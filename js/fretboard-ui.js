// Fretboard & Chords tab
window.FretboardUI = (() => {
  const M=window.Music, V=window.Voicings;
  const $=(s)=>document.querySelector(s);
  const state = { picked:new Map(), /* "s,f" -> {s,f} */ perPos:3, pos:0, lastPattern:[] };
  const useFlats = () => $('#useFlats').checked;
  const NOTE_OPTS = () => M.SHARP.map((n,i)=>`<option value="${i}">${useFlats()&&M.FLAT[i]!==n?M.FLAT[i]:n}</option>`).join('');

  function fillNoteSelects(){
    ['#fbRoot','#vRoot','#kRoot'].forEach(sel=>{ const el=$(sel); const v=el.value; el.innerHTML=NOTE_OPTS(); if(v!=='') el.value=v; });
  }
  function init(){
    fillNoteSelects();
    $('#fbRoot').value=9; $('#vRoot').value=9; $('#kRoot').value=9; // A
    $('#fbScale').innerHTML=Object.keys(M.SCALES).map(s=>`<option>${s}</option>`).join('');
    $('#fbScale').value='Minor Pentatonic';
    $('#kScale').innerHTML=Object.keys(M.SCALES).filter(s=>M.SCALES[s].iv.length===7).map(s=>`<option>${s}</option>`).join('');
    $('#kScale').value='Major (Ionian)';
    const chordOpts=M.CHORDS.map(c=>`<option value="${c[0]}">${c[0]||'maj'} — ${c[2]}</option>`).join('');
    $('#fbChord').innerHTML=chordOpts; $('#vType').innerHTML=chordOpts;
    $('#vType').value='7';
    $('#fbCompare').innerHTML='<option value="">— none —</option>'+Object.keys(M.SCALES).map(s=>`<option>${s}</option>`).join('');
    ['#fbMode','#fbRoot','#fbScale','#fbChord','#fbLabels','#fbView','#fbCompare'].forEach(s=>$(s).addEventListener('change',()=>{ if(s==='#fbScale'||s==='#fbRoot'||s==='#fbView'){ state.pos=0; fillTargets(); } syncModeVisibility(); renderFretboard(); }));
    $('#fbTarget').addEventListener('change',renderFretboard);
    $('#fbPrev').addEventListener('click',()=>{ state.pos--; renderFretboard(); });
    $('#fbNext').addEventListener('click',()=>{ state.pos++; renderFretboard(); });
    $('#fbPlay').addEventListener('click',playPattern);
    fillTargets();
    ['#vRoot','#vType','#vRootBass','#vLabels'].forEach(s=>$(s).addEventListener('change',renderVoicings));
    $('#vShowAll').addEventListener('click',()=>{ state.perPos = state.perPos===3?8:3; $('#vShowAll').textContent = state.perPos===3?'More per position':'Fewer per position'; renderVoicings(); });
    ['#kRoot','#kScale'].forEach(s=>$(s).addEventListener('change',renderKey));
    $('#fbClear').addEventListener('click',()=>{ state.picked.clear(); renderFretboard(); });
    $('#fretboardHost').addEventListener('click',(e)=>{
      const t=e.target.closest('.hit'); if(!t) return;
      const s=+t.dataset.s, f=+t.dataset.f, k=s+','+f;
      // one note per string: clicking another fret on same string replaces it
      if(state.picked.has(k)) state.picked.delete(k);
      else { for(const key of [...state.picked.keys()]) if(key.startsWith(s+',')) state.picked.delete(key); state.picked.set(k,{s,f}); window.Tone.pluck(M.TUNING[s]+f); }
      renderFretboard();
    });
    $('#useFlats').addEventListener('change',()=>{ fillNoteSelects(); renderAll(); });
    syncModeVisibility(); renderAll();
  }
  function syncModeVisibility(){
    const m=$('#fbMode').value, v=$('#fbView').value;
    $('#fbScaleWrap').classList.toggle('hidden', m!=='scale');
    ['#fbViewWrap','#fbCompareWrap','#fbTargetWrap','#fbPlay'].forEach(x=>$(x).classList.toggle('hidden', m!=='scale'));
    $('#fbPosWrap').classList.toggle('hidden', m!=='scale' || v==='neck');
    $('#fbChordWrap').classList.toggle('hidden', m!=='chord');
  }
  // Target = chord whose tones get highlighted inside the scale (diatonic chords of the scale, or root only)
  function fillTargets(){
    const root=+$('#fbRoot').value, name=$('#fbScale').value, sc=M.SCALES[name]; const cur=$('#fbTarget').value;
    let opts='<option value="">— none —</option><option value="root">Root only</option>';
    if(sc && sc.iv.length===7){ M.diatonicChords(root,name).forEach(c=>{ const sym=c.seventh?c.seventh.symbol:(c.triad?c.triad.symbol:''); opts+=`<option value="${c.root}:${sym}">${c.roman7||c.roman} ${M.pcToName(c.root,useFlats())}${sym}</option>`; }); }
    else if(sc){ // pentatonic/blues: offer the implied tonic chords
      const minorish=sc.iv.includes(3)&&!sc.iv.includes(4); [['','maj'],['7','7'],['m','m'],['m7','m7']].filter(x=>minorish?x[0].startsWith('m'):!x[0].startsWith('m')).forEach(([sym])=>opts+=`<option value="${root}:${sym}">${M.pcToName(root,useFlats())}${sym||''}</option>`); }
    $('#fbTarget').innerHTML=opts; if([...$('#fbTarget').options].some(o=>o.value===cur)) $('#fbTarget').value=cur;
  }
  // ----- pattern generation -----
  // Returns {positions:[{label, notes:[{s,f}]}]} for the current scale/view
  function patterns(root, name, view){
    const iv=M.SCALES[name].iv, set=new Set(M.scaleNotes(root,name));
    const allNotes=[]; for(let s=0;s<6;s++) for(let f=0;f<=V.NUM_FRETS;f++){ if(set.has(M.mod(M.TUNING[s]+f))) allNotes.push({s,f,midi:M.TUNING[s]+f}); }
    if(view==='neck') return [{label:'Whole neck', notes:allNotes}];
    if(view==='string'){ return [0,1,2,3,4,5].map(s=>({label:`${M.STRING_NAMES[s]} string`, notes:allNotes.filter(n=>n.s===s)})); }
    // anchors: scale notes on low E within frets 0..11 (one per scale degree)
    // anchors ordered from the root upward (Box 1 = root on low E), wrapping past fret 12
    const rootF=M.mod(root-M.TUNING[0]); const anchors=[]; for(let k=0;k<12;k++){ const f=rootF+k; if(set.has(M.mod(M.TUNING[0]+f))) anchors.push(f); }
    const degName=(f)=>M.INTERVAL_NAMES[M.mod(M.TUNING[0]+f-root)];
    if(view==='box'){
      const span = iv.length<=6 ? 3 : 4; // pentatonic boxes span 4 frets, 7-note positions 5
      return anchors.map((p,i)=>{ let lo=p, hi=p+span; if(hi>V.NUM_FRETS){ lo=p-12; hi=lo+span; }
        const notes=allNotes.filter(n=>n.f>=lo&&n.f<=hi);
        // also allow open strings for position at fret 0..1
        return {label:`Box ${i+1} · from ${degName(p)} on E (fret ${lo})`, notes}; });
    }
    if(view==='3nps'){
      return anchors.map((p0,i)=>{ const p=p0>=12?p0-12:p0; const notes=[]; let cursor=M.TUNING[0]+p-1;
        for(let s=0;s<6;s++){ let got=0; for(let f=Math.max(0,cursor+1-M.TUNING[s]); f<=V.NUM_FRETS && got<3; f++){ const midi=M.TUNING[s]+f; if(midi>cursor && set.has(M.mod(midi))){ notes.push({s,f,midi}); cursor=midi; got++; } } }
        const maxF=Math.max(...notes.map(n=>n.f)); if(maxF>V.NUM_FRETS) return null;
        return {label:`Pattern ${i+1} · starts on ${degName(p)} (fret ${p})`, notes}; }).filter(Boolean);
    }
    return [{label:'',notes:allNotes}];
  }
  function renderAll(){ renderFretboard(); renderVoicings(); renderKey(); }

  function overlayMarks(){
    const mode=$('#fbMode').value, root=+$('#fbRoot').value, lab=$('#fbLabels').value;
    const labelFor=(pc)=> lab==='notes'?M.pcToName(pc,useFlats()) : lab==='intervals'?M.INTERVAL_NAMES[M.mod(pc-root)] : null;
    const marks=[];
    if(mode==='chord'){
      const set=new Set(M.chordTones(root,$('#fbChord').value));
      for(let s=0;s<6;s++) for(let f=0;f<=V.NUM_FRETS;f++){ const pc=M.mod(M.TUNING[s]+f); if(set.has(pc)) marks.push({string:s,fret:f,kind:pc===root?'root':'scale',label:labelFor(pc)}); }
      state.lastPattern=marks.map(m=>({s:m.string,f:m.fret,midi:M.TUNING[m.string]+m.fret})); $('#fbPosLabel').textContent=''; return marks;
    }
    if(mode!=='scale') { state.lastPattern=[]; return marks; }
    const name=$('#fbScale').value, view=$('#fbView').value;
    const pats=patterns(root,name,view); if(!pats.length) return marks;
    state.pos=((state.pos%pats.length)+pats.length)%pats.length;
    const pat=pats[state.pos]; $('#fbPosLabel').textContent=pats.length>1?`${pat.label} (${state.pos+1}/${pats.length})`:pat.label;
    // compare scale (same root) and target chord
    const cmp=$('#fbCompare').value; const cmpSet=cmp?new Set(M.scaleNotes(root,cmp)):null; const mainSet=new Set(M.scaleNotes(root,name));
    const tgt=$('#fbTarget').value; let tgtSet=null; if(tgt==='root') tgtSet=new Set([root]); else if(tgt){ const [r,sym]=tgt.split(':'); tgtSet=new Set(M.chordTones(+r,sym)); }
    const inPat=new Set(pat.notes.map(n=>n.s+','+n.f));
    // dim context: in box/3nps/string views, show the rest of the neck faintly
    if(view!=='neck'){ for(let s=0;s<6;s++) for(let f=0;f<=V.NUM_FRETS;f++){ const pc=M.mod(M.TUNING[s]+f); if(mainSet.has(pc)&&!inPat.has(s+','+f)) marks.push({string:s,fret:f,kind:'dim',label:null}); } }
    for(const n of pat.notes){ const pc=M.mod(n.midi); let kind = pc===root?'root':'scale';
      if(tgtSet && tgtSet.has(pc) && pc!==root) kind='chord';
      if(cmpSet && !cmpSet.has(pc)) kind = pc===root?'root':'sel';           // only in main scale → blue
      marks.push({string:n.s,fret:n.f,kind,label:labelFor(pc)}); }
    if(cmpSet){ // notes only in the comparison scale → hollow-ish (use 'ask' kind w/ different label styling)
      for(let s=0;s<6;s++) for(let f=0;f<=V.NUM_FRETS;f++){ const pc=M.mod(M.TUNING[s]+f); if(cmpSet.has(pc)&&!mainSet.has(pc)&&(view==='neck'||inPatRange(pat,s,f))) marks.push({string:s,fret:f,kind:'bad',label:labelFor(pc)}); } }
    state.lastPattern=pat.notes.slice().sort((a,b)=>a.midi-b.midi||a.s-b.s);
    return marks;
  }
  function inPatRange(pat,s,f){ if(!pat.notes.length) return false; const lo=Math.min(...pat.notes.map(n=>n.f)), hi=Math.max(...pat.notes.map(n=>n.f)); return f>=lo&&f<=hi; }
  function playPattern(){
    const notes=state.lastPattern; if(!notes||!notes.length) return;
    const seq=notes.slice().sort((a,b)=>a.midi-b.midi); const gap=seq.length>24?0.11:0.17;
    seq.forEach((n,i)=>window.Tone.pluck(n.midi,i*gap,0.8,0.45));
  }
  function renderFretboard(){
    const marks=overlayMarks();
    const lab=$('#fbLabels').value;
    for(const {s,f} of state.picked.values()){
      const pc=M.mod(M.TUNING[s]+f);
      const i=marks.findIndex(m=>m.string===s&&m.fret===f); if(i>=0) marks.splice(i,1);
      marks.push({string:s,fret:f,kind:'sel',label:lab==='none'?null:M.pcToName(pc,useFlats())});
    }
    $('#fretboardHost').innerHTML=V.fretboardSVG(marks);
    renderIdentify(); renderScaleInfo();
  }
  function renderIdentify(){
    const el=$('#identify');
    const picked=[...state.picked.values()].sort((a,b)=>(M.TUNING[a.s]+a.f)-(M.TUNING[b.s]+b.f));
    if(!picked.length){ el.innerHTML='<em class="empty">Pick some notes on the fretboard…</em>'; return; }
    const midis=picked.map(p=>M.TUNING[p.s]+p.f);
    const pcs=midis.map(m=>M.mod(m)); const bass=pcs[0];
    const names=[...new Set(pcs)].map(pc=>`<span class="pill">${M.pcToName(pc,useFlats())}</span>`).join('');
    if(new Set(pcs).size<2){ el.innerHTML=`<div class="primary">${M.pcToName(pcs[0],useFlats())}</div><div class="alt">Single note — add more to identify a chord.</div>`; return; }
    const res=M.identifyChord(pcs,bass);
    if(new Set(pcs).size===2){
      const iv=M.mod(pcs[1]-pcs[0]);
      const r=res[0];
      el.innerHTML=`<div class="primary">${r? M.chordLabel(r,useFlats()) : 'Interval'}</div><div class="alt">Interval from bass: <b>${M.INTERVAL_LONG[iv]}</b> (${M.INTERVAL_NAMES[iv]})</div><div class="notes">${names}</div>`; return;
    }
    if(!res.length){ el.innerHTML=`<div class="primary">No standard chord</div><div class="alt">Notes: ${names}</div><div class="alt">Try it as a scale fragment or an add/sus color — or ask Claude what it could be called.</div>`; return; }
    const top=res[0];
    const intervals=[...new Set(pcs)].map(pc=>`<span class="pill ${pc===top.root?'root':''}">${M.pcToName(pc,useFlats())} <small>${M.INTERVAL_NAMES[M.mod(pc-top.root)]}</small></span>`).join('');
    const alts=res.slice(1,5).map(r=>`<span class="pill" data-root="${r.root}" data-sym="${r.symbol}">${M.chordLabel(r,useFlats())}</span>`).join(' ');
    el.innerHTML=`<div class="primary">${M.chordLabel(top,useFlats())}</div><div class="alt">${top.name}${top.inversion?` · inversion (bass is the ${top.inversion})`:''}</div><div class="notes">${intervals}</div>${alts?`<div class="alt">Also could be: ${alts}</div>`:''}<div class="alt"><span class="pill" data-root="${top.root}" data-sym="${top.symbol}">See voicings for ${M.pcToName(top.root,useFlats())}${top.symbol}</span> <span class="pill" id="playPicked">▶ Play</span></div>`;
    el.querySelector('#playPicked').addEventListener('click',()=>{ const fr=[-1,-1,-1,-1,-1,-1]; for(const {s,f} of state.picked.values()) fr[s]=f; window.Tone.strum(fr); });
    el.querySelectorAll('[data-sym]').forEach(p=>p.addEventListener('click',()=>showChord(+p.dataset.root,p.dataset.sym)));
  }
  function renderScaleInfo(){
    const el=$('#scaleInfo'); const mode=$('#fbMode').value, root=+$('#fbRoot').value;
    if(mode==='scale'){
      const name=$('#fbScale').value, sc=M.SCALES[name];
      const notes=M.scaleNotes(root,name);
      const rows=[`<div class="row"><b>${M.pcToName(root,useFlats())} ${name}</b> — ${sc.desc}</div>`,
        `<div class="row">Notes: ${notes.map(n=>`<span class="pill ${n===root?'root':''}">${M.pcToName(n,useFlats())}</span>`).join('')}</div>`,
        `<div class="row">Formula: ${sc.iv.map(i=>M.INTERVAL_NAMES[i]).join(' – ')}</div>`];
      if(sc.iv.length===7){
        const dc=M.diatonicChords(root,name);
        rows.push(`<div class="row">Chords: ${dc.map(c=>`<span class="pill" data-root="${c.root}" data-sym="${c.seventh?c.seventh.symbol:''}">${c.roman} ${M.pcToName(c.root,useFlats())}${c.triad?c.triad.symbol:''}</span>`).join('')}</div>`);
        if(sc.mode!=null){ const parent=M.mod(root-sc.iv[0]-M.SCALES['Major (Ionian)'].iv[sc.mode]); rows.push(`<div class="row">Parent major scale: <b>${M.pcToName(M.mod(root-M.SCALES['Major (Ionian)'].iv[sc.mode]),useFlats())} major</b> (mode ${sc.mode+1})</div>`); }
      }
      // relationships for pentatonic/blues
      if(name==='Minor Pentatonic'||name==='Blues (minor)') rows.push(`<div class="row">Same notes as <b>${M.pcToName(M.mod(root+3),useFlats())} major pentatonic</b>. Over a major-key blues in ${M.pcToName(root,useFlats())}, mix this with ${M.pcToName(root,useFlats())} major pentatonic (= ${M.pcToName(M.mod(root+9),useFlats())} minor pent shape) for the SRV/Bonamassa sound.</div>`);
      if(name==='Major Pentatonic'||name==='Blues (major)') rows.push(`<div class="row">Same notes as <b>${M.pcToName(M.mod(root+9),useFlats())} minor pentatonic</b> — the shape you already know, 3 frets down.</div>`);
      const cmp=$('#fbCompare').value, tgt=$('#fbTarget').value;
      let legend=`<span><i style="background:var(--accent)"></i>root</span><span><i style="background:var(--scale)"></i>scale tone</span>`;
      if(tgt) legend+=`<span><i style="background:var(--dot)"></i>target chord tone</span>`;
      if(cmp) legend+=`<span><i style="background:var(--sel)"></i>only in ${name}</span><span><i style="background:var(--danger)"></i>only in ${cmp}</span>`;
      if($('#fbView').value!=='neck') legend+=`<span><i style="background:var(--scale);opacity:.35"></i>outside this position</span>`;
      rows.push(`<div class="legend">${legend}</div>`);
      if(cmp){ const a=new Set(M.scaleNotes(root,name)), b=new Set(M.scaleNotes(root,cmp)); const onlyA=[...a].filter(x=>!b.has(x)), onlyB=[...b].filter(x=>!a.has(x));
        rows.push(`<div class="row"><b>${M.pcToName(root,useFlats())} ${name}</b> vs <b>${cmp}</b>: ${onlyA.length||onlyB.length?`${name} has ${onlyA.map(x=>M.pcToName(x,useFlats())+' ('+M.INTERVAL_NAMES[M.mod(x-root)]+')').join(', ')||'nothing extra'}; ${cmp} has ${onlyB.map(x=>M.pcToName(x,useFlats())+' ('+M.INTERVAL_NAMES[M.mod(x-root)]+')').join(', ')||'nothing extra'}.`:'identical note sets.'}</div>`); }
      rows.push(`<div class="row"><span class="pill" id="playScale">▶ Play scale</span> <span class="hint" style="margin:0">· ▶ Play (top) plays the current position/pattern</span></div>`);
      el.innerHTML=rows.join('');
      el.querySelector('#playScale').addEventListener('click',()=>{ const base=45+M.mod(root-45); const seq=[...sc.iv.map(i=>base+i), base+12]; seq.forEach((m,i)=>window.Tone.pluck(m,i*0.2,0.8,0.5)); });
      el.querySelectorAll('[data-sym]').forEach(p=>p.addEventListener('click',()=>showChord(+p.dataset.root,p.dataset.sym)));
    } else if(mode==='chord'){
      const sym=$('#fbChord').value; const tones=M.chordTones(root,sym);
      el.innerHTML=`<div class="row"><b>${M.pcToName(root,useFlats())}${sym}</b> — ${M.CHORD_BY_SYMBOL[sym].name}</div><div class="row">Tones: ${tones.map(t=>`<span class="pill ${t===root?'root':''}">${M.pcToName(t,useFlats())} <small>${M.INTERVAL_NAMES[M.mod(t-root)]}</small></span>`).join('')}</div><div class="row hint">Chord-tone map: these are the notes your solo can land on. Everything else is passing color.</div>`;
    } else el.innerHTML='<span class="empty">Choose a scale or chord overlay.</span>';
  }

  function renderVoicings(){
    const root=+$('#vRoot').value, sym=$('#vType').value, lab=$('#vLabels').value;
    const tones=M.chordTones(root,sym);
    $('#vFormula').innerHTML=`<b>${M.pcToName(root,useFlats())}${sym||''}</b> · ${M.CHORD_BY_SYMBOL[sym].name} · formula ${M.CHORD_BY_SYMBOL[sym].iv.map(i=>M.INTERVAL_NAMES[i]).join('–')} · notes ${tones.map(t=>M.pcToName(t,useFlats())).join(' ')}${tones.length>=4?' · <i>5th (and root on big chords) may be omitted</i>':''}`;
    const vs=V.curated(root,sym,{rootInBass:$('#vRootBass').checked, perPosition:state.perPos});
    const host=$('#voicings');
    if(!vs.length){ host.innerHTML='<span class="empty">No comfortable voicings found with these constraints — try unchecking "Root in bass".</span>'; return; }
    host.innerHTML=vs.slice(0,60).map((v,i)=>`<div class="voicing" data-i="${i}" title="Click to show on the fretboard">${V.diagramSVG(v.frets,{rootPc:root,labels:lab||null,useFlats:useFlats()})}<div class="cap">${v.frets.map(f=>f<0?'x':f).join(' ')}</div></div>`).join('');
    host.querySelectorAll('.voicing').forEach(el=>el.addEventListener('click',()=>{
      const v=vs[+el.dataset.i]; state.picked.clear(); window.Tone.strum(v.frets);
      v.frets.forEach((f,s)=>{ if(f>=0) state.picked.set(s+','+f,{s,f}); });
      $('#fbMode').value='chord'; $('#fbRoot').value=root; $('#fbChord').value=sym; syncModeVisibility(); renderFretboard();
      $('#fretboardHost').scrollIntoView({behavior:'smooth',block:'center'});
    }));
  }

  const PROGRESSIONS = [
    {name:'I – IV – V', degs:[1,4,5], desc:'The backbone of rock, blues, country. Try it as I7–IV7–V7 for blues.'},
    {name:'12-bar blues', degs:[1,1,1,1,4,4,1,1,5,4,1,5], desc:'All dominant 7ths. Solo with minor pent + major pent mixed; hit the 3rd of each chord as it changes.', sev:true},
    {name:'I – V – vi – IV', degs:[1,5,6,4], desc:'The "Axis" progression — thousands of pop/rock songs.'},
    {name:'vi – IV – I – V', degs:[6,4,1,5], desc:'Same chords, minor feel. "Zombie", "Africa", "Otherside".'},
    {name:'ii – V – I', degs:[2,5,1], desc:'Jazz cadence. Play as m7 – 7 – maj7. Great for learning arpeggios.', sev:true},
    {name:'I – vi – IV – V', degs:[1,6,4,5], desc:'50s doo-wop / "Stand By Me".'},
    {name:'I – bVII – IV', degs:[1,'b7',4], desc:'Mixolydian rock: "Sweet Home Alabama", "Sympathy for the Devil". Solo with Mixolydian or major pent.', mixo:true},
    {name:'i – bVII – bVI – V', degs:[1,'b7','b6',5], desc:'Andalusian cadence (minor). "Sultans of Swing" verse-ish, "Hit the Road Jack".', minor:true},
    {name:'i – iv – v (minor blues)', degs:[1,4,5], desc:'Minor blues (SRV "Tin Pan Alley", "The Thrill Is Gone"). Dorian over the i and iv, minor pent everywhere.', minor:true},
    {name:'I – iii – IV – V', degs:[1,3,4,5], desc:'Adds the iii for lift. Beatles-y.'},
    {name:'IV – V – iii – vi', degs:[4,5,3,6], desc:'The "royal road" progression (J-pop / anime, but great for tasty modern rock).'},
  ];
  function renderKey(){
    const root=+$('#kRoot').value, scale=$('#kScale').value;
    const dc=M.diatonicChords(root,scale);
    const FN=['Tonic','Supertonic','Mediant','Subdominant','Dominant','Submediant','Leading tone'];
    $('#keyChords').innerHTML=dc.map((c,i)=>`<div class="kc" data-root="${c.root}" data-sym="${c.triad?c.triad.symbol:''}" data-sev="${c.seventh?c.seventh.symbol:''}"><div class="roman">${c.roman}</div><div class="name">${M.pcToName(c.root,useFlats())}${c.triad?c.triad.symbol:'?'}</div><div class="sev">${M.pcToName(c.root,useFlats())}${c.seventh?c.seventh.symbol:''}</div><div class="fn">${scale==='Major (Ionian)'?FN[i]:''}</div></div>`).join('');
    $('#keyChords').querySelectorAll('.kc').forEach(el=>{
      el.addEventListener('click',(e)=>{ const sev=e.altKey||e.metaKey||!!e.target.closest('.sev'); const r=+el.dataset.root, sy=sev?el.dataset.sev:el.dataset.sym; const v=V.curated(r,sy,{perPosition:1})[0]; if(v) window.Tone.strum(v.frets); showChord(r, sy); });
    });
    const isMinor = scale.startsWith('Natural Minor')||scale==='Dorian'||scale==='Phrygian'||scale==='Harmonic Minor';
    const isMixo = scale==='Mixolydian';
    const chordFor=(deg)=>{
      if(typeof deg==='number'){ const c=dc[deg-1]; return M.pcToName(c.root,useFlats())+(c.triad?c.triad.symbol:''); }
      const off = deg==='b7'?10:deg==='b6'?8:0; return M.pcToName(M.mod(root+off),useFlats());
    };
    const list=PROGRESSIONS.filter(p=> p.minor?isMinor : p.mixo?(isMixo||scale==='Major (Ionian)') : !isMinor);
    $('#progressions').innerHTML=list.map(p=>{
      let chords=p.degs.map(d=>{ if(p.sev&&typeof d==='number'){ const c=dc[d-1]; return M.pcToName(c.root,useFlats())+(p.name.includes('blues')?'7':(c.seventh?c.seventh.symbol:'')); } return chordFor(d); });
      return `<div class="prog"><div class="title">${p.name} <span class="pill play-prog" data-ch="${chords.join('|')}">▶</span></div><div class="chords">${chords.map(c=>`<span class="pill play-ch" data-ch="${c}">${c}</span>`).join('')}</div><div class="desc">${p.desc}</div></div>`;
    }).join('');
    const playName=(name,when)=>{ const m=name.match(/^([A-G][#b]?)(.*)$/); if(!m) return; const r=M.noteToPc(m[1]); const sym=M.CHORD_BY_SYMBOL[m[2]]?m[2]:''; const v=V.curated(r,sym,{perPosition:1})[0]; if(v) setTimeout(()=>window.Tone.strum(v.frets),when*1000); };
    $('#progressions').querySelectorAll('.play-ch').forEach(p=>p.addEventListener('click',()=>playName(p.dataset.ch,0)));
    $('#progressions').querySelectorAll('.play-prog').forEach(p=>p.addEventListener('click',()=>p.dataset.ch.split('|').forEach((c,i)=>playName(c,i*0.9))));
  }

  // Cross-tab helpers
  function showChord(rootPc, sym){
    $('#vRoot').value=rootPc; $('#vType').value=sym; renderVoicings();
    $('#fbMode').value='chord'; $('#fbRoot').value=rootPc; $('#fbChord').value=sym; syncModeVisibility(); state.picked.clear(); renderFretboard();
    window.App.showTab('fretboard'); $('#voicings').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function showScale(rootPc, name){
    $('#fbMode').value='scale'; $('#fbRoot').value=rootPc; $('#fbScale').value=name; syncModeVisibility(); state.picked.clear(); renderFretboard();
    window.App.showTab('fretboard'); window.scrollTo({top:0,behavior:'smooth'});
  }
  return {init, showChord, showScale, renderAll, useFlats};
})();
