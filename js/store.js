// Simple localStorage-backed store with JSON export/import.
// Every list record has a stable `id` and an `updatedAt` (ms) so devices can be merged (see js/sync-merge.js).
// Deleting a record leaves a tombstone in data.deleted[collection] so the delete syncs too.
window.Store = (() => {
  const CFG=window.GS_CONFIG||{};
  const KEY=CFG.STORE_KEY||'guitarStudio.v1';
  const SM=window.SyncMerge;
  const DEFAULT_S1 = {id:'s1', title:'Slow Dancing in a Burning Room', artist:'John Mayer', status:'Learning', key:'C#m', tuning:'Standard', tempo:70, curTempo:'',
       sections:'Intro riff (C#m–A–E–B feel, hybrid picking)\nVerse comping\nChorus\nSolo phrasing', notes:'Current focus. Bend intonation on the intro; keep thumb steady on the bass notes.', links:'', added:'2026-08-16'};
  const defaults = () => ({
    sessions: [],
    songs: [ Object.assign({updatedAt:0}, DEFAULT_S1) ],
    prefs: {useFlats:false},
    version:1,
  });
  let data;
  let loadFailed=false, rawBackupKey=null, rawCorrupt=null;
  let onError=null; // set by App: called with {type:'load'|'save', error}
  const changeListeners=[];

  const isObj = (v) => v!=null && typeof v==='object' && !Array.isArray(v);
  // Escape user text for innerHTML (& < > " ').
  const esc = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  // Local calendar date (YYYY-MM-DD) for a timestamp/Date — never UTC.
  const localDate = (ts) => { const d = ts==null ? new Date() : new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const uid = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);
  // A fresh edit timestamp: now, but always later than the record's previous one (guards against clock skew).
  const stamp = (prev) => Math.max(Date.now(), (+prev||0)+1);

  // Fill in missing fields so older / hand-edited data can't crash the UI. Additive only.
  // Records without an id get a deterministic content-hash id (in SyncMerge.normalize), so the same
  // old record on two devices doesn't turn into two records.
  function normSession(s){
    if(!isObj(s)) return null;
    if(typeof s.date!=='string' || !/^\d{4}-\d{2}-\d{2}/.test(s.date)) s.date = s.created ? localDate(s.created) : localDate();
    if(typeof s.created!=='string') s.created='';
    if(!Array.isArray(s.cats)) s.cats=[];
    s.minutes = +s.minutes||0;
    return s;
  }
  const isPristineDefault=(s)=>{ const {updated, updatedAt, ...rest}=s; return JSON.stringify(rest)===JSON.stringify(DEFAULT_S1); };
  function normSong(s){
    if(!isObj(s)) return null;
    if(typeof s.title!=='string') s.title=String(s.title||'Untitled');
    if(!['Want','Learning','Polishing','Can play'].includes(s.status)) s.status='Want';
    if(typeof s.updatedAt!=='number' || !isFinite(s.updatedAt)){
      // older versions kept an `updated` edit time on songs; an edited seed song without one still beats the pristine seed (0)
      s.updatedAt = (+s.updated>0) ? +s.updated : (s.id==='s1' && !isPristineDefault(s) ? 1 : 0);
    }
    return s;
  }
  function normalize(d){
    if(!Array.isArray(d.sessions)) d.sessions=[];
    if(!Array.isArray(d.songs)) d.songs=[];
    if(!isObj(d.prefs)) d.prefs={};
    d.sessions=d.sessions.map(normSession).filter(Boolean);
    d.songs=d.songs.map(normSong).filter(Boolean);
    if(d.quiz!=null && (!isObj(d.quiz) || !Array.isArray(d.quiz.attempts))) d.quiz={attempts:[]};
    if(d.videos!=null && !isObj(d.videos)) d.videos={};
    return SM.normalize(d);
  }

  function load(){
    let raw=null;
    try{ raw=localStorage.getItem(KEY); }catch(e){ raw=null; }
    try{
      const parsed = JSON.parse(raw||'{}');
      if(!isObj(parsed)) throw new Error('Stored data is not an object');
      data = normalize(Object.assign(defaults(), parsed));
      loadFailed=false;
    }catch(e){
      // Never overwrite unreadable data: keep a copy and refuse to save until the user decides.
      data = normalize(defaults());
      loadFailed=true; rawCorrupt=raw;
      // reuse an identical backup from an earlier load instead of piling up copies
      try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.startsWith(KEY+'.corrupt-') && localStorage.getItem(k)===(raw||'')){ rawBackupKey=k; break; } } }catch(e2){}
      if(!rawBackupKey){ rawBackupKey = KEY+'.corrupt-'+Date.now();
        try{ localStorage.setItem(rawBackupKey, raw||''); }catch(e2){ rawBackupKey=null; } }
      console.error('Guitar Studio: could not read saved data', e);
    }
    return data;
  }
  // save() persists and tells listeners (the sync engine) that something changed.
  // save({silent:true}) is used by sync itself so a merged download doesn't schedule another upload.
  function save(opts){
    if(loadFailed) return false; // protect the unreadable original until the user chooses
    try{ localStorage.setItem(KEY, JSON.stringify(data)); }
    catch(e){ console.error('Guitar Studio: save failed', e); onError && onError({type:'save', error:e}); return false; }
    if(!(opts && opts.silent)) changeListeners.forEach(fn=>{ try{ fn(); }catch(e){ console.error(e); } });
    return true;
  }
  // User chose "Start fresh" after a failed load (the raw copy stays in its backup key).
  function startFresh(){ loadFailed=false; data=normalize(defaults()); return save(); }

  // ---- Mutation helpers (every edit goes through these so it syncs correctly) ----
  function touch(rec){ if(rec) rec.updatedAt=stamp(rec.updatedAt); return rec; }
  // Remove a record and leave a tombstone. collection: 'sessions' | 'songs' | 'videos' (videos: id = file name).
  function remove(collection, id){
    if(id==null) return;
    id=String(id);
    let prev=0;
    if(collection==='videos'){ if(isObj(data.videos) && data.videos[id]){ prev=data.videos[id].updatedAt; delete data.videos[id]; } }
    else { const arr=data[collection]||[]; const r=arr.find(x=>x.id===id); if(r) prev=r.updatedAt; data[collection]=arr.filter(x=>x.id!==id); }
    if(!isObj(data.deleted)) data.deleted={};
    const list=data.deleted[collection]=(data.deleted[collection]||[]).filter(t=>t.id!==id);
    list.push({id, deleted:true, updatedAt:stamp(prev)});
  }
  function setPref(k, v){
    if(!isObj(data.prefs)) data.prefs={};
    if(!isObj(data.prefsMeta)) data.prefsMeta={};
    data.prefs[k]=v; data.prefsMeta[k]=stamp(data.prefsMeta[k]);
  }
  // Sync: swap in merged data (already normalized by SyncMerge) and persist without re-triggering sync.
  function replaceData(next){
    if(loadFailed) return false;
    const prev=data; data=normalize(next);
    if(!save({silent:true})){ data=prev; return false; }
    return true;
  }

  // iPhone/iPad (iPadOS reports itself as a Mac with touch). There, <a download> is unreliable —
  // especially in a home-screen app — so hand files to the Share sheet ("Save to Files", "Save Video").
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  // Save a Blob as a file. Call it directly from a tap/click (the Share sheet needs a user gesture).
  async function saveFile(blob, name){
    if(isIOS && navigator.canShare && window.File){
      try{
        const file=new File([blob], name, {type:blob.type||'application/octet-stream'});
        if(navigator.canShare({files:[file]})){ await navigator.share({files:[file]}); return 'shared'; }
      }catch(e){ if(e && e.name==='AbortError') return 'cancelled'; console.warn('Share failed, falling back to download', e); }
    }
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),10000);
    return 'downloaded';
  }
  function exportJSON(){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    return saveFile(blob, `guitar-studio-backup-${localDate()}.json`);
  }
  function exportRaw(){
    const blob=new Blob([rawCorrupt||''],{type:'text/plain'});
    return saveFile(blob, `guitar-studio-raw-${localDate()}.txt`);
  }
  // Merge a backup into the current data, using the same rules as sync. On an exact timestamp tie the
  // local copy is kept, so importing an old backup never overwrites local edits made without timestamps.
  function mergeData(inc){
    if(!isObj(inc)) throw new Error('Not a Guitar Studio backup (expected a JSON object).');
    inc=normalize(Object.assign({}, JSON.parse(JSON.stringify(inc))));
    const before=data;
    const merged=normalize(SM.merge(before, inc, {tiePrefer:'local'}));
    const ids=(arr)=>new Map((arr||[]).map(r=>[r.id,SM.stable(r)]));
    const bS=ids(before.sessions), bG=ids(before.songs);
    const c={sessions:0, songsAdded:0, songsUpdated:0, attempts:0, videos:0};
    merged.sessions.forEach(s=>{ if(!bS.has(s.id)) c.sessions++; });
    merged.songs.forEach(s=>{ if(!bG.has(s.id)) c.songsAdded++; else if(bG.get(s.id)!==SM.stable(s)) c.songsUpdated++; });
    const bA=new Set(((before.quiz&&before.quiz.attempts)||[]).map(a=>a.id));
    ((merged.quiz&&merged.quiz.attempts)||[]).forEach(a=>{ if(!bA.has(a.id)) c.attempts++; });
    const bV=before.videos||{}; Object.keys(merged.videos||{}).forEach(n=>{ if(!bV[n]) c.videos++; });
    data=merged;
    return c;
  }
  function importJSON(file, cb){
    const r=new FileReader();
    r.onload=()=>{ try{
        const inc=JSON.parse(r.result);
        // Importing a backup is a way out of a failed load — but only once the unreadable original is safely copied.
        if(loadFailed){ if(!rawBackupKey) throw new Error('Your current data could not be read. Use "Export raw backup" first.'); loadFailed=false; }
        const counts=mergeData(inc); if(!save()) throw new Error('Could not save the merged data.'); cb&&cb(null,counts); }
      catch(e){ cb&&cb(e); } };
    r.onerror=()=>cb&&cb(r.error||new Error('Could not read file'));
    r.readAsText(file);
  }
  load();
  return {get:()=>data, save, uid, esc, localDate, exportJSON, exportRaw, importJSON, mergeData, load, startFresh, saveFile, isIOS,
    touch, remove, setPref, replaceData, stamp, onChange:(fn)=>changeListeners.push(fn), KEY,
    loadFailed:()=>loadFailed, backupKey:()=>rawBackupKey, setErrorHandler:(fn)=>{ onError=fn; }};
})();
