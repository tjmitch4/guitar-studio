// Fretboard Trainer: learn + quiz every note on the neck, with progress tracking and a level path.
window.TrainerUI = (() => {
  const M=window.Music, V=window.Voicings, S=window.Store, T=window.Tone;
  const $=(s)=>document.querySelector(s);
  const uf=()=>window.FretboardUI.useFlats();
  const NAT=[0,2,4,5,7,9,11];
  const STR=['E (6th)','A (5th)','D (4th)','G (3rd)','B (2nd)','e (1st)'];

  const LEVELS=[
    {id:1, name:'Low E string · naturals', strings:[0], naturals:true, maxFret:12, tip:'Anchor notes: open E, F at 1, G at 3, A at 5, B at 7, C at 8, D at 10, E at 12. Sharps live between (except E–F and B–C, which are one fret apart).'},
    {id:2, name:'A string · naturals', strings:[1], naturals:true, maxFret:12, tip:'Same pattern shifted: A open, B 2, C 3, D 5, E 7, F 8, G 10, A 12. E and A strings are your barre-chord roots — nail these first.'},
    {id:3, name:'E + A strings · all 12 notes', strings:[0,1], naturals:false, maxFret:12, tip:'Sharps/flats: one fret above a natural is its sharp, one below is the flat of the next. F#=Gb etc.'},
    {id:4, name:'D + G strings · naturals', strings:[2,3], naturals:true, maxFret:12, tip:'Octave shape: any note on E → same note 2 strings up, 2 frets higher (on D). Any note on A → 2 strings up, 2 frets higher (on G).'},
    {id:5, name:'D + G strings · all notes', strings:[2,3], naturals:false, maxFret:12, tip:'Keep using the octave shapes from E and A until it\'s automatic.'},
    {id:6, name:'B + high e · all notes', strings:[4,5], naturals:false, maxFret:12, tip:'High e = low E (same names). B string: notes are 4 frets *lower* than on G… or think from high e: 5 frets higher than e for the same note (B string fret 5 = E).'},
    {id:7, name:'Whole neck · timed', strings:[0,1,2,3,4,5], naturals:false, maxFret:15, timed:true, tip:'Speed round. Aim for under 3 s per answer. Frets 13–15 repeat 1–3.'},
  ];
  const state={ mode:'find', strings:new Set([0,1]), naturals:true, maxFret:12, timed:false, level:null,
    q:null, qStart:0, lock:false, learnPc:null, learnString:null, streak:0, sessionN:0, sessionOK:0 };

  const stats=()=>{ const d=S.get(); if(!d.quiz||!Array.isArray(d.quiz.attempts)) d.quiz={attempts:[]}; return d.quiz; };
  // Phones: a taller, full-width neck with bigger tap targets instead of a 700px board you have to scroll.
  const narrowMQ=window.matchMedia('(max-width: 560px)');
  const isCompact=()=>narrowMQ.matches;

  // ---------- Question generation (weighted toward weak spots) ----------
  function candidates(){
    const out=[]; for(const s of state.strings) for(let f=0;f<=state.maxFret;f++){ const pc=M.mod(M.TUNING[s]+f); if(state.naturals&&!NAT.includes(pc)) continue; out.push({s,f,pc}); }
    return out;
  }
  function weightFor(c, per){
    const k=c.s+':'+c.pc, st=per[k];
    if(!st) return 3;               // unseen
    const acc=st.ok/st.n; return 1 + (1-acc)*4 + (st.avg>4000?1:0);
  }
  function perStats(){
    const per={}; for(const a of stats().attempts){ const k=a.s+':'+a.pc; const p=per[k]=per[k]||{n:0,ok:0,ms:0}; p.n++; if(a.ok) p.ok++; p.ms+=a.ms; }
    for(const k in per) per[k].avg=per[k].ms/per[k].n; return per;
  }
  function nextQuestion(){
    const cs=candidates(); if(!cs.length){ $('#trPrompt').innerHTML='<span class="empty">Select at least one string.</span>'; return; }
    const per=perStats();
    const ws=cs.map(c=>weightFor(c,per)); let tot=ws.reduce((a,b)=>a+b,0);
    let q=null; for(let tries=0;tries<10;tries++){ let r=Math.random()*tot; for(let i=0;i<cs.length;i++){ r-=ws[i]; if(r<=0){ q=cs[i]; break; } } q=q||cs[cs.length-1]; if(!state.q||q.s!==state.q.s||q.pc!==state.q.pc) break; }
    state.q=q; state.qStart=performance.now(); state.lock=false;
    render();
  }

  // ---------- Rendering ----------
  function marksFor(){
    const marks=[]; const nm=(pc)=>M.pcToName(pc,uf());
    if(state.mode==='learn'){
      for(let s=0;s<6;s++) for(let f=0;f<=state.maxFret;f++){
        const pc=M.mod(M.TUNING[s]+f);
        if(state.learnString!=null && s===state.learnString){ marks.push({string:s,fret:f,kind:NAT.includes(pc)?'sel':'dim',label:nm(pc)}); }
        else if(state.learnPc!=null && pc===state.learnPc) marks.push({string:s,fret:f,kind:'root',label:nm(pc)});
      }
      // In find-note learn mode, dim the strings not selected? keep clean.
    } else if(state.q){
      if(state.mode==='name') marks.push({string:state.q.s,fret:state.q.f,kind:'ask',label:'?'});
      // strings not in scope: subtle dots at open position? Show nothing; string labels suffice.
    }
    if(state.fb) marks.push(...state.fb);
    return marks;
  }
  function render(){
    $('#tab-trainer').classList.toggle('learn', state.mode==='learn');
    $('#trFretboard').innerHTML=V.fretboardSVG(marksFor(),{frets:state.maxFret>12?15:12, compact:isCompact()});
    // dim strings not in play
    if(state.mode!=='learn'){ const svg=$('#trFretboard svg'); if(svg){ for(let s=0;s<6;s++){ if(!state.strings.has(s)){ svg.querySelectorAll(`.hit[data-s="${s}"]`).forEach(h=>h.style.cursor='not-allowed'); } } } }
    const nm=(pc)=>M.pcToName(pc,uf());
    if(state.mode==='learn'){
      $('#trPrompt').innerHTML= state.learnString!=null ? `<b>Notes on the ${STR[state.learnString]} string</b> — bold = naturals. Click any fret to hear it.` : state.learnPc!=null ? `<b>Every ${nm(state.learnPc)}</b> on the neck. Notice the octave shapes: 2 strings up + 2 frets (E→D, A→G), 2 strings up + 3 frets (D→B, G→e), and same fret on E and e.` : 'Pick a note or a string below.';
      $('#trAnswers').innerHTML=`<div class="chips" role="group" aria-label="Show every"><span class="chips-label">Every:</span>${M.SHARP.map((n,i)=>`<button type="button" class="chip ${state.learnPc===i?'on':''}" aria-pressed="${state.learnPc===i}" data-pc="${i}">${nm(i)}</button>`).join('')}</div><div class="chips" style="margin-top:.4rem" role="group" aria-label="Show string"><span class="chips-label">String:</span>${STR.map((n,i)=>`<button type="button" class="chip ${state.learnString===i?'on':''}" aria-pressed="${state.learnString===i}" data-str="${i}">${n}</button>`).join('')}</div>`;
      $('#trAnswers').querySelectorAll('[data-pc]').forEach(c=>c.addEventListener('click',()=>{ state.learnPc=+c.dataset.pc; state.learnString=null; render(); const m=M.TUNING[0]+((state.learnPc-M.TUNING[0])%12+12)%12; T.pluck(m); }));
      $('#trAnswers').querySelectorAll('[data-str]').forEach(c=>c.addEventListener('click',()=>{ state.learnString=+c.dataset.str; state.learnPc=null; render(); }));
    } else if(state.q){
      if(state.mode==='find'){
        $('#trPrompt').innerHTML=`Find <b class="big">${nm(state.q.pc)}</b> on the <b>${STR[state.q.s]}</b> string`;
        $('#trAnswers').innerHTML='<span class="hint">Click the fret on the fretboard.</span>';
      } else {
        $('#trPrompt').innerHTML=`What note is the <b>blue dot</b>? (${STR[state.q.s]} string, fret ${state.q.f})`;
        const opts = state.naturals? NAT : [...Array(12).keys()];
        $('#trAnswers').innerHTML=`<div class="chips big">${opts.map(pc=>`<button type="button" class="chip" data-ans="${pc}">${nm(pc)}</button>`).join('')}</div><span class="hint">Keyboard: A–G for naturals · Shift+letter = sharp · letter then <kbd>-</kbd> = flat.</span>`;
        $('#trAnswers').querySelectorAll('[data-ans]').forEach(c=>c.addEventListener('click',()=>answerName(+c.dataset.ans)));
      }
    }
    $('#trSession').innerHTML=`Session: <b>${state.sessionOK}/${state.sessionN}</b> · streak <b>${state.streak}</b>${state.level?` · Level ${state.level.id}: ${state.level.name}`:''}`;
    renderLevels(); renderHeat(perStats());
  }

  // ---------- Answering ----------
  function record(ok, ms){
    const q=state.q; const st=stats(); st.attempts.push({s:q.s,f:q.f,pc:q.pc,ok,ms:Math.round(ms),mode:state.mode,lvl:state.level?state.level.id:0,ts:Date.now()});
    if(st.attempts.length>4000) st.attempts=st.attempts.slice(-4000);
    S.save(); state.sessionN++; if(ok){ state.sessionOK++; state.streak++; } else state.streak=0;
  }
  function onFretClick(s,f){
    if(state.mode==='learn'){ T.pluck(M.TUNING[s]+f); state.fb=[{string:s,fret:f,kind:'ok',label:M.pcToName(M.mod(M.TUNING[s]+f),uf())}]; render(); setTimeout(()=>{state.fb=null; render();},700); return; }
    if(state.mode!=='find'||!state.q||state.lock) return;
    if(!state.strings.has(s)) return;
    const ms=performance.now()-state.qStart; const pc=M.mod(M.TUNING[s]+f);
    const ok = s===state.q.s && pc===state.q.pc;
    state.lock=true; record(ok,ms);
    T.pluck(M.TUNING[s]+f);
    if(ok){ state.fb=[{string:s,fret:f,kind:'ok',label:M.pcToName(pc,uf())}]; }
    else { T.blip(false); state.fb=[{string:s,fret:f,kind:'bad',label:M.pcToName(pc,uf())}]; for(let ff=0;ff<=state.maxFret;ff++){ if(M.mod(M.TUNING[state.q.s]+ff)===state.q.pc) state.fb.push({string:state.q.s,fret:ff,kind:'ok',label:M.pcToName(state.q.pc,uf())}); } }
    render();
    setTimeout(()=>{ state.fb=null; nextQuestion(); }, ok?650:1600);
  }
  function answerName(pc){
    if(state.mode!=='name'||!state.q||state.lock) return;
    const ms=performance.now()-state.qStart; const ok=pc===state.q.pc; state.lock=true; record(ok,ms);
    T.pluck(M.TUNING[state.q.s]+state.q.f);
    state.fb=[{string:state.q.s,fret:state.q.f,kind:ok?'ok':'bad',label:M.pcToName(state.q.pc,uf())}];
    if(!ok){ T.blip(false); $('#trPrompt').innerHTML=`<span style="color:var(--danger)">Nope — that's <b>${M.pcToName(state.q.pc,uf())}</b>.</span> You said ${M.pcToName(pc,uf())}.`; }
    render(); if(!ok) $('#trPrompt').innerHTML=`<span style="color:var(--danger)">Nope — it's <b>${M.pcToName(state.q.pc,uf())}</b></span> (you said ${M.pcToName(pc,uf())})`;
    setTimeout(()=>{ state.fb=null; nextQuestion(); }, ok?650:1600);
  }
  let pendingKey=null, pendingTimer=null;
  function onKey(e){
    if(!$('#tab-trainer').classList.contains('active')||state.mode!=='name'||!state.q) return;
    if(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k=e.key.toUpperCase();
    if(k.length===1 && 'ABCDEFG'.includes(k)){
      const pc=M.noteToPc(k);
      if(e.shiftKey){ answerName(M.mod(pc+1)); return; }
      if(state.naturals){ answerName(pc); return; }
      clearTimeout(pendingTimer); pendingKey=pc;
      pendingTimer=setTimeout(()=>{ if(pendingKey===pc){ pendingKey=null; answerName(pc); } },400);
    } else if(pendingKey!=null && (e.key==='#'||e.key==='3'||e.key==='=')){ clearTimeout(pendingTimer); const p=pendingKey; pendingKey=null; answerName(M.mod(p+1)); }
    else if(pendingKey!=null && e.key==='-'){ clearTimeout(pendingTimer); const p=pendingKey; pendingKey=null; answerName(M.mod(p-1)); }
  }

  // ---------- Levels & progress ----------
  function levelProgress(L){
    const at=stats().attempts.filter(a=>a.lvl===L.id).slice(-20);
    if(!at.length) return {n:0,acc:0,avg:0,passed:false};
    const acc=at.filter(a=>a.ok).length/at.length, avg=at.reduce((x,a)=>x+a.ms,0)/at.length;
    const passed = at.length>=20 && acc>=0.9 && avg<=(L.timed?3000:5000);
    return {n:at.length,acc,avg,passed};
  }
  function renderLevels(){
    $('#trLevels').innerHTML=LEVELS.map(L=>{ const p=levelProgress(L); const cur=state.level&&state.level.id===L.id;
      return `<button type="button" class="lvl ${p.passed?'passed':''} ${cur?'cur':''}" data-l="${L.id}" ${cur?'aria-current="true"':''}><span class="lvl-h"><span>${p.passed?'✅':cur?'▶':'○'} L${L.id} · ${L.name}</span><span class="lvl-p">${p.n?`${Math.round(p.acc*100)}% · ${(p.avg/1000).toFixed(1)}s (${p.n}/20)`:'not started'}</span></span></button>`; }).join('');
    $('#trLevels').querySelectorAll('.lvl').forEach(el=>el.addEventListener('click',()=>startLevel(+el.dataset.l)));
    const next=LEVELS.find(L=>!levelProgress(L).passed);
    $('#trNext').textContent= next? `Suggested: L${next.id} · ${next.name}` : 'All levels passed — do timed whole-neck rounds to keep it sharp!';
  }
  function startLevel(id){
    const L=LEVELS.find(l=>l.id===id); state.level=L; state.strings=new Set(L.strings); state.naturals=L.naturals; state.maxFret=L.maxFret; state.timed=!!L.timed;
    if(state.mode==='learn') state.mode='find';
    syncControls(); $('#trTip').textContent=L.tip; nextQuestion();
  }
  function renderHeat(per){
    per=per||perStats(); const nm=(pc)=>M.pcToName(pc,uf());
    let h=`<table class="heat"><tr><th></th>${M.SHARP.map((n,i)=>`<th>${nm(i)}</th>`).join('')}</tr>`;
    for(let s=5;s>=0;s--){ h+=`<tr><th>${M.STRING_NAMES[s]}</th>`; for(let pc=0;pc<12;pc++){ const st=per[s+':'+pc]; let bg='transparent',txt='·',title='not practiced'; if(st){ const acc=st.ok/st.n; const hue=Math.round(acc*120); bg=`hsla(${hue},60%,45%,${0.35+0.5*Math.min(1,st.n/8)})`; txt=Math.round(acc*100)+''; title=`${st.ok}/${st.n} correct · avg ${(st.avg/1000).toFixed(1)}s`; } h+=`<td style="background:${bg}" title="${title}">${txt}</td>`; } h+='</tr>'; }
    h+='</table>';
    const all=stats().attempts; const acc=all.length?Math.round(all.filter(a=>a.ok).length/all.length*100):0;
    $('#trHeat').innerHTML=`<div class="hint">Accuracy per string × note (all time: ${all.length} answers, ${acc}% correct). Hover a cell for details. Weak cells get asked more often.</div>`+h;
  }

  function syncControls(){
    $('#trMode').value=state.mode; $('#trNaturals').checked=state.naturals; $('#trFrets').value=state.maxFret;
    $('#trStrings').querySelectorAll('.chip').forEach(c=>{ const on=state.strings.has(+c.dataset.s); c.classList.toggle('on',on); c.setAttribute('aria-pressed',on); });
  }
  function init(){
    $('#trStrings').innerHTML='<span class="chips-label">Quiz strings:</span>'+STR.map((n,i)=>`<button type="button" class="chip" aria-pressed="false" data-s="${i}">${n}</button>`).join('');
    $('#trStrings').querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{ const s=+c.dataset.s; state.strings.has(s)?state.strings.delete(s):state.strings.add(s); state.level=null; syncControls(); nextQuestion(); }));
    $('#trMode').addEventListener('change',()=>{ state.mode=$('#trMode').value; state.fb=null; if(state.mode==='learn'){ state.q=null; render(); } else nextQuestion(); });
    $('#trNaturals').addEventListener('change',()=>{ state.naturals=$('#trNaturals').checked; state.level=null; nextQuestion(); });
    $('#trFrets').addEventListener('change',()=>{ state.maxFret=+$('#trFrets').value; state.level=null; nextQuestion(); });
    $('#trSkip').addEventListener('click',()=>{ state.fb=null; nextQuestion(); });
    $('#trReset').addEventListener('click',()=>{ if(!confirm('Reset all trainer stats?')) return; S.get().quiz={attempts:[]}; S.save(); render(); window.App.toast('Trainer stats reset'); });
    $('#trFretboard').addEventListener('click',(e)=>{ const t=e.target.closest('.hit'); if(t) onFretClick(+t.dataset.s,+t.dataset.f); });
    document.addEventListener('keydown',onKey);
    const onMQ=()=>render(); if(narrowMQ.addEventListener) narrowMQ.addEventListener('change',onMQ); else if(narrowMQ.addListener) narrowMQ.addListener(onMQ);
    $('#useFlats').addEventListener('change',render);
    // start at suggested level
    const next=LEVELS.find(L=>!levelProgress(L).passed)||LEVELS[6];
    startLevel(next.id);
  }
  return {init, render};
})();
