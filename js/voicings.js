// Voicing generator + SVG renderers (chord diagrams and full fretboard)
window.Voicings = (() => {
  const M = window.Music;
  const NUM_FRETS = 15;

  // Generate playable voicings for a chord. Returns [{frets:[6], baseFret, notes:[pcs], score}]
  // frets: -1 = muted, 0 = open, n = fret. Index 0 = low E.
  function generate(rootPc, symbol, opts={}){
    const tones = M.chordTones(rootPc, symbol);
    if(!tones.length) return [];
    const toneSet = new Set(tones);
    const requireRootBass = opts.rootInBass !== false;
    const maxSpan = opts.span || 4;
    const minStrings = opts.minStrings || Math.min(3, tones.length);
    const results = [];
    const seen = new Set();
    // Fifth may be omitted for 4+ note chords; for 5+ note chords, root or 5th may go.
    const required = new Set(tones);
    const fifth = M.mod(rootPc+7);
    if(tones.length>=4) required.delete(fifth);
    if(tones.length>=5) required.delete(rootPc);

    for(let pos=0; pos<=NUM_FRETS-maxSpan+1; pos++){
      // options per string: muted, open (if chord tone), frets in [pos, pos+span-1] that are chord tones
      const optsPerString = M.TUNING.map(open=>{
        const arr=[-1];
        if(toneSet.has(M.mod(open))) arr.push(0);
        for(let f=Math.max(1,pos); f<pos+maxSpan; f++){ if(toneSet.has(M.mod(open+f))) arr.push(f); }
        return arr;
      });
      const cur=new Array(6).fill(-1);
      const rec=(s)=>{
        if(s===6){ evaluate(cur.slice()); return; }
        for(const f of optsPerString[s]){ cur[s]=f; rec(s+1); }
      };
      const evaluate=(fr)=>{
        const key=fr.join(',');
        if(seen.has(key)) return;
        const sounding = fr.map((f,i)=>f>=0?{s:i,f,midi:M.TUNING[i]+f}:null).filter(Boolean);
        if(sounding.length<minStrings) return;
        // no muted strings between sounding strings (inner mutes are hard to play; allow one? keep strict)
        const first=sounding[0].s, last=sounding[sounding.length-1].s;
        for(let i=first;i<=last;i++) if(fr[i]<0) return;
        const pcs=new Set(sounding.map(x=>M.mod(x.midi)));
        for(const r of required) if(!pcs.has(r)) return;
        // for triads require all three
        const bass=sounding[0];
        if(requireRootBass && M.mod(bass.midi)!==rootPc) return;
        const fretted=sounding.filter(x=>x.f>0);
        const fretsUsed=fretted.map(x=>x.f);
        const minF=fretsUsed.length?Math.min(...fretsUsed):0, maxF=fretsUsed.length?Math.max(...fretsUsed):0;
        if(fretsUsed.length && maxF-minF>=maxSpan) return;
        // finger count: allow barre at the lowest fret if it spans contiguous strings incl. highest sounding string
        let fingers = fretted.length;
        if(fretted.length>4){
          const atMin=fretted.filter(x=>x.f===minF);
          const barreOk = atMin.length>=2 && atMin[atMin.length-1].s===last;
          if(!barreOk) return;
          fingers = 1 + fretted.length - atMin.length;
          if(fingers>4) return;
        }
        // open strings mixed with high positions are awkward
        const opens=sounding.filter(x=>x.f===0).length;
        if(opens && minF>5) return;
        seen.add(key);
        let score = 0;
        score += pcs.size*4;                              // more distinct tones = richer
        score -= (maxF-minF)*2;                           // compact
        score -= (fingers>3?3:0);
        score += sounding.length*1.5;                     // fuller voicings (barre chords) rank up
        if(fretted.length===0) score += 3;
        // duplicated tones ok, but penalise very wide gaps in pitch (>= 12 semitones between adjacent strings) rarely occur
        results.push({frets:fr, baseFret:minF||1, notes:sounding.map(x=>M.mod(x.midi)), fingers, score, minF, maxF, pos:minF});
      };
      rec(0);
    }
    results.sort((a,b)=>a.pos-b.pos || b.score-a.score);
    return results;
  }

  // Cluster voicings by position and take best few per position for a browsable list
  function curated(rootPc, symbol, opts={}){
    const all = generate(rootPc, symbol, opts);
    const byPos = {};
    for(const v of all){ const k=v.pos; (byPos[k]=byPos[k]||[]).push(v); }
    const out=[];
    Object.keys(byPos).map(Number).sort((a,b)=>a-b).forEach(k=>{
      byPos[k].sort((a,b)=>b.score-a.score);
      out.push(...byPos[k].slice(0, opts.perPosition||3));
    });
    return out;
  }

  // ---------- Chord diagram SVG ----------
  function diagramSVG(frets, opts={}){
    const w=opts.width||110, fretsShown=opts.fretsShown||5;
    const padL=20, padT=26, padR=10, padB=8;
    const gw=w-padL-padR, gh=(opts.height||120)-padT-padB;
    const sx=gw/5, fy=gh/fretsShown;
    const sounding=frets.filter(f=>f>0);
    let base=1;
    if(sounding.length){ const mn=Math.min(...sounding), mx=Math.max(...sounding); if(mx>fretsShown) base=mn; }
    const h=padT+gh+padB;
    let s=`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chord-diagram">`;
    // nut or base fret
    if(base===1) s+=`<rect x="${padL-1}" y="${padT-3}" width="${gw+2}" height="4" fill="currentColor"/>`;
    else s+=`<text x="${padL-4}" y="${padT+fy*0.7}" font-size="9.5" text-anchor="end" fill="currentColor">${base}fr</text>`;
    for(let i=0;i<=fretsShown;i++) s+=`<line x1="${padL}" y1="${padT+i*fy}" x2="${padL+gw}" y2="${padT+i*fy}" stroke="currentColor" stroke-opacity=".5"/>`;
    for(let i=0;i<6;i++) s+=`<line x1="${padL+i*sx}" y1="${padT}" x2="${padL+i*sx}" y2="${padT+gh}" stroke="currentColor" stroke-opacity=".7"/>`;
    // barre detection: >4 fretted with min fret shared
    const fretted=frets.map((f,i)=>({f,i})).filter(x=>x.f>0);
    if(fretted.length>4){
      const mn=Math.min(...fretted.map(x=>x.f));
      const atMin=fretted.filter(x=>x.f===mn);
      if(atMin.length>=2){
        const x1=padL+atMin[0].i*sx, x2=padL+atMin[atMin.length-1].i*sx, y=padT+(mn-base+0.5)*fy;
        s+=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" opacity=".85"/>`;
      }
    }
    frets.forEach((f,i)=>{
      const x=padL+i*sx;
      const pc=M.mod(M.TUNING[i]+f);
      const isRoot=opts.rootPc!=null && pc===opts.rootPc;
      if(f<0) s+=`<text x="${x}" y="${padT-8}" font-size="11" text-anchor="middle" fill="currentColor" opacity=".7">×</text>`;
      else if(f===0) s+=`<circle cx="${x}" cy="${padT-10}" r="3.5" fill="none" stroke="${isRoot?'var(--accent)':'currentColor'}" stroke-width="1.5"/>`;
      else {
        const y=padT+(f-base+0.5)*fy;
        s+=`<circle cx="${x}" cy="${y}" r="${sx*0.34}" fill="${isRoot?'var(--accent)':'var(--dot)'}"/>`;
        if(opts.labels){ const lab=opts.labels==='intervals'&&opts.rootPc!=null?M.INTERVAL_NAMES[M.mod(pc-opts.rootPc)]:M.pcToName(pc,opts.useFlats);
          s+=`<text x="${x}" y="${y+3}" font-size="7.5" text-anchor="middle" fill="var(--bg)" font-weight="700">${lab}</text>`; }
      }
    });
    s+='</svg>';
    return s;
  }

  // ---------- Fretboard SVG (horizontal, low E at bottom) ----------
  // marks: array of {string, fret, kind:'scale'|'root'|'sel'|'chord', label}
  function fretboardSVG(marks, opts={}){
    const nf=opts.frets||NUM_FRETS;
    // compact: phone layout — narrower viewBox (so it fits the screen without scrolling), wider string spacing, bigger marks.
    const C=!!opts.compact;
    const w=opts.width||(C?480:900), padL=C?34:40, padR=C?8:16, padT=C?20:18, padB=C?24:22;
    const gw=w-padL-padR, sh=C?44:22, gh=sh*5, h=padT+gh+padB;
    const openW=C?padL:28, markR=C?13:9, scaleR=C?11.5:7.5, markFont=C?13:9, numFont=C?13:10, strFont=C?14:11;
    const fx=(f)=> f===0 ? padL : padL + (f-0.5)*(gw/nf); // center of fret f
    const fline=(f)=> padL + f*(gw/nf);
    const sy=(s)=> padT + (5-s)*sh; // string 0 (low E) at bottom
    let s=`<svg viewBox="0 0 ${w} ${h}" width="100%" class="fretboard${C?' compact':''}" data-nf="${nf}">`;
    s+=`<rect x="${padL}" y="${padT-4}" width="${gw}" height="${gh+8}" fill="var(--wood)" rx="3"/>`;
    // fret markers
    const inR=C?6:4;
    [3,5,7,9,15].forEach(f=>{ if(f<=nf) s+=`<circle cx="${fx(f)}" cy="${padT+gh/2}" r="${inR}" fill="var(--inlay)"/>`; });
    if(nf>=12){ s+=`<circle cx="${fx(12)}" cy="${padT+sh*1.5}" r="${inR}" fill="var(--inlay)"/><circle cx="${fx(12)}" cy="${padT+sh*3.5}" r="${inR}" fill="var(--inlay)"/>`; }
    for(let f=0;f<=nf;f++){ s+=`<line x1="${fline(f)}" y1="${padT-4}" x2="${fline(f)}" y2="${padT+gh+4}" stroke="${f===0?'var(--nut)':'var(--fretwire)'}" stroke-width="${f===0?5:2}"/>`;
      if(f>0) s+=`<text x="${fx(f)}" y="${h-6}" font-size="${numFont}" text-anchor="middle" fill="currentColor" opacity=".7">${f}</text>`; }
    for(let st=0;st<6;st++){ s+=`<line x1="${padL}" y1="${sy(st)}" x2="${padL+gw}" y2="${sy(st)}" stroke="var(--string)" stroke-width="${2.6-st*0.3}"/>`;
      s+=`<text x="${padL-10}" y="${sy(st)+4}" font-size="${strFont}" text-anchor="end" fill="currentColor" opacity=".75">${M.STRING_NAMES[st]}</text>`; }
    // clickable hit areas
    for(let st=0;st<6;st++) for(let f=0;f<=nf;f++){
      const x = f===0? padL-openW : fline(f-1), wdt = f===0? openW : gw/nf;
      s+=`<rect class="hit" data-s="${st}" data-f="${f}" x="${x}" y="${sy(st)-sh/2}" width="${wdt}" height="${sh}" fill="transparent" style="cursor:pointer"/>`;
    }
    for(const m of marks){
      const cx = m.fret===0 ? padL-openW/2 : fx(m.fret), cy=sy(m.string);
      const r = m.kind==='scale'||m.kind==='dim' ? scaleR : markR;
      // fretboard colours are fixed (the neck is always dark wood), so they don't flip with light/dark mode
      const FILL={root:'var(--accent)',sel:'var(--fb-sel)',chord:'var(--fb-dot)',scale:'var(--fb-scale)',ok:'var(--ok)',bad:'var(--fb-bad)',ask:'var(--fb-sel)',dim:'var(--fb-scale)'};
      const fill = FILL[m.kind]||'var(--fb-scale)';
      const op = m.kind==='scale'?0.85: m.kind==='dim'?0.35:1;
      s+=`<g pointer-events="none"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${op}" stroke="var(--wood)" stroke-width="1"/>`;
      if(m.label!=null) s+=`<text x="${cx}" y="${cy+markFont*0.38}" font-size="${markFont}" font-weight="700" text-anchor="middle" fill="var(--mark-text)">${m.label}</text>`;
      s+='</g>';
    }
    s+='</svg>';
    return s;
  }

  // CAGED major shapes: relative to a root fret r; string order low->high; null = muted
  const CAGED = {
    'C': {rootString:1, rel:[null,0,-1,-3,-2,-3]},
    'A': {rootString:1, rel:[null,0,2,2,2,0]},
    'G': {rootString:0, rel:[0,-1,-3,-3,-3,0]},
    'E': {rootString:0, rel:[0,2,2,1,0,0]},
    'D': {rootString:2, rel:[null,null,0,2,3,2]},
  };
  const CAGED_MINOR = {
    'Cm': {rootString:1, rel:[null,0,-2,-3,-2,-2]}, // e.g. Cm at 3: x 3 1 0 1 1? that's Cm w/ open G — use barre-friendly: x 3 5 5 4 3 is Am shape. Skip C-shape minor.
    'Am': {rootString:1, rel:[null,0,2,2,1,0]},
    'Gm': {rootString:0, rel:[0,-2,-3,-3,-2,0]},   // approximate; rarely used
    'Em': {rootString:0, rel:[0,2,2,0,0,0]},
    'Dm': {rootString:2, rel:[null,null,0,2,3,1]},
  };
  function cagedShapes(rootPc, minor=false){
    const shapes = minor? {Am:CAGED_MINOR.Am, Em:CAGED_MINOR.Em, Dm:CAGED_MINOR.Dm} : CAGED;
    const out=[];
    for(const [name,sh] of Object.entries(shapes)){
      const open=M.TUNING[sh.rootString];
      let r=M.mod(rootPc-open); // fret on root string
      const minRel=Math.min(...sh.rel.filter(x=>x!=null));
      if(r+minRel<0) r+=12;
      // also give the +12 copy if it fits
      const cands=[r, r+12].filter(rr=>rr+Math.max(...sh.rel.filter(x=>x!=null))<=NUM_FRETS && rr+minRel>=0);
      for(const rr of cands){ out.push({shape:name, frets:sh.rel.map(x=>x==null?-1:rr+x), pos:rr+minRel}); }
    }
    out.sort((a,b)=>a.pos-b.pos);
    return out;
  }

  return {generate, curated, diagramSVG, fretboardSVG, cagedShapes, NUM_FRETS};
})();
