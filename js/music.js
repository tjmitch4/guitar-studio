// Core music theory engine — pure functions, no DOM.
// Pitch classes: 0 = C ... 11 = B
window.Music = (() => {
  const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const NAME_TO_PC = {};
  SHARP.forEach((n,i)=>NAME_TO_PC[n]=i);
  FLAT.forEach((n,i)=>NAME_TO_PC[n]=i);
  Object.assign(NAME_TO_PC, {'E#':5,'B#':0,'Fb':4,'Cb':11});

  // Keys that conventionally use flats
  const FLAT_KEYS = new Set([5,10,3,8,1,6]); // F Bb Eb Ab Db Gb

  const noteToPc = (n) => NAME_TO_PC[n.trim()];
  const pcToName = (pc, useFlats=false) => (useFlats?FLAT:SHARP)[((pc%12)+12)%12];
  const mod = (n,m=12) => ((n%m)+m)%m;

  const INTERVAL_NAMES = ['1','b2','2','b3','3','4','b5','5','#5','6','b7','7'];
  const INTERVAL_LONG = ['Root','Minor 2nd','Major 2nd','Minor 3rd','Major 3rd','Perfect 4th','Tritone','Perfect 5th','Minor 6th','Major 6th','Minor 7th','Major 7th'];

  const SCALES = {
    'Major (Ionian)':        {iv:[0,2,4,5,7,9,11], mode:0, desc:'Bright, resolved. Home base for pop, rock, country.'},
    'Dorian':                {iv:[0,2,3,5,7,9,10], mode:1, desc:'Minor with a natural 6 — jazzy/funky minor. Santana, "So What", Bonamassa minor grooves.'},
    'Phrygian':              {iv:[0,1,3,5,7,8,10], mode:2, desc:'Dark, Spanish/flamenco flavor from the b2.'},
    'Lydian':                {iv:[0,2,4,6,7,9,11], mode:3, desc:'Dreamy major with a #4. Satriani "Flying in a Blue Dream", Vai, Andy Timmons ballads.'},
    'Mixolydian':            {iv:[0,2,4,5,7,9,10], mode:4, desc:'Major with a b7 — the dominant-7 sound. Blues-rock, "Sweet Home Alabama", jam-band land.'},
    'Natural Minor (Aeolian)':{iv:[0,2,3,5,7,8,10], mode:5, desc:'Sad/serious minor. Most rock ballads and metal.'},
    'Locrian':               {iv:[0,1,3,5,6,8,10], mode:6, desc:'Unstable, diminished tonic. Rare as a home key.'},
    'Major Pentatonic':      {iv:[0,2,4,7,9], desc:'Sweet, country/blues-major sound. Allman Brothers, SRV major-blues, Clapton.'},
    'Minor Pentatonic':      {iv:[0,3,5,7,10], desc:'THE rock/blues scale. Hendrix, SRV, everyone.'},
    'Blues (minor)':         {iv:[0,3,5,6,7,10], desc:'Minor pentatonic + b5 "blue note".'},
    'Blues (major)':         {iv:[0,2,3,4,7,9], desc:'Major pentatonic + b3. The SRV/Bonamassa "hybrid" flavor when mixed with minor blues.'},
    'Harmonic Minor':        {iv:[0,2,3,5,7,8,11], desc:'Minor with a raised 7 — exotic/neoclassical, and the source of the V7 chord in minor keys.'},
    'Melodic Minor':         {iv:[0,2,3,5,7,9,11], desc:'Minor with natural 6 and 7. Jazz minor.'},
    'Dorian b2':             {iv:[0,1,3,5,7,9,10], desc:'2nd mode of melodic minor.'},
    'Lydian Dominant':       {iv:[0,2,4,6,7,9,10], desc:'Mixolydian #4. Great over unresolved dominant 7 chords.'},
    'Whole Tone':            {iv:[0,2,4,6,8,10], desc:'Symmetrical, floating. Augmented chords.'},
    'Diminished (W-H)':      {iv:[0,2,3,5,6,8,9,11], desc:'Symmetrical, over dim7 chords.'},
    'Diminished (H-W)':      {iv:[0,1,3,4,6,7,9,10], desc:'Over 7b9 chords. Robben Ford, Bonamassa spice.'},
    'Chromatic':             {iv:[0,1,2,3,4,5,6,7,8,9,10,11], desc:'All 12 notes.'},
  };
  const MODE_NAMES = ['Ionian','Dorian','Phrygian','Lydian','Mixolydian','Aeolian','Locrian'];

  // Chord formulas: symbol -> intervals. Order matters for display priority.
  const CHORDS = [
    ['',      [0,4,7],        'Major'],
    ['m',     [0,3,7],        'Minor'],
    ['5',     [0,7],          'Power chord'],
    ['7',     [0,4,7,10],     'Dominant 7'],
    ['maj7',  [0,4,7,11],     'Major 7'],
    ['m7',    [0,3,7,10],     'Minor 7'],
    ['dim',   [0,3,6],        'Diminished'],
    ['aug',   [0,4,8],        'Augmented'],
    ['sus2',  [0,2,7],        'Suspended 2'],
    ['sus4',  [0,5,7],        'Suspended 4'],
    ['6',     [0,4,7,9],      'Major 6'],
    ['m6',    [0,3,7,9],      'Minor 6'],
    ['m7b5',  [0,3,6,10],     'Half-diminished'],
    ['dim7',  [0,3,6,9],      'Diminished 7'],
    ['mMaj7', [0,3,7,11],     'Minor-major 7'],
    ['add9',  [0,4,7,2],      'Add 9'],
    ['madd9', [0,3,7,2],      'Minor add 9'],
    ['7sus4', [0,5,7,10],     'Dominant 7 sus4'],
    ['9',     [0,4,7,10,2],   'Dominant 9'],
    ['maj9',  [0,4,7,11,2],   'Major 9'],
    ['m9',    [0,3,7,10,2],   'Minor 9'],
    ['7#9',   [0,4,7,10,3],   'Hendrix chord (7#9)'],
    ['7b9',   [0,4,7,10,1],   'Dominant 7 b9'],
    ['6/9',   [0,4,7,9,2],    'Six-nine'],
    ['11',    [0,4,7,10,2,5], 'Dominant 11'],
    ['m11',   [0,3,7,10,2,5], 'Minor 11'],
    ['13',    [0,4,7,10,2,9], 'Dominant 13'],
    ['maj7#11',[0,4,7,11,6],  'Major 7 #11'],
    ['7#5',   [0,4,8,10],     'Dominant 7 #5'],
    ['7b5',   [0,4,6,10],     'Dominant 7 b5'],
    ['maj7#5',[0,4,8,11],     'Major 7 #5'],
    ['sus2sus4',[0,2,5,7],    'Sus2/4'],
  ];
  const CHORD_BY_SYMBOL = Object.fromEntries(CHORDS.map(c=>[c[0],{iv:c[1],name:c[2]}]));

  function chordTones(rootPc, symbol){
    const f = CHORD_BY_SYMBOL[symbol]; if(!f) return [];
    return f.iv.map(i=>mod(rootPc+i));
  }

  // Identify chord(s) from a set of pitch classes; bassPc = lowest sounding note (optional).
  // Returns array of {root, symbol, name, exact, omitted, inversion, score}
  function identifyChord(pcsIn, bassPc){
    const pcs = [...new Set(pcsIn.map(p=>mod(p)))];
    if(pcs.length===0) return [];
    const set = new Set(pcs);
    const results = [];
    for(let root=0; root<12; root++){
      for(const [sym, iv, name] of CHORDS){
        const tones = iv.map(i=>mod(root+i));
        const toneSet = new Set(tones);
        // every input note must be a chord tone
        if(!pcs.every(p=>toneSet.has(p))) continue;
        const missing = tones.filter(t=>!set.has(t));
        const missingIv = missing.map(t=>mod(t-root));
        // allow: exact; omitted 5th; for 5+ note chords also omitted 5th and/or root
        let ok=false, omitted=[];
        if(missing.length===0){ ok=true; }
        else if(missing.length===1 && missingIv[0]===7 && iv.length>=4){ ok=true; omitted=['5']; }
        else if(iv.length>=5 && missing.every(m=>[7,0].includes(mod(m-root))) && missing.length<=2 && set.has(mod(root+iv[iv.length-1]))){ ok=true; omitted=missingIv.map(i=>INTERVAL_NAMES[i]); }
        if(!ok) continue;
        if(!set.has(root) && iv.length<5) continue;
        let score = 100 - iv.length*3 - omitted.length*12 - CHORDS.findIndex(c=>c[0]===sym)*0.5;
        let inversion = null;
        if(bassPc!=null){
          if(bassPc===root) score+=15;
          else { const bi = mod(bassPc-root); inversion = INTERVAL_NAMES[bi]; score-=6; }
        }
        results.push({root, symbol:sym, name, exact:missing.length===0, omitted, inversion, score, tones});
      }
    }
    results.sort((a,b)=>b.score-a.score);
    // dedupe same label
    const seen=new Set();
    return results.filter(r=>{const k=r.root+r.symbol; if(seen.has(k))return false; seen.add(k); return true;});
  }

  function chordLabel(r, useFlats){
    let s = pcToName(r.root,useFlats)+r.symbol;
    if(r.inversion) s += '/'+pcToName(mod(r.root+INTERVAL_NAMES.indexOf(r.inversion)),useFlats);
    if(r.omitted && r.omitted.length) s += ' (no '+r.omitted.join(', ')+')';
    return s;
  }

  function scaleNotes(rootPc, scaleName){
    return SCALES[scaleName].iv.map(i=>mod(rootPc+i));
  }

  // Diatonic chords for a 7-note scale: stack thirds (triads & sevenths)
  function diatonicChords(rootPc, scaleName){
    const iv = SCALES[scaleName].iv;
    if(iv.length!==7) return [];
    const notes = iv.map(i=>mod(rootPc+i));
    const ROMAN=['I','II','III','IV','V','VI','VII'];
    return notes.map((n,d)=>{
      const tri=[notes[d],notes[(d+2)%7],notes[(d+4)%7]];
      const sev=[...tri,notes[(d+6)%7]];
      const t=identifyChord(tri,n)[0]; const s=identifyChord(sev,n)[0];
      const rn = (sym)=>{
        let r=ROMAN[d];
        if(sym && (sym.startsWith('m')||sym.startsWith('dim'))) r=r.toLowerCase();
        if(sym==='dim'||sym==='m7b5'||sym==='dim7') r+='°';
        if(sym==='aug') r+='+';
        return r;
      };
      return {degree:d+1, root:n, triad:t, seventh:s, roman:rn(t?t.symbol:''), roman7:rn(s?s.symbol:'')+(s?(s.symbol.replace(/^m(?!aj)/,'').replace('dim','')||''):'')};
    });
  }

  // Circle of fifths order starting at C
  const CIRCLE = [0,7,2,9,4,11,6,1,8,3,10,5];
  const KEY_SIG = {0:'—',7:'1♯',2:'2♯',9:'3♯',4:'4♯',11:'5♯',6:'6♯/6♭',1:'5♭',8:'4♭',3:'3♭',10:'2♭',5:'1♭'};

  // Standard tuning low->high as MIDI numbers
  const TUNING = [40,45,50,55,59,64]; // E2 A2 D3 G3 B3 E4
  const STRING_NAMES = ['E','A','D','G','B','e'];

  return {SHARP,FLAT,FLAT_KEYS,noteToPc,pcToName,mod,INTERVAL_NAMES,INTERVAL_LONG,SCALES,MODE_NAMES,CHORDS,CHORD_BY_SYMBOL,
          chordTones,identifyChord,chordLabel,scaleNotes,diatonicChords,CIRCLE,KEY_SIG,TUNING,STRING_NAMES};
})();
