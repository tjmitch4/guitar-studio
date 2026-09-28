// App shell: tabs + init order
window.App = (() => {
  function showTab(name){
    document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id==='tab-'+name));
    location.hash=name;
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
    const prefs=window.Store.get().prefs||{};
    document.getElementById('useFlats').checked=!!prefs.useFlats;
    document.getElementById('useFlats').addEventListener('change',(e)=>{ const d=window.Store.get(); d.prefs=d.prefs||{}; d.prefs.useFlats=e.target.checked; window.Store.save(); });
    const snd=document.getElementById('soundOn'); snd.checked=prefs.sound!==false; window.Tone.setEnabled(snd.checked);
    snd.addEventListener('change',(e)=>{ window.Tone.setEnabled(e.target.checked); const d=window.Store.get(); d.prefs=d.prefs||{}; d.prefs.sound=e.target.checked; window.Store.save(); });
    const tp=document.getElementById('tonePreset');
    tp.innerHTML=Object.entries(window.Tone.PRESETS).map(([k,p])=>`<option value="${k}">${p.label}</option>`).join('');
    tp.value=prefs.tone||'acoustic'; window.Tone.setPreset(tp.value);
    tp.addEventListener('change',()=>{ window.Tone.setPreset(tp.value); const d=window.Store.get(); d.prefs=d.prefs||{}; d.prefs.tone=tp.value; window.Store.save(); window.Tone.strum([-1,0,2,2,2,0]); });
    document.getElementById('toneTest').addEventListener('click',()=>{ window.Tone.strum([-1,0,2,2,2,0]); setTimeout(()=>window.Tone.strum([0,2,2,1,0,0]),1100); setTimeout(()=>window.Tone.arpeggio([-1,3,2,0,1,0],0.16),2300); });
    window.FretboardUI.init();
    window.TheoryUI.init();
    window.SongsUI.init();
    window.PracticeUI.init();
    window.TrainerUI.init();
    window.VideosUI.init();
    window.TunerUI.init();
    const h=location.hash.replace('#','');
    if(['trainer','fretboard','theory','practice','songs'].includes(h)) showTab(h);
  });

  // iOS/iPadOS: audio can only start from a user gesture — unlock it on the first tap/key,
  // and wake it again when the app comes back to the foreground (iOS "interrupts" it).
  const unlockAudio=()=>{ try{ if(window.Tone.isEnabled()) window.Tone.unlock(); }catch(e){} };
  ['pointerdown','touchend','keydown'].forEach(ev=>document.addEventListener(ev,unlockAudio,{passive:true}));
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') window.Tone.wake(); });

  // Ask the browser not to evict localStorage/IndexedDB under storage pressure (best effort).
  if(navigator.storage && navigator.storage.persist){ navigator.storage.persisted().then(p=>{ if(!p) navigator.storage.persist(); }).catch(()=>{}); }

  // Offline support. Service workers need https (GitHub Pages) or localhost.
  const secureHost = location.protocol==='https:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if('serviceWorker' in navigator && secureHost){
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service worker registration failed',e)); });
  }
  return {showTab};
})();
