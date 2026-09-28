// Automatic sync of practice data to the private GitHub repo tjmitch4/studio-data (folder guitar/), as readable
// Markdown files. Local-first: the app always reads and writes localStorage; this engine reads the repo,
// merges (js/sync-plan.js + js/sync-merge.js), saves locally, and writes only the files that changed, as ONE
// commit per sync (Git Data API). If another device pushed in between, the ref update is refused
// (not a fast-forward) and the whole round starts again (up to 3 tries).
// With no token saved, nothing here touches the network and the app works exactly as before.
window.Sync = (() => {
  const C=window.GS_CONFIG, S=window.Store, GH=window.GH, SM=window.SyncMerge, P=window.SyncPlan;
  const DEBOUNCE_MS=5000, INTERVAL_MS=120000, MAX_TRIES=3, FETCH_CONCURRENCY=6;
  const repoId=()=>`${C.GH_OWNER}/${C.GH_REPO}@${C.GH_BRANCH}/${C.GH_PREFIX}`;
  let status='idle';        // idle | syncing | synced | offline | error
  let running=null, again=false, debounceT=null, failures=0, nextTry=0;
  const listeners=[];

  // ---- bookkeeping (never contains the token) ----
  function loadMeta(){
    try{ const m=JSON.parse(localStorage.getItem(C.SYNC_KEY)||'null'); if(m && typeof m==='object' && m.repo===repoId() && m.files && typeof m.files==='object') return m; }catch(e){}
    return {repo:repoId(), files:{}};
  }
  let meta=loadMeta();
  function saveMeta(patch){
    Object.assign(meta, patch);
    Object.keys(meta).forEach(k=>{ if(meta[k]===undefined) delete meta[k]; });
    try{ localStorage.setItem(C.SYNC_KEY, JSON.stringify(meta)); }catch(e){ console.warn('Could not save sync bookkeeping', e); }
  }
  function deviceId(){
    let id=null; try{ id=localStorage.getItem(C.DEVICE_KEY); }catch(e){}
    if(!id || !/^[a-z0-9]{4,8}$/.test(id)){ id=Math.random().toString(36).slice(2,6).padEnd(4,'0'); try{ localStorage.setItem(C.DEVICE_KEY,id); }catch(e){} }
    return id;
  }
  function platform(){
    const ua=navigator.userAgent||'';
    if(/iPhone/.test(ua)) return 'iPhone';
    if(/iPad/.test(ua) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1)) return 'iPad';
    if(/Android/.test(ua)) return 'Android';
    if(/Windows/.test(ua)) return 'Windows';
    if(/Mac OS X|Macintosh/.test(ua)) return 'Mac';
    if(/CrOS/.test(ua)) return 'ChromeOS';
    if(/Linux/.test(ua)) return 'Linux';
    return 'Browser';
  }
  const deviceLabel=()=>platform()+' '+deviceId();

  // What the header shows: notconnected | blocked | syncing | synced | offline | error
  function view(){
    if(!GH.token()) return 'notconnected';
    if(S.loadFailed()) return 'blocked';
    if(meta.authError) return 'error';
    if(status==='idle') return meta.lastError?'error':(meta.lastSyncedAt?'synced':'syncing');
    return status;
  }
  const emit=()=>listeners.forEach(fn=>{ try{ fn(view()); }catch(e){ console.error(e); } });
  const setStatus=(s)=>{ status=s; emit(); };

  async function fetchAll(paths, tree){
    const out={}; let i=0;
    const worker=async()=>{ while(i<paths.length){ const p=paths[i++]; out[p]=await GH.blobText(tree.get(p)); } };
    await Promise.all(Array.from({length:Math.min(FETCH_CONCURRENCY, paths.length)}, worker));
    return out;
  }
  // Tombstones whose file removal is now committed can be forgotten (deterministic ids are kept in settings.md).
  function dropTombstones(drop){
    const d=S.get(); let changed=false;
    drop.forEach(({kind,id,updatedAt})=>{
      const l=d.deleted && d.deleted[kind]; if(!l) return;
      const i=l.findIndex(t=>t.id===id && (+t.updatedAt||0)===(+updatedAt||0));
      if(i>=0){ l.splice(i,1); changed=true; }
    });
    if(changed) S.save({silent:true});
  }

  // One full round: read repo -> merge -> save locally -> commit the changed files.
  async function runOnce(){
    setStatus('syncing');
    let changedLocal=false;
    try{
      for(let attempt=1;;attempt++){
        if(S.loadFailed()) throw new GH.GhError('blocked','Local data could not be read — sync is paused.');
        const head=await GH.headSha();
        let tree, treeSha;
        if(meta.head===head && meta.treeSha){ // nothing new on GitHub since our last sync: the file map is current
          treeSha=meta.treeSha; tree=new Map(Object.entries(meta.files).map(([p,f])=>[p,f.sha]));
        } else {
          treeSha=await GH.commitTreeSha(head);
          tree=new Map((await GH.listPrefix(treeSha, C.GH_PREFIX)).map(e=>[e.path,e.sha]));
        }
        const fetched=await fetchAll(P.needFetch(tree, meta, S.get()), tree);
        if(S.loadFailed()) throw new GH.GhError('blocked','Local data could not be read — sync is paused.');
        const local=S.get();
        const r=P.mergeRemote(local, meta, tree, fetched);
        r.warnings.forEach(w=>console.warn('Guitar Studio sync: '+w));
        if(!SM.equal(r.merged, local)){
          if(!S.replaceData(r.merged)) throw new GH.GhError('api','Could not save the merged data on this device.');
          changedLocal=true;
        }
        const snap=JSON.parse(JSON.stringify(S.get())); // edits made while we upload are picked up by the next round
        const plan=await P.planWrites(snap, meta, tree, r.keyPaths, r.bad, {sha:P.gitBlobSha, today:S.localDate(), device:deviceLabel(), deleteLog:r.deleteLog});
        let newHead=head, newTree=treeSha;
        if(plan.writes.length){
          newTree=await GH.createTree(treeSha, plan.writes);
          const commit=await GH.createCommit(`guitar: sync (${plan.changed||plan.writes.length} changed) from ${deviceLabel()}`, newTree, head);
          try{ await GH.updateRef(commit); newHead=commit; }
          catch(e){
            if(e.kind==='conflict'){ if(attempt<MAX_TRIES) continue; throw new GH.GhError('server','Another device kept syncing at the same moment — trying again shortly.'); }
            throw e;
          }
        }
        if(r.wiped){ console.warn('Guitar Studio sync: the GitHub folder looked wiped — deleted nothing here and restored it from this device.'); }
        saveMeta({head:newHead, treeSha:newTree, files:plan.files, deletes:plan.deletes, lastSyncedAt:Date.now(), lastError:null, note:undefined, authError:undefined,
          restoredAt:r.wiped?Date.now():meta.restoredAt,
          warnings:r.warnings.length?r.warnings:(plan.files && Object.values(plan.files).some(f=>f.bad)?meta.warnings:undefined)});
        if(plan.drop.length) dropTombstones(plan.drop);
        break;
      }
      status='synced'; failures=0; nextTry=0;
    }catch(e){
      const k=e && e.kind;
      failures++;
      nextTry=Date.now()+Math.min(15*60000, 30000*Math.pow(2, failures-1));
      if(k==='network' || k==='server'){ status='offline'; saveMeta({note:k==='server'?e.message:undefined}); }   // quiet: retried later
      else if(k==='ratelimit'){ status='offline'; nextTry=Math.max(nextTry, e.until||0); saveMeta({note:e.message}); }
      else if(k==='auth'){ status='error'; saveMeta({authError:true, lastError:'GitHub rejected the saved token (expired or revoked). Paste a new token below.'}); }
      else if(k==='notfound'){ status='error'; saveMeta({lastError:`Can't find ${C.GH_OWNER}/${C.GH_REPO} (branch ${C.GH_BRANCH}) with this token. Check the token's repository access.`}); }
      else if(k==='forbidden'){ status='error'; saveMeta({lastError:'The token can\'t write to the repo. It needs Repository permissions → Contents: Read and write.'}); }
      else if(k==='blocked'){ status='idle'; }
      else { status='error'; saveMeta({lastError:(e && e.message)||String(e)}); console.warn('Sync failed', e); }
    }finally{
      if(changedLocal){ try{ window.App && window.App.refreshData(); }catch(e){ console.error(e); } }
      emit();
    }
    return view();
  }
  // Run a sync now (or once more after the current one). Automatic triggers respect the backoff; "Sync now" doesn't.
  function syncNow(opts){
    const manual=!!(opts && opts.manual);
    clearTimeout(debounceT); debounceT=null;
    if(!GH.token()){ emit(); return Promise.resolve('notconnected'); }
    if(S.loadFailed()){ emit(); return Promise.resolve('blocked'); } // never upload unreadable/blocked local data
    if(!manual && (meta.authError || Date.now()<nextTry)){ emit(); return Promise.resolve(view()); }
    if(running){ again=true; return running; }
    running=(async()=>{
      let r;
      try{ do{ again=false; r=await runOnce(); }while(again && r==='synced'); }
      finally{ running=null; }
      return r;
    })();
    return running;
  }
  function schedule(ms){ if(!GH.token()) return; clearTimeout(debounceT); debounceT=setTimeout(()=>syncNow(), ms==null?DEBOUNCE_MS:ms); }

  // ---------------- UI: header indicator + panel ----------------
  const LABEL={notconnected:'Sync off', blocked:'Sync paused', syncing:'Syncing…', synced:'Synced', offline:'Offline', error:'Sync error'};
  const esc=S.esc;
  function ago(ms){
    if(!ms) return 'never';
    const s=Math.round((Date.now()-ms)/1000);
    if(s<45) return 'just now'; if(s<3600) return Math.round(s/60)+' min ago'; if(s<86400) return Math.round(s/3600)+' h ago';
    return new Date(ms).toLocaleString();
  }
  function renderButton(){
    const b=document.getElementById('syncBtn'); if(!b) return;
    const v=view();
    b.dataset.state=v;
    b.querySelector('.sync-lbl').textContent=LABEL[v]||'Sync';
    b.title = v==='notconnected' ? 'Sync is off — tap to connect GitHub' : v==='synced' ? 'Synced with GitHub '+ago(meta.lastSyncedAt) : (LABEL[v]||'Sync');
    b.setAttribute('aria-label','GitHub sync: '+b.title);
  }
  const TOKEN_URL='https://github.com/settings/personal-access-tokens/new';
  function howTo(open){
    return `<details class="sync-howto" ${open?'open':''}><summary>How to make a token (2 minutes, once per browser)</summary>
      <ol>
        <li>Open <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub → new fine-grained token</a> (signed in as <b>${esc(C.GH_OWNER)}</b>).</li>
        <li><b>Token name:</b> e.g. “Studio apps – iPhone”. <b>Expiration:</b> your choice (you'll paste a new one when it runs out).</li>
        <li><b>Repository access:</b> <i>Only select repositories</i> → <b>${esc(C.GH_REPO)}</b>.</li>
        <li><b>Permissions → Repository permissions → Contents:</b> <i>Read and write</i>. Nothing else is needed.</li>
        <li><b>Generate token</b>, copy it, and paste it here.</li>
      </ol>
      <p class="hint">The token stays in this browser only. Lift Studio uses the same one, so pasting it here connects both apps in this browser.</p>
    </details>`;
  }
  function tokenForm(label){
    return `<form class="sync-token" id="ghForm" autocomplete="off">
        <label for="ghToken">${label}</label>
        <div class="btn-row"><input type="password" id="ghToken" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" aria-describedby="ghErr"><button type="submit" class="btn" id="ghConnect">Connect</button></div>
        <p class="sync-err" id="ghErr" role="alert"></p>
      </form>`;
  }
  function renderPanel(){
    const dlg=document.getElementById('syncDialog'); if(!dlg || !dlg.open) return;
    const host=dlg.querySelector('#syncBody'); const v=view();
    // keep a half-typed token and any message across re-renders
    const prevTok=host.querySelector('#ghToken'), prevErr=host.querySelector('#ghErr');
    const keepTok=prevTok?prevTok.value:'', keepErr=prevErr?prevErr.textContent:'', keepOpen=!!(host.querySelector('#ghReplace')&&host.querySelector('#ghReplace').open);
    if(host.querySelector('#ghConnect') && host.querySelector('#ghConnect').disabled) return; // mid-check: don't clobber
    const where=`<a href="${esc(GH.repoUrl())}/tree/${esc(C.GH_BRANCH)}/${esc(C.GH_PREFIX.replace(/\/$/,''))}" target="_blank" rel="noopener"><code>${esc(C.GH_OWNER)}/${esc(C.GH_REPO)}/${esc(C.GH_PREFIX)}</code></a>`;
    let h='';
    if(v==='notconnected'){
      h=`<p>Sync your sessions, songs, trainer stats, video notes and settings to your private GitHub repo ${where} as readable Markdown files. Every device stays in step, and <code>guitar/PROGRESS.md</code> gives Claude the full picture for coaching.</p>
        <p class="hint">Right now everything is saved on this device only, just like before.</p>
        ${howTo(true)}${tokenForm('Paste your token')}`;
    } else {
      const st={syncing:'Syncing…', synced:'Up to date', offline:'Offline or GitHub unreachable — retrying automatically', error:'Sync problem', blocked:'Paused: this device\'s saved data couldn\'t be read, so nothing is uploaded.'}[v]||v;
      const warn=(meta.warnings||[]);
      h=`<p><span class="sync-dot" data-state="${v}"></span> <b>${esc(st)}</b></p>
        <p class="hint">Last synced: ${esc(ago(meta.lastSyncedAt))}${meta.note&&v==='offline'?`<br>${esc(meta.note)}`:''}${meta.lastError&&v==='error'?`<br><span class="sync-err">${esc(meta.lastError)}</span>`:''}</p>
        ${meta.restoredAt && Date.now()-meta.restoredAt<7*86400000 ? `<p class="sync-note"><b>GitHub folder looked empty — restored it from this device</b> (${esc(new Date(meta.restoredAt).toLocaleString())}). Nothing was deleted here.</p>`:''}
        ${warn.length?`<div class="hint"><b>Skipped files</b> (couldn't be read, left untouched on GitHub — fix or delete them there):<ul>${warn.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}
        <p class="hint">Repo: ${where}. One commit per sync; only changed files are written.</p>
        <div class="btn-row"><button type="button" class="btn" id="syncNowBtn" ${v==='syncing'||v==='blocked'?'disabled':''}>Sync now</button><a class="btn ghost" href="${esc(GH.repoUrl())}" target="_blank" rel="noopener">Open repo</a><button type="button" class="btn ghost" id="syncDisconnect">Disconnect</button></div>
        <details class="sync-howto" id="ghReplace" ${meta.authError||keepOpen?'open':''}><summary>Replace token</summary>${howTo(false)}${tokenForm('New token')}</details>`;
    }
    host.innerHTML=h;
    const tok=host.querySelector('#ghToken'); if(tok) tok.value=keepTok;
    const err=host.querySelector('#ghErr'); if(err) err.textContent=keepErr;
    const on=(id,fn,ev)=>{ const el=host.querySelector('#'+id); if(el) el.addEventListener(ev||'click',fn); };
    on('ghForm',(e)=>{ e.preventDefault(); connect(); },'submit');
    on('syncNowBtn',()=>syncNow({manual:true}));
    on('syncDisconnect',()=>{
      if(!confirm('Disconnect GitHub in this browser?\n\nYour data stays on this device and in the repo. Lift Studio shares the same token, so it disconnects too.')) return;
      disconnect(); window.App && window.App.toast('Disconnected from GitHub');
    });
  }
  // Connecting (or disconnecting) starts from a clean slate: forget which files this device last saw, so a
  // recreated/emptied repo is never read as "everything was deleted on another device". Local data is untouched.
  function resetCache(){ saveMeta({files:{}, head:undefined, treeSha:undefined, deletes:undefined, warnings:undefined, restoredAt:undefined}); }
  function disconnect(){ GH.clearToken(); resetCache(); status='idle'; failures=0; nextTry=0; saveMeta({authError:undefined, lastError:null, note:undefined}); emit(); }
  async function validateAndSave(tok){
    await GH.validate(tok);
    GH.setToken(tok); resetCache();
    status='idle'; failures=0; nextTry=0; saveMeta({authError:undefined, lastError:null, note:undefined}); emit();
  }
  async function connectToken(tok){ await validateAndSave(tok); return syncNow({manual:true}); }
  let checking=false;
  async function connect(){
    const dlg=document.getElementById('syncDialog'); const inp=dlg.querySelector('#ghToken'), btn=dlg.querySelector('#ghConnect'), err=dlg.querySelector('#ghErr');
    const tok=(inp.value||'').trim().replace(/^Bearer\s+/i,'');
    if(!tok){ err.textContent='Paste the token first.'; inp.focus(); return; }
    if(/\s/.test(tok)){ err.textContent='That doesn\'t look like a token (it contains spaces).'; return; }
    if(checking) return; checking=true;
    err.textContent=''; btn.disabled=true; btn.textContent='Checking…';
    try{
      await validateAndSave(tok); inp.value='';
      btn.disabled=false; btn.textContent='Connect';
      window.App && window.App.toast('Connected to GitHub');
      syncNow({manual:true});
    }catch(e){
      btn.disabled=false; btn.textContent='Connect';
      err.textContent = e && e.kind==='network' ? 'Can\'t reach GitHub — check your connection and try again.' : ((e && e.message) || 'Could not check the token.');
    }finally{ checking=false; }
  }
  function openPanel(){
    const dlg=document.getElementById('syncDialog'); if(!dlg) return;
    if(!dlg.open) dlg.showModal();
    renderPanel();
  }

  function init(){
    const b=document.getElementById('syncBtn'); if(b) b.addEventListener('click',openPanel);
    const close=document.getElementById('syncClose'); if(close) close.addEventListener('click',()=>document.getElementById('syncDialog').close());
    listeners.push(renderButton, renderPanel);
    renderButton();
    // Lift Studio (same origin) may connect/disconnect the shared token in another tab.
    window.addEventListener('storage',(e)=>{ if(e.key===C.TOKEN_KEY){ resetCache(); saveMeta({authError:undefined}); failures=0; nextTry=0; emit(); if(GH.token() && C.SYNC_AUTO!==false) syncNow(); } });
    if(C.SYNC_AUTO===false) return; // test harness drives sync by hand
    S.onChange(()=>schedule());
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') syncNow(); });
    window.addEventListener('online',()=>{ nextTry=0; syncNow(); });
    window.addEventListener('offline',()=>{ if(GH.token()) setStatus('offline'); });
    setInterval(()=>{ if(document.visibilityState==='visible') syncNow(); renderButton(); }, INTERVAL_MS);
    syncNow();
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0)); // after the tabs have initialised

  return {syncNow, schedule, view, openPanel, deviceLabel, connectToken, disconnect, onStatus:(fn)=>listeners.push(fn), _meta:()=>meta, _reloadMeta:()=>{ meta=loadMeta(); status='idle'; failures=0; nextTry=0; }};
})();
