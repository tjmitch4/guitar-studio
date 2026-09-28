// Theory tab: circle of fifths, CAGED, modes, reference tables, refresher cards
window.TheoryUI = (() => {
  const M=window.Music, V=window.Voicings;
  const $=(s)=>document.querySelector(s);
  const uf=()=>window.FretboardUI.useFlats();
  let currentKey=0;

  function init(){
    fillRootSelects();
    $('#cagedRoot').value=0; $('#modesRoot').value=0;
    ['#cagedRoot','#cagedQual'].forEach(s=>$(s).addEventListener('change',renderCaged));
    $('#modesRoot').addEventListener('change',renderModes);
    $('#useFlats').addEventListener('change',()=>{ fillRootSelects(); renderAll(); });
    renderAll();
  }
  function fillRootSelects(){ ['#cagedRoot','#modesRoot'].forEach(s=>{ const el=$(s), v=el.value; el.innerHTML=M.SHARP.map((n,i)=>`<option value="${i}">${M.pcToName(i,uf())}</option>`).join(''); if(v!=='') el.value=v; }); }
  function renderAll(){ renderCircle(); renderKeyDetail(); renderCaged(); renderModes(); renderRefTables(); renderCards(); }

  function renderCircle(){
    const R=200, cx=220, cy=220, r1=200, r2=140, r3=85;
    const seg=(i,rOut,rIn,label,pc,minor)=>{
      const a0=(i*30-15-90)*Math.PI/180, a1=(i*30+15-90)*Math.PI/180;
      const p=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
      const [x0,y0]=p(rOut,a0),[x1,y1]=p(rOut,a1),[x2,y2]=p(rIn,a1),[x3,y3]=p(rIn,a0);
      const [tx,ty]=p((rOut+rIn)/2,(a0+a1)/2);
      const active=pc===currentKey;
      return `<g class="seg" data-pc="${pc}" ${minor?'':`tabindex="0" role="button" aria-label="Key of ${label}" aria-pressed="${active}"`}><path d="M${x0},${y0} A${rOut},${rOut} 0 0 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 0 0 ${x3},${y3} Z" fill="${active?'var(--accent)':minor?'var(--panel2)':'var(--panel)'}" stroke="var(--border)"/><text x="${tx}" y="${ty+5}" text-anchor="middle" font-size="${minor?13:17}" font-weight="${minor?500:700}" fill="${active?'#141414':'var(--text)'}">${label}</text></g>`;
    };
    let s=`<svg viewBox="0 0 440 440">`;
    M.CIRCLE.forEach((pc,i)=>{
      const flats = M.FLAT_KEYS.has(pc);
      const maj = pc===6?'F♯/G♭': M.pcToName(pc,flats).replace('#','♯').replace('b','♭');
      const minPc=M.mod(pc+9);
      const minFlats = M.FLAT_KEYS.has(pc)||pc===0||pc===7? (pc===0||pc===7?false:true):false;
      const minName = (pc===6?'D♯/E♭':M.pcToName(minPc, flats && !(pc===0)).replace('#','♯').replace('b','♭'))+'m';
      s+=seg(i,r1,r2,maj,pc,false);
      s+=seg(i,r2,r3,minName,pc,true);
    });
    s+=`<text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="12" fill="var(--muted)">key sig</text><text x="${cx}" y="${cy+14}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--text)">${M.KEY_SIG[currentKey]}</text>`;
    s+='</svg>';
    $('#circleHost').innerHTML=s;
    $('#circleHost').querySelectorAll('.seg').forEach(g=>g.addEventListener('click',()=>{ currentKey=+g.dataset.pc; renderCircle(); renderKeyDetail(); const v=V.curated(currentKey,'',{perPosition:1})[0]; if(v) window.Tone.strum(v.frets); }));
  }
  function renderKeyDetail(){
    const pc=currentKey, flats=M.FLAT_KEYS.has(pc)||(pc===6&&uf()); const rel=M.mod(pc+9);
    // letter-correct spelling (Cb in Gb major); pcs outside the key fall back to the key's sharp/flat side
    const majNames=M.spellScale(pc,'Major (Ionian)',flats), spelled=new Map(M.scaleNotes(pc,'Major (Ionian)').map((p,i)=>[p,majNames[i]]));
    const nm=(p)=>spelled.get(M.mod(p))||M.pcToName(p,flats);
    const maj=M.diatonicChords(pc,'Major (Ionian)'); const min=M.diatonicChords(rel,'Natural Minor (Aeolian)');
    $('#keyTitle').textContent=`Key of ${nm(pc)} major / ${nm(rel)} minor`;
    const chordPills=(dc)=>dc.map(c=>`<button type="button" class="pill" data-root="${c.root}" data-sym="${c.triad?c.triad.symbol:''}">${c.roman} <b>${nm(c.root)}${c.triad?c.triad.symbol:''}</b> <small>${c.seventh?c.seventh.symbol:''}</small></button>`).join('');
    const notes=M.scaleNotes(pc,'Major (Ionian)').map(n=>`<span class="pill static">${nm(n)}</span>`).join('');
    const neighbours=`${nm(M.mod(pc+7))} (V, one step clockwise) · ${nm(M.mod(pc+5))} (IV, one step counter-clockwise)`;
    $('#keyDetail').innerHTML=`
      <div class="row"><div class="lbl">Key signature</div>${M.KEY_SIG[pc]}</div>
      <div class="row"><div class="lbl">Notes</div>${notes}</div>
      <div class="row"><div class="lbl">Chords in ${nm(pc)} major</div>${chordPills(maj)}</div>
      <div class="row"><div class="lbl">Chords in ${nm(rel)} minor (same notes)</div>${chordPills(min)}</div>
      <div class="row"><div class="lbl">Closest keys</div>${neighbours}</div>
      <div class="row"><div class="lbl">Blues in ${nm(pc)}</div>${nm(pc)}7 – ${nm(M.mod(pc+5))}7 – ${nm(M.mod(pc+7))}7 · solo: ${nm(pc)} minor pent + ${nm(pc)} major pent (= ${nm(M.mod(pc+9))} minor pent shape)</div>
      <div class="row"><div class="lbl">Try on the fretboard</div>
        <button type="button" class="pill" data-scale="Major (Ionian)" data-root="${pc}">${nm(pc)} major</button>
        <button type="button" class="pill" data-scale="Major Pentatonic" data-root="${pc}">${nm(pc)} major pent</button>
        <button type="button" class="pill" data-scale="Mixolydian" data-root="${pc}">${nm(pc)} Mixolydian</button>
        <button type="button" class="pill" data-scale="Minor Pentatonic" data-root="${rel}">${nm(rel)} minor pent</button>
        <button type="button" class="pill" data-scale="Dorian" data-root="${rel}">${nm(rel)} Dorian</button>
        <button type="button" class="pill" data-scale="Blues (minor)" data-root="${rel}">${nm(rel)} blues</button>
      </div>`;
    $('#keyDetail').querySelectorAll('[data-sym]').forEach(p=>p.addEventListener('click',()=>{ const v=V.curated(+p.dataset.root,p.dataset.sym,{perPosition:1})[0]; if(v) window.Tone.strum(v.frets); window.FretboardUI.showChord(+p.dataset.root,p.dataset.sym); }));
    $('#keyDetail').querySelectorAll('[data-scale]').forEach(p=>p.addEventListener('click',()=>window.FretboardUI.showScale(+p.dataset.root,p.dataset.scale)));
  }

  function renderCaged(){
    const root=+$('#cagedRoot').value, minor=$('#cagedQual').value==='min';
    const shapes=V.cagedShapes(root,minor);
    const sym=minor?'m':'';
    $('#cagedDiagrams').innerHTML=shapes.map((s,i)=>`<div class="voicing" data-i="${i}" title="Click to hear"><div class="name">${s.shape} shape</div>${V.diagramSVG(s.frets,{rootPc:root,labels:'intervals',useFlats:uf()})}<div class="cap">${s.frets.map(f=>f<0?'x':f).join(' ')}</div></div>`).join('');
    $('#cagedDiagrams').querySelectorAll('.voicing').forEach(el=>el.addEventListener('click',()=>window.Tone.strum(shapes[+el.dataset.i].frets)));
    // fretboard: all chord tones, with shape membership colored by root
    const tones=new Set(M.chordTones(root,sym)); const marks=[];
    for(let s=0;s<6;s++) for(let f=0;f<=V.NUM_FRETS;f++){ const pc=M.mod(M.TUNING[s]+f); if(tones.has(pc)) marks.push({string:s,fret:f,kind:pc===root?'root':'scale',label:M.INTERVAL_NAMES[M.mod(pc-root)]}); }
    $('#cagedFretboard').innerHTML=V.fretboardSVG(marks);
  }

  function renderModes(){
    const root=+$('#modesRoot').value; const flats=M.FLAT_KEYS.has(root)||(root===6&&uf());
    const parentNames=M.spellScale(root,'Major (Ionian)',flats), spelled=new Map(M.scaleNotes(root,'Major (Ionian)').map((p,i)=>[p,parentNames[i]]));
    const nm=(p)=>spelled.get(M.mod(p))||M.pcToName(p,flats);
    const majorIv=M.SCALES['Major (Ionian)'].iv;
    const scaleNames=['Major (Ionian)','Dorian','Phrygian','Lydian','Mixolydian','Natural Minor (Aeolian)','Locrian'];
    const CHAR=['—','natural 6 in a minor scale','b2','#4','b7 in a major scale','b6, b7','b2, b5'];
    const CHORD=['maj7','m7','m7','maj7','7','m7','m7b5'];
    const rows=scaleNames.map((sn,i)=>{
      const r=M.mod(root+majorIv[i]); const iv=M.SCALES[sn].iv;
      return `<tr class="clickable" data-root="${r}" data-scale="${sn}" tabindex="0" role="button" aria-label="Show ${nm(r)} ${M.MODE_NAMES[i]} on the fretboard"><td><b>${nm(r)} ${M.MODE_NAMES[i]}</b></td><td>${iv.map(x=>M.INTERVAL_NAMES[x]).join(' ')}</td><td>${M.scaleNotes(r,sn).map(nm).join(' ')}</td><td>${nm(r)}${CHORD[i]}</td><td>${CHAR[i]}</td><td class="hint">${M.SCALES[sn].desc}</td></tr>`;
    }).join('');
    $('#modesTable').innerHTML=`<div class="table-scroll"><table class="ref-table"><thead><tr><th>Mode</th><th>Formula</th><th>Notes</th><th>Home chord</th><th>Signature note</th><th>Sound</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    $('#modesTable').querySelectorAll('tr.clickable').forEach(tr=>tr.addEventListener('click',()=>window.FretboardUI.showScale(+tr.dataset.root,tr.dataset.scale)));
  }

  function renderRefTables(){
    const EX=['Unison','Jaws / "White Christmas" opening','"Happy Birthday" (first two notes)','"Smoke on the Water" (riff), "Greensleeves"','"Oh, When the Saints"','"Here Comes the Bride", "Amazing Grace"','"The Simpsons", "Maria"','"Star Wars" theme, "Twinkle Twinkle"','"The Entertainer" (opening leap)','"My Way", NBC chime','"Star Trek" (original)','"Take On Me" (chorus leap)'];
    $('#intervalsTable').innerHTML=`<tr><th>Semitones</th><th>Name</th><th>Symbol</th><th>Ear anchor</th></tr>`+M.INTERVAL_LONG.map((n,i)=>`<tr><td>${i}</td><td>${n}</td><td>${M.INTERVAL_NAMES[i]}</td><td class="hint">${EX[i]}</td></tr>`).join('');
    $('#chordFormulaTable').innerHTML=`<tr><th>Symbol</th><th>Name</th><th>Formula</th><th>Ex. in C</th></tr>`+M.CHORDS.map(([sym,iv,name])=>`<tr class="clickable" data-sym="${sym}" tabindex="0" role="button" aria-label="Show C${sym} voicings"><td><b>C${sym}</b></td><td>${name}</td><td>${iv.map(x=>M.INTERVAL_NAMES[x]).join(' ')}</td><td>${iv.map(x=>M.pcToName(x)).join(' ')}</td></tr>`).join('');
    $('#chordFormulaTable').querySelectorAll('tr.clickable').forEach(tr=>tr.addEventListener('click',()=>window.FretboardUI.showChord(0,tr.dataset.sym)));
  }

  const CARDS=[
    {t:'Circle of fifths — what it\'s for', b:`<p>Go clockwise, each key adds a sharp; counter-clockwise adds a flat. Neighbours share 6 of 7 notes, so <b>IV – I – V</b> are always side by side. Uses:</p><ul><li>Find the chords in a key: I is the key, IV and V are its neighbours, ii/iii/vi are the inner minors under them.</li><li>Move keys smoothly (modulate to a neighbour).</li><li>Read the relative minor (inner ring).</li><li>Root motion in fourths (counter-clockwise) is the strongest resolution: ii→V→I.</li></ul>`},
    {t:'CAGED in one paragraph', b:`<p>Five open-chord shapes (C, A, G, E, D) can each be barred and slid up. Stack them in that order and they tile the neck for any one chord. Each shape has a matching scale/pentatonic box on top of it — so learning CAGED = knowing where the chord tones are inside every scale box. Practice: pick one chord, play it in all 5 shapes ascending, then solo in each box while targeting the chord tones.</p>`},
    {t:'Pentatonic + blues cheat', b:`<p><b>Minor pent</b> = 1 b3 4 5 b7. <b>Blues</b> adds b5. Over a major/dominant blues (A7 D7 E7), the "pro" sound is switching between <b>A minor pent</b> and <b>A major pent</b> (which is the F#m pent shape — same shape, 3 frets lower). Land the <b>major 3rd</b> (C#) on the I chord and the b7 (G) for grit; over the IV chord (D7) the b3 (C) becomes the b7 of D — that's why it suddenly sounds "right" there.</p>`},
    {t:'Modes without the headache', b:`<p>Only two modes matter most for you right now: <b>Mixolydian</b> (major scale with b7 → over dominant 7 / bluesy major vamps) and <b>Dorian</b> (minor with natural 6 → over m7 vamps, funky/jazzy minor). Quick recipe: Mixolydian = major pent + 4 + b7. Dorian = minor pent + 2 + 6. Aim for the "signature note" (b7 / 6) on strong beats to make the mode audible.</p>`},
    {t:'Chord tones vs. scale tones', b:`<p>Scales tell you what's <i>allowed</i>; chord tones tell you what <i>lands</i>. On each chord change, target its 3rd (defines major/minor) or 7th. Exercise: over a jam track, play only chord tones for a chorus (arpeggios in one position), then add scale notes as connectors.</p>`},
    {t:'Building a solo (jam-track method)', b:`<p><b>Chorus 1</b> — motif: one 2-bar idea, repeat it, change the ending. <b>Chorus 2</b> — move it up an octave/box; add bends. <b>Chorus 3</b> — density: faster runs, double-stops, then leave space. Steal one lick per week from Bonamassa/SRV/Timmons and force it into 3 different keys and positions.</p>`},
    {t:'Fingerstyle / hybrid picking basics', b:`<p>Thumb owns strings 6-5-4 (alternating bass or root-5), fingers i-m-a own 3-2-1. Start with a steady quarter-note thumb, add melody on top. For <i>Slow Dancing in a Burning Room</i>: hybrid picking (pick + middle/ring), let the bass ring, keep the top-string melody notes bright and separate; the feel is behind the beat.</p>`},
    {t:'Practice loop that works in 20 min', b:`<p>5 min warm-up (chromatic + one scale box with metronome) → 10 min <b>one</b> song section slowed down (loop the hard 2 bars, +4 bpm when clean 3× in a row) → 5 min improv over a jam track with one goal (e.g. "only chord tones", "only Dorian", "start every phrase on the 3rd"). Log it. Consistency beats length.</p>`},
  ];
  function renderCards(){
    $('#refresherCards').innerHTML=CARDS.map(c=>`<div class="card"><details><summary>${c.t}</summary>${c.b}</details></div>`).join('');
  }
  return {init, renderAll};
})();
