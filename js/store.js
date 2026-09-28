// Simple localStorage-backed store with JSON export/import.
window.Store = (() => {
  const KEY='guitarStudio.v1';
  const DEFAULT_S1 = {id:'s1', title:'Slow Dancing in a Burning Room', artist:'John Mayer', status:'Learning', key:'C#m', tuning:'Standard', tempo:70, curTempo:'',
       sections:'Intro riff (C#m–A–E–B feel, hybrid picking)\nVerse comping\nChorus\nSolo phrasing', notes:'Current focus. Bend intonation on the intro; keep thumb steady on the bass notes.', links:'', added:'2026-08-16'};
  const defaults = () => ({
    sessions: [],
    songs: [ Object.assign({}, DEFAULT_S1) ],
    prefs: {useFlats:false},
    version:1,
  });
  let data;
  let loadFailed=false, rawBackupKey=null, rawCorrupt=null;
  let onError=null; // set by App: called with {type:'load'|'save', error}

  const isObj = (v) => v!=null && typeof v==='object' && !Array.isArray(v);
  // Escape user text for innerHTML (& < > " ').
  const esc = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  // Local calendar date (YYYY-MM-DD) for a timestamp/Date — never UTC.
  const localDate = (ts) => { const d = ts==null ? new Date() : new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const uid = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);

  // Fill in missing fields so older / hand-edited data can't crash the UI. Additive only.
  function normSession(s){
    if(!isObj(s)) return null;
    if(!s.id) s.id=uid();
    if(typeof s.date!=='string' || !/^\d{4}-\d{2}-\d{2}/.test(s.date)) s.date = s.created ? localDate(s.created) : localDate();
    if(typeof s.created!=='string') s.created='';
    if(!Array.isArray(s.cats)) s.cats=[];
    s.minutes = +s.minutes||0;
    return s;
  }
  function normSong(s){
    if(!isObj(s)) return null;
    if(!s.id) s.id=uid();
    if(typeof s.title!=='string') s.title=String(s.title||'Untitled');
    if(!['Want','Learning','Polishing','Can play'].includes(s.status)) s.status='Want';
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
    return d;
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
      data = defaults();
      loadFailed=true; rawCorrupt=raw;
      // reuse an identical backup from an earlier load instead of piling up copies
      try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.startsWith(KEY+'.corrupt-') && localStorage.getItem(k)===(raw||'')){ rawBackupKey=k; break; } } }catch(e2){}
      if(!rawBackupKey){ rawBackupKey = KEY+'.corrupt-'+Date.now();
        try{ localStorage.setItem(rawBackupKey, raw||''); }catch(e2){ rawBackupKey=null; } }
      console.error('Guitar Studio: could not read saved data', e);
    }
    return data;
  }
  function save(){
    if(loadFailed) return false; // protect the unreadable original until the user chooses
    try{ localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch(e){ console.error('Guitar Studio: save failed', e); onError && onError({type:'save', error:e}); return false; }
  }
  // User chose "Start fresh" after a failed load (the raw copy stays in its backup key).
  function startFresh(){ loadFailed=false; data=defaults(); return save(); }

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
  // Merge a backup into the current data. Nothing local is deleted.
  function mergeData(inc){
    if(!isObj(inc)) throw new Error('Not a Guitar Studio backup (expected a JSON object).');
    const c={sessions:0, songsAdded:0, songsUpdated:0, attempts:0, videos:0};
    // sessions: add unseen ids
    const sIds=new Set(data.sessions.map(s=>s.id));
    (Array.isArray(inc.sessions)?inc.sessions:[]).forEach(s=>{ s=normSession(s); if(s && !sIds.has(s.id)){ data.sessions.push(s); sIds.add(s.id); c.sessions++; } });
    // songs: add unseen; on id collision keep the newer record
    const isPristineDefault=(s)=>{ const {updated, ...rest}=s; return JSON.stringify(rest)===JSON.stringify(DEFAULT_S1); };
    (Array.isArray(inc.songs)?inc.songs:[]).forEach(s=>{ s=normSong(s); if(!s) return;
      const i=data.songs.findIndex(x=>x.id===s.id);
      if(i<0){ data.songs.push(s); c.songsAdded++; return; }
      const cur=data.songs[i];
      const newer = (s.updated||0) > (cur.updated||0) || (!cur.updated && !s.updated && isPristineDefault(cur) && !isPristineDefault(s));
      if(newer){ data.songs[i]=s; c.songsUpdated++; }
    });
    // trainer attempts: dedupe by ts+string+fret, keep newest 4000
    if(isObj(inc.quiz) && Array.isArray(inc.quiz.attempts)){
      if(!isObj(data.quiz)||!Array.isArray(data.quiz.attempts)) data.quiz={attempts:[]};
      const k=(a)=>a.ts+':'+a.s+':'+a.f; const seen=new Set(data.quiz.attempts.map(k));
      inc.quiz.attempts.forEach(a=>{ if(isObj(a) && a.ts && !seen.has(k(a))){ data.quiz.attempts.push(a); seen.add(k(a)); c.attempts++; } });
      data.quiz.attempts.sort((a,b)=>a.ts-b.ts); if(data.quiz.attempts.length>4000) data.quiz.attempts=data.quiz.attempts.slice(-4000);
    }
    // video notes: add entries we don't have
    if(isObj(inc.videos)){ if(!isObj(data.videos)) data.videos={};
      Object.entries(inc.videos).forEach(([n,v])=>{ if(isObj(v) && !data.videos[n]){ data.videos[n]=v; c.videos++; } }); }
    // prefs: only fill ones not set here
    if(isObj(inc.prefs)){ Object.entries(inc.prefs).forEach(([k,v])=>{ if(!(k in data.prefs)) data.prefs[k]=v; }); }
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
    loadFailed:()=>loadFailed, backupKey:()=>rawBackupKey, setErrorHandler:(fn)=>{ onError=fn; }};
})();
