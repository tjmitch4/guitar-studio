// Automatic sync of practice data through one JSON file in Dropbox. Local-first: the app always reads and
// writes localStorage; this engine downloads the Dropbox copy, merges (js/sync-merge.js), saves locally,
// and uploads the merged result with a revision check so two devices can't overwrite each other.
window.Sync = (() => {
  const C=window.GS_CONFIG, S=window.Store, D=window.DBX, SM=window.SyncMerge;
  const DEBOUNCE_MS=2000, INTERVAL_MS=60000, MAX_RETRIES=3;
  let status='idle';        // idle | syncing | synced | offline | error
  let running=null, again=false, debounceT=null, intervalT=null;
  const listeners=[];

  // What the header shows: unconfigured | signedout | reconnect | blocked | syncing | synced | offline | error
  function view(){
    const i=D.info();
    if(!i.configured) return 'unconfigured';
    if(!i.signedIn) return 'signedout';
    if(i.needsReconnect) return 'reconnect';
    if(S.loadFailed()) return 'blocked';
    if(status==='idle') return i.lastError?'error':(i.lastSyncedAt?'synced':'syncing');
    return status;
  }
  const emit=()=>listeners.forEach(fn=>{ try{ fn(view()); }catch(e){ console.error(e); } });
  const setStatus=(s)=>{ status=s; emit(); };

  // One full download -> merge -> save -> upload round. Retries on a revision conflict.
  async function runOnce(){
    setStatus('syncing');
    let changedLocal=false;
    try{
      await D.resolveRoot();
      for(let attempt=0;;attempt++){
        const remote=await D.download(C.DATA_PATH);   // null = no file yet
        let remoteData=null;
        if(remote){
          try{ remoteData=JSON.parse(remote.text); }catch(e){ remoteData=undefined; }
          if(!remoteData || typeof remoteData!=='object' || Array.isArray(remoteData))
            throw new D.DbxError('api','The Dropbox copy of your data is unreadable, so it was left alone. Your data on this device is safe.');
        }
        if(S.loadFailed()) throw new D.DbxError('api','Local data could not be read — sync is paused.');
        const local=S.get();
        const merged=remoteData ? SM.merge(local, remoteData) : SM.normalize(JSON.parse(JSON.stringify(local)));
        if(!SM.equal(merged, local)){
          if(!S.replaceData(merged)) throw new D.DbxError('api','Could not save the merged data on this device.');
          changedLocal=true;
        }
        if(remoteData && SM.equal(S.get(), remoteData)) break; // Dropbox already has exactly this
        try{
          await D.upload(C.DATA_PATH, JSON.stringify(S.get()), remote ? {'.tag':'update', update:remote.rev} : 'add');
          break;
        }catch(e){
          if(e.kind==='conflict' && attempt<MAX_RETRIES) continue; // someone else wrote first: re-download and merge again
          throw e;
        }
      }
      D.saveMeta({lastSyncedAt:Date.now(), lastError:null});
      status='synced';
    }catch(e){
      if(e.kind==='network' || e.kind==='transient'){ status='offline'; }            // retried silently on the next trigger
      else if(e.kind==='auth'){ status='error'; D.saveMeta({lastError:e.message}); }
      else { status='error'; D.saveMeta({lastError:e.message||String(e)}); console.warn('Sync failed', e); }
    }finally{
      if(changedLocal){ try{ window.App && window.App.refreshData(); }catch(e){ console.error(e); } }
      emit();
    }
    return status;
  }
  // Run a sync now (or once more after the current one, if one is in flight).
  function syncNow(){
    clearTimeout(debounceT); debounceT=null;
    if(!D.signedIn() || D.info().needsReconnect){ emit(); return Promise.resolve(view()); }
    if(S.loadFailed()){ emit(); return Promise.resolve('blocked'); }  // never upload unreadable/blocked local data
    if(running){ again=true; return running; }
    running=(async()=>{
      let r;
      do{ again=false; r=await runOnce(); }while(again && r==='synced');
      running=null;
      try{ window.VideosUI && window.VideosUI.syncHook && window.VideosUI.syncHook(); }catch(e){}
      return r;
    })();
    return running;
  }
  function schedule(ms){ if(!D.signedIn()) return; clearTimeout(debounceT); debounceT=setTimeout(syncNow, ms==null?DEBOUNCE_MS:ms); }

  // ---------------- UI: header indicator + panel ----------------
  const LABEL={unconfigured:'Sync off', signedout:'Sync off', reconnect:'Reconnect', blocked:'Sync paused', syncing:'Syncing…', synced:'Synced', offline:'Offline', error:'Sync error'};
  const esc=S.esc;
  const isStandaloneIOS=()=>S.isIOS && (navigator.standalone===true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
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
    const i=D.info();
    b.title = v==='unconfigured' ? 'Sync not configured yet' : v==='synced' ? 'Synced with Dropbox '+ago(i.lastSyncedAt) : (LABEL[v]||'Sync');
    b.setAttribute('aria-label','Dropbox sync: '+b.title);
  }
  let codeOpen=false;
  function renderPanel(){
    const dlg=document.getElementById('syncDialog'); if(!dlg || !dlg.open) return;
    const host=dlg.querySelector('#syncBody'); const i=D.info(); const v=view();
    const where=`<code>${esc(C.DATA_PATH)}</code>`;
    const codeBlock=`<div class="sync-code ${codeOpen?'':'hidden'}" id="syncCodeBox">
        <p class="hint">1. <button type="button" class="btn small" id="syncOpenCode">Open Dropbox</button> and tap <b>Allow</b>. Dropbox shows a code.<br>2. Copy it, come back here, and paste it:</p>
        <div class="btn-row"><input type="text" id="syncCode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the code from Dropbox" aria-label="Code from Dropbox"><button type="button" class="btn small" id="syncCodeGo">Connect</button></div>
      </div>`;
    let h='';
    if(v==='unconfigured'){
      h=`<p><b>Sync not configured yet.</b> Everything is saved on this device only, just like before.</p><p class="hint">To turn on Dropbox sync, the Dropbox app key goes in <code>js/config.js</code> (see the README).</p>`;
    } else if(v==='signedout' || v==='reconnect'){
      const primaryCode=isStandaloneIOS();
      h=`<p>${v==='reconnect'?'<b>Dropbox needs you to sign in again.</b> Your data on this device is safe.':'Connect Dropbox and your sessions, songs, trainer stats and settings sync automatically between your devices.'}</p>
        <p class="hint">Data file: ${where}${primaryCode?'':'. You\'ll sign in on Dropbox and come straight back.'}</p>
        <div class="btn-row"><button type="button" class="btn" id="syncConnect">Connect Dropbox</button></div>
        ${primaryCode?'':`<p class="hint"><button type="button" class="linkish" id="syncUseCode" aria-expanded="${codeOpen}">Having trouble? Use a code instead</button></p>`}
        ${codeBlock}`;
    } else {
      const st={syncing:'Syncing…', synced:'Up to date', offline:'Offline — will sync when you\'re back online', error:'Last sync failed', blocked:'Paused: this device\'s saved data couldn\'t be read, so nothing is uploaded.'}[v]||v;
      h=`<p><span class="sync-dot" data-state="${v}"></span> <b>${esc(st)}</b></p>
        <p class="hint">Last synced: ${esc(ago(i.lastSyncedAt))}${i.lastError&&v==='error'?`<br><span class="sync-err">${esc(i.lastError)}</span>`:''}</p>
        ${i.lastError && /Couldn't find/.test(i.lastError) ? `<p class="hint">If this is the first time, the app can create it. <button type="button" class="btn small" id="syncCreate">Create ${esc(C.DATA_DIR)} and sync</button></p>`:''}
        <p class="hint">Data file: ${where}${i.pathRoot&&i.pathRoot.prefix?` (in <code>${esc(i.pathRoot.prefix)}</code>)`:''}. Videos you record or import upload to <code>${esc(C.VIDEO_DIR)}</code>.</p>
        <div class="btn-row"><button type="button" class="btn" id="syncNowBtn" ${v==='syncing'||v==='blocked'?'disabled':''}>Sync now</button><button type="button" class="btn ghost" id="syncSignOut">Sign out</button></div>`;
    }
    h+=`<details class="backup-tools"><summary>Backup files (export / import JSON)</summary>
        <p class="hint">Not needed for sync — handy for an extra backup. Import merges a backup into this device; nothing is deleted.</p>
        <div class="btn-row"><button type="button" class="btn small ghost" id="syncExport">Export JSON</button><label class="btn small ghost">Import JSON<input type="file" id="syncImport" accept="application/json,.json" class="vh"></label></div>
      </details>`;
    host.innerHTML=h;
    const on=(id,fn,ev)=>{ const el=host.querySelector('#'+id); if(el) el.addEventListener(ev||'click',fn); };
    on('syncConnect',()=>connect(isStandaloneIOS()?'code':'redirect'));
    on('syncUseCode',()=>{ codeOpen=!codeOpen; renderPanel(); });
    on('syncOpenCode',()=>connect('code'));
    on('syncCodeGo',()=>submitCode());
    on('syncCode',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); submitCode(); } },'keydown');
    on('syncNowBtn',()=>syncNow());
    on('syncCreate',()=>{ D.useHomeRoot(); D.saveMeta({lastError:null}); syncNow(); });
    on('syncSignOut',async()=>{ if(!confirm('Sign out of Dropbox on this device? Your data stays on this device, and in Dropbox.')) return; await D.signOut(); status='idle'; emit(); window.App && window.App.toast('Signed out of Dropbox'); });
    on('syncExport',async()=>{ const r=await S.exportJSON(); if(r!=='cancelled') window.App.toast('Backup exported'); });
    on('syncImport',(e)=>{ const f=e.target.files[0]; e.target.value=''; if(f && window.PracticeUI) window.PracticeUI.importFile(f); },'change');
  }
  // Open Dropbox's sign-in. Keep this synchronous from the tap (PKCE is prepared when the panel opens) so popups aren't blocked.
  function connect(mode){
    let url;
    try{ url=D.buildAuthUrl(mode); }
    catch(e){ D.prepareAuth().then(()=>connect(mode)).catch(err=>alert('Could not start Dropbox sign-in: '+err.message)); return; }
    if(mode==='redirect'){ location.assign(url); return; }
    codeOpen=true;
    const w=window.open(url,'_blank','noopener');
    if(!w){ /* popup blocked (or noopener returns null): the code box stays open; offer a plain link */ }
    D.prepareAuth().catch(()=>{}); // ready for another attempt
    renderPanel();
    const box=document.getElementById('syncCode'); if(box) setTimeout(()=>box.focus(),300);
  }
  async function submitCode(){
    const inp=document.getElementById('syncCode'); const code=inp&&inp.value;
    try{ await D.exchangeCode(code); codeOpen=false; status='idle'; emit(); window.App.toast('Connected to Dropbox'); syncNow(); }
    catch(e){ alert(e.message||'Could not connect to Dropbox'); }
  }
  function openPanel(){
    const dlg=document.getElementById('syncDialog'); if(!dlg) return;
    if(!dlg.open) dlg.showModal();
    renderPanel();
    if(D.configured() && !D.signedIn()) D.prepareAuth().catch(e=>console.warn('PKCE unavailable', e));
  }

  function init(){
    const b=document.getElementById('syncBtn'); if(b) b.addEventListener('click',openPanel);
    const close=document.getElementById('syncClose'); if(close) close.addEventListener('click',()=>document.getElementById('syncDialog').close());
    listeners.push(renderButton, renderPanel);
    renderButton();
    if(!D.configured()) return; // app behaves exactly as before
    if(C.SYNC_AUTO===false) return; // test harness drives sync by hand
    S.onChange(()=>schedule());
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') syncNow(); });
    window.addEventListener('online',()=>syncNow());
    window.addEventListener('offline',()=>{ if(D.signedIn()) setStatus('offline'); });
    intervalT=setInterval(()=>{ if(document.visibilityState==='visible') syncNow(); else renderButton(); }, INTERVAL_MS);
    // Returning from Dropbox's sign-in page?
    D.completeRedirect().then(done=>{
      if(done){ window.App && window.App.toast('Connected to Dropbox'); }
      syncNow();
    }).catch(e=>{ D.saveMeta({lastError:e.message}); emit(); alert('Dropbox sign-in failed: '+e.message); });
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0)); // after the tabs have initialised

  return {syncNow, schedule, view, openPanel, onStatus:(fn)=>listeners.push(fn), _runOnce:runOnce};
})();
