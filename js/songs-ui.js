// Songs tab: repertoire board + resources
window.SongsUI = (() => {
  const $=(s)=>document.querySelector(s);
  const S=window.Store, esc=S.esc;
  const STATUSES=['Want','Learning','Polishing','Can play'];
  let editing=null;

  // Practice history for a song, from logged sessions (matched by title, case-insensitive). No schema change.
  function songStats(title){
    const t=(title||'').trim().toLowerCase(); if(!t) return null;
    const ss=S.get().sessions.filter(s=>(s.song||'').trim().toLowerCase()===t).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.created||'').localeCompare(b.created||''));
    if(!ss.length) return null;
    const minutes=ss.reduce((a,s)=>a+(+s.minutes||0),0);
    const tempos=ss.filter(s=>s.tempo).map(s=>({date:s.date,tempo:+s.tempo}));
    return {n:ss.length, minutes, last:ss[ss.length-1].date, tempos};
  }
  const fmtMin=(m)=>m>=120?(m/60).toFixed(1)+' h':m+' min';
  // Only http(s) links become clickable.
  function linkList(s){
    return String(s.links||'').split(/\n+/).map(x=>x.trim()).filter(x=>/^https?:\/\/\S+$/i.test(x));
  }
  function linkLabel(u){ try{ const x=new URL(u); return x.hostname.replace(/^www\./,''); }catch(e){ return 'link'; } }

  function render(){
    const songs=S.get().songs;
    $('#songBoard').innerHTML=STATUSES.map(st=>{
      const list=songs.filter(s=>s.status===st);
      return `<div class="col"><h4>${st} (${list.length})</h4>${list.map(s=>{
        const pct = s.tempo&&s.curTempo? Math.min(100,Math.round(s.curTempo/s.tempo*100)) : null;
        const st2=songStats(s.title); const links=linkList(s).slice(0,3);
        return `<div class="song"><button type="button" class="song-open" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.title)}"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.artist||'')}</span><span class="meta">${esc([s.key,s.tuning,s.tempo?`${s.curTempo||'?'}/${s.tempo} bpm`:''].filter(Boolean).join(' · '))}</span>${pct!=null?`<span class="bar"><i style="width:${pct}%"></i></span>`:''}${st2?`<span class="meta">${st2.n} session${st2.n>1?'s':''} · ${fmtMin(st2.minutes)} · last ${esc(st2.last)}</span>`:''}</button>${links.length?`<div class="song-links">${links.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(linkLabel(u))} ↗</a>`).join('')}</div>`:''}</div>`;
      }).join('')}<button type="button" class="empty-slot" data-status="${st}">+ Add a song</button></div>`;
    }).join('');
    $('#songBoard').querySelectorAll('.song-open').forEach(el=>el.addEventListener('click',()=>openDialog(el.dataset.id)));
    $('#songBoard').querySelectorAll('.empty-slot').forEach(el=>el.addEventListener('click',()=>openDialog(null,el.dataset.status)));
    window.PracticeUI && window.PracticeUI.renderSongList();
  }

  function openDialog(id, status){
    editing=id||null;
    const s=id? S.get().songs.find(x=>x.id===id) : {title:'',artist:'',status:status||'Want',key:'',tuning:'Standard',tempo:'',curTempo:'',sections:'',notes:'',links:''};
    if(!s) return;
    $('#songDialogTitle').textContent=id?'Edit song':'Add song';
    $('#sTitle').value=s.title; $('#sArtist').value=s.artist||''; $('#sStatus').value=s.status; $('#sKey').value=s.key||''; $('#sTuning').value=s.tuning||'';
    $('#sTempo').value=s.tempo||''; $('#sCurTempo').value=s.curTempo||''; $('#sSections').value=s.sections||''; $('#sNotes').value=s.notes||''; $('#sLinks').value=s.links||'';
    $('#songDelete').classList.toggle('hidden',!id);
    // practice history
    const st=id&&songStats(s.title); const h=$('#songHistory');
    if(st){
      const climb=st.tempos.slice(-8).map(t=>`<span title="${esc(t.date)}">${esc(t.tempo)}</span>`).join(' → ');
      h.innerHTML=`<b>Practice history:</b> ${st.n} session${st.n>1?'s':''} · ${fmtMin(st.minutes)} · last ${esc(st.last)}${climb?`<br>Tempo climb: ${climb}${s.tempo?` <span class="hint">(target ${esc(s.tempo)})</span>`:''}`:''}`;
      h.classList.remove('hidden');
    } else { h.innerHTML=''; h.classList.add('hidden'); }
    $('#songDialog').showModal();
  }
  function saveDialog(e){
    e.preventDefault();
    const d=S.get();
    const obj={title:$('#sTitle').value.trim(), artist:$('#sArtist').value.trim(), status:$('#sStatus').value, key:$('#sKey').value.trim(), tuning:$('#sTuning').value.trim(), tempo:$('#sTempo').value?+$('#sTempo').value:'', curTempo:$('#sCurTempo').value?+$('#sCurTempo').value:'', sections:$('#sSections').value.trim(), notes:$('#sNotes').value.trim(), links:$('#sLinks').value.trim(), updated:Date.now()};
    if(!obj.title) return;
    const cur=editing && d.songs.find(x=>x.id===editing);
    if(cur){ Object.assign(cur,obj); }
    else d.songs.push(Object.assign({id:S.uid(),added:S.localDate()},obj));
    const ok=S.save(); $('#songDialog').close(); render(); window.PracticeUI.generatePlan();
    if(ok!==false) window.App.toast(cur?'Song saved':'Song added');
  }
  function del(){ if(!editing||!confirm('Delete this song?')) return; const d=S.get(); d.songs=d.songs.filter(x=>x.id!==editing); S.save(); $('#songDialog').close(); render(); window.App.toast('Song deleted'); }

  const RESOURCES=[
    {t:'Elevated Jam Tracks (YouTube)', b:'Your Dropbox Guitar folder already has EJT downloads (Deep Highway A minor, Tense Blues Rock D minor, Hot Driving Rock E, Mysterious Bluesy F minor). Match them to scales: A minor → A minor pent / A Dorian; D minor blues-rock → D minor pent + D blues; E rock → E minor pent / E Mixolydian; F minor → F minor pent / F Aeolian.'},
    {t:'JustinGuitar', b:'Good for structured gap-filling: the Intermediate modules (Grade 4–6) on CAGED, triads, and blues lead. Use it when the Theory tab isn\'t enough and you want a lesson sequence.'},
    {t:'Bernth', b:'Technique-focused (picking, legato, speed). Pair his exercises with the metronome here — log the bpm each session so the tempo chart shows the climb.'},
    {t:'Your players', b:'SRV: "Pride and Joy" (shuffle rhythm + lead), "Lenny" (chord-melody). Bonamassa: "Sloe Gin", "Just Got Paid" solo. Hendrix: "Little Wing" (the CAGED/thumb-over chord-melody bible), "Wind Cries Mary". Eric Johnson: "Cliffs of Dover" intro pentatonics. Satriani: "Always with Me, Always with You" (Lydian-ish melody). Andy Timmons: "Electric Gypsy", "Cry for You".'},
    {t:'Ask Claude', b:'For anything on the fly — "explain CAGED again", "what scale over C#m–A–E–B", "break down the Slow Dancing intro" — just ask in chat. Tip: export your practice log (Practice → Export JSON) and share it for feedback on what to work on next.'},
  ];
  function init(){
    $('#songAdd').addEventListener('click',()=>openDialog(null));
    $('#songForm').addEventListener('submit',saveDialog);
    $('#songCancel').addEventListener('click',()=>$('#songDialog').close());
    $('#songDelete').addEventListener('click',del);
    $('#resources').innerHTML=RESOURCES.map(r=>`<div class="card"><h4>${r.t}</h4><p>${r.b}</p></div>`).join('');
    render();
  }
  return {init, render};
})();
