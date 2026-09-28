// Chromatic tuner: mic → autocorrelation pitch detection → note + cents needle. Reference tones via Tone.
window.TunerUI = (() => {
  const $=(s)=>document.querySelector(s);
  const M=window.Music;
  let ac=null, analyser=null, stream=null, raf=null, buf=null, running=false, a4=440, smooth=null, holdNote=null, holdUntil=0;
  const STRINGS=[{n:'E2',m:40},{n:'A2',m:45},{n:'D3',m:50},{n:'G3',m:55},{n:'B3',m:59},{n:'E4',m:64}];

  function detect(data, sr){
    // RMS gate
    let rms=0; for(let i=0;i<data.length;i++) rms+=data[i]*data[i]; rms=Math.sqrt(rms/data.length);
    if(rms<0.01) return null;
    // normalized autocorrelation (McLeod-style NSDF, simplified)
    const N=data.length, maxLag=Math.floor(sr/60), minLag=Math.floor(sr/1200);
    const nsdf=new Float32Array(maxLag+1);
    for(let lag=minLag;lag<=maxLag;lag++){ let ac=0,m=0; for(let i=0;i<N-lag;i++){ ac+=data[i]*data[i+lag]; m+=data[i]*data[i]+data[i+lag]*data[i+lag]; } nsdf[lag]=m?2*ac/m:0; }
    // find first peak above threshold after first negative zero crossing
    let i=minLag; while(i<=maxLag && nsdf[i]>0) i++;
    let best=-1, bestVal=0; const peaks=[];
    while(i<maxLag){ if(nsdf[i]>0 && nsdf[i]>=nsdf[i-1] && nsdf[i]>nsdf[i+1]){ peaks.push([i,nsdf[i]]); if(nsdf[i]>bestVal){bestVal=nsdf[i];} } i++; }
    if(!peaks.length) return null;
    const thr=bestVal*0.9; const pk=peaks.find(p=>p[1]>=thr); if(!pk||pk[1]<0.6) return null;
    let lag=pk[0];
    // parabolic interpolation
    const y0=nsdf[lag-1],y1=nsdf[lag],y2=nsdf[lag+1]; const d=(y0-2*y1+y2); const off=d?0.5*(y0-y2)/d:0;
    return {freq:sr/(lag+off), clarity:pk[1], rms};
  }
  function loop(){
    analyser.getFloatTimeDomainData(buf);
    const r=detect(buf, ac.sampleRate);
    if(r){ smooth = smooth? smooth*0.6+r.freq*0.4 : r.freq; show(smooth, r.clarity); holdUntil=performance.now()+700; }
    else if(performance.now()>holdUntil){ smooth=null; showIdle(); }
    raf=requestAnimationFrame(loop);
  }
  function show(f, clarity){
    const midi=69+12*Math.log2(f/a4); const near=Math.round(midi); const cents=(midi-near)*100;
    const pc=M.mod(near), oct=Math.floor(near/12)-1;
    const nm=M.pcToName(pc, $('#useFlats').checked);
    $('#tnNote').textContent=nm; $('#tnOct').textContent=oct; $('#tnHz').textContent=f.toFixed(1)+' Hz';
    const c=Math.max(-50,Math.min(50,cents)); $('#tnCents').textContent=(c>0?'+':'')+c.toFixed(0)+'¢';
    const inTune=Math.abs(c)<=3;
    $('#tnNeedle').setAttribute('transform',`rotate(${c*1.6} 150 140)`);
    $('#tnNote').style.color = inTune?'var(--ok)': Math.abs(c)<10?'var(--accent2)':'var(--text)';
    $('#tnDir').textContent = inTune?'in tune':(c<0?'▲ tune up':'▼ tune down');
    // nearest guitar string hint
    const nearest=STRINGS.reduce((a,s)=>Math.abs(s.m-midi)<Math.abs(a.m-midi)?s:a);
    $('#tnStrings').querySelectorAll('.chip').forEach(ch=>ch.classList.toggle('on', +ch.dataset.m===nearest.m && Math.abs(nearest.m-midi)<1.5));
  }
  function showIdle(){ $('#tnNote').textContent='—'; $('#tnOct').textContent=''; $('#tnHz').textContent=''; $('#tnCents').textContent=''; $('#tnDir').textContent='play a note'; $('#tnNeedle').setAttribute('transform','rotate(0 150 140)'); $('#tnNote').style.color='var(--muted)'; $('#tnStrings').querySelectorAll('.chip').forEach(ch=>ch.classList.remove('on')); }
  async function start(){
    if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)){
      alert(window.isSecureContext===false ? 'The tuner needs a secure (https) page to use the microphone.' : 'This browser does not support microphone input.');
      return;
    }
    // Create/resume the AudioContext synchronously inside the tap — iOS Safari refuses to start it
    // after an await (the user-gesture is gone by the time getUserMedia resolves).
    window.Tone.audioSession('play-and-record');
    ac=ac||new (window.AudioContext||window.webkitAudioContext)(); const resumed=ac.resume();
    try{ stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}}); }
    catch(e){ window.Tone.audioSession('playback'); alert('Microphone not available: '+(e.name==='NotAllowedError'?'permission was denied. Allow microphone access for this site in your browser settings (iPhone/iPad: Settings → Safari → Microphone, or the "aA" menu → Website Settings).':e.message)); return; }
    try{ await resumed; }catch(e){}
    if(ac.state!=='running'){ try{ await ac.resume(); }catch(e){} }
    const src=ac.createMediaStreamSource(stream);
    const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=55;
    analyser=ac.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0;
    src.connect(hp).connect(analyser); buf=new Float32Array(analyser.fftSize);
    running=true; $('#tnToggle').textContent='■ Stop tuner'; $('#tnToggle').classList.add('danger'); loop();
  }
  function stop(){ running=false; cancelAnimationFrame(raf); if(stream) stream.getTracks().forEach(t=>t.stop()); stream=null; window.Tone.audioSession('playback'); $('#tnToggle').textContent='🎤 Start tuner'; $('#tnToggle').classList.remove('danger'); showIdle(); }
  function init(){
    $('#tnStrings').innerHTML=STRINGS.map(s=>`<span class="chip" data-m="${s.m}" title="Play reference">${s.n.replace(/\d/,'')}<small>${s.n.slice(-1)}</small></span>`).join('');
    $('#tnStrings').querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>window.Tone.pluck(+ch.dataset.m,0,0.9)));
    $('#tnToggle').addEventListener('click',()=>running?stop():start());
    $('#tnA4').addEventListener('change',()=>{ a4=+$('#tnA4').value||440; });
    showIdle();
  }
  return {init, stop, _detect:detect};
})();
