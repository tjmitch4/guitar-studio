// Practice tab: timer, metronome, session log, plan generator, charts
window.PracticeUI = (() => {
  const $=(s)=>document.querySelector(s);
  const S=window.Store;
  const CATS=['Song','Improv / jam track','Technique','Fingerstyle','Theory','Ear / transcribing','Rhythm / chords','Repertoire run-through'];
  const today=()=>{ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };

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
    while(nextTime < ac.currentTime+0.1){
      const accent = sig>0 && beat%sig===0;
      const o=ac.createOscillator(), g=ac.createGain();
      o.frequency.value=accent?1500:1000; g.gain.setValueAtTime(0.0001,nextTime); g.gain.exponentialRampToValueAtTime(0.6,nextTime+0.002); g.gain.exponentialRampToValueAtTime(0.0001,nextTime+0.06);
      o.connect(g).connect(ac.destination); o.start(nextTime); o.stop(nextTime+0.07);
      const b=beat, t=nextTime; setTimeout(()=>flash(b,accent), Math.max(0,(t-ac.currentTime)*1000));
      const perBeat=60/bpm*(sig===6?0.5:1);
      nextTime+=perBeat; beat++;
    }
    mTimer=setTimeout(schedule,25);
  }
  function flash(b,accent){ const sig=+$('#metroSig').value||4; const dots=$('#metroBeats').children; for(let i=0;i<dots.length;i++) dots[i].className=''; const d=dots[b%sig]; if(d) d.className='on'+(accent?' accent':''); }
  function renderBeats(){ const sig=+$('#metroSig').value||4; $('#metroBeats').innerHTML=Array.from({length:sig},()=>'<span></span>').join(''); }
  function metroToggle(){
    if(mRunning){ mRunning=false; clearTimeout(mTimer); $('#metroToggle').textContent='▶ Metronome'; return; }
    window.Tone.unlock(); // iOS: 'playback' audio session so the click is heard with the silent switch on
    ac=ac||new (window.AudioContext||window.webkitAudioContext)(); ac.resume(); // resume inside the tap (required on iOS)
    mRunning=true; beat=0; nextTime=ac.currentTime+0.05; $('#metroToggle').textContent='■ Stop'; schedule();
  }

  // ---------- Log ----------
  const selectedCats=new Set();
  function renderCats(){ $('#logCats').innerHTML=CATS.map(c=>`<span class="chip ${selectedCats.has(c)?'on':''}" data-c="${c}">${c}</span>`).join('');
    $('#logCats').querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>{ const c=ch.dataset.c; selectedCats.has(c)?selectedCats.delete(c):selectedCats.add(c); renderCats(); })); }
  function saveSession(e){
    e.preventDefault();
    const d=S.get();
    d.sessions.push({id:S.uid(), date:$('#logDate').value, minutes:+$('#logMinutes').value, cats:[...selectedCats], song:$('#logSong').value.trim(), tempo:$('#logTempo').value?+$('#logTempo').value:null, rating:$('#logRating').value, notes:$('#logNotes').value.trim(), created:new Date().toISOString()});
    S.save();
    // if the song is in the repertoire and a tempo was logged, update its current tempo
    const song=d.songs.find(s=>s.title.toLowerCase()===$('#logSong').value.trim().toLowerCase());
    if(song && $('#logTempo').value){ song.curTempo=+$('#logTempo').value; S.save(); }
    $('#logForm').reset(); $('#logDate').value=today(); selectedCats.clear(); renderCats(); timerReset();
    renderProgress(); renderHistory(); window.SongsUI && window.SongsUI.render();
  }
  function renderSongList(){ $('#songList').innerHTML=S.get().songs.map(s=>`<option value="${s.title.replace(/"/g,'&quot;')}">`).join(''); }

  // ---------- Plan generator ----------
  const THEORY_BITES=['Name the notes of one pentatonic box out loud as you play it','Play the CAGED shapes for one chord up the neck','Play a ii–V–I in three keys using 7th-chord voicings','Find every root of today\'s key on strings 6, 5 and 4','Sing the interval before you play it (3rds and 5ths)','Play a scale in 3rds (1-3, 2-4, 3-5…)','Harmonise a major scale in triads on the top 3 strings','Say each chord\'s roman numeral as you play a progression'];
  const IMPROV_GOALS=['Only chord tones — arpeggios on the changes','Only Dorian over a minor vamp; lean on the 6','Mixolydian over a dominant vamp; lean on the b7','Minor pent ↔ major pent switching on a major blues','One motif, three variations, then leave space','Every phrase starts on the 3rd of the current chord','Double-stops and hybrid picking only','Bends: unison, pre-bend, half-step — check pitch against the fretted note','Steal one lick, play it in 3 positions','Solo one whole chorus on ONE string'];
  const TECH=['Chromatic 1-2-3-4 with metronome, +4 bpm each pass','Alternate picking scale runs, 8th → 16th at same bpm','Legato hammer/pull triplets on each string','String skipping arpeggios (E shape → D shape)','Travis picking pattern on an open chord loop','Vibrato drills: slow wide, fast narrow, hold each 8 beats'];
  const pick=(arr,seed)=>arr[Math.floor(seed*arr.length)];
  function generatePlan(){
    const d=S.get(); const learning=d.songs.filter(s=>['Learning','Polishing'].includes(s.status));
    const song=learning.length?learning[Math.floor(Math.random()*learning.length)]:null;
    const items=[
      {min:5, what:'Warm-up', how:pick(TECH,Math.random())},
      {min:10, what: song?`Song: ${song.title}`:'Song work', how: song?(song.sections?`Loop the hardest section: ${song.sections.split('\n')[0]}. Slow it down, +4 bpm when clean 3× in a row.${song.tempo?` Target ${song.tempo} bpm${song.curTempo?`, currently ${song.curTempo}`:''}.`:''}`:'Pick the hardest 2 bars, loop them slowly.'):'Add a song in the Songs tab and it\'ll show up here.'},
      {min:7, what:'Improv over a jam track', how:pick(IMPROV_GOALS,Math.random())},
      {min:3, what:'Theory bite', how:pick(THEORY_BITES,Math.random())},
    ];
    $('#planHost').innerHTML=items.map(i=>`<div class="item"><div class="min">${i.min} min</div><div class="what"><b>${i.what}</b><span>${i.how}</span></div></div>`).join('');
  }

  // ---------- Progress ----------
  function weekKey(dateStr){ const d=new Date(dateStr+'T00:00:00'); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return d.toISOString().slice(0,10); }
  function renderProgress(){
    const ss=S.get().sessions.slice().sort((a,b)=>a.date.localeCompare(b.date));
    const total=ss.reduce((a,s)=>a+s.minutes,0);
    // streak: consecutive days ending today or yesterday
    const days=new Set(ss.map(s=>s.date)); let streak=0; const d=new Date();
    const key=(dt)=>new Date(dt.getTime()-dt.getTimezoneOffset()*60000).toISOString().slice(0,10);
    if(!days.has(key(d))) d.setDate(d.getDate()-1);
    while(days.has(key(d))){ streak++; d.setDate(d.getDate()-1); }
    const last7=ss.filter(s=>(Date.now()-new Date(s.date+'T00:00:00'))<7*864e5).reduce((a,s)=>a+s.minutes,0);
    const last30=ss.filter(s=>(Date.now()-new Date(s.date+'T00:00:00'))<30*864e5);
    const daysIn30=new Set(last30.map(s=>s.date)).size;
    $('#stats').innerHTML=[['Sessions',ss.length],['Total',total>=120?(total/60).toFixed(1)+' h':total+' min'],['Last 7 days',last7+' min'],['Days / last 30',daysIn30],['Streak',streak+' d']].map(([l,v])=>`<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
    // weekly chart, last 12 weeks
    const weeks=[]; const start=new Date(); start.setDate(start.getDate()-7*11);
    for(let i=0;i<12;i++){ const dt=new Date(start.getTime()+i*7*864e5); weeks.push(weekKey(key(dt))); }
    const byWeek={}; ss.forEach(s=>{ const k=weekKey(s.date); byWeek[k]=(byWeek[k]||0)+s.minutes; });
    const vals=weeks.map(w=>byWeek[w]||0); const max=Math.max(60,...vals);
    const W=900,H=200,pl=40,pb=28,pt=10; const bw=(W-pl-10)/12;
    let svg=`<svg viewBox="0 0 ${W} ${H}"><text x="${pl-6}" y="${pt+8}" font-size="10" text-anchor="end" fill="var(--muted)">${max}m</text><text x="${pl-6}" y="${H-pb}" font-size="10" text-anchor="end" fill="var(--muted)">0</text><line x1="${pl}" y1="${H-pb}" x2="${W-10}" y2="${H-pb}" stroke="var(--border)"/>`;
    vals.forEach((v,i)=>{ const h=(H-pb-pt)*v/max; const x=pl+i*bw+4; svg+=`<rect x="${x}" y="${H-pb-h}" width="${bw-8}" height="${h}" rx="3" fill="${i===11?'var(--accent)':'var(--sel)'}" opacity=".9"/>`; if(v) svg+=`<text x="${x+(bw-8)/2}" y="${H-pb-h-4}" font-size="10" text-anchor="middle" fill="var(--text)">${v}</text>`; svg+=`<text x="${x+(bw-8)/2}" y="${H-8}" font-size="9" text-anchor="middle" fill="var(--muted)">${weeks[i].slice(5)}</text>`; });
    svg+=`<text x="${pl}" y="${H-pb+22}" font-size="9" fill="var(--muted)"></text></svg>`;
    $('#chartHost').innerHTML=`<div class="hint">Minutes per week (weeks starting Monday)</div>`+svg;
    // category split (last 30 days)
    const byCat={}; last30.forEach(s=>{ const cs=s.cats&&s.cats.length?s.cats:['Uncategorised']; cs.forEach(c=>byCat[c]=(byCat[c]||0)+s.minutes/cs.length); });
    const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    if(cats.length){ const tot=cats.reduce((a,c)=>a+c[1],0); $('#catChart').innerHTML=`<div class="hint">Focus split, last 30 days</div><div class="chips">${cats.map(([c,m])=>`<span class="chip">${c} · ${Math.round(m)} min (${Math.round(m/tot*100)}%)</span>`).join('')}</div>`; }
    else $('#catChart').innerHTML='';
  }
  function renderHistory(){
    const ss=S.get().sessions.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created));
    if(!ss.length){ $('#historyHost').innerHTML='<p class="empty">No sessions yet — log your first one above.</p>'; return; }
    $('#historyHost').innerHTML=`<table class="hist"><tr><th>Date</th><th>Min</th><th>Focus</th><th>Song</th><th>Tempo</th><th>Feel</th><th>Notes</th><th></th></tr>${ss.map(s=>`<tr><td>${s.date}</td><td>${s.minutes}</td><td>${(s.cats||[]).join(', ')}</td><td>${s.song||''}</td><td>${s.tempo||''}</td><td>${s.rating||''}</td><td>${(s.notes||'').replace(/</g,'&lt;')}</td><td><span class="del" data-id="${s.id}" title="Delete">✕</span></td></tr>`).join('')}</table>`;
    $('#historyHost').querySelectorAll('.del').forEach(b=>b.addEventListener('click',()=>{ if(!confirm('Delete this session?')) return; const d=S.get(); d.sessions=d.sessions.filter(x=>x.id!==b.dataset.id); S.save(); renderProgress(); renderHistory(); }));
  }

  function init(){
    $('#logDate').value=today(); renderCats(); renderSongList(); renderBeats();
    $('#timerStart').addEventListener('click',timerToggle); $('#timerReset').addEventListener('click',timerReset);
    $('#metroToggle').addEventListener('click',metroToggle);
    $('#metroBpm').addEventListener('input',()=>$('#metroSlider').value=$('#metroBpm').value);
    $('#metroSlider').addEventListener('input',()=>$('#metroBpm').value=$('#metroSlider').value);
    $('#metroSig').addEventListener('change',()=>{ renderBeats(); beat=0; });
    $('#logForm').addEventListener('submit',saveSession);
    $('#planRegen').addEventListener('click',generatePlan);
    $('#exportBtn').addEventListener('click',S.exportJSON);
    $('#importFile').addEventListener('change',(e)=>{ const f=e.target.files[0]; if(!f) return; S.importJSON(f,(err)=>{ if(err) alert('Import failed: '+err.message); else { renderProgress(); renderHistory(); window.SongsUI.render(); } e.target.value=''; }); });
    document.addEventListener('keydown',(e)=>{ if(e.code==='Space' && document.activeElement===document.body && $('#tab-practice').classList.contains('active')){ e.preventDefault(); metroToggle(); } });
    generatePlan(); renderProgress(); renderHistory();
  }
  return {init, renderSongList, generatePlan};
})();
