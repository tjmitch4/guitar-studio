// Simple localStorage-backed store with JSON export/import.
window.Store = (() => {
  const KEY='guitarStudio.v1';
  const defaults = () => ({
    sessions: [],
    songs: [
      {id:'s1', title:'Slow Dancing in a Burning Room', artist:'John Mayer', status:'Learning', key:'C#m', tuning:'Standard', tempo:70, curTempo:'',
       sections:'Intro riff (C#m–A–E–B feel, hybrid picking)\nVerse comping\nChorus\nSolo phrasing', notes:'Current focus. Bend intonation on the intro; keep thumb steady on the bass notes.', links:'', added:'2026-08-16'},
    ],
    prefs: {useFlats:false},
    version:1,
  });
  let data;
  function load(){
    try{ data = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY)||'{}')); }
    catch(e){ data = defaults(); }
    if(!Array.isArray(data.sessions)) data.sessions=[];
    if(!Array.isArray(data.songs)) data.songs=[];
    return data;
  }
  function save(){ localStorage.setItem(KEY, JSON.stringify(data)); }
  const uid = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);
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
    return saveFile(blob, `guitar-studio-backup-${new Date().toISOString().slice(0,10)}.json`);
  }
  function importJSON(file, cb){
    const r=new FileReader();
    r.onload=()=>{ try{ const inc=JSON.parse(r.result);
        // merge by id
        const sIds=new Set(data.sessions.map(s=>s.id)); (inc.sessions||[]).forEach(s=>{ if(!sIds.has(s.id)) data.sessions.push(s); });
        const gIds=new Set(data.songs.map(s=>s.id)); (inc.songs||[]).forEach(s=>{ if(!gIds.has(s.id)) data.songs.push(s); });
        save(); cb&&cb(null);
      }catch(e){ cb&&cb(e); } };
    r.readAsText(file);
  }
  load();
  return {get:()=>data, save, uid, exportJSON, importJSON, load, saveFile, isIOS};
})();
