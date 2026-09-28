// Practice videos: link the Dropbox "Practice Videos" folder, record in-browser, import, review, nudge.
//
// Browser support:
// - Folder linking uses the File System Access API (showDirectoryPicker) — Chrome/Edge/Arc on a computer only.
//   iPhone/iPad Safari, Firefox and Android don't have it. There, recordings/imports are kept in a
//   "this session" list and saved with a Save button (Share sheet on iOS → Save Video / Save to Files,
//   a normal download elsewhere).
// - Recording needs getUserMedia + MediaRecorder (Safari 14.5+, Chrome, Firefox, Edge) and https.
window.VideosUI = (() => {
  const $=(s)=>document.querySelector(s);
  const S=window.Store;
  const hasFS = 'showDirectoryPicker' in window;
  const hasRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof window.MediaRecorder!=='undefined';
  let dirHandle=null, recorder=null, chunks=[], stream=null, recStart=0, recTimer=null;
  let files=[];   // videos in the linked folder: {name,handle,size,modified}
  let local=[];   // videos held in memory this session (no folder linked): {name,file,size,modified,local:true,saved}
  let shown=[];   // what the list currently renders (local + folder), indexed by data-i

  // ---- IndexedDB for the directory handle ----
  function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open('guitarStudio',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function kvSet(k,v){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }
  async function kvGet(k){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction('kv'); const r=tx.objectStore('kv').get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

  const meta=()=>{ const d=S.get(); if(!d.videos) d.videos={}; return d.videos; }; // name -> {song,notes,reviewed,date}
  const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

  async function pickFolder(){
    if(!hasFS) return;
    try{ dirHandle=await window.showDirectoryPicker({mode:'readwrite', id:'practice-videos'}); await kvSet('videoDir',dirHandle); await refresh(); }
    catch(e){ if(e.name!=='AbortError') alert('Could not open folder: '+e.message); }
  }
  async function ensurePermission(){
    if(!dirHandle) return false;
    const q=await dirHandle.queryPermission({mode:'readwrite'}); if(q==='granted') return true;
    const r=await dirHandle.requestPermission({mode:'readwrite'}); return r==='granted';
  }
  async function listFiles(){
    files=[]; if(!dirHandle) return;
    for await (const [name,h] of dirHandle.entries()){ if(h.kind==='file' && /\.(mp4|mov|webm|m4v|mkv)$/i.test(name)){ const f=await h.getFile(); files.push({name,handle:h,size:f.size,modified:f.lastModified}); } }
    files.sort((a,b)=>b.modified-a.modified);
  }
  async function refresh(){
    if(dirHandle){ try{ if(await ensurePermission()) await listFiles(); }catch(e){ console.warn(e); } }
    render();
  }

  // ---- Recording ----
  function pickMime(){
    const opts=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    try{ return opts.find(m=>MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m))||''; }catch(e){ return ''; }
  }
  async function startRec(){
    if(!hasRec){ alert('Recording isn\'t supported in this browser. Use "Import video(s)" instead.'); return; }
    window.Tone && window.Tone.audioSession('play-and-record');
    try{ stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}}, audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}}); }
    catch(e){ window.Tone && window.Tone.audioSession('playback'); alert('Camera/mic not available: '+(e.name==='NotAllowedError'?'permission was denied. Allow camera and microphone for this site in your browser settings.':e.message)); return; }
    const v=$('#vidPreview'); v.muted=true; v.setAttribute('playsinline',''); v.srcObject=stream; const p=v.play(); if(p&&p.catch) p.catch(()=>{});
    const mime=pickMime();
    const opts={videoBitsPerSecond:4_000_000, audioBitsPerSecond:192_000}; if(mime) opts.mimeType=mime;
    try{ recorder=new MediaRecorder(stream,opts); }
    catch(e){ try{ recorder=new MediaRecorder(stream); }catch(e2){ alert('Could not start recording: '+e2.message); stopTracks(); return; } }
    chunks=[];
    recorder.ondataavailable=(e)=>{ if(e.data&&e.data.size) chunks.push(e.data); };
    recorder.onstop=saveRecording;
    recorder.start(1000); recStart=Date.now();
    $('#vidRecBtn').textContent='■ Stop & save'; $('#vidRecBtn').classList.add('danger');
    recTimer=setInterval(()=>{ const s=Math.floor((Date.now()-recStart)/1000); $('#vidRecTime').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); },500);
  }
  function stopTracks(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } $('#vidPreview').srcObject=null; window.Tone && window.Tone.audioSession('playback'); }
  function stopRec(){ if(recorder&&recorder.state!=='inactive') recorder.stop(); clearInterval(recTimer); stopTracks(); $('#vidRecBtn').textContent='● Record'; $('#vidRecBtn').classList.remove('danger'); }
  async function saveRecording(){
    const type=recorder.mimeType||(chunks[0]&&chunks[0].type)||'video/webm';
    const ext=/mp4/.test(type)?'mp4':'webm';
    const blob=new Blob(chunks,{type});
    const song=($('#vidSong').value||'').trim().replace(/[^\w\- ]+/g,'').slice(0,40);
    const d=new Date(); const stamp=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    const name=`${stamp}${song?'_'+song.replace(/ /g,'-'):''}.${ext}`;
    meta()[name]={song:$('#vidSong').value.trim(), notes:$('#vidNotes').value.trim(), date:stamp.slice(0,10), reviewed:false}; S.save();
    $('#vidNotes').value='';
    await store(name,blob,{fresh:true});
    await refresh();
  }
  // Put a recorded/imported video somewhere: the linked folder if we have one, otherwise the session list.
  async function store(name,blob,{fresh=false}={}){
    if(dirHandle){
      try{
        if(await ensurePermission()){
          const fh=await dirHandle.getFileHandle(name,{create:true}); const w=await fh.createWritable(); await w.write(blob); await w.close();
          return 'folder';
        }
      }catch(e){ console.warn('Folder write failed; keeping the video in this session instead', e); }
    }
    const file=(window.File&&!(blob instanceof File))? new File([blob],name,{type:blob.type,lastModified:Date.now()}) : blob;
    local=local.filter(x=>x.name!==name);
    local.unshift({name,file,size:blob.size,modified:(blob.lastModified||Date.now()),local:true,saved:!fresh});
    // Desktop browsers without folder linking: download right away (as before). On iPhone/iPad the
    // Share sheet needs a fresh tap, so the video waits in the list with a Save button instead.
    if(fresh && !S.isIOS){ await S.saveFile(blob,name); local[0].saved=true; }
    return 'session';
  }
  async function importFiles(list){
    for(const f of list){
      const m=meta(); if(!m[f.name]) m[f.name]={song:$('#vidSong').value.trim(),notes:'',date:new Date(f.lastModified||Date.now()).toISOString().slice(0,10),reviewed:false};
      await store(f.name,f); // imported files already exist on the device, so no auto-download
    }
    S.save(); await refresh();
  }

  // ---- Render ----
  function daysSince(ts){ return Math.floor((Date.now()-ts)/864e5); }
  function render(){
    const m=meta();
    shown=[...local, ...files.filter(f=>!local.some(l=>l.name===f.name))].sort((a,b)=>b.modified-a.modified);
    // nudge
    const last = shown.length? shown[0].modified : (Object.values(m).map(x=>new Date(x.date).getTime()).sort((a,b)=>b-a)[0]||null);
    let nudge;
    if(!last) nudge=`🎥 No practice videos yet. Record <b>60 seconds</b> of whatever you're working on today — you'll be amazed what you hear back. Future-you will thank you.`;
    else { const d=daysSince(last); nudge = d===0? `🎥 Video recorded today — nice. Watch it back once with a pen: one thing that worked, one to fix.` : d<7? `🎥 Last video ${d} day${d>1?'s':''} ago. Aim for one a week; a 60-second take counts.` : `🎥 It's been <b>${d} days</b> since your last video. Progress you can't see is progress you doubt — hit record for one take of ${suggestSong()}.`; }
    const unreviewed=shown.filter(f=>m[f.name]&&!m[f.name].reviewed).length;
    if(unreviewed) nudge+=` <br>📝 ${unreviewed} video${unreviewed>1?'s':''} not yet reviewed.`;
    const unsaved=local.filter(x=>!x.saved).length;
    if(unsaved) nudge+=` <br>💾 <b>${unsaved} recording${unsaved>1?'s':''} not saved yet</b> — tap it below and hit <b>Save video</b>, or it'll be gone when you close the app.`;
    $('#vidNudge').innerHTML=nudge;
    $('#vidCount').textContent = files.length? `${files.length} video${files.length>1?'s':''} in folder` : (hasFS&&!dirHandle?'Folder not linked':'');
    // folder / capability status
    const notes=[];
    if(!hasFS){
      $('#vidPickFolder').classList.add('hidden'); $('#vidRefresh').classList.add('hidden');
      notes.push(S.isIOS
        ? `On iPhone/iPad the app can't link a folder. Recordings and imports stay in the list below until you close the app — open one and tap <b>Save video</b> (choose <b>Save Video</b> for Photos, or <b>Save to Files</b> → Dropbox → Practice Videos). Folder linking works in Chrome/Edge on a computer.`
        : `This browser can't link a folder (Chrome/Edge on a computer can). Recordings download automatically — drop them into your Dropbox <b>Practice Videos</b> folder. Imports are listed below for this session.`);
    } else {
      notes.push(dirHandle? `Linked to <b>${esc(dirHandle.name)}</b> ✓` : `Link your Dropbox <b>Practice Videos</b> folder to save recordings and imports straight into Dropbox (synced to your phone too).`);
    }
    if(!hasRec){
      $('#vidRecBtn').disabled=true; $('#vidRecBtn').title='Recording not supported in this browser';
      notes.push(window.isSecureContext===false
        ? `Recording needs a secure (https) page — open the app from its https address.`
        : `This browser can't record video in the page — use <b>Import video(s)</b> instead${S.isIOS?' (it can open the camera directly)':''}.`);
    }
    $('#vidFolderStatus').innerHTML=notes.map(n=>`<div>${n}</div>`).join('');
    // list
    if(!shown.length){ $('#vidList').innerHTML=`<p class="empty">${dirHandle||!hasFS?'No videos yet.':'Link the folder to see your videos here.'}</p>`; return; }
    $('#vidList').innerHTML=shown.map((f,i)=>{ const x=m[f.name]||{}; const tag=f.local?(f.saved?' · <span class="hint">this session</span>':' · <b style="color:var(--accent)">not saved</b>'):''; return `<div class="vid ${x.reviewed?'reviewed':''}" data-i="${i}"><div class="vid-h"><span class="t">▶ ${esc(f.name)}</span><span class="hint">${new Date(f.modified).toLocaleDateString()} · ${(f.size/1048576).toFixed(1)} MB${x.song?' · '+esc(x.song):''}${tag}</span></div>${x.notes?`<div class="hint">${esc(x.notes)}</div>`:''}<div class="vid-body hidden"></div></div>`; }).join('');
    $('#vidList').querySelectorAll('.vid').forEach(el=>el.querySelector('.vid-h').addEventListener('click',()=>openVideo(el)));
  }
  function suggestSong(){ const s=S.get().songs.filter(x=>['Learning','Polishing'].includes(x.status)); return s.length? `<i>${esc(s[Math.floor(Math.random()*s.length)].title)}</i>` : 'your current song'; }
  async function openVideo(el){
    const body=el.querySelector('.vid-body'); if(!body.classList.contains('hidden')){ const v=body.querySelector('video'); if(v&&v.src) URL.revokeObjectURL(v.src); body.classList.add('hidden'); body.innerHTML=''; return; }
    const f=shown[+el.dataset.i]; if(!f) return;
    const file=f.local? f.file : await f.handle.getFile(); const url=URL.createObjectURL(file);
    const x=meta()[f.name]||(meta()[f.name]={song:'',notes:'',date:new Date(f.modified).toISOString().slice(0,10),reviewed:false});
    body.classList.remove('hidden');
    const actions = f.local
      ? `<button class="btn small vDl">${S.isIOS?'Save video…':'Download again'}</button><button class="btn small ghost vLog">Log as practice session</button><button class="btn small danger vRm">Remove from list</button>`
      : `<button class="btn small ghost vLog">Log as practice session</button><button class="btn small danger vDel">Delete file</button>`;
    body.innerHTML=`<video controls playsinline src="${url}" style="width:100%;max-height:420px;background:#000;border-radius:8px"></video>
      <div class="form"><div class="form-row"><label>Song <input type="text" class="vSong" value="${esc(x.song||'')}"></label><label class="toggle" style="align-self:end"><input type="checkbox" class="vRev" ${x.reviewed?'checked':''}> Reviewed</label></div>
      <label>Review notes (what worked / what to fix) <textarea class="vNotes" rows="2">${esc(x.notes||'')}</textarea></label>
      <div class="btn-row"><button class="btn small vSave">Save notes</button>${actions}</div></div>`;
    body.querySelector('.vSave').addEventListener('click',()=>{ x.song=body.querySelector('.vSong').value.trim(); x.notes=body.querySelector('.vNotes').value.trim(); x.reviewed=body.querySelector('.vRev').checked; S.save(); render(); });
    body.querySelector('.vRev').addEventListener('change',(e)=>{ x.reviewed=e.target.checked; S.save(); });
    body.querySelector('.vLog').addEventListener('click',()=>{ $('#logSong').value=x.song||''; $('#logNotes').value='Video: '+f.name+(x.notes?'\n'+x.notes:''); $('#logDate').value=new Date(f.modified).toISOString().slice(0,10); $('#logForm').scrollIntoView({behavior:'smooth'}); });
    const dl=body.querySelector('.vDl'); if(dl) dl.addEventListener('click',async()=>{ const r=await S.saveFile(f.file,f.name); if(r!=='cancelled'){ f.saved=true; render(); } });
    const rm=body.querySelector('.vRm'); if(rm) rm.addEventListener('click',()=>{ if(!f.saved && !confirm('This recording hasn\'t been saved. Remove it anyway?')) return; URL.revokeObjectURL(url); local=local.filter(l=>l!==f); render(); });
    const del=body.querySelector('.vDel'); if(del) del.addEventListener('click',async()=>{ if(!confirm('Delete '+f.name+' from the folder?')) return; await dirHandle.removeEntry(f.name); delete meta()[f.name]; S.save(); await refresh(); });
  }

  async function init(){
    $('#vidPickFolder').addEventListener('click',pickFolder);
    $('#vidRecBtn').addEventListener('click',()=>{ if(recorder&&recorder.state==='recording') stopRec(); else startRec(); });
    $('#vidImport').addEventListener('change',(e)=>{ importFiles([...e.target.files]); e.target.value=''; });
    $('#vidRefresh').addEventListener('click',refresh);
    // Warn before closing with unsaved in-memory recordings.
    window.addEventListener('beforeunload',(e)=>{ if(local.some(x=>!x.saved)){ e.preventDefault(); e.returnValue=''; } });
    if(hasFS){ try{ dirHandle=await kvGet('videoDir')||null; }catch(e){} }
    await refresh();
  }
  return {init, refresh};
})();
