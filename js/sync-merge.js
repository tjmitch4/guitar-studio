// Pure merge logic for cross-device sync. No DOM, no network, no localStorage.
// Works in the browser (window.SyncMerge) and is loaded by tests/merge-test.html.
//
// Data model (all additive to the original guitarStudio.v1 shape):
//   sessions[] / songs[]   records with a stable `id` and `updatedAt` (ms). Missing updatedAt -> 0.
//   videos{name: note}     video notes keyed by file name (the name is the id); each note has `updatedAt`.
//   deleted{sessions[], songs[], videos[]}   tombstones {id, deleted:true, updatedAt}; never shown in the UI.
//   quiz{attempts[], resetAt}   trainer answers: append-only union by id; `resetAt` hides older answers.
//   prefs{} + prefsMeta{key: ms}   per-field last-write-wins.
//
// Merge rule for records: union by id; the higher updatedAt wins. Ties: a tombstone beats a live record,
// then the larger canonical JSON wins (so both devices always pick the same one).
(function(root){
  'use strict';
  const COLLECTIONS=['sessions','songs'];         // arrays of records
  const MAP_COLLECTIONS=['videos'];               // objects keyed by id
  const ATTEMPT_CAP=4000;

  const isObj=(v)=>v!=null && typeof v==='object' && !Array.isArray(v);
  const clone=(v)=>v===undefined?undefined:JSON.parse(JSON.stringify(v));

  // JSON with sorted object keys: identical content -> identical string on every device.
  function stable(v){
    if(Array.isArray(v)) return '['+v.map(x=>x===undefined?'null':stable(x)).join(',')+']';
    if(isObj(v)) return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
    return JSON.stringify(v===undefined?null:v);
  }
  // cyrb53: small, fast, good-enough 53-bit string hash -> base36.
  function hash(str){
    let h1=0xdeadbeef, h2=0x41c6ce57;
    for(let i=0;i<str.length;i++){ const ch=str.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677); }
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (4294967296*(2097151&h2)+(h1>>>0)).toString(36);
  }
  // Deterministic id for a record that has none: the same record on two devices gets the same id.
  function contentId(rec, prefix){
    const r=Object.assign({},rec); delete r.id; delete r.updatedAt;
    return (prefix||'h')+hash(stable(r));
  }
  function attemptId(a){ return 'q'+hash([a.ts,a.s,a.f,a.pc,a.ok?1:0,a.ms,a.mode||'',a.lvl||0].join('|')); }
  const ts=(r)=>{ const n=+(r&&r.updatedAt); return isFinite(n)&&n>0?n:0; };

  // The newer of two versions of the same record (commutative and deterministic).
  function winner(a,b){
    if(!a) return b; if(!b) return a;
    const ta=ts(a), tb=ts(b);
    if(ta!==tb) return ta>tb?a:b;
    const da=!!a.deleted, db=!!b.deleted;
    if(da!==db) return da?a:b;
    const sa=stable(a), sb=stable(b);
    return sa>=sb?a:b;
  }

  // Bring any version of the data up to the sync shape. Mutates and returns `d`. Additive only.
  function normalize(d){
    if(!isObj(d)) d={};
    COLLECTIONS.forEach(c=>{
      if(!Array.isArray(d[c])) d[c]=[];
      const seen=new Set();
      d[c]=d[c].filter(isObj).map(r=>{
        if(r.id==null || r.id==='') { r.id=contentId(r); }
        r.id=String(r.id);
        // two identical id-less records: keep both, deterministically
        if(seen.has(r.id)){ let n=2; while(seen.has(r.id+'-'+n)) n++; r.id=r.id+'-'+n; }
        seen.add(r.id);
        if(typeof r.updatedAt!=='number' || !isFinite(r.updatedAt)) r.updatedAt=0;
        return r;
      });
    });
    MAP_COLLECTIONS.forEach(c=>{
      if(d[c]==null) return;
      if(!isObj(d[c])){ d[c]={}; return; }
      Object.keys(d[c]).forEach(k=>{ const v=d[c][k]; if(!isObj(v)){ delete d[c][k]; return; } if(typeof v.updatedAt!=='number'||!isFinite(v.updatedAt)) v.updatedAt=0; });
    });
    if(!isObj(d.deleted)) d.deleted={};
    COLLECTIONS.concat(MAP_COLLECTIONS).forEach(c=>{
      const arr=Array.isArray(d.deleted[c])?d.deleted[c]:[];
      const byId=new Map();
      arr.forEach(t=>{ if(isObj(t) && t.id!=null){ const x={id:String(t.id),deleted:true,updatedAt:ts(t)}; byId.set(x.id,winner(byId.get(x.id),x)); } });
      d.deleted[c]=[...byId.values()];
    });
    if(d.quiz!=null){
      if(!isObj(d.quiz)||!Array.isArray(d.quiz.attempts)) d.quiz={attempts:[]};
      d.quiz.attempts=d.quiz.attempts.filter(isObj);
      d.quiz.attempts.forEach(a=>{ if(!a.id) a.id=attemptId(a); });
      if(typeof d.quiz.resetAt!=='number') delete d.quiz.resetAt;
    }
    if(!isObj(d.prefs)) d.prefs={};
    if(!isObj(d.prefsMeta)) d.prefsMeta={};
    return d;
  }

  // Resolve one collection. `live` is an array of records, `dead` an array of tombstones.
  function mergeRecords(liveA, deadA, liveB, deadB, tiePreferA){
    const pick=(a,b)=>{ if(tiePreferA && a && b && ts(a)===ts(b)) return a; return winner(a,b); };
    const side=(live,dead)=>{ const m=new Map(); dead.forEach(t=>m.set(t.id,winner(m.get(t.id),t))); live.forEach(r=>m.set(r.id,winner(m.get(r.id),r))); return m; };
    const A=side(liveA,deadA), B=side(liveB,deadB);
    // Order: B's order first (B is the cloud copy during sync, so every device converges on one order), then A-only.
    const ids=[]; const seen=new Set();
    liveB.concat(deadB).forEach(r=>{ if(!seen.has(r.id)){ seen.add(r.id); ids.push(r.id); } });
    liveA.concat(deadA).forEach(r=>{ if(!seen.has(r.id)){ seen.add(r.id); ids.push(r.id); } });
    const live=[], dead=[];
    ids.forEach(id=>{ const w=pick(A.get(id),B.get(id)); if(w.deleted) dead.push({id,deleted:true,updatedAt:ts(w)}); else live.push(clone(w)); });
    return {live, dead};
  }

  function mergeQuiz(qa, qb){
    if(qa==null && qb==null) return undefined;
    qa=qa||{attempts:[]}; qb=qb||{attempts:[]};
    const resetAt=Math.max(+qa.resetAt||0, +qb.resetAt||0);
    const m=new Map();
    qa.attempts.concat(qb.attempts).forEach(a=>{ if(!m.has(a.id)) m.set(a.id,a); });
    let attempts=[...m.values()].filter(a=>!(resetAt && (+a.ts||0)<=resetAt)).map(clone);
    attempts.sort((x,y)=>((+x.ts||0)-(+y.ts||0)) || (x.id<y.id?-1:x.id>y.id?1:0));
    if(attempts.length>ATTEMPT_CAP) attempts=attempts.slice(-ATTEMPT_CAP);
    const q={attempts}; if(resetAt) q.resetAt=resetAt;
    return q;
  }

  function mergePrefs(a, am, b, bm, tiePreferA){
    const prefs={}, meta={};
    const keys=new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach(k=>{
      const inA=k in a, inB=k in b; const ta=+am[k]||0, tb=+bm[k]||0;
      let useA;
      if(inA && !inB) useA=true; else if(inB && !inA) useA=false;
      else if(ta!==tb) useA=ta>tb;
      else if(tiePreferA) useA=true;
      else useA=stable(a[k])>=stable(b[k]);
      prefs[k]=clone(useA?a[k]:b[k]);
      const t=Math.max(ta,tb); if(t) meta[k]=t;
    });
    return {prefs, meta};
  }

  // merge(local, remote) -> new merged object. Inputs are not modified.
  // opts.tiePrefer='local': on an exact timestamp tie keep the local version (used by "Import JSON").
  function merge(local, remote, opts){
    opts=opts||{};
    const A=normalize(clone(local)||{}), B=normalize(clone(remote)||{});
    const tieA=opts.tiePrefer==='local';
    // unknown top-level fields: keep local, fill gaps from remote
    const out=Object.assign({}, B, A);
    out.deleted={};
    COLLECTIONS.forEach(c=>{ const r=mergeRecords(A[c],A.deleted[c],B[c],B.deleted[c],tieA); out[c]=r.live; out.deleted[c]=r.dead; });
    MAP_COLLECTIONS.forEach(c=>{
      const toArr=(o)=>Object.keys(o||{}).map(k=>Object.assign({},o[k],{id:k}));
      if(A[c]==null && B[c]==null && !A.deleted[c].length && !B.deleted[c].length){ delete out[c]; out.deleted[c]=[]; return; }
      const r=mergeRecords(toArr(A[c]),A.deleted[c],toArr(B[c]),B.deleted[c],tieA);
      const obj={}; r.live.forEach(x=>{ const id=x.id; delete x.id; obj[id]=x; });
      out[c]=obj; out.deleted[c]=r.dead;
    });
    const q=mergeQuiz(A.quiz,B.quiz); if(q) out.quiz=q; else delete out.quiz;
    const p=mergePrefs(A.prefs,A.prefsMeta,B.prefs,B.prefsMeta,tieA); out.prefs=p.prefs; out.prefsMeta=p.meta;
    out.version=Math.max(+A.version||1, +B.version||1);
    return out;
  }

  // Same content regardless of array order (used to decide whether anything needs saving/uploading).
  function canonical(d){
    const x=normalize(clone(d)||{});
    const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
    COLLECTIONS.forEach(c=>x[c].sort(byId));
    Object.keys(x.deleted).forEach(c=>x.deleted[c].sort(byId));
    if(x.quiz) x.quiz.attempts.sort((p,q)=>((+p.ts||0)-(+q.ts||0))||byId(p,q));
    return stable(x);
  }
  const equal=(a,b)=>canonical(a)===canonical(b);

  const api={merge, normalize, equal, canonical, winner, contentId, attemptId, stable, hash, ATTEMPT_CAP};
  root.SyncMerge=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof window!=='undefined'?window:this);
