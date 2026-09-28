// A small in-memory GitHub (repo + Git Data API) for tests. Replaces window.fetch for https://api.github.com/*.
// Blob shas are real git blob shas (SHA-1 of "blob <len>\0<content>"), so the app's own sha comparisons work.
// Trees are stored flat (full path -> blob sha); sub-tree shas are "<tree>:<dir>" so non-recursive listings work.
//
//   GitHubMock.install({persistState})       patch fetch (persistState keeps the repo in localStorage across reloads)
//   GitHubMock.addToken(tok, {valid, access, write, push})
//   GitHubMock.files()                     {path: text} at the head of main
//   GitHubMock.commitFiles({path: text|null}, message)   commit directly (another app / a hand edit)
//   GitHubMock.set({offline, rateLimited, serverError, truncate})
//   GitHubMock.beforeRefUpdate(async fn)   runs once, just before the next PATCH of the ref (to simulate a race)
//   GitHubMock.calls(filter)               recorded requests [{method, path, url, headers, body, status}]
(function(){
  'use strict';
  const API='https://api.github.com';
  const OWNER='tjmitch4', REPO='studio-data';
  const LS='gsMock.github';
  let st, persist=false, realFetch=null, hook=null, calls=[];
  const enc=new TextEncoder();

  function fresh(){ return {blobs:{}, trees:{}, commits:{}, ref:null, n:0, tokens:{}, flags:{}}; }
  function save(){ if(persist) try{ localStorage.setItem(LS, JSON.stringify(st)); }catch(e){} }
  function load(){ try{ const s=JSON.parse(localStorage.getItem(LS)||'null'); if(s && s.blobs) return s; }catch(e){} return null; }

  async function sha1hex(bytes){ const d=new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)); return Array.from(d,b=>b.toString(16).padStart(2,'0')).join(''); }
  async function blobSha(text){ const body=enc.encode(text); const head=enc.encode('blob '+body.length+'\0'); const b=new Uint8Array(head.length+body.length); b.set(head); b.set(body,head.length); return sha1hex(b); }
  async function putBlob(text){ const sha=await blobSha(text); st.blobs[sha]=text; return sha; }
  const id=(p)=>{ st.n++; return p+String(st.n).padStart(6,'0')+Math.random().toString(16).slice(2,10); };
  function b64(text){ const bytes=enc.encode(text); let bin=''; bytes.forEach(b=>bin+=String.fromCharCode(b)); return btoa(bin).replace(/(.{60})/g,'$1\n'); }

  async function commitMap(map, message, parent){
    const t=id('t'); st.trees[t]=map;
    const c=id('c'); st.commits[c]={tree:t, parents:parent?[parent]:[], message};
    return c;
  }
  async function init(){
    st=fresh();
    const map={'README.md':await putBlob('# studio-data\n\nPrivate data for Lift Studio and Guitar Studio.\n'), 'lift/.gitkeep':await putBlob(''), 'guitar/.gitkeep':await putBlob('')};
    st.ref=await commitMap(map,'Initial commit',null);
    save();
  }

  function headMap(){ return Object.assign({}, st.trees[st.commits[st.ref].tree]); }
  function listing(treeId, recursive){
    const [root, dir]=String(treeId).split(':'); const map=st.trees[root]; if(!map) return null;
    const pre=dir?dir+'/':'';
    const out=[]; const dirs=new Set();
    Object.keys(map).sort().forEach(p=>{
      if(!p.startsWith(pre)) return; const rel=p.slice(pre.length);
      const parts=rel.split('/');
      for(let i=1;i<parts.length;i++){ const d=parts.slice(0,i).join('/'); if(!dirs.has(d) && (recursive || i===1)){ dirs.add(d); out.push({path:d, mode:'040000', type:'tree', sha:root+':'+pre+d}); } }
      if(recursive || parts.length===1) out.push({path:rel, mode:'100644', type:'blob', sha:map[p], size:enc.encode(st.blobs[map[p]]||'').length});
    });
    return out;
  }

  function respond(status, body, headers){
    const h=Object.assign({'content-type':'application/json; charset=utf-8', 'x-ratelimit-limit':'5000', 'x-ratelimit-remaining':'4999', 'x-ratelimit-reset':String(Math.floor(Date.now()/1000)+3600)}, headers||{});
    return new Response(body==null?null:JSON.stringify(body), {status, headers:h});
  }

  async function handle(url, init){
    const u=new URL(url); const method=(init && init.method)||'GET';
    const headers={}; const hin=(init && init.headers)||{}; Object.keys(hin).forEach(k=>headers[k.toLowerCase()]=hin[k]);
    const body=init && init.body ? JSON.parse(init.body) : undefined;
    const rec={method, path:u.pathname+u.search, url, headers, body, cache:init && init.cache}; calls.push(rec);
    const F=st.flags;
    if(F.offline){ rec.status='offline'; throw new TypeError('Failed to fetch'); }
    const fin=(r)=>{ rec.status=r.status; return r; };
    if(F.rateLimited) return fin(respond(403,{message:'API rate limit exceeded'},{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.floor(Date.now()/1000)+600)}));
    if(F.serverError) return fin(respond(502,{message:'Bad gateway'}));
    const auth=headers['authorization']||''; const tok=auth.replace(/^Bearer /,'');
    const T=st.tokens[tok];
    if(!T || !T.valid) return fin(respond(401,{message:'Bad credentials'}));
    const base=`/repos/${OWNER}/${REPO}`;
    if(!u.pathname.startsWith(base) || !T.access) return fin(respond(404,{message:'Not Found'}));
    const p=u.pathname.slice(base.length);
    const recursive=u.searchParams.get('recursive')==='1';
    let m;
    if(method==='GET' && p===''){ return fin(respond(200,{full_name:OWNER+'/'+REPO, private:true, default_branch:'main', permissions:{admin:!!T.push, push:!!T.push, pull:true}})); }
    if(method==='POST' && p==='/git/blobs'){ if(!T.write) return fin(respond(403,{message:'Resource not accessible by personal access token'})); const sha=await putBlob(body.content||''); save(); return fin(respond(201,{sha})); }
    if(method==='GET' && p==='/git/ref/heads/main'){ return fin(respond(200,{ref:'refs/heads/main', object:{sha:st.ref, type:'commit'}})); }
    if(method==='GET' && (m=p.match(/^\/git\/commits\/(\w+)$/))){ const c=st.commits[m[1]]; if(!c) return fin(respond(404,{message:'Not Found'})); return fin(respond(200,{sha:m[1], tree:{sha:c.tree}, parents:c.parents.map(s=>({sha:s})), message:c.message})); }
    if(method==='GET' && (m=p.match(/^\/git\/trees\/([\w:.\/-]+)$/))){
      const tid=decodeURIComponent(m[1]); const l=listing(tid, recursive); if(!l) return fin(respond(404,{message:'Not Found'}));
      const truncated=!!(recursive && F.truncate && !tid.includes(':'));
      return fin(respond(200,{sha:tid, tree:truncated?l.slice(0,3):l, truncated}));
    }
    if(method==='GET' && (m=p.match(/^\/git\/blobs\/(\w+)$/))){ const t=st.blobs[m[1]]; if(t==null) return fin(respond(404,{message:'Not Found'})); return fin(respond(200,{sha:m[1], encoding:'base64', content:b64(t), size:enc.encode(t).length})); }
    if(!T.write && method!=='GET') return fin(respond(403,{message:'Resource not accessible by personal access token'}));
    if(method==='POST' && p==='/git/trees'){
      const baseMap=Object.assign({}, st.trees[body.base_tree]||{});
      if(body.base_tree && !st.trees[body.base_tree]) return fin(respond(422,{message:'Invalid tree info'}));
      for(const e of body.tree){
        if(e.sha===null){ if(!(e.path in baseMap)) return fin(respond(422,{message:'GitRPC::BadObjectState'})); delete baseMap[e.path]; }
        else if(typeof e.content==='string'){ baseMap[e.path]=await putBlob(e.content); }
        else if(e.sha){ baseMap[e.path]=e.sha; }
      }
      const t=id('t'); st.trees[t]=baseMap; save(); return fin(respond(201,{sha:t, tree:[]}));
    }
    if(method==='POST' && p==='/git/commits'){ if(!st.trees[body.tree]) return fin(respond(422,{message:'Tree not found'})); const c=id('c'); st.commits[c]={tree:body.tree, parents:body.parents||[], message:body.message}; save(); return fin(respond(201,{sha:c})); }
    if(method==='PATCH' && p==='/git/refs/heads/main'){
      if(hook){ const h=hook; hook=null; await h(); }
      const c=st.commits[body.sha]; if(!c) return fin(respond(422,{message:'Object does not exist'}));
      if(!body.force && !c.parents.includes(st.ref)) return fin(respond(422,{message:'Update is not a fast forward'}));
      st.ref=body.sha; save(); return fin(respond(200,{ref:'refs/heads/main', object:{sha:body.sha}}));
    }
    return fin(respond(404,{message:'Not Found (mock)'}));
  }

  const api={
    async install(opts){
      opts=opts||{}; persist=!!opts.persistState;
      st=persist?load():null; if(!st) await init();
      if(!realFetch){ realFetch=window.fetch.bind(window); window.fetch=(url, init)=>{ const s=typeof url==='string'?url:url.url; if(s.startsWith(API+'/')) return handle(s, init); return realFetch(url, init); }; }
    },
    async reset(){ await init(); calls=[]; hook=null; },
    addToken(tok, o){ st.tokens[tok]=Object.assign({valid:true, access:true, write:true, push:true}, o||{}); save(); },
    set(flags){ Object.assign(st.flags, flags); save(); },
    files(){ const m=headMap(); const out={}; Object.keys(m).forEach(p=>out[p]=st.blobs[m[p]]); return out; },
    shaOf(path){ return headMap()[path]; },
    head(){ return st.ref; },
    commit(sha){ return st.commits[sha||st.ref]; },
    commitCount(){ let n=0, c=st.ref; while(c){ n++; c=st.commits[c].parents[0]; } return n; },
    async commitFiles(changes, message){
      const map=headMap();
      for(const p of Object.keys(changes)){ if(changes[p]==null) delete map[p]; else map[p]=await putBlob(changes[p]); }
      st.ref=await commitMap(map, message||'edit', st.ref); save();
    },
    // A brand-new history (repo deleted and recreated): only README + .gitkeeps, unrelated to the old commits.
    async recreate(){ const map={'README.md':await putBlob('# studio-data\n'),'lift/.gitkeep':await putBlob(''), 'guitar/.gitkeep':await putBlob('')}; st.ref=await commitMap(map,'Initial commit',null); save(); },
    beforeRefUpdate(fn){ hook=fn; },
    calls(filter){ return calls.filter(c=>!filter || (typeof filter==='function'?filter(c):c.path.includes(filter))); },
    clearCalls(){ calls=[]; },
    blobSha,
  };
  window.GitHubMock=api;
})();
