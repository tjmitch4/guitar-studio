// The GitHub sync plan: which remote files to read, how they merge into local data, and which files to write.
// No network and no storage here (js/sync.js does those), so every step is testable with plain objects.
//
// Bookkeeping kept on each device (meta.files) mirrors the repo's guitar/ folder at the last successful sync:
//   {path: {sha, key, u, h, bad}}   sha = git blob sha, key = which record the file holds ('session:<id>',
//   'song:<id>', 'trainer:YYYY-MM', 'videos', 'settings', 'progress'), u = the record's updatedAt when synced,
//   h = hash of the record when synced, bad = the file couldn't be parsed (left alone, never written/deleted).
//
// Rules (see README "How sync works"):
// - Only files whose blob sha changed since the last sync are downloaded, parsed and merged (js/sync-merge.js).
// - A session/song file that disappeared remotely was deleted on another device: the local record goes too,
//   unless it was edited here since the last sync (then the edit wins and the file comes back).
// - A local delete removes the file. Tombstones for records with deterministic ids (the seeded song, content-hash
//   ids of old records) are also kept in settings.md, so a device that has never synced can't bring them back.
// - Files are only written when their content actually differs (deterministic serialization, compared by git
//   blob sha), so an idle device never commits.
(function(root){
  'use strict';
  const SM=root.SyncMerge, MD=root.MdFormat;
  const REC=['sessions','songs'];
  const KEYP={sessions:'session:', songs:'song:'};
  const keyOf=(kind,id)=>KEYP[kind]+id;
  const parseKey=(key)=>{ const i=String(key||'').indexOf(':'); if(i<0) return null; const k=key.slice(0,i); const kind=k==='session'?'sessions':k==='song'?'songs':null; return kind?{kind, id:key.slice(i+1)}:null; };
  const recHash=(r)=>SM.hash(SM.stable(r));
  // Ids that two devices can create independently (seed song, content-hash ids of old id-less records).
  const isDeterministicId=(id)=>id==='s1' || /^h[0-9a-z]{1,11}(-\d+)?$/.test(String(id));
  const monthEnd=(mo)=>{ const [y,m]=mo.split('-').map(Number); return Date.UTC(y,m,1)-1; };

  // Step 1: remote paths to download. tree: Map(path -> blob sha) for everything under guitar/.
  function needFetch(tree, meta, local){
    const files=(meta&&meta.files)||{};
    const live={}, dead={};
    REC.forEach(k=>{ live[k]=new Set((local[k]||[]).map(r=>r.id)); dead[k]=new Set(((local.deleted&&local.deleted[k])||[]).map(t=>t.id)); });
    const months=new Set(((local.quiz&&local.quiz.attempts)||[]).map(a=>MD.monthKey(a.ts)));
    const resetAt=(local.quiz&&+local.quiz.resetAt)||0;
    const out=[];
    tree.forEach((sha,path)=>{
      const kind=MD.kindOf(path); if(!kind) return;
      const m=files[path];
      if(!m || m.sha!==sha){ out.push(path); return; }
      if(m.bad) return;
      // Unchanged since the last sync: this device already holds it — unless it has lost it (storage cleared).
      if(kind==='sessions' || kind==='songs'){ const pk=parseKey(m.key); if(pk && !live[pk.kind].has(pk.id) && !dead[pk.kind].has(pk.id)) out.push(path); }
      else if(kind==='trainer'){ const mo=path.slice(-10,-3); if(!months.has(mo) && !(resetAt && resetAt>=monthEnd(mo))) out.push(path); }
      else if(kind==='videos'){ if(!Object.keys(local.videos||{}).length && !((local.deleted&&local.deleted.videos)||[]).length) out.push(path); }
      else if(kind==='settings'){ if(!Object.keys(local.prefsMeta||{}).length && !resetAt && !(local.sessions||[]).length) out.push(path); }
    });
    return out;
  }

  // Keep the local order of records (remote-only ones go at the end) so a sync doesn't shuffle the UI.
  function keepOrder(merged, local){
    REC.forEach(k=>{
      const pos=new Map((local[k]||[]).map((r,i)=>[r.id,i]));
      const idx=new Map(merged[k].map((r,i)=>[r.id,i]));
      merged[k].sort((a,b)=>{ const pa=pos.has(a.id)?pos.get(a.id):1e9+idx.get(a.id), pb=pos.has(b.id)?pos.get(b.id):1e9+idx.get(b.id); return pa-pb; });
    });
    return merged;
  }

  // Step 2: parse what was downloaded and merge it into local data.
  // fetched: {path: text}. Returns {merged, keyPaths: Map(key -> [paths]), bad: Set(paths), warnings[], remoteDeleted, handEdits}.
  function mergeRemote(local, meta, tree, fetched, now){
    now=now||Date.now();
    const files=(meta&&meta.files)||{};
    const warnings=[], bad=new Set(), keyPaths=new Map();
    const add=(k,p)=>{ if(!keyPaths.has(k)) keyPaths.set(k,[]); keyPaths.get(k).push(p); };
    const recs={sessions:new Map(), songs:new Map()};
    const localById={}; REC.forEach(k=>{ localById[k]=new Map((local[k]||[]).map(r=>[r.id,r])); });
    const remote={sessions:[], songs:[], deleted:{sessions:[], songs:[], videos:[]}, prefs:{}, prefsMeta:{}};
    let attempts=null, resetAt=0, videos=null, handEdits=0;
    tree.forEach((sha,path)=>{
      const kind=MD.kindOf(path); if(!kind) return;
      const m=files[path];
      if(!Object.prototype.hasOwnProperty.call(fetched,path)){
        if(m && m.key) add(m.key,path);
        if(m && m.bad && m.sha===sha) bad.add(path);
        return;
      }
      let p;
      try{ p=MD.parseFile(path, fetched[path]); if(!p) throw new Error('unrecognised file'); }
      catch(e){ bad.add(path); warnings.push(`${path}: ${e.message} — skipped (left as it is on GitHub)`); if(m && m.key) add(m.key,path); return; }
      if(kind==='sessions' || kind==='songs'){
        const r=p.record; const key=keyOf(kind,r.id); add(key,path);
        // Edited by hand (e.g. on github.com or by Claude) without raising updatedAt: treat it as a new edit.
        if(m && m.key===key && typeof m.h==='string' && (+r.updatedAt||0)<=(+m.u||0) && recHash(r)!==m.h){
          const lr=localById[kind].get(r.id);
          r.updatedAt=Math.max(now, (+m.u||0)+1, lr?(+lr.updatedAt||0)+1:0); handEdits++;
        }
        recs[kind].set(r.id, SM.winner(recs[kind].get(r.id), r));
      } else if(kind==='trainer'){ attempts=(attempts||[]).concat(p.attempts); add('trainer:'+path.slice(-10,-3), path); }
      else if(kind==='videos'){ videos=p.videos; remote.deleted.videos=p.deleted; add('videos',path); }
      else if(kind==='settings'){
        remote.prefs=p.prefs; remote.prefsMeta=p.prefsMeta; resetAt=p.quizResetAt;
        remote.deleted.sessions=p.tombstones.sessions; remote.deleted.songs=p.tombstones.songs; add('settings',path);
      }
    });
    remote.sessions=[...recs.sessions.values()]; remote.songs=[...recs.songs.values()];
    if(attempts || resetAt){ remote.quiz={attempts:attempts||[]}; if(resetAt) remote.quiz.resetAt=resetAt; }
    if(videos) remote.videos=videos;
    const merged=keepOrder(SM.merge(local, remote), local);

    // Files that vanished remotely since the last sync = deleted on another device.
    let remoteDeleted=0;
    Object.keys(files).forEach(path=>{
      const m=files[path]; if(!m.key || tree.has(path)) return;
      const pk=parseKey(m.key); if(!pk || keyPaths.has(m.key)) return; // renamed/moved, not deleted
      const i=merged[pk.kind].findIndex(r=>r.id===pk.id); if(i<0) return;
      if((+merged[pk.kind][i].updatedAt||0)===(+m.u||0)){ merged[pk.kind].splice(i,1); remoteDeleted++; }
    });
    return {merged, keyPaths, bad, warnings, remoteDeleted, handEdits};
  }

  // Step 3: the files to write/delete for `data` (a snapshot of the merged local data).
  // opts: {sha: async text -> git blob sha, today: 'YYYY-MM-DD', device: label}
  // Returns {writes: [{path, content|null}], files (new meta.files), changed (data files changed), drop (tombstones to forget after commit)}.
  async function planWrites(data, meta, tree, keyPaths, bad, opts){
    const files=(meta&&meta.files)||{};
    const P=MD.PATHS;
    const writes=[], newFiles={}, drop=[];
    const pathKey=new Map(); keyPaths.forEach((ps,k)=>ps.forEach(p=>pathKey.set(p,k)));
    const metaPathOf=new Map(); Object.keys(files).forEach(p=>{ const k=files[p].key; if(k && !metaPathOf.has(k)) metaPathOf.set(k,p); });
    tree.forEach((sha,path)=>{
      const m=files[path];
      const e=(m && m.sha===sha)? Object.assign({},m) : {sha, key:pathKey.get(path)||(m&&m.key)||null};
      if(bad.has(path)) e.bad=true; else delete e.bad;
      newFiles[path]=e;
    });
    const frozen=new Set(); bad.forEach(p=>{ const k=pathKey.get(p); if(k) frozen.add(k); });
    const used=new Set(tree.keys());
    const put=async(path, content, info)=>{
      const sha=await opts.sha(content);
      if(tree.get(path)!==sha) writes.push({path, content});
      newFiles[path]=Object.assign({sha}, info); used.add(path);
    };
    const del=(path)=>{ if(bad.has(path) || !tree.has(path) || writes.some(w=>w.path===path)) return; writes.push({path, content:null}); delete newFiles[path]; };

    for(const kind of REC){
      for(const rec of (data[kind]||[])){
        const key=keyOf(kind,rec.id); if(frozen.has(key)) continue;
        const paths=(keyPaths.get(key)||[]).slice().sort();
        let path=paths[0];
        if(!path){ const old=metaPathOf.get(key); path=(old && MD.kindOf(old)===kind && !used.has(old))? old : MD.recordPath(kind, rec, p=>used.has(p)); }
        paths.slice(1).forEach(del); // the same record in two files: keep one
        const h=recHash(rec), u=+rec.updatedAt||0, m=files[path];
        if(m && m.key===key && m.h===h && !m.bad && tree.has(path) && tree.get(path)===m.sha){ newFiles[path]=Object.assign({},m,{u}); used.add(path); continue; }
        await put(path, kind==='sessions'?MD.sessionMd(rec):MD.songMd(rec), {key, u, h});
      }
      for(const t of ((data.deleted&&data.deleted[kind])||[])){
        const ps=keyPaths.get(keyOf(kind,t.id))||[];
        ps.forEach(del);
        if(!isDeterministicId(t.id) && ps.every(p=>!bad.has(p))) drop.push({kind, id:t.id, updatedAt:t.updatedAt});
      }
    }
    // trainer answers by month; months emptied by a reset or the cap lose their file
    const tf=MD.trainerFiles(data.quiz);
    for(const path of Object.keys(tf).sort()){ if(!bad.has(path)) await put(path, tf[path].content, {key:'trainer:'+tf[path].month}); }
    tree.forEach((sha,path)=>{ if(MD.kindOf(path)==='trainer' && !tf[path]) del(path); });
    // video notes
    const vt=(data.deleted&&data.deleted.videos)||[];
    if(!bad.has(P.videos) && (Object.keys(data.videos||{}).length || vt.length || tree.has(P.videos))) await put(P.videos, MD.videosMd(data.videos||{}, vt), {key:'videos'});
    // settings (+ tombstones of deterministic ids)
    if(!bad.has(P.settings)){
      const s={prefs:data.prefs||{}, prefsMeta:data.prefsMeta||{}};
      if(data.quiz && data.quiz.resetAt) s.quizResetAt=data.quiz.resetAt;
      const tomb={}; REC.forEach(k=>{ const l=((data.deleted&&data.deleted[k])||[]).filter(t=>isDeterministicId(t.id)).map(t=>({id:t.id, deleted:true, updatedAt:+t.updatedAt||0})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0); if(l.length) tomb[k]=l; });
      if(Object.keys(tomb).length) s.tombstones=tomb;
      await put(P.settings, MD.settingsMd(s), {key:'settings'});
    }
    const changed=writes.length;
    // the coaching summary: regenerated whenever data changed (or if it's missing)
    if(changed || !tree.has(P.progress)) await put(P.progress, MD.progressMd(data, {today:opts.today, device:opts.device}), {key:'progress'});
    return {writes, files:newFiles, changed, drop};
  }

  // git's blob id: sha1("blob <byte length>\0<content>")
  async function gitBlobSha(text){
    const enc=new TextEncoder(); const body=enc.encode(text); const head=enc.encode('blob '+body.length+'\0');
    const buf=new Uint8Array(head.length+body.length); buf.set(head,0); buf.set(body,head.length);
    const d=new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
    return Array.from(d, b=>b.toString(16).padStart(2,'0')).join('');
  }

  root.SyncPlan={needFetch, mergeRemote, planWrites, gitBlobSha, isDeterministicId, keyOf, parseKey};
})(typeof window!=='undefined'?window:this);
