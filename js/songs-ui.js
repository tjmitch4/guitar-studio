// Songs tab: repertoire board + resources
window.SongsUI = (() => {
  const $=(s)=>document.querySelector(s);
  const S=window.Store;
  const STATUSES=['Want','Learning','Polishing','Can play'];
  let editing=null;

  function render(){
    const songs=S.get().songs;
    $('#songBoard').innerHTML=STATUSES.map(st=>{
      const list=songs.filter(s=>s.status===st);
      return `<div class="col"><h4>${st} (${list.length})</h4>${list.map(s=>{
        const pct = s.tempo&&s.curTempo? Math.min(100,Math.round(s.curTempo/s.tempo*100)) : null;
        return `<div class="song" data-id="${s.id}"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist||'')}</div><div class="meta">${[s.key,s.tuning,s.tempo?`${s.curTempo||'?'}/${s.tempo} bpm`:''].filter(Boolean).join(' · ')}</div>${pct!=null?`<div class="bar"><i style="width:${pct}%"></i></div>`:''}</div>`;
      }).join('')||'<p class="empty">—</p>'}</div>`;
    }).join('');
    $('#songBoard').querySelectorAll('.song').forEach(el=>el.addEventListener('click',()=>openDialog(el.dataset.id)));
    window.PracticeUI && window.PracticeUI.renderSongList();
  }
  const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');

  function openDialog(id){
    editing=id||null;
    const s=id? S.get().songs.find(x=>x.id===id) : {title:'',artist:'',status:'Want',key:'',tuning:'Standard',tempo:'',curTempo:'',sections:'',notes:'',links:''};
    $('#songDialogTitle').textContent=id?'Edit song':'Add song';
    $('#sTitle').value=s.title; $('#sArtist').value=s.artist||''; $('#sStatus').value=s.status; $('#sKey').value=s.key||''; $('#sTuning').value=s.tuning||'';
    $('#sTempo').value=s.tempo||''; $('#sCurTempo').value=s.curTempo||''; $('#sSections').value=s.sections||''; $('#sNotes').value=s.notes||''; $('#sLinks').value=s.links||'';
    $('#songDelete').classList.toggle('hidden',!id);
    $('#songDialog').showModal();
  }
  function saveDialog(e){
    e.preventDefault();
    const d=S.get();
    const obj={title:$('#sTitle').value.trim(), artist:$('#sArtist').value.trim(), status:$('#sStatus').value, key:$('#sKey').value.trim(), tuning:$('#sTuning').value.trim(), tempo:$('#sTempo').value?+$('#sTempo').value:'', curTempo:$('#sCurTempo').value?+$('#sCurTempo').value:'', sections:$('#sSections').value.trim(), notes:$('#sNotes').value.trim(), links:$('#sLinks').value.trim()};
    if(!obj.title) return;
    if(editing){ Object.assign(d.songs.find(x=>x.id===editing),obj); }
    else d.songs.push(Object.assign({id:S.uid(),added:new Date().toISOString().slice(0,10)},obj));
    S.save(); $('#songDialog').close(); render(); window.PracticeUI.generatePlan();
  }
  function del(){ if(!editing||!confirm('Delete this song?')) return; const d=S.get(); d.songs=d.songs.filter(x=>x.id!==editing); S.save(); $('#songDialog').close(); render(); }

  const RESOURCES=[
    {t:'Elevated Jam Tracks (YouTube)', b:'Your Dropbox Guitar folder already has EJT downloads (Deep Highway A minor, Tense Blues Rock D minor, Hot Driving Rock E, Mysterious Bluesy F minor). Match them to scales: A minor → A minor pent / A Dorian; D minor blues-rock → D minor pent + D blues; E rock → E minor pent / E Mixolydian; F minor → F minor pent / F Aeolian.'},
    {t:'JustinGuitar', b:'Good for structured gap-filling: the Intermediate modules (Grade 4–6) on CAGED, triads, and blues lead. Use it when the Theory tab isn\'t enough and you want a lesson sequence.'},
    {t:'Bernth', b:'Technique-focused (picking, legato, speed). Pair his exercises with the metronome here — log the bpm each session so the tempo chart shows the climb.'},
    {t:'Your players', b:'SRV: "Pride and Joy" (shuffle rhythm + lead), "Lenny" (chord-melody). Bonamassa: "Sloe Gin", "Just Got Paid" solo. Hendrix: "Little Wing" (the CAGED/thumb-over chord-melody bible), "Wind Cries Mary". Eric Johnson: "Cliffs of Dover" intro pentatonics. Satriani: "Always with Me, Always with You" (Lydian-ish melody). Andy Timmons: "Electric Gypsy", "Cry for You".'},
    {t:'Ask Claude', b:'For anything on the fly — "explain CAGED again", "what scale over C#m–A–E–B", "break down the Slow Dancing intro" — just ask in chat. Claude keeps a profile of your goals and songs in this folder (profile.md).'},
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
