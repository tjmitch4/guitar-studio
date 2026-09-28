// Markdown files for the GitHub data repo (studio-data, under guitar/). Pure: no DOM, no network, no storage.
//
// Every data file is Markdown: YAML frontmatter with a few flat scalars (for people and for Claude), a readable
// body, and the full record in a final section:
//
//   ## Data
//   ```json
//   { ...full record, sorted keys... }
//   ```
//
// The app only ever reads that JSON block (parse* below). Serialization is deterministic (sorted keys, fixed
// English date formatting, UTC months) so two devices holding the same data write byte-identical files and an
// idle device never makes a commit. PROGRESS.md is a generated coaching summary; the app never parses it.
(function(root){
  'use strict';
  const SM = root.SyncMerge;
  const isObj=(v)=>v!=null && typeof v==='object' && !Array.isArray(v);
  const isFlat=(v)=>isObj(v) && Object.keys(v).every(k=>v[k]==null || typeof v[k]!=='object');

  const PREFIX='guitar/';
  const PATHS={ sessions:PREFIX+'sessions/', songs:PREFIX+'songs/', trainer:PREFIX+'trainer/',
    videos:PREFIX+'video-notes.md', settings:PREFIX+'settings.md', progress:PREFIX+'PROGRESS.md' };

  // ---------- JSON block: sorted keys, 2-space indent; flat objects inside arrays stay on one line ----------
  function pretty(v, ind){
    ind=ind||'';
    const i2=ind+'  ';
    if(Array.isArray(v)){
      if(!v.length) return '[]';
      if(v.every(x=>x==null || typeof x!=='object')) return SM.stable(v);
      return '[\n'+v.map(x=>i2+(isFlat(x)?SM.stable(x):pretty(x,i2))).join(',\n')+'\n'+ind+']';
    }
    if(isObj(v)){
      const keys=Object.keys(v).filter(k=>v[k]!==undefined).sort();
      if(!keys.length) return '{}';
      return '{\n'+keys.map(k=>i2+JSON.stringify(k)+': '+pretty(v[k],i2)).join(',\n')+'\n'+ind+'}';
    }
    return JSON.stringify(v===undefined?null:v);
  }
  const dataBlock=(obj)=>'## Data\n\n```json\n'+pretty(obj)+'\n```\n';

  // Pull the JSON out of the LAST "## Data" section. Throws on anything unexpected (caller skips the file).
  function extractJSON(text){
    if(typeof text!=='string') throw new Error('not text');
    const t=text.replace(/\r\n/g,'\n');
    const re=/(^|\n)## Data[ \t]*\n/g; let m, last=-1;
    while((m=re.exec(t))) last=m.index+m[0].length;
    if(last<0) throw new Error('no "## Data" section');
    const rest=t.slice(last);
    const f=/^\s*```json[^\n]*\n([\s\S]*?)\n```/.exec(rest);
    if(!f) throw new Error('no ```json block under "## Data"');
    return JSON.parse(f[1]);
  }

  // ---------- frontmatter (flat scalars only) ----------
  const RESERVED=/^(true|false|yes|no|on|off|null|~|y|n)$/i;
  function yamlScalar(v){
    if(typeof v==='number') return isFinite(v)?String(v):'null';
    if(typeof v==='boolean') return v?'true':'false';
    const s=String(v);
    if(/^\d{4}-\d{2}(-\d{2})?(T[\d:.]+Z)?$/.test(s)) return s;                              // dates, months, ISO times
    if(/^[A-Za-z][A-Za-z0-9 _.#\/()+-]*$/.test(s) && !RESERVED.test(s) && !/ #|: |\s$/.test(s)) return s;
    return JSON.stringify(s); // double-quoted YAML (JSON escapes are valid YAML escapes)
  }
  function frontmatter(fields){
    const lines=['---'];
    fields.forEach(([k,v])=>{ if(v===undefined || v===null || v==='') return; lines.push(k+': '+yamlScalar(v)); });
    lines.push('---','');
    return lines.join('\n');
  }

  // ---------- small deterministic formatting helpers ----------
  const DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const NOTE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const STRING=['low E (6th)','A (5th)','D (4th)','G (3rd)','B (2nd)','high e (1st)'];
  const validDate=(s)=>typeof s==='string' && /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s.slice(0,10)+'T00:00:00Z'));
  function longDate(s){ if(!validDate(s)) return String(s||'undated'); const d=new Date(s.slice(0,10)+'T00:00:00Z'); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
  const iso=(ms)=>(+ms>0 && isFinite(+ms))? new Date(+ms).toISOString() : undefined;
  const pct=(n,d)=>d?Math.round(n*100/d):0;
  const oneLine=(s)=>String(s==null?'':s).replace(/\s*\n\s*/g,' / ').trim();
  const cell=(s)=>oneLine(s).replace(/\|/g,'\\|');
  const quote=(s)=>String(s).replace(/\r\n/g,'\n').split('\n').map(l=>l.trim()?'> '+l:'>').join('\n');
  const monthKey=(ts)=>{ const d=new Date(+ts||0); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; };
  const monthName=(k)=>{ const [y,m]=k.split('-'); return `${MON[(+m||1)-1]} ${y}`; };

  // ---------- file names ----------
  function slug(s, max){
    const out=String(s==null?'':s).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase()
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,max||40).replace(/-+$/,'');
    return out;
  }
  function shortId(id, len){
    const clean=String(id).toLowerCase().replace(/[^a-z0-9]/g,'');
    return (clean.slice(0,len||6) || SM.hash(String(id)).slice(0,len||6));
  }
  // A new file name for a record. `taken(path)` says whether a path is already used by another record;
  // on a clash the id part gets longer, then a hash is added (stable per id).
  function recordPath(kind, rec, taken){
    taken=taken||(()=>false);
    let base;
    if(kind==='sessions'){
      const focus=slug((rec.cats&&rec.cats[0]) || rec.song || 'practice', 30) || 'practice';
      const date=validDate(rec.date)?rec.date.slice(0,10):'undated';
      base=PATHS.sessions+date+'-'+focus+'-';
    } else {
      base=PATHS.songs+(slug(rec.title,40)||'untitled')+'-';
    }
    for(const len of [6,10,16]){ const p=base+shortId(rec.id,len)+'.md'; if(!taken(p)) return p; }
    for(let n=0;;n++){ const p=base+shortId(rec.id,16)+'-'+SM.hash(rec.id+'#'+n).slice(0,6)+'.md'; if(!taken(p)) return p; }
  }
  const trainerPath=(month)=>PATHS.trainer+month+'.md';

  // What a path in the repo is. null = not ours to read (PROGRESS.md, .gitkeep, anything else).
  function kindOf(path){
    if(path.startsWith(PATHS.sessions) && /^[^/]+\.md$/.test(path.slice(PATHS.sessions.length))) return 'sessions';
    if(path.startsWith(PATHS.songs) && /^[^/]+\.md$/.test(path.slice(PATHS.songs.length))) return 'songs';
    if(/^guitar\/trainer\/\d{4}-\d{2}\.md$/.test(path)) return 'trainer';
    if(path===PATHS.videos) return 'videos';
    if(path===PATHS.settings) return 'settings';
    return null;
  }

  // ---------- sessions ----------
  function sessionMd(s){
    const cats=(s.cats||[]).join(', ');
    const fm=frontmatter([['id',s.id],['type','session'],['date',validDate(s.date)?s.date.slice(0,10):s.date],['updatedAt',iso(s.updatedAt)],
      ['minutes',+s.minutes||0],['focus',cats],['song',s.song],['tempo',s.tempo==null||s.tempo===''?undefined:s.tempo],['feel',s.rating]]);
    const lines=[`# Practice session · ${longDate(s.date)}`,''];
    lines.push(`- **Minutes:** ${+s.minutes||0}`);
    if(cats) lines.push(`- **Focus:** ${oneLine(cats)}`);
    if(s.song) lines.push(`- **Song:** ${oneLine(s.song)}`);
    if(s.tempo) lines.push(`- **Tempo:** ${oneLine(s.tempo)} bpm`);
    if(s.rating) lines.push(`- **Feel:** ${oneLine(s.rating)}`);
    lines.push('');
    if(s.notes){ lines.push('## Notes','',quote(s.notes),''); }
    return fm+'\n'+lines.join('\n')+'\n'+dataBlock(s);
  }
  // ---------- songs ----------
  function tempoLine(g){
    const cur=+g.curTempo||0, tgt=+g.tempo||0;
    if(cur && tgt) return `${cur} / ${tgt} bpm (${pct(cur,tgt)}% of target)`;
    if(tgt) return `target ${tgt} bpm (no current tempo logged)`;
    if(cur) return `${cur} bpm (no target set)`;
    return '';
  }
  function songMd(g){
    const fm=frontmatter([['id',g.id],['type','song'],['title',g.title],['artist',g.artist],['status',g.status],['key',g.key],
      ['tempo',+g.tempo||undefined],['currentTempo',+g.curTempo||undefined],['added',g.added],['updatedAt',iso(g.updatedAt)]]);
    const lines=[`# ${oneLine(g.title||'Untitled')}${g.artist?' — '+oneLine(g.artist):''}`,''];
    lines.push(`- **Status:** ${oneLine(g.status||'Want')}`);
    if(g.key || g.tuning) lines.push(`- **Key:** ${oneLine(g.key||'—')}${g.tuning?` · **Tuning:** ${oneLine(g.tuning)}`:''}`);
    const t=tempoLine(g); if(t) lines.push(`- **Tempo:** ${t}`);
    if(g.added) lines.push(`- **Added:** ${oneLine(g.added)}`);
    lines.push('');
    const list=(s)=>String(s).replace(/\r\n/g,'\n').split('\n').map(x=>x.trim()).filter(Boolean).map(x=>'- '+x).join('\n');
    if(g.sections) lines.push('## Sections','',list(g.sections),'');
    if(g.notes) lines.push('## Notes','',quote(g.notes),'');
    if(g.links) lines.push('## Links','',list(g.links),'');
    return fm+'\n'+lines.join('\n')+'\n'+dataBlock(g);
  }

  // ---------- trainer answers, one file per UTC month ----------
  function trainerStats(attempts){
    const by=(keyFn)=>{ const m={}; attempts.forEach(a=>{ const k=keyFn(a); const x=m[k]=m[k]||{n:0,ok:0,ms:0}; x.n++; if(a.ok) x.ok++; x.ms+=(+a.ms||0); }); return m; };
    const n=attempts.length, ok=attempts.filter(a=>a.ok).length, ms=attempts.reduce((s,a)=>s+(+a.ms||0),0);
    return {n, ok, avg:n?ms/n:0, byMode:by(a=>a.mode||'find'), byString:by(a=>+a.s), byCell:by(a=>(+a.s)+':'+(+a.pc)), byLevel:by(a=>+a.lvl||0)};
  }
  const secs=(ms)=>(ms/1000).toFixed(1)+' s';
  function weakCells(st, min, limit){
    return Object.entries(st.byCell).filter(([,x])=>x.n>=min)
      .map(([k,x])=>{ const [s,pc]=k.split(':').map(Number); return {s,pc,n:x.n,acc:x.ok/x.n,avg:x.ms/x.n}; })
      .sort((a,b)=>(a.acc-b.acc)||(b.avg-a.avg)||(a.s-b.s)||(a.pc-b.pc)).slice(0,limit);
  }
  function trainerMd(month, attempts){
    const st=trainerStats(attempts);
    const fm=frontmatter([['type','trainer-month'],['month',month],['answers',st.n],['correct',st.ok],['accuracy',pct(st.ok,st.n)],['avgSeconds',+(st.avg/1000).toFixed(1)]]);
    const L=[`# Note trainer · ${monthName(month)}`,'',`- **Answers:** ${st.n} · **Correct:** ${st.ok} (${pct(st.ok,st.n)}%) · **Average time:** ${secs(st.avg)}`];
    const modes=Object.keys(st.byMode).sort().map(k=>`${k} ${st.byMode[k].n} (${pct(st.byMode[k].ok,st.byMode[k].n)}%)`);
    if(modes.length) L.push(`- **By mode:** ${modes.join(', ')}`);
    const lv=Object.keys(st.byLevel).map(Number).sort((a,b)=>a-b).map(k=>`${k?'L'+k:'free practice'} ${st.byLevel[k].n} (${pct(st.byLevel[k].ok,st.byLevel[k].n)}%)`);
    if(lv.length) L.push(`- **By level:** ${lv.join(', ')}`);
    L.push('','## Accuracy by string','','| String | Answers | Accuracy | Avg time |','|---|---:|---:|---:|');
    Object.keys(st.byString).map(Number).sort((a,b)=>a-b).forEach(s=>{ const x=st.byString[s]; L.push(`| ${STRING[s]||s} | ${x.n} | ${pct(x.ok,x.n)}% | ${secs(x.ms/x.n)} |`); });
    const weak=weakCells(st,3,8);
    if(weak.length){ L.push('','## Weakest notes this month (3+ answers)','','| String | Note | Answers | Accuracy | Avg time |','|---|---|---:|---:|---:|');
      weak.forEach(w=>L.push(`| ${STRING[w.s]||w.s} | ${NOTE[w.pc]||w.pc} | ${w.n} | ${Math.round(w.acc*100)}% | ${secs(w.avg)} |`)); }
    L.push('');
    return fm+'\n'+L.join('\n')+'\n'+dataBlock({month, attempts});
  }
  // Group answers into UTC months (the same bucket on every device, whatever its time zone).
  function trainerFiles(quiz){
    const out={}; if(!quiz || !Array.isArray(quiz.attempts)) return out;
    const by={};
    quiz.attempts.forEach(a=>{ const k=monthKey(a.ts); (by[k]=by[k]||[]).push(a); });
    Object.keys(by).forEach(k=>{
      const arr=by[k].slice().sort((x,y)=>((+x.ts||0)-(+y.ts||0)) || (x.id<y.id?-1:x.id>y.id?1:0));
      out[trainerPath(k)]={month:k, content:trainerMd(k, arr)};
    });
    return out;
  }

  // ---------- video notes (one file, keyed by video file name) ----------
  function videosMd(videos, tombstones){
    const names=Object.keys(videos||{}).sort();
    const unrev=names.filter(n=>!videos[n].reviewed).length;
    const fm=frontmatter([['type','video-notes'],['videos',names.length],['unreviewed',unrev]]);
    const L=['# Practice video notes','',`${names.length} video${names.length===1?'':'s'} with notes · ${unrev} not reviewed yet. The videos themselves stay in TJ's Practice Videos folder; only these notes sync.`,''];
    if(names.length){
      L.push('| Video | Date | Song | Reviewed | Notes |','|---|---|---|---|---|');
      names.slice().sort((a,b)=>(String(videos[b].date||'')).localeCompare(String(videos[a].date||''))||a.localeCompare(b))
        .forEach(n=>{ const v=videos[n]; L.push(`| ${cell(n)} | ${cell(v.date||'')} | ${cell(v.song||'')} | ${v.reviewed?'yes':'no'} | ${cell(v.notes||'')} |`); });
      L.push('');
    }
    const deleted=(tombstones||[]).slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    return fm+'\n'+L.join('\n')+'\n'+dataBlock({videos:videos||{}, deleted});
  }

  // ---------- settings (prefs with per-field timestamps) ----------
  function settingsMd(s){
    const prefs=s.prefs||{};
    const fm=frontmatter([['type','settings']]);
    const L=['# Guitar Studio settings',''];
    const DESC={useFlats:'Flat note names (♭)', sound:'Sound on', tone:'Guitar tone'};
    Object.keys(prefs).sort().forEach(k=>L.push(`- **${DESC[k]||k}:** ${oneLine(JSON.stringify(prefs[k]))}`));
    if(s.quizResetAt) L.push(`- **Trainer stats reset:** ${iso(s.quizResetAt)}`);
    L.push('','Each setting keeps whichever device changed it last.','');
    return fm+'\n'+L.join('\n')+'\n'+dataBlock(s);
  }

  // ---------- parsing (the JSON block only) ----------
  // Returns {kind, ...} or throws. Validates just enough that merging can't crash.
  function parseFile(path, text){
    const kind=kindOf(path); if(!kind) return null;
    const j=extractJSON(text);
    if(kind==='sessions' || kind==='songs'){
      if(!isObj(j) || typeof j.id!=='string' || !j.id) throw new Error('record has no id');
      if(j.updatedAt!=null && (typeof j.updatedAt!=='number' || !isFinite(j.updatedAt))) throw new Error('bad updatedAt');
      return {kind, record:j};
    }
    if(kind==='trainer'){
      if(!isObj(j) || !Array.isArray(j.attempts)) throw new Error('no attempts array');
      return {kind, attempts:j.attempts.filter(a=>isObj(a) && typeof a.ts==='number')};
    }
    if(kind==='videos'){
      if(!isObj(j) || (j.videos!=null && !isObj(j.videos))) throw new Error('no videos object');
      return {kind, videos:j.videos||{}, deleted:Array.isArray(j.deleted)?j.deleted.filter(t=>isObj(t)&&t.id!=null):[]};
    }
    if(kind==='settings'){
      if(!isObj(j)) throw new Error('settings is not an object');
      const tomb=isObj(j.tombstones)?j.tombstones:{};
      return {kind, prefs:isObj(j.prefs)?j.prefs:{}, prefsMeta:isObj(j.prefsMeta)?j.prefsMeta:{},
        quizResetAt:typeof j.quizResetAt==='number'?j.quizResetAt:0,
        tombstones:{sessions:Array.isArray(tomb.sessions)?tomb.sessions.filter(isObj):[], songs:Array.isArray(tomb.songs)?tomb.songs.filter(isObj):[]}};
    }
    return null;
  }

  // ---------- PROGRESS.md: the coaching summary (generated, never parsed) ----------
  const LEVELS=[[1,'Low E string · naturals'],[2,'A string · naturals'],[3,'E + A strings · all 12 notes'],[4,'D + G strings · naturals'],
    [5,'D + G strings · all notes'],[6,'B + high e · all notes'],[7,'Whole neck · timed',true]];
  const STATUSES=['Learning','Polishing','Want','Can play'];
  // date helpers on local-calendar strings (YYYY-MM-DD), computed in UTC so they don't drift
  const dayMs=86400000;
  const toDay=(s)=>Date.parse(s.slice(0,10)+'T00:00:00Z');
  const fromDay=(ms)=>new Date(ms).toISOString().slice(0,10);
  const mondayOf=(s)=>{ const t=toDay(s); const dow=(new Date(t).getUTCDay()+6)%7; return fromDay(t-dow*dayMs); };

  function progressMd(data, opts){
    opts=opts||{};
    const today=opts.today; // YYYY-MM-DD, the syncing device's local date
    const sessions=(data.sessions||[]).filter(s=>validDate(s.date)).slice().sort((a,b)=>(b.date.localeCompare(a.date))||String(b.created||'').localeCompare(String(a.created||''))||(a.id<b.id?-1:1));
    const songs=(data.songs||[]).slice();
    const attempts=((data.quiz&&data.quiz.attempts)||[]).slice().sort((a,b)=>(+a.ts||0)-(+b.ts||0));
    const mins=(s)=>+s.minutes||0;
    const L=[];
    L.push('# Guitar progress — TJ','');
    L.push(`_Generated by Guitar Studio on ${today}${opts.device?` (${opts.device})`:''}. Regenerated on every sync that changes data; edit the files in \`sessions/\`, \`songs/\`, \`trainer/\` instead of this one._`,'');

    // --- practice summary
    const days=new Set(sessions.map(s=>s.date.slice(0,10)));
    let streak=0; { let t=toDay(today); if(!days.has(today)) t-=dayMs; while(days.has(fromDay(t))){ streak++; t-=dayMs; } }
    let longest=0; { const sorted=[...days].sort(); let run=0, prev=null; sorted.forEach(d=>{ run=(prev && toDay(d)-toDay(prev)===dayMs)?run+1:1; longest=Math.max(longest,run); prev=d; }); }
    const since=(n)=>fromDay(toDay(today)-(n-1)*dayMs);
    const inRange=(s,from)=>s.date.slice(0,10)>=from && s.date.slice(0,10)<=today;
    const sum=(arr)=>arr.reduce((a,s)=>a+mins(s),0);
    const last7=sessions.filter(s=>inRange(s,since(7))), last30=sessions.filter(s=>inRange(s,since(30)));
    const total=sum(sessions);
    const lastDate=sessions[0]&&sessions[0].date.slice(0,10);
    const gap=lastDate? Math.round((toDay(today)-toDay(lastDate))/dayMs) : null;
    L.push('## Snapshot','');
    L.push(`- **Practice streak:** ${streak} day${streak===1?'':'s'} (longest: ${longest})`);
    L.push(`- **Last practiced:** ${lastDate?`${longDate(lastDate)} (${gap===0?'today':gap===1?'yesterday':gap+' days ago'})`:'never'}`);
    L.push(`- **Last 7 days:** ${sum(last7)} min in ${last7.length} session${last7.length===1?'':'s'} · **Last 30 days:** ${sum(last30)} min, ${(n=>n+(n===1?' day':' days'))(new Set(last30.map(s=>s.date.slice(0,10))).size)} practised`);
    L.push(`- **All time:** ${sessions.length} session${sessions.length===1?'':'s'}, ${total>=120?(total/60).toFixed(1)+' h':total+' min'}${sessions.length?` (average ${Math.round(total/sessions.length)} min)`:''}`);
    const act=songs.filter(g=>g.status==='Learning'||g.status==='Polishing');
    L.push(`- **Songs:** ${songs.length} on the board — ${STATUSES.map(st=>`${songs.filter(g=>g.status===st).length} ${st.toLowerCase()}`).join(', ')}`);
    if(attempts.length){ const r=attempts.slice(-200); L.push(`- **Note trainer:** ${attempts.length} answers kept, last 200 at ${pct(r.filter(a=>a.ok).length,r.length)}% correct`); }
    L.push('');

    // --- weekly minutes (last 12 weeks, Monday start)
    L.push('## Weekly minutes (last 12 weeks)','','| Week of | Minutes | Sessions | Days |','|---|---:|---:|---:|');
    const thisMon=mondayOf(today);
    for(let i=11;i>=0;i--){
      const wk=fromDay(toDay(thisMon)-i*7*dayMs), end=fromDay(toDay(wk)+6*dayMs);
      const ss=sessions.filter(s=>s.date.slice(0,10)>=wk && s.date.slice(0,10)<=end);
      L.push(`| ${wk}${i===0?' (this week)':''} | ${sum(ss)} | ${ss.length} | ${new Set(ss.map(s=>s.date.slice(0,10))).size} |`);
    }
    L.push('');

    // --- focus mix (last 30 days)
    const focus={}; last30.forEach(s=>{ const c=(s.cats&&s.cats.length)?s.cats:['(no focus set)']; c.forEach(k=>{ focus[k]=(focus[k]||0)+mins(s)/c.length; }); });
    const fk=Object.keys(focus).sort((a,b)=>(focus[b]-focus[a])||a.localeCompare(b));
    if(fk.length){ L.push('## Focus mix (last 30 days)','',...fk.map(k=>`- ${oneLine(k)}: ${Math.round(focus[k])} min (${pct(focus[k],sum(last30))}%)`),''); }

    // --- recent sessions
    L.push('## Recent sessions','');
    if(!sessions.length) L.push('_No sessions logged yet._');
    else { L.push('| Date | Min | Focus | Song | Tempo | Feel | Notes |','|---|---:|---|---|---:|---|---|');
      sessions.slice(0,20).forEach(s=>L.push(`| ${s.date.slice(0,10)} | ${mins(s)} | ${cell((s.cats||[]).join(', '))} | ${cell(s.song||'')} | ${cell(s.tempo||'')} | ${cell(s.rating||'')} | ${cell(s.notes||'')} |`)); }
    L.push('');

    // --- song board
    L.push('## Song board','');
    const lastPlayed=(g)=>{ const t=(g.title||'').toLowerCase(); const s=t && sessions.find(x=>(x.song||'').toLowerCase()===t); return s?s.date.slice(0,10):null; };
    const countPlayed=(g)=>{ const t=(g.title||'').toLowerCase(); return t?sessions.filter(x=>(x.song||'').toLowerCase()===t):[]; };
    STATUSES.forEach(st=>{
      const list=songs.filter(g=>g.status===st).sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''))||(a.id<b.id?-1:1));
      L.push(`### ${st} (${list.length})`,'');
      if(!list.length){ L.push('_None._',''); return; }
      list.forEach(g=>{
        const played=countPlayed(g), lp=lastPlayed(g);
        const tempoLog=played.filter(x=>+x.tempo).slice(0,5).map(x=>`${x.date.slice(5,10)}: ${x.tempo}`).reverse();
        const bits=[g.key?`key ${oneLine(g.key)}`:'', tempoLine(g), lp?`last practised ${lp} (${played.length} session${played.length===1?'':'s'}, ${sum(played)} min)`:'not practised yet'].filter(Boolean);
        L.push(`- **${oneLine(g.title||'Untitled')}**${g.artist?' — '+oneLine(g.artist):''}: ${bits.join(' · ')}`);
        if(tempoLog.length>1) L.push(`  - Tempo trend: ${tempoLog.join(' → ')} bpm`);
        if(g.sections) L.push(`  - Sections: ${oneLine(g.sections)}`);
        if(g.notes) L.push(`  - Notes: ${oneLine(g.notes)}`);
      });
      L.push('');
    });
    const stale=act.filter(g=>{ const lp=lastPlayed(g); return !lp || (toDay(today)-toDay(lp))/dayMs>=14; });
    if(stale.length) L.push(`**Needs attention:** ${stale.map(g=>oneLine(g.title)).join(', ')} — learning/polishing but not practised in 14+ days.`,'');

    // --- trainer
    L.push('## Note trainer','');
    if(!attempts.length){ L.push('_No trainer answers yet._',''); }
    else {
      const lvl=LEVELS.map(([id,name,timed])=>{ const at=attempts.filter(a=>+a.lvl===id).slice(-20); const n=at.length; const acc=n?at.filter(a=>a.ok).length/n:0; const avg=n?at.reduce((x,a)=>x+(+a.ms||0),0)/n:0;
        return {id,name,n,acc,avg,passed:n>=20&&acc>=0.9&&avg<=(timed?3000:5000)}; });
      const next=lvl.find(l=>!l.passed);
      L.push(`- **Current level:** ${next?`L${next.id} · ${next.name} (not passed yet)`:'all 7 levels passed'} — a level passes at 90%+ over its last 20 answers and under 5 s each (3 s for L7).`);
      L.push('','| Level | Last answers | Accuracy | Avg time | Passed |','|---|---:|---:|---:|---|');
      lvl.forEach(l=>L.push(`| L${l.id} · ${l.name} | ${l.n}/20 | ${l.n?Math.round(l.acc*100)+'%':'—'} | ${l.n?secs(l.avg):'—'} | ${l.passed?'yes':'no'} |`));
      const st=trainerStats(attempts), recent=trainerStats(attempts.slice(-300));
      L.push('',`- **All kept answers:** ${st.n}, ${pct(st.ok,st.n)}% correct, average ${secs(st.avg)}. **Last 300:** ${pct(recent.ok,recent.n)}% correct, ${secs(recent.avg)}.`);
      const strs=Object.keys(st.byString).map(Number).sort((a,b)=>a-b).map(s=>`${STRING[s]||s} ${pct(st.byString[s].ok,st.byString[s].n)}%`);
      L.push(`- **By string:** ${strs.join(', ')}`);
      const weak=weakCells(st,4,10);
      if(weak.length){ L.push('','**Weak spots** (string × note, 4+ answers, worst first):','','| String | Note | Answers | Accuracy | Avg time |','|---|---|---:|---:|---:|');
        weak.forEach(w=>L.push(`| ${STRING[w.s]||w.s} | ${NOTE[w.pc]} | ${w.n} | ${Math.round(w.acc*100)}% | ${secs(w.avg)} |`)); }
      const seen=new Set(Object.keys(st.byCell)); const unseen=[];
      for(let s=0;s<6;s++) for(let pc=0;pc<12;pc++) if(!seen.has(s+':'+pc)) unseen.push(`${STRING[s].split(' (')[0]} ${NOTE[pc]}`);
      if(unseen.length) L.push('',`**Never asked yet (${unseen.length}/72):** ${unseen.length>24?unseen.slice(0,24).join(', ')+', …':unseen.join(', ')}`);
      L.push('');
    }

    // --- videos
    const vids=data.videos||{}; const vn=Object.keys(vids);
    L.push('## Practice videos','');
    if(!vn.length) L.push('_No video notes yet._','');
    else {
      const sorted=vn.slice().sort((a,b)=>String(vids[b].date||'').localeCompare(String(vids[a].date||''))||a.localeCompare(b));
      L.push(`- ${vn.length} video${vn.length===1?'':'s'} with notes, ${vn.filter(n=>!vids[n].reviewed).length} not reviewed yet. Latest: ${oneLine(vids[sorted[0]].date||'?')}.`);
      sorted.slice(0,5).forEach(n=>{ const v=vids[n]; L.push(`- ${oneLine(v.date||'')} ${cell(n)}${v.song?' ('+oneLine(v.song)+')':''}: ${v.reviewed?'reviewed':'not reviewed'}${v.notes?' — '+oneLine(v.notes):''}`); });
      L.push('');
    }
    L.push('## Where the data is','','- `sessions/` one file per practice session · `songs/` one per song · `trainer/` answers by month (UTC)',
      '- `video-notes.md` notes on practice videos · `settings.md` app settings',
      '- Each file ends with a `## Data` JSON block — that block is what the app syncs. When editing it by hand, keep it valid JSON and raise `updatedAt` (ms) so devices pick up the change.','');
    return L.join('\n');
  }

  const api={PATHS, PREFIX, pretty, extractJSON, frontmatter, slug, shortId, recordPath, trainerPath, monthKey, kindOf,
    sessionMd, songMd, trainerMd, trainerFiles, videosMd, settingsMd, parseFile, progressMd, validDate};
  root.MdFormat=api;
})(typeof window!=='undefined'?window:this);
