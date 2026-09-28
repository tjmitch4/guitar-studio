// Guitar tone engine v2 — extended Karplus-Strong plucked-string synthesis rendered to buffers.
// Pick-position comb filter, allpass fractional tuning, frequency-dependent decay, doubled/detuned string,
// then a preset "instrument" chain (body resonances / amp coloring / reverb). No samples needed.
window.Tone = (() => {
  let ac=null, chain=null, cache=new Map(), enabled=true, preset='acoustic';
  // bright: loop-filter weight (lower = darker, highs die faster). exciteLP: pick softness (higher = softer).
  // lowShelf: dB boost under ~250 Hz for body. mid: [freq, gainDb] presence/mid coloring.
  const PRESETS={
    acoustic:{ label:'Acoustic', pickPos:0.16, bright:0.50, decay:1.15, detune:2.2, mix2:0.6, exciteLP:0.55, body:'acoustic', verb:0.38, verbLen:2.4, lp:5200, drive:0, lowShelf:4, mid:[900,1.5] },
    clean:   { label:'Clean electric', pickPos:0.22, bright:0.56, decay:1.3, detune:1.2, mix2:0.5, exciteLP:0.5, body:'amp', verb:0.32, verbLen:2.0, lp:3800, drive:0.12, lowShelf:5, mid:[1400,1.5] },
    blues:   { label:'Blues drive', pickPos:0.24, bright:0.55, decay:1.5, detune:1.5, mix2:0.55, exciteLP:0.45, body:'amp', verb:0.28, verbLen:1.8, lp:3600, drive:0.55, lowShelf:3, mid:[1100,4], sat:0.35 },
    warm:    { label:'Warm / jazz', pickPos:0.36, bright:0.36, decay:0.95, detune:0.8, mix2:0.4, exciteLP:0.75, body:'amp', verb:0.30, verbLen:2.0, lp:2400, drive:0.05, lowShelf:6, mid:[600,2] },
  };
  function ctx(){
    if(ac) return ac;
    ac=new (window.AudioContext||window.webkitAudioContext)();
    buildChain(); return ac;
  }
  // iOS/iPadOS: Web Audio is muted by the ring/silent switch unless the page declares a "playback"
  // audio session (Safari 16.4+), and an AudioContext can only start from a user gesture. It can also
  // be left "interrupted" after a call / backgrounding, so resume whenever it isn't running.
  function audioSession(type){ try{ if(navigator.audioSession) navigator.audioSession.type=type; }catch(e){} }
  function wake(c){ if(c && c.state!=='running' && c.state!=='closed'){ try{ const p=c.resume(); if(p&&p.catch) p.catch(()=>{}); }catch(e){} } }
  let unlocked=false;
  function unlock(){
    // don't clobber 'play-and-record' while the tuner / camera is using the mic
    try{ if(navigator.audioSession && (!navigator.audioSession.type || navigator.audioSession.type==='auto')) audioSession('playback'); }catch(e){}
    const c=ctx(); wake(c);
    if(!unlocked){ // play one silent sample inside the gesture (older iOS needs this to really start output)
      try{ const b=c.createBuffer(1,1,c.sampleRate), s=c.createBufferSource(); s.buffer=b; s.connect(c.destination); s.start(0); unlocked=true; }catch(e){}
    }
  }
  function buildChain(){
    const P=PRESETS[preset];
    if(chain){ try{ chain.input.disconnect(); }catch(e){} }
    const input=ac.createGain(); input.gain.value=1;
    let node=input;
    const biq=(type,f,q,g)=>{ const b=ac.createBiquadFilter(); b.type=type; b.frequency.value=f; b.Q.value=q; if(g!=null) b.gain.value=g; node.connect(b); node=b; return b; };
    const shaper=(amt,asym)=>{ const ws=ac.createWaveShaper(); const n=2048, c=new Float32Array(n); const k=amt*40; for(let i=0;i<n;i++){ let x=i/(n-1)*2-1; if(asym) x+=0.08; c[i]=Math.tanh(k*x/4)/Math.tanh(k/4); } ws.curve=c; ws.oversample='4x'; node.connect(ws); node=ws; return ws; };
    // body / low-mid richness
    if(P.lowShelf) biq('lowshelf',240,0.7,P.lowShelf);
    if(P.body==='acoustic'){
      // modal body: resonant peaks + air, then a little "wood" lowpass on the very top
      for(const [f,q,g] of [[100,3.0,4],[205,2.5,3.5],[410,2.0,2.5],[1200,1.5,1.2]]) biq('peaking',f,q,g);
      biq('highpass',65,0.7);
    } else {
      biq('highpass',85,0.7);
      if(P.drive>0){
        // tube-screamer-ish: mid push into the drive stage, then tame fizz
        if(P.drive>0.3) biq('peaking',800,0.8,4);
        const pre=ac.createGain(); pre.gain.value=1+P.drive*3; node.connect(pre); node=pre;
        shaper(P.drive, P.drive>0.3);
        const post=ac.createGain(); post.gain.value=1/(1+P.drive*1.6); node.connect(post); node=post;
        biq('lowpass',P.drive>0.3?4200:6000,0.7);
        if(P.sat){ biq('peaking',3200,1.2,-P.sat*6); } // pull fizz
      }
    }
    if(P.mid) biq('peaking',P.mid[0],1.0,P.mid[1]);
    biq('lowpass',P.lp,0.6);
    const comp=ac.createDynamicsCompressor(); comp.threshold.value=-18; comp.knee.value=12; comp.ratio.value=2.5; comp.attack.value=0.006; comp.release.value=0.25; node.connect(comp);
    const out=ac.createGain(); out.gain.value=0.85; comp.connect(out); out.connect(ac.destination);
    // reverb: pre-filtered so the tail is warm, not splashy
    const vlp=ac.createBiquadFilter(); vlp.type='lowpass'; vlp.frequency.value=3200; vlp.Q.value=0.5;
    const conv=ac.createConvolver(); conv.buffer=impulse(P.verbLen,2.2);
    const wet=ac.createGain(); wet.gain.value=P.verb; node.connect(vlp); vlp.connect(conv); conv.connect(wet); wet.connect(comp);
    chain={input};
  }
  function impulse(sec,decay){
    const sr=ac.sampleRate, len=Math.floor(sr*sec), b=ac.createBuffer(2,len,sr);
    for(let c=0;c<2;c++){ const d=b.getChannelData(c); let lp=0; for(let i=0;i<len;i++){ const n=(Math.random()*2-1); lp=0.7*lp+0.3*n; d[i]=lp*Math.pow(1-i/len,decay); } }
    return b;
  }
  const midiToHz=(m)=>440*Math.pow(2,(m-69)/12);

  // One string loop with allpass fractional delay. Returns Float32Array.
  function renderString(f, len, P, detuneCents){
    const sr=ac.sampleRate; const fr=f*Math.pow(2,detuneCents/1200);
    // loop filter blends ring[idx] (age N) with ring[idx+1] (age N-1) → effective delay N-(1-b); compensate.
    const total=sr/fr + (1-P.bright);
    const N=Math.floor(total-0.5); const frac=total-N; // allpass handles frac in [0.5,1.5)
    const apC=(1-frac)/(1+frac);
    // per-frequency loss so highs die faster and bass rings longer
    const t60 = P.decay*(fr<120?4.5: fr<250?3.6: fr<500?2.6: 1.9);
    const g = Math.pow(0.001, 1/(fr*t60));  // per-period loss → per-sample via loop
    const ring=new Float32Array(N);
    // excitation: noise, lowpassed (pick softness), pick-position comb
    const ex=new Float32Array(N); let lp=0;
    for(let i=0;i<N;i++){ const n=Math.random()*2-1; lp=lp+(n-lp)*(1-P.exciteLP); ex[i]=lp; }
    const pp=Math.max(1,Math.floor(N*P.pickPos));
    for(let i=0;i<N;i++){ ring[i]=ex[i]-(i>=pp?ex[i-pp]:0); }
    // dc removal
    let mean=0; for(let i=0;i<N;i++) mean+=ring[i]; mean/=N; for(let i=0;i<N;i++) ring[i]-=mean;
    const out=new Float32Array(len);
    let idx=0, apPrevIn=0, apPrevOut=0; const b=P.bright;
    for(let i=0;i<len;i++){
      const cur=ring[idx], next=ring[(idx+1)%N];
      out[i]=cur;
      // loop filter: brightness-weighted 2-point lowpass * loss, then allpass for tuning
      const lpv=(b*cur+(1-b)*next)*g;
      const apOut=apC*lpv+apPrevIn-apC*apPrevOut; apPrevIn=lpv; apPrevOut=apOut;
      ring[idx]=apOut;
      idx=(idx+1)%N;
    }
    return out;
  }
  function stringBuffer(midi){
    const key=preset+':'+midi; if(cache.has(key)) return cache.get(key);
    const P=PRESETS[preset], sr=ctx().sampleRate, f=midiToHz(midi);
    const dur = midi<50?4.2 : midi<62?3.4 : 2.6;
    const len=Math.floor(sr*dur);
    const a=renderString(f,len,P,0), b=renderString(f,len,P,P.detune);
    const out=new Float32Array(len);
    for(let i=0;i<len;i++) out[i]=a[i]+P.mix2*b[i];
    // add a tiny "thump" (body knock) at attack for acoustic
    if(P.body==='acoustic'){ const th=Math.floor(sr*0.03); const tf=90; for(let i=0;i<th;i++){ out[i]+=0.35*Math.sin(2*Math.PI*tf*i/sr)*(1-i/th); } }
    for(let i=0;i<48;i++) out[i]*=i/48;
    const fo=Math.floor(sr*0.2); for(let i=0;i<fo;i++) out[len-1-i]*=i/fo;
    let mx=0; for(let i=0;i<len;i++) mx=Math.max(mx,Math.abs(out[i])); if(mx>0){ const s=0.9/mx; for(let i=0;i<len;i++) out[i]*=s; }
    const buf=ac.createBuffer(1,len,sr); buf.copyToChannel(out,0);
    cache.set(key,buf); return buf;
  }
  function pluck(midi, when=0, vel=0.8, dur=null){
    if(!enabled) return;
    const c=ctx(); wake(c);
    const src=c.createBufferSource(); src.buffer=stringBuffer(midi);
    // subtle velocity → brightness via a per-note lowpass
    const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=1800+vel*4500; f.Q.value=0.4;
    const g=c.createGain(); const t=c.currentTime+when;
    g.gain.setValueAtTime(vel,t);
    if(dur){ g.gain.setValueAtTime(vel,t+dur); g.gain.exponentialRampToValueAtTime(0.001,t+dur+0.3); }
    src.connect(f).connect(g).connect(chain.input);
    src.start(t); if(dur) src.stop(t+dur+0.35);
  }
  function strum(frets, opts={}){
    const T=window.Music.TUNING; const gap=opts.gap??0.04;
    const notes=frets.map((f,s)=>f>=0?T[s]+f:null).filter(x=>x!=null);
    const order=opts.direction==='up'?notes.slice().reverse():notes;
    order.forEach((m,i)=>pluck(m,i*gap+Math.random()*0.006,0.7+i*0.03+Math.random()*0.05, opts.dur||null));
  }
  function chordPcs(pcs, opts={}){ const base=opts.base??52; const notes=pcs.map(pc=>base+((pc-base)%12+12)%12).sort((a,b)=>a-b); notes.forEach((m,i)=>pluck(m,i*(opts.gap??0.04),0.75)); }
  function arpeggio(frets, gap=0.22){ const T=window.Music.TUNING; frets.map((f,s)=>f>=0?T[s]+f:null).filter(x=>x!=null).forEach((m,i)=>pluck(m,i*gap,0.8)); }
  function setEnabled(v){ enabled=!!v; }
  function setPreset(p){ if(!PRESETS[p]) return; preset=p; if(ac) buildChain(); }
  function blip(good){ if(!enabled) return; const c=ctx(); wake(c); const o=c.createOscillator(), g=c.createGain(); o.type='sine'; o.frequency.setValueAtTime(good?880:220,c.currentTime); if(good) o.frequency.exponentialRampToValueAtTime(1320,c.currentTime+0.08); g.gain.setValueAtTime(0.0001,c.currentTime); g.gain.exponentialRampToValueAtTime(0.2,c.currentTime+0.01); g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+(good?0.18:0.3)); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime+0.35); }
  return {unlock, wake:()=>wake(ac), audioSession, pluck, strum, chordPcs, arpeggio, setEnabled, setPreset, getPreset:()=>preset, PRESETS, blip, isEnabled:()=>enabled, _buffer:stringBuffer};
})();
