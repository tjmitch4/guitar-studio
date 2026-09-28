// Practice tab: timer, metronome, session log, plan generator, charts
window.PracticeUI = (() => {
  const $=(s)=>document.querySelector(s);
  const S=window.Store, esc=S.esc;
  const CATS=['Song','Improv / jam track','Technique','Fingerstyle','Theory','Ear / transcribing','Rhythm / chords','Repertoire run-through'];
  const today=()=>S.localDate();
  const toast=(m)=>window.App && window.App.toast(m);

  // ---------- Timer ----------
  let tStart=null, tElapsed=0, tInt=null;
  function fmt(sec){ sec=Math.floor(sec); return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0'); }
  function tick(){ const e=tElapsed+(tStart?(Date.now()-tStart)/1000:0); $('#timerDisplay').textContent=fmt(e); }
  function timerToggle(){
    if(tStart){ tElapsed+=(Date.now()-tStart)/1000; tStart=null; clearInterval(tInt); $('#timerStart').textContent='Resume'; $('#logMinutes').value=Math.max(1,Math.round(tElapsed/60)); }
    else { tStart=Date.now(); tInt=setInterval(tick,500); $('#timerStart').textContent='Pause'; }
    tick();
  }
  function timerReset(){ tStart=null; tElapsed=0; clearInterval(tInt); $('#timerStart').textContent='Start'; tick(); }

  // ---------- Metronome (Web Audio, lookahead scheduler) ----------
  let ac=null, mRunning=false, nextTime=0, beat=0, mTimer=null;
  function schedule(){
    const bpm=+$('#metroBpm').value||90, sig=+$('#metroSig').value;
    // BPM is the quarter note; 6/8 clicks eighths (two per quarter).
    const perBeat=60/bpm*(sig===6?0.5:1);
    // If the scheduler was stalled (background tab, app switcher, busy thread), don't play the missed
    // clicks all at once — skip ahead to the next beat slot.
    if(nextTime < ac.currentTime){ const missed=Math.ceil((ac.currentTime-nextTime)/perBeat); beat+=missed; nextTime+=missed*perBeat; if(nextTime<ac.currentTime+0.02) nextTime=ac.currentTime+0.05; }
    while(nextTime < ac.currentTime+0.1){
      const accent = sig>0 && beat%sig===0;
      const o=ac.createOscillator(), g=ac.createGain();
      o.frequency.value=accent?1500:1000; g.gain.setValueAtTime(0.0001,nextTime); g.gain.exponentialRampToValueAtTime(0.6,nextTime+0.002); g.gain.exponentialRampToValueAtTime(0.0001,nextTime+0.06);
      o.connect(g).connect(ac.destination); o.start(nextTime); o.stop(nextTime+0.07);
      const b=beat, t=nextTime; setTimeout(()=>flash(b,accent), Math.max(0,(t-ac.currentTime)*1000));
      nextTime+=perBeat; beat++;
    }
    mTimer=setTimeout(schedule,25);
  }
  function flash(b,accent){ const sig=+$('#metroSig').value||4; const dots=$('#metroBeats').children; for(let i=0;i<dots.length;i++) dots[i].className=''; const d=dots[b%sig]; if(d) d.className='on'+(accent?' accent':''); }
  function renderBeats(){ const sig=+$('#metroSig').value||4; $('#metroBeats').innerHTML=Array.from({length:sig},()=>'<span></span>').join('');
    $('#metroUnit').textContent = sig===6 ? 'bpm ♩ (clicks ♪)' : 'bpm'; }
  function metroToggle(){
    if(mRunning){ mRunning=false; clearTimeout(mTimer); $('#metroToggle').textContent='▶ Metronome'; return; }
    window.Tone.unlock(); // iOS: 'playback' audio session so the click is heard with the silent switch on
    ac=ac||new (window.AudioContext||window.webkitAudioContext)(); ac.resume(); // resume inside the tap (required on iOS)
    mRunning=true; beat=0; nextTime=ac.currentTime+0.05; $('#metroToggle').textContent='■ Stop'; schedule();
  }

  // ---------- Log ----------
  const selectedCats=new Set();
  let editingId=null;
  function renderCats(){ $('#logCats').innerHTML=CATS.map(c=>`<button type="button" class="chip ${selectedCats.has(c)?'on':''}" aria-pressed="${selectedCats.has(c)}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('#logCats').querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>{ const c=ch.dataset.c; selectedCats.has(c)?selectedCats.delete(c):selectedCats.add(c); ch.classList.toggle('on',selectedCats.has(c)); ch.setAttribute('aria-pressed',selectedCats.has(c)); })); }
  function streakDays(){ const days=new Set(S.get().sessions.map(s=>s.date)); let n=0; const d=new Date(); if(!days.has(S.localDate(d))) d.setDate(d.getDate()-1); while(days.has(S.localDate(d))){ n++; d.setDate(d.getDate()-1); } return n; }
  function saveSession(e){
    e.preventDefault();
    const d=S.get();
    const fields={date:$('#logDate').value, minutes:+$('#logMinutes').value, cats:[...selectedCats], song:$('#logSong').value.trim(), tempo:$('#logTempo').value?+$('#logTempo').value:null, rating:$('#logRating').value, notes:$('#logNotes').value.trim()};
    const existing = editingId && d.sessions.find(s=>s.id===editingId);
    if(existing) Object.assign(existing, fields);
    else d.sessions.push(Object.assign({id:S.uid()}, fields, {created:new Date().toISOString()}));
    // if the song is in the repertoire and a tempo was logged, update its current tempo
    const song=fields.song && d.songs.find(s=>(s.title||'').toLowerCase()===fields.song.toLowerCase());
    if(song && fields.tempo){ song.curTempo=fields.tempo; song.updated=Date.now(); }
    const ok=S.save();
    const wasEdit=!!existing;
    cancelEdit();
    renderProgress(); renderHistory(); window.SongsUI && window.SongsUI.render();
    if(ok!==false){ const st=streakDays(); toast(wasEdit?'Session updated':`Logged ${fields.minutes} min${st>1?` · streak ${st} days`:''}`); }
  }
  function startEdit(id){
    const s=S.get().sessions.find(x=>x.id===id); if(!s) return;
    editingId=id;
    $('#logDate').value=s.date||today(); $('#logMinutes').value=s.minutes||''; $('#logSong').value=s.song||''; $('#logTempo').value=s.tempo||''; $('#logRating').value=s.rating||''; $('#logNotes').value=s.notes||'';
    selectedCats.clear(); (s.cats||[]).forEach(c=>selectedCats.add(c)); renderCats();
    $('#logSubmit').textContent='Update session'; $('#logCancelEdit').classList.remove('hidden');
    $('#logForm').scrollIntoView({behavior:'smooth',block:'start'}); $('#logMinutes').focus({preventScroll:true});
  }
  function cancelEdit(){
    editingId=null; $('#logForm').reset(); $('#logDate').value=today(); selectedCats.clear(); renderCats(); timerReset();
    $('#logSubmit').textContent='Save session'; $('#logCancelEdit').classList.add('hidden');
  }
  function renderSongList(){ $('#songList').innerHTML=S.get().songs.map(s=>`<option value="${esc(s.title)}">`).join(''); }

  // ---------- Plan generator ----------
  const THEORY_BITES=['Name the notes of one pentatonic box out loud as you play it','Play the CAGED shapes for one chord up the neck','Play a ii–V–I in three keys using 7th-chord voicings','Find every root of today\'s key on strings 6, 5 and 4','Sing the interval before you play it (3rds and 5ths)','Play a scale in 3rds (1-3, 2-4, 3-5…)','Harmonise a major scale in triads on the top 3 strings','Say each chord\'s roman numeral as you play a progression'];
  const IMPROV_GOALS=['Only chord tones — arpeggios on the changes','Only Dorian over a minor vamp; lean on the 6','Mixolydian over a dominant vamp; lean on the b7','Minor pent ↔ major pent switching on a major blues','One motif, three variations, then leave space','Every phrase starts on the 3rd of the current chord','Double-stops and hybrid picking only','Bends: unison, pre-bend, half-step — check pitch against the fretted note','Steal one lick, play it in 3 positions','Solo one whole chorus on ONE string'];
  const TECH=['Chromatic 1-2-3-4 with metronome, +4 bpm each pass','Alternate picking scale runs, 8th → 16th at same bpm','Legato hammer/pull triplets on each string','String skipping arpeggios (E shape → D shape)','Travis picking pattern on an open chord loop','Vibrato drills: slow wide, fast narrow, hold each 8 beats'];
  const pick=(arr,seed)=>arr[Math.floor(seed*arr.length)];
  function generatePlan(){
    const d=S.get(); const learning=d.songs.filter(s=>['Learning','Polishing'].includes(s.status));
    const song=learning.length?learning[Math.floor(Math.random()*learning.length)]:null;
    const items=[
      {min:5, what:'Warm-up', how:esc(pick(TECH,Math.random()))},
      {min:10, what: song?`Song: ${esc(song.title)}`:'Song work', how: song?(song.sections?`Loop the hardest section: ${esc(String(song.sections).split('\n')[0])}. Slow it down, +4 bpm when clean 3× in a row.${song.tempo?` Target ${esc(song.tempo)} bpm${song.curTempo?`, currently ${esc(song.curTempo)}`:''}.`:''}`:'Pick the hardest 2 bars, loop them slowly.'):'Add a song in the Songs tab and it\'ll show up here.'},
      {min:7, what:'Improv over a jam track', how:esc(pick(IMPROV_GOALS,Math.random()))},
      {min:3, what:'Theory bite', how:esc(pick(THEORY_BITES,Math.random()))},
    ];
    $('#planHost').innerHTML=items.map(i=>`<div class="item"><div class="min">${i.min} min</div><div class="what"><b>${i.what}</b><span>${i.how}</span></div></div>`).join('');
  }

  // ---------- Progress ----------
  function weekKey(dateStr){ const d=new Date(dateStr+'T00:00:00'); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return S.localDate(d); }
  const byDateAsc=(a,b)=>(a.date||'').localeCompare(b.date||'');
  function renderProgress(){
    const ss=S.get().sessions.slice().sort(byDateAsc);
    const mins=(s)=>+s.minutes||0;
    const total=ss.reduce((a,s)=>a+mins(s),0);
    const streak=streakDays();
    const last7=ss.filter(s=>(Date.now()-new Date(s.date+'T00:00:00'))<7*864e5).reduce((a,s)=>a+mins(s),0);
    const last30=ss.filter(s=>(Date.now()-new Date(s.date+'T00:00:00'))<30*864e5);
    const daysIn30=new Set(last30.map(s=>s.date)).size;
    $('#stats').innerHTML=[['Sessions',ss.length],['Total',total>=120?(total/60).toFixed(1)+' h':total+' min'],['Last 7 days',last7+' min'],['Days / last 30',daysIn30],['Streak',streak+' d']].map(([l,v])=>`<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
    if(!ss.length){ $('#chartHost').innerHTML='<p class="empty">Log a session and your weekly minutes will chart here.</p>'; $('#catChart').innerHTML=''; return; }
    // weekly chart, last 12 weeks
    const weeks=[]; const start=new Date(); start.setDate(start.getDate()-7*11);
    for(let i=0;i<12;i++){ const dt=new Date(start); dt.setDate(start.getDate()+i*7); weeks.push(weekKey(S.localDate(dt))); }
    const byWeek={}; ss.forEach(s=>{ const k=weekKey(s.date); byWeek[k]=(byWeek[k]||0)+mins(s); });
    const vals=weeks.map(w=>byWeek[w]||0); const max=Math.max(60,...vals);
    const W=900,H=200,pl=40,pb=28,pt=10; const bw=(W-pl-10)/12;
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes practised per week, last 12 weeks"><text x="${pl-6}" y="${pt+8}" font-size="10" text-anchor="end" fill="var(--muted)">${max}m</text><text x="${pl-6}" y="${H-pb}" font-size="10" text-anchor="end" fill="var(--muted)">0</text><line x1="${pl}" y1="${H-pb}" x2="${W-10}" y2="${H-pb}" stroke="var(--border)"/>`;
    vals.forEach((v,i)=>{ const h=(H-pb-pt)*v/max; const x=pl+i*bw+4; svg+=`<rect x="${x}" y="${H-pb-h}" width="${bw-8}" height="${h}" rx="3" fill="${i===11?'var(--accent)':'var(--sel)'}" opacity=".9"/>`; if(v) svg+=`<text x="${x+(bw-8)/2}" y="${H-pb-h-4}" font-size="10" text-anchor="middle" fill="var(--text)">${v}</text>`; svg+=`<text x="${x+(bw-8)/2}" y="${H-8}" font-size="9" text-anchor="middle" fill="var(--muted)">${weeks[i].slice(5)}</text>`; });
    svg+='</svg>';
    $('#chartHost').innerHTML=`<div class="hint">Minutes per week (weeks starting Monday)</div>`+svg;
    // category split (last 30 days)
    const byCat={}; last30.forEach(s=>{ const cs=s.cats&&s.cats.length?s.cats:['Uncategorised']; cs.forEach(c=>byCat[c]=(byCat[c]||0)+mins(s)/cs.length); });
    const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    if(cats.length){ const tot=cats.reduce((a,c)=>a+c[1],0)||1; $('#catChart').innerHTML=`<div class="hint">Focus split, last 30 days</div><div class="chips">${cats.map(([c,m])=>`<span class="chip static">${esc(c)} · ${Math.round(m)} min (${Math.round(m/tot*100)}%)</span>`).join('')}</div>`; }
    else $('#catChart').innerHTML='';
  }
  function renderHistory(){
    const ss=S.get().sessions.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.created||'').localeCompare(a.created||''));
    if(!ss.length){ $('#historyHost').innerHTML='<p class="empty">No sessions yet — log your first one above.</p>'; return; }
    $('#historyHost').innerHTML=`<div class="table-scroll"><table class="hist"><thead><tr><th>Date</th><th>Min</th><th>Focus</th><th>Song</th><th class="c-tempo">Tempo</th><th class="c-feel">Feel</th><th>Notes</th><th><span class="vh">Actions</span></th></tr></thead><tbody>${ss.map(s=>`<tr><td class="nowrap">${esc(s.date)}</td><td>${esc(s.minutes)}</td><td>${esc((s.cats||[]).join(', '))}</td><td>${esc(s.song||'')}</td><td class="c-tempo">${esc(s.tempo||'')}</td><td class="c-feel">${esc(s.rating||'')}</td><td class="notes">${esc(s.notes||'')}</td><td class="acts"><button type="button" class="icon-btn edit" data-id="${esc(s.id)}" aria-label="Edit session from ${esc(s.date)}" title="Edit">✎</button><button type="button" class="icon-btn del" data-id="${esc(s.id)}" aria-label="Delete session from ${esc(s.date)}" title="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#historyHost').querySelectorAll('.edit').forEach(b=>b.addEventListener('click',()=>startEdit(b.dataset.id)));
    $('#historyHost').querySelectorAll('.del').forEach(b=>b.addEventListener('click',()=>{ if(!confirm('Delete this session?')) return; const d=S.get(); d.sessions=d.sessions.filter(x=>x.id!==b.dataset.id); if(editingId===b.dataset.id) cancelEdit(); S.save(); renderProgress(); renderHistory(); window.SongsUI && window.SongsUI.render(); toast('Session deleted'); }));
  }

  function init(){
    $('#logDate').value=today(); renderCats(); renderSongList(); renderBeats();
    $('#timerStart').addEventListener('click',timerToggle); $('#timerReset').addEventListener('click',timerReset);
    $('#metroToggle').addEventListener('click',metroToggle);
    $('#metroBpm').addEventListener('input',()=>$('#metroSlider').value=$('#metroBpm').value);
    $('#metroSlider').addEventListener('input',()=>$('#metroBpm').value=$('#metroSlider').value);
    $('#metroSig').addEventListener('change',()=>{ renderBeats(); beat=0; });
    $('#logForm').addEventListener('submit',saveSession);
    $('#logCancelEdit').addEventListener('click',cancelEdit);
    $('#planRegen').addEventListener('click',generatePlan);
    $('#exportBtn').addEventListener('click',async()=>{ const r=await S.exportJSON(); if(r!=='cancelled') toast('Backup exported'); });
    $('#importFile').addEventListener('change',(e)=>{ const f=e.target.files[0]; if(!f) return; S.importJSON(f,(err,c)=>{
      e.target.value='';
      if(err){ alert('Import failed: '+err.message); return; }
      document.getElementById('dataBanner').classList.add('hidden');
      renderProgress(); renderHistory(); renderSongList(); window.SongsUI.render(); try{ window.TrainerUI.render(); }catch(x){} try{ window.VideosUI.refresh(); }catch(x){}
      const parts=[]; if(c.sessions) parts.push(`${c.sessions} session${c.sessions>1?'s':''}`); if(c.songsAdded) parts.push(`${c.songsAdded} song${c.songsAdded>1?'s':''}`); if(c.attempts) parts.push(`${c.attempts} trainer answers`); if(c.videos) parts.push(`${c.videos} video note${c.videos>1?'s':''}`);
      const msg=(parts.length?'Imported '+parts.join(', '):'Nothing new to import')+(c.songsUpdated?` · updated ${c.songsUpdated} song${c.songsUpdated>1?'s':''}`:'');
      window.App.toast(msg,{ms:4000});
    }); });
    document.addEventListener('keydown',(e)=>{ if(e.code==='Space' && document.activeElement===document.body && $('#tab-practice').classList.contains('active')){ e.preventDefault(); metroToggle(); } });
    // the metronome has its own AudioContext; wake it when the app comes back (iOS suspends it)
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && ac && mRunning){ try{ ac.resume(); }catch(e){} } });
    generatePlan(); renderProgress(); renderHistory();
  }
  return {init, renderSongList, generatePlan};
})();
