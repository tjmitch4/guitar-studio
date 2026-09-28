// Minimal GitHub REST client for the private data repo (Git Data API). The token is a fine-grained personal
// access token pasted by the user; it lives only in localStorage (GS_CONFIG.TOKEN_KEY, shared with Lift Studio)
// and is only ever sent in the Authorization header to api.github.com — never logged, never in a URL.
window.GH = (() => {
  const C=window.GS_CONFIG;
  const repoPath=()=>`/repos/${encodeURIComponent(C.GH_OWNER)}/${encodeURIComponent(C.GH_REPO)}`;

  // kind: network | auth | notfound | forbidden | readonly | ratelimit | conflict | server | api
  class GhError extends Error{
    constructor(kind, message, extra){ super(message); this.name='GhError'; this.kind=kind; Object.assign(this, extra||{}); }
  }

  function token(){ try{ return localStorage.getItem(C.TOKEN_KEY)||''; }catch(e){ return ''; } }
  function setToken(t){ localStorage.setItem(C.TOKEN_KEY, t); }
  function clearToken(){ try{ localStorage.removeItem(C.TOKEN_KEY); }catch(e){} }

  let rate={remaining:null, reset:0};
  async function req(method, path, body, tok){
    const t=tok||token();
    if(!t) throw new GhError('auth','Not connected to GitHub.');
    const headers={'Authorization':'Bearer '+t, 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'};
    if(body!==undefined) headers['Content-Type']='application/json';
    let res;
    try{ res=await fetch(C.GH_API+path, {method, headers, body:body===undefined?undefined:JSON.stringify(body), cache:'no-store'}); }
    catch(e){ throw new GhError('network','Can\'t reach GitHub (offline?).'); }
    const h=(n)=>res.headers && res.headers.get(n);
    const rem=h('x-ratelimit-remaining'), rst=h('x-ratelimit-reset');
    if(rem!=null) rate={remaining:+rem, reset:rst?(+rst)*1000:0};
    if(res.ok){ if(res.status===204) return null; try{ return await res.json(); }catch(e){ return null; } }
    let msg=''; try{ const j=await res.json(); msg=(j && j.message)||''; }catch(e){}
    const st=res.status;
    if(st===401) throw new GhError('auth','GitHub rejected the token (expired, revoked or mistyped).', {status:st});
    const retryAfter=+h('retry-after')||0;
    if(st===429 || ((st===403) && (rem==='0' || retryAfter || /rate limit/i.test(msg)))){
      const until=retryAfter? Date.now()+retryAfter*1000 : (rst? (+rst)*1000 : Date.now()+60000);
      throw new GhError('ratelimit','GitHub rate limit reached — sync resumes at '+new Date(until).toLocaleTimeString()+'.', {status:st, until});
    }
    if(st===403) throw new GhError('forbidden', msg||'GitHub refused the request.', {status:st});
    if(st===404) throw new GhError('notfound', msg||'Not found.', {status:st});
    if(st===409 || st===422) throw new GhError('conflict', msg||'Conflict.', {status:st});
    if(st>=500) throw new GhError('server','GitHub is having trouble ('+st+').', {status:st});
    throw new GhError('api', (msg||'GitHub error')+' ('+st+')', {status:st});
  }

  // Check a token before saving it: the repo must be visible and writable.
  // Returns {private} or throws a GhError with a message meant for the user.
  async function validate(tok){
    const repoName=`${C.GH_OWNER}/${C.GH_REPO}`;
    let repo;
    try{ repo=await req('GET', repoPath(), undefined, tok); }
    catch(e){
      if(e.kind==='auth') throw new GhError('auth','GitHub says this token is not valid (401). Check you copied all of it, and that it hasn\'t expired.');
      if(e.kind==='notfound') throw new GhError('notfound',`This token can't see ${repoName} (404). When creating it, choose "Only select repositories" → ${C.GH_REPO}.`);
      throw e;
    }
    if(!repo || !repo.permissions || !repo.permissions.push)
      throw new GhError('readonly',`This token can read ${repoName} but not write to it. Set Repository permissions → Contents to "Read and write".`);
    // Fine-grained tokens report the *user's* repo permissions above, so also prove the token itself can write:
    // creating a blob needs Contents: write and leaves nothing behind (an unreferenced blob is garbage-collected).
    try{ await req('POST', repoPath()+'/git/blobs', {content:'', encoding:'utf-8'}, tok); }
    catch(e){
      if(e.kind==='forbidden' || e.kind==='notfound') throw new GhError('readonly',`This token is read-only for ${repoName}. Set Repository permissions → Contents to "Read and write".`);
      throw e;
    }
    return {private:!!repo.private};
  }

  // ---- Git Data API ----
  async function headSha(){ const r=await req('GET', repoPath()+'/git/ref/heads/'+encodeURIComponent(C.GH_BRANCH)); return r.object.sha; }
  async function commitTreeSha(sha){ const r=await req('GET', repoPath()+'/git/commits/'+sha); return r.tree.sha; }
  // Blobs under `prefix`, as [{path, sha}]. Uses one recursive listing; if GitHub truncates it, walks down to the prefix folder.
  async function listPrefix(treeSha, prefix){
    const pick=(entries, base)=>entries.filter(e=>e.type==='blob').map(e=>({path:base+e.path, sha:e.sha})).filter(e=>e.path.startsWith(prefix));
    const r=await req('GET', repoPath()+'/git/trees/'+treeSha+'?recursive=1');
    if(!r.truncated) return pick(r.tree||[], '');
    let sha=treeSha, base='';
    for(const part of prefix.replace(/\/$/,'').split('/')){
      const t=await req('GET', repoPath()+'/git/trees/'+sha);
      const e=(t.tree||[]).find(x=>x.path===part && x.type==='tree'); if(!e) return [];
      sha=e.sha; base+=part+'/';
    }
    const sub=await req('GET', repoPath()+'/git/trees/'+sha+'?recursive=1');
    if(sub.truncated) throw new GhError('api','The '+prefix+' folder is too large to list.');
    return pick(sub.tree||[], base);
  }
  function decodeBase64Utf8(b64){
    const bin=atob(String(b64||'').replace(/\s+/g,''));
    const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  async function blobText(sha){
    const r=await req('GET', repoPath()+'/git/blobs/'+sha);
    if(r.encoding==='base64') return decodeBase64Utf8(r.content);
    return String(r.content||'');
  }
  // entries: [{path, content}] (content null = delete)
  async function createTree(baseTree, entries){
    const tree=entries.map(e=>e.content==null? {path:e.path, mode:'100644', type:'blob', sha:null} : {path:e.path, mode:'100644', type:'blob', content:e.content});
    const r=await req('POST', repoPath()+'/git/trees', {base_tree:baseTree, tree}); return r.sha;
  }
  async function createCommit(message, treeSha, parent){ const r=await req('POST', repoPath()+'/git/commits', {message, tree:treeSha, parents:[parent]}); return r.sha; }
  async function updateRef(sha){ await req('PATCH', repoPath()+'/git/refs/heads/'+encodeURIComponent(C.GH_BRANCH), {sha, force:false}); }

  const repoUrl=()=>`https://github.com/${C.GH_OWNER}/${C.GH_REPO}`;
  return {GhError, token, setToken, clearToken, validate, headSha, commitTreeSha, listPrefix, blobText, createTree, createCommit, updateRef,
    decodeBase64Utf8, repoUrl, rate:()=>Object.assign({},rate)};
})();
