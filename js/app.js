// App shell: tabs + init order
window.App = (() => {
  const TABS=['trainer','fretboard','theory','practice','songs'];
  let current=null;
  function showTab(name, {push=true}={}){
    if(!TABS.includes(name)) return;
    const leaving=current; current=name;
    document.querySelectorAll('.tabs button').forEach(b=>{ const on=b.dataset.tab===name; b.classList.toggle('active',on); b.setAttribute('aria-selected',on?'true':'false'); b.tabIndex=on?0:-1;
      if(on) try{ b.scrollIntoView({inline:'nearest',block:'nearest'}); }catch(e){} });
    document.querySelectorAll('.tab').forEach(t=>{ const on=t.id==='tab-'+name; t.classList.toggle('active',on); t.hidden=!on; });
    // Leaving Practice: release the mic (iOS keeps the orange indicator and ducks playback otherwise)
    if(leaving==='practice' && name!=='practice'){ try{ window.TunerUI.stop(); }catch(e){} }
    if(leaving && leaving!==name) window.scrollTo(0,0);
    if(push && location.hash.slice(1)!==name) location.hash=name;
    updateTabFade();
  }
  // Fade the right edge of the (phone) tab strip only while there's more to scroll to
  function updateTabFade(){ const t=document.querySelector('.tabs'); if(t) t.classList.toggle('at-end', t.scrollLeft+t.clientWidth>=t.scrollWidth-4); }

  // ---- toast (role=status) ----
  let toastTimer=null;
  function toast(msg, {action=null, ms=2600}={}){
    const el=document.getElementById('toast'); if(!el) return;
    el.innerHTML=''; el.append(document.createTextNode(msg));
    if(action){ const b=document.createElement('button'); b.type='button'; b.className='toast-btn'; b.textContent=action.label; b.addEventListener('click',action.onClick); el.append(' ',b); }
    el.classList.toggle('interactive',!!action);
    el.classList.add('show'); clearTimeout(toastTimer);
    if(ms) toastTimer=setTimeout(()=>el.classList.remove('show'),ms);
  }
  // ---- persistent banner for data problems ----
  function banner(html, buttons){
    const el=document.getElementById('dataBanner'); if(!el) return;
    el.innerHTML=`<div>${html}</div>`; const row=document.createElement('div'); row.className='btn-row';
    buttons.forEach(([label,fn,cls])=>{ const b=document.createElement('button'); b.type='button'; b.className='btn small '+(cls||''); b.textContent=label; b.addEventListener('click',fn); row.append(b); });
    el.append(row); el.classList.remove('hidden');
  }
  const hideBanner=()=>document.getElementById('dataBanner').classList.add('hidden');
  function showLoadFailedBanner(){
    const S=window.Store;
    banner(`<b>Your saved practice data couldn't be read.</b> Nothing has been overwritten — a copy is kept${S.backupKey()?` (in <code>${S.esc(S.backupKey())}</code>)`:''}. Changes you make now <b>won't be saved</b> until you choose: export the raw data, import a backup JSON (Practice → Session history), or start fresh.`,
      [['Export raw backup',()=>S.exportRaw()],
       ['Start fresh',()=>{ if(!confirm('Start with empty data? The unreadable copy stays in browser storage.')) return; S.startFresh(); location.reload(); },'danger']]);
  }
  let saveWarned=false;
  window.Store.setErrorHandler(({type})=>{
    if(type==='save' && !saveWarned){ saveWarned=true;
      banner(`<b>Couldn't save</b> — the browser's storage is full or unavailable. Export a backup now so nothing is lost.`, [['Export JSON',()=>window.Store.exportJSON()],['Dismiss',()=>{ hideBanner(); saveWarned=false; },'ghost']]); }
  });

  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
    document.querySelector('.tabs').addEventListener('scroll',updateTabFade,{passive:true}); window.addEventListener('resize',updateTabFade);
    // arrow keys move between tabs (tablist pattern)
    document.querySelector('.tabs').addEventListener('keydown',(e)=>{ if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft') return; const i=TABS.indexOf(current); const n=TABS[(i+(e.key==='ArrowRight'?1:TABS.length-1))%TABS.length]; showTab(n); document.querySelector(`.tabs button[data-tab="${n}"]`).focus(); });
    const prefs=window.Store.get().prefs||{};
    document.getElementById('useFlats').checked=!!prefs.useFlats;
    document.getElementById('useFlats').addEventListener('change',(e)=>{ if(applyingRemote) return; window.Store.setPref('useFlats', e.target.checked); window.Store.save(); });
    const snd=document.getElementById('soundOn'); snd.checked=prefs.sound!==false; window.Tone.setEnabled(snd.checked);
    snd.addEventListener('change',(e)=>{ window.Tone.setEnabled(e.target.checked); if(applyingRemote) return; window.Store.setPref('sound', e.target.checked); window.Store.save(); });
    const tp=document.getElementById('tonePreset');
    tp.innerHTML=Object.entries(window.Tone.PRESETS).map(([k,p])=>`<option value="${k}">${p.label}</option>`).join('');
    tp.value=(prefs.tone && window.Tone.PRESETS[prefs.tone])? prefs.tone : 'acoustic'; window.Tone.setPreset(tp.value);
    tp.addEventListener('change',()=>{ window.Tone.setPreset(tp.value); window.Store.setPref('tone', tp.value); window.Store.save(); window.Tone.strum([-1,0,2,2,2,0]); });
    document.getElementById('toneTest').addEventListener('click',()=>{ window.Tone.strum([-1,0,2,2,2,0]); setTimeout(()=>window.Tone.strum([0,2,2,1,0,0]),1100); setTimeout(()=>window.Tone.arpeggio([-1,3,2,0,1,0],0.16),2300); });
    // Initialise each tab on its own so one failure can't leave the rest of the app dead.
    ['FretboardUI','TheoryUI','SongsUI','PracticeUI','TrainerUI','VideosUI','TunerUI'].forEach(n=>{
      try{ const r=window[n].init(); if(r && r.catch) r.catch(e=>console.error(n+' init failed',e)); }catch(e){ console.error(n+' init failed',e); }
    });
    if(window.Store.loadFailed()) showLoadFailedBanner();
    const h=location.hash.replace('#','');
    showTab(TABS.includes(h)?h:'trainer',{push:false});
  });
  // Sync (or an import) brought in new data: re-render everything that shows stored data, and apply synced settings.
  let applyingRemote=false;
  function refreshData(){
    const prefs=window.Store.get().prefs||{};
    applyingRemote=true;
    try{
      const uf=document.getElementById('useFlats');
      if(uf && uf.checked!==!!prefs.useFlats){ uf.checked=!!prefs.useFlats; uf.dispatchEvent(new Event('change')); } // listeners re-spell notes; the pref isn't re-saved
      const snd=document.getElementById('soundOn');
      if(snd && snd.checked!==(prefs.sound!==false)){ snd.checked=prefs.sound!==false; window.Tone.setEnabled(snd.checked); }
      const tp=document.getElementById('tonePreset');
      if(tp && prefs.tone && window.Tone.PRESETS[prefs.tone] && tp.value!==prefs.tone){ tp.value=prefs.tone; window.Tone.setPreset(prefs.tone); }
    }finally{ applyingRemote=false; }
    [()=>window.PracticeUI.refresh(), ()=>window.SongsUI.render(), ()=>window.TrainerUI.render(), ()=>window.VideosUI.refresh(false)]
      .forEach(fn=>{ try{ fn(); }catch(e){ console.error('Refresh after sync failed', e); } });
  }
  // Back/forward (and edited URLs) switch tabs
  window.addEventListener('hashchange',()=>{ const h=location.hash.slice(1); if(TABS.includes(h) && h!==current) showTab(h,{push:false}); });

  // Keyboard support for non-button controls marked role="button" (table rows, SVG segments)
  document.addEventListener('keydown',(e)=>{
    if(e.key!=='Enter' && e.key!==' ') return;
    const t=e.target; if(!t || !t.getAttribute || t.getAttribute('role')!=='button' || t.tagName==='BUTTON') return;
    e.preventDefault(); t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  });

  // iOS/iPadOS: audio can only start from a user gesture — unlock it on the first tap/key,
  // and wake it again when the app comes back to the foreground (iOS "interrupts" it).
  const unlockAudio=()=>{ try{ if(window.Tone.isEnabled()) window.Tone.unlock(); }catch(e){} };
  ['pointerdown','touchend','keydown'].forEach(ev=>document.addEventListener(ev,unlockAudio,{passive:true}));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible') window.Tone.wake();
    else { try{ window.TunerUI.stop(); }catch(e){} } // don't keep the mic open in the background
  });

  // Ask the browser not to evict localStorage/IndexedDB under storage pressure (best effort).
  if(navigator.storage && navigator.storage.persist){ navigator.storage.persisted().then(p=>{ if(!p) navigator.storage.persist(); }).catch(()=>{}); }

  // Offline support. Service workers need https (GitHub Pages) or localhost.
  const secureHost = location.protocol==='https:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if('serviceWorker' in navigator && secureHost){
    const hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(hadController) toast('Guitar Studio was updated.',{action:{label:'Reload',onClick:()=>location.reload()},ms:0});
    });
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service worker registration failed',e)); });
  }
  return {showTab, toast, refreshData};
})();
