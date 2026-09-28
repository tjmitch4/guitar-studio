// Dropbox API client: OAuth2 PKCE (no secret), token refresh, and the handful of endpoints the app uses.
// No UI here. Tokens live in their own localStorage key (GS_CONFIG.DROPBOX_KEY), separate from practice data.
window.DBX = (() => {
  const C=window.GS_CONFIG;
  const API='https://api.dropboxapi.com', CONTENT='https://content.dropboxapi.com', WWW='https://www.dropbox.com';
  const KEY=C.DROPBOX_KEY, PKCE_KEY=C.DROPBOX_KEY+'.pkce';
  const CHUNK=8*1024*1024;          // upload-session chunk size
  const SINGLE_MAX=8*1024*1024;     // files larger than this use an upload session (the hard single-call limit is 150 MB)

  class DbxError extends Error{ constructor(kind,msg,extra){ super(msg); this.name='DbxError'; this.kind=kind; Object.assign(this,extra||{}); } }
  // kinds: network | transient (429/5xx) | auth (must reconnect) | notfound | conflict | missing-folder | api | config

  // ---- persisted state: {refreshToken, accessToken, expiresAt, accountId, pathRoot:{prefix,root}, lastSyncedAt, lastError} ----
  const readJSON=(k)=>{ try{ const v=JSON.parse(localStorage.getItem(k)||'null'); return v&&typeof v==='object'?v:null; }catch(e){ return null; } };
  let st=readJSON(KEY)||{};
  const persist=()=>{ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} };
  const configured=()=>!!C.DROPBOX_APP_KEY;
  const signedIn=()=>configured() && !!st.refreshToken;

  // Header values must be ASCII: escape everything outside it as \uXXXX (Dropbox's documented approach).
  const headerJSON=(obj)=>JSON.stringify(obj).replace(/[\u007f-￿]/g, c=>'\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4));

  // ---- PKCE ----
  const b64url=(bytes)=>{ let s=''; for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
  const rand=(n)=>{ const a=new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
  let prepared=null; // {verifier, challenge, state} computed ahead so the Connect tap can open a window synchronously
  async function prepareAuth(){
    if(prepared) return prepared;
    const verifier=rand(48); // 64 chars
    const digest=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    prepared={verifier, challenge:b64url(new Uint8Array(digest)), state:rand(16)};
    return prepared;
  }
  // Always the folder URL (…/guitar-studio/), even if the app was opened as …/index.html, so one registered URI covers both.
  const redirectUri=()=>location.origin+location.pathname.replace(/index\.html$/,'');
  // mode 'redirect': Dropbox sends the browser back here with ?code=. mode 'code': no redirect_uri, Dropbox shows a code to paste.
  function buildAuthUrl(mode){
    if(!configured()) throw new DbxError('config','Sync not configured yet');
    if(!prepared) throw new DbxError('config','Call prepareAuth() first');
    const p=prepared; prepared=null;
    const q=new URLSearchParams({client_id:C.DROPBOX_APP_KEY, response_type:'code', code_challenge:p.challenge, code_challenge_method:'S256', token_access_type:'offline'});
    const rec={verifier:p.verifier, state:p.state, mode, createdAt:Date.now(), returnHash:location.hash||''};
    if(mode==='redirect'){ rec.redirectUri=redirectUri(); q.set('redirect_uri',rec.redirectUri); q.set('state',p.state); }
    try{ localStorage.setItem(PKCE_KEY, JSON.stringify(rec)); }catch(e){}
    return WWW+'/oauth2/authorize?'+q.toString();
  }

  async function tokenRequest(params){
    let r;
    try{ r=await fetch(API+'/oauth2/token',{method:'POST', body:new URLSearchParams(params)}); }
    catch(e){ throw new DbxError('network','Could not reach Dropbox'); }
    const text=await r.text().catch(()=>''); let j=null; try{ j=JSON.parse(text); }catch(e){}
    if(!r.ok){
      if(r.status>=500||r.status===429) throw new DbxError('transient','Dropbox is busy ('+r.status+')');
      const code=(j&&(j.error||'')) || '';
      throw new DbxError('auth', (j&&j.error_description) || code || ('Dropbox sign-in failed ('+r.status+')'), {status:r.status, code});
    }
    return j||{};
  }
  function applyToken(j){
    if(j.refresh_token) st.refreshToken=j.refresh_token;
    st.accessToken=j.access_token; st.expiresAt=Date.now()+Math.max(60,(+j.expires_in||14400)-120)*1000;
    if(j.account_id) st.accountId=j.account_id;
    st.needsReconnect=false; persist();
  }
  // Finish sign-in with the code from the redirect or the one the user pasted.
  async function exchangeCode(code){
    code=String(code||'').trim();
    if(!code) throw new DbxError('auth','Paste the code from Dropbox first.');
    const p=readJSON(PKCE_KEY);
    if(!p||!p.verifier) throw new DbxError('auth','That sign-in has expired — tap Connect again.');
    const params={code, grant_type:'authorization_code', code_verifier:p.verifier, client_id:C.DROPBOX_APP_KEY};
    if(p.mode==='redirect' && p.redirectUri) params.redirect_uri=p.redirectUri;
    const j=await tokenRequest(params);
    if(!j.refresh_token) throw new DbxError('auth','Dropbox did not return a long-lived token.');
    st={}; applyToken(j);
    try{ localStorage.removeItem(PKCE_KEY); }catch(e){}
    return true;
  }
  // Pick up ?code= / ?error= from a redirect, and strip it from the address bar right away
  // (the tabs use #hash routing, which is restored from before the redirect).
  let redirectResult=null;
  (function captureRedirect(){
    let q; try{ q=new URLSearchParams(location.search); }catch(e){ return; }
    if(!q.has('code') && !q.has('error')) return;
    const p=readJSON(PKCE_KEY);
    if(!p || p.mode!=='redirect') return; // not ours
    const code=q.get('code'), err=q.get('error'), errDesc=q.get('error_description'), state=q.get('state');
    ['code','state','error','error_description'].forEach(k=>q.delete(k));
    const rest=q.toString();
    try{ history.replaceState(history.state,'', location.pathname+(rest?'?'+rest:'')+(location.hash||p.returnHash||'')); }catch(e){}
    if(state!==p.state) redirectResult={error:'Sign-in response did not match — please try Connect again.'};
    else if(err) redirectResult={error: err==='access_denied'?'Dropbox access was not allowed.':(errDesc||err)};
    else redirectResult={code};
  })();
  async function completeRedirect(){
    const r=redirectResult; redirectResult=null;
    if(!r) return null;
    if(r.error){ try{ localStorage.removeItem(PKCE_KEY); }catch(e){} throw new DbxError('auth', r.error); }
    await exchangeCode(r.code); return true;
  }

  let refreshing=null;
  async function accessToken(force){
    if(!signedIn()) throw new DbxError('auth','Not signed in');
    if(!force && st.accessToken && Date.now()<(st.expiresAt||0)) return st.accessToken;
    if(!refreshing){
      refreshing=(async()=>{
        try{ applyToken(await tokenRequest({grant_type:'refresh_token', refresh_token:st.refreshToken, client_id:C.DROPBOX_APP_KEY})); return st.accessToken; }
        catch(e){ if(e.kind==='auth'){ st.needsReconnect=true; st.accessToken=null; persist(); } throw e; }
      })().finally(()=>{ refreshing=null; });
    }
    return refreshing;
  }

  // One API call. host: API or CONTENT. rpc: JSON body. Otherwise arg goes in Dropbox-API-Arg and body is raw bytes.
  // root: undefined = use the resolved path root, null = none, or an explicit namespace id.
  async function call(host, endpoint, {arg, body, rpc=false, root}={}){
    for(let attempt=0; attempt<2; attempt++){
      const t=await accessToken(attempt>0);
      const headers={Authorization:'Bearer '+t};
      const ns = root===undefined ? (st.pathRoot && st.pathRoot.root) : root;
      if(ns) headers['Dropbox-API-Path-Root']=headerJSON({'.tag':'root', root:String(ns)});
      let fbody;
      if(rpc){ if(arg!==undefined){ headers['Content-Type']='application/json'; fbody=JSON.stringify(arg); } }
      else { if(arg!==undefined) headers['Dropbox-API-Arg']=headerJSON(arg); if(body!==undefined){ headers['Content-Type']='application/octet-stream'; fbody=body; } }
      let r;
      try{ r=await fetch(host+'/2/'+endpoint,{method:'POST', headers, body:fbody}); }
      catch(e){ throw new DbxError('network','Could not reach Dropbox'); }
      if(r.status===401 && attempt===0){ st.accessToken=null; continue; } // expired: refresh once and retry
      if(r.ok) return r;
      const text=await r.text().catch(()=>''); let j=null; try{ j=JSON.parse(text); }catch(e){}
      const summary=(j&&j.error_summary)||text.slice(0,200)||('HTTP '+r.status);
      if(r.status===401){ st.needsReconnect=true; persist(); throw new DbxError('auth','Dropbox sign-in expired — reconnect.', {status:401}); }
      if(r.status===409){
        if(/not_found/.test(summary)) throw new DbxError('notfound', summary, {status:409});
        if(/conflict/.test(summary)) throw new DbxError('conflict', summary, {status:409});
        throw new DbxError('api', summary, {status:409});
      }
      if(r.status===429||r.status>=500) throw new DbxError('transient','Dropbox is busy ('+r.status+')', {status:r.status});
      throw new DbxError('api', summary, {status:r.status});
    }
  }
  const rpc=async(endpoint,arg,opts)=>(await call(API,endpoint,Object.assign({arg,rpc:true},opts||{}))).json();

  // ---- where the data lives (Business accounts may need the team root namespace) ----
  const full=(path)=>((st.pathRoot&&st.pathRoot.prefix)||'')+path;
  async function folderExists(path, root){
    try{ const m=await rpc('files/get_metadata',{path},{root}); return m['.tag']==='folder'; }
    catch(e){ if(e.kind==='notfound') return false; throw e; }
  }
  async function resolveRoot(){
    if(st.pathRoot) return st.pathRoot;
    if(await folderExists(C.DATA_DIR, null)){ st.pathRoot={prefix:'', root:null}; persist(); return st.pathRoot; }
    const acct=await rpc('users/get_current_account', undefined, {root:null});
    const ri=(acct&&acct.root_info)||{};
    if(ri.root_namespace_id && ri.root_namespace_id!==ri.home_namespace_id){
      const prefixes=[...new Set([ri.home_path, C.TEAM_HOME_PREFIX].filter(Boolean))];
      for(const pre of prefixes){
        if(await folderExists(pre+C.DATA_DIR, ri.root_namespace_id)){ st.pathRoot={prefix:pre, root:ri.root_namespace_id}; persist(); return st.pathRoot; }
      }
    }
    throw new DbxError('missing-folder', `Couldn't find the ${C.DATA_DIR} folder in your Dropbox.`);
  }
  // User chose "Create it": use the default home namespace; uploads create missing parent folders.
  function useHomeRoot(){ st.pathRoot={prefix:'', root:null, created:true}; persist(); }

  // ---- files ----
  async function download(path){
    let r;
    try{ r=await call(CONTENT,'files/download',{arg:{path:full(path)}}); }
    catch(e){ if(e.kind==='notfound') return null; throw e; }
    let meta=null; try{ meta=JSON.parse(r.headers.get('Dropbox-API-Result')||'null'); }catch(e){}
    const text=await r.text();
    if(!meta||!meta.rev){ try{ meta=await rpc('files/get_metadata',{path:full(path)}); }catch(e){ meta=meta||{}; } }
    return {text, rev:meta.rev, meta};
  }
  // mode: 'add' | 'overwrite' | {'.tag':'update', update:rev}
  async function upload(path, content, mode, opts){
    const arg=Object.assign({path:full(path), mode:mode||'add', autorename:false, mute:true, strict_conflict:true}, opts||{});
    return (await call(CONTENT,'files/upload',{arg, body:content})).json();
  }
  const clientModified=(ms)=>new Date(ms||Date.now()).toISOString().replace(/\.\d{3}Z$/,'Z');
  // Upload a (possibly large) file. Uses upload sessions above SINGLE_MAX. Never overwrites: a name clash gets " (1)".
  async function uploadFile(path, blob, {modified, onProgress}={}){
    const commit={path:full(path), mode:'add', autorename:true, mute:false, client_modified:clientModified(modified)};
    const size=blob.size;
    if(size<=SINGLE_MAX){ const m=await (await call(CONTENT,'files/upload',{arg:commit, body:blob})).json(); onProgress&&onProgress(1); return m; }
    const start=await (await call(CONTENT,'files/upload_session/start',{arg:{close:false}, body:blob.slice(0,CHUNK)})).json();
    let offset=Math.min(CHUNK,size); onProgress&&onProgress(offset/size);
    while(size-offset>CHUNK){
      await call(CONTENT,'files/upload_session/append_v2',{arg:{cursor:{session_id:start.session_id, offset}, close:false}, body:blob.slice(offset,offset+CHUNK)});
      offset+=CHUNK; onProgress&&onProgress(offset/size);
    }
    const m=await (await call(CONTENT,'files/upload_session/finish',{arg:{cursor:{session_id:start.session_id, offset}, commit}, body:blob.slice(offset)})).json();
    onProgress&&onProgress(1); return m;
  }
  async function listFolder(path){
    let res;
    try{ res=await rpc('files/list_folder',{path:full(path), limit:2000}); }
    catch(e){ if(e.kind==='notfound') return []; throw e; }
    const out=res.entries.slice();
    while(res.has_more){ res=await rpc('files/list_folder/continue',{cursor:res.cursor}); out.push(...res.entries); }
    return out.filter(x=>x['.tag']==='file');
  }
  const tempLink=async(pathLower)=>(await rpc('files/get_temporary_link',{path:pathLower})).link;
  const deleteFile=(pathLower)=>rpc('files/delete_v2',{path:pathLower});

  async function signOut(){
    const had=st.refreshToken;
    if(had){ try{ await call(API,'auth/token/revoke',{rpc:true}); }catch(e){ /* token may already be dead; still sign out locally */ } }
    st={}; persist();
    try{ localStorage.removeItem(PKCE_KEY); }catch(e){}
  }
  function saveMeta(m){ Object.assign(st,m); persist(); }
  const info=()=>({configured:configured(), signedIn:signedIn(), needsReconnect:!!st.needsReconnect, lastSyncedAt:st.lastSyncedAt||0, lastError:st.lastError||null,
    pathRoot:st.pathRoot||null, hasPendingCode:(readJSON(PKCE_KEY)||{}).mode==='code'});

  return {configured, signedIn, info, prepareAuth, buildAuthUrl, exchangeCode, completeRedirect, redirectUri, resolveRoot, useHomeRoot,
    download, upload, uploadFile, listFolder, tempLink, deleteFile, signOut, saveMeta, full, headerJSON, DbxError, CHUNK, SINGLE_MAX,
    reload:()=>{ st=readJSON(KEY)||{}; prepared=null; }}; // reload: re-read tokens from storage (another tab / tests)
})();
