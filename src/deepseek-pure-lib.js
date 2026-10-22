// deepseek-pure helper library (LIB2 eval-based, unguarded closures)
// install: global.lib2 = (0,eval)("(" + "function(_G,pal){" + BODY + "; return L; }" + ")")(global, pal)
module.exports = {};
/* BODY follows */

(function(){
const WD=192;
const G=global; G.lib2 = G.lib2 || {};
const L=G.lib2;
L.mrows = async (num)=>{ if(!G.MAPC) G.MAPC={}; if(!G.MAPC[num]) G.MAPC[num]=await pal.readData('maps/'+num+'.json'); return G.MAPC[num].rows; };
L.bfs = async (mapNum,sx,sy,tx,ty,ban)=>{
  const rows=await L.mrows(mapNum), H=rows.length;
  let ok=(x,y)=> x>=0&&x<WD&&y>=0&&y<H&&rows[y]&&rows[y][x]==='.';
  if(!ok(tx,ty)||!ok(sx,sy)) return null;
  const N=WD*H, seen=new Uint8Array(N), prev=new Int32Array(N).fill(-1);
  const st=sy*WD+sx, tg=ty*WD+tx; seen[st]=1;
  const q=new Int32Array(N); let qh=0,qt=0; q[qt++]=st;
  let guard=0;
  while(qh<qt && guard++<N){
    const c=q[qh++];
    if(c===tg){ const path=[]; let k=tg; while(k>=0){ const x=k%WD,y=(k-x)/WD; path.push([x,y]); k=prev[k]; } path.reverse(); return path; }
    const cx=c%WD, cy=(c-cx)/WD;
    const nbs=[[cx,cy-1],[cx,cy+1],[cx-1,cy],[cx+1,cy]];
    for(let i=0;i<4;i++){ const nx=nbs[i][0], ny=nbs[i][1];
      if(!ok(nx,ny)) continue; const nk=ny*WD+nx; if(seen[nk]) continue;
      if(ban&&ban.has(nx+','+ny)) continue;
      seen[nk]=1; prev[nk]=c; q[qt++]=nk; }
  }
  return null;
};
L.dir=(a,b)=> b[0]===a[0] ? (b[1]<a[1]?'up':'down') : (b[0]<a[0]?'left':'right');
L.key=d=>({up:'Up',down:'Down',left:'Left',right:'Right'})[d];
L.blocked=()=>{ const s=new Set(); for(const o of (pal.world.objectList||[])) if(o.blocking) s.add(o.gx+','+o.gy); return s; };
L.bfsO = async (mapNum,sx,sy,tx,ty,ban)=>{
  const rows=await L.mrows(mapNum), H=rows.length;
  let ok=(x,y)=> x>=0&&x<WD&&y>=0&&y<H&&rows[y]&&rows[y][x]==='.';
  if(!ok(tx,ty)||!ok(sx,sy)) return null;
  const ob=L.blocked();
  const N=WD*H, seen=new Uint8Array(N), prev=new Int32Array(N).fill(-1);
  const st=sy*WD+sx, tg=ty*WD+tx; seen[st]=1;
  const q=new Int32Array(N); let qh=0,qt=0; q[qt++]=st;
  let guard=0;
  while(qh<qt && guard++<N){
    const c=q[qh++];
    if(c===tg){ const path=[]; let k=tg; while(k>=0){ const x=k%WD,y=(k-x)/WD; path.push([x,y]); k=prev[k]; } path.reverse(); return path; }
    const cx=c%WD, cy=(c-cx)/WD;
    const nbs=[[cx,cy-1],[cx,cy+1],[cx-1,cy],[cx+1,cy]];
    for(let i=0;i<4;i++){ const nx=nbs[i][0], ny=nbs[i][1];
      if(!ok(nx,ny)) continue; const nk=ny*WD+nx; if(seen[nk]) continue;
      if(ban&&ban.has(nx+','+ny)) continue;
      if(ob.has(nx+','+ny)&&!(nx===tx&&ny===ty)) continue;
      seen[nk]=1; prev[nk]=c; q[qt++]=nk; }
  }
  return null;
};
L.walk = async (tx,ty,opts)=>{
  opts=opts||{}; const scene0=pal.world.scene; const ban=new Set(opts.ban||[]);
  let moves=0, path=null;
  for(let g=0; g<(opts.maxIter||900); g++){
    await pal.observe();
    const w=pal.world;
    if(w.scene!==scene0) return {ok:false,stop:'scene',scene:w.scene,at:[w.gx,w.gy],moves};
    if(w.mode!=='control') return {ok:false,stop:'mode',mode:w.mode,at:[w.gx,w.gy],moves};
    if(w.gx===tx&&w.gy===ty) return {ok:true,stop:'arrived',at:[w.gx,w.gy],moves};
    let idx=-1;
    if(path){ for(let i=0;i<path.length;i++){ if(path[i][0]===w.gx&&path[i][1]===w.gy){ idx=i; break; } } }
    if(idx<0||idx>=path.length-1){ path=await L.bfsO(w.map,w.gx,w.gy,tx,ty,ban); if(!path||path.length<2) return {ok:false,stop:'nopath',at:[w.gx,w.gy],moves}; idx=0; }
    const nxt=path[idx+1];
    await pal.step(L.dir([w.gx,w.gy],nxt),1); moves++;
    await pal.observe();
    if(pal.world.gx===w.gx&&pal.world.gy===w.gy){ ban.add(nxt[0]+','+nxt[1]); path=null; }
  }
  return {ok:false,stop:'iters',at:[pal.world.gx,pal.world.gy],moves};
};
L.handleMode = async ()=>{ for(let i=0;i<80;i++){ await pal.observe(); const w=pal.world;
  if(w.mode==='control') return 'control';
  if(w.mode==='dialog'){ await pal.advance(15); continue; }
  if(w.mode==='battle'){ await L.fightT({max:120}); continue; }
  if(w.mode==='menu'){ await pal.press('Menu'); await pal.wait(250); continue; }
  await pal.wait(200); } return pal.world.mode; };
L.goTo = async (tx,ty,opts)=>{
  opts=opts||{}; const scene0=pal.world.scene;
  for(let r=0;r<(opts.rounds||25);r++){
    const res=await L.walk(tx,ty,opts);
    if(res.ok||res.stop==='scene'||res.stop==='nopath') return res;
    const m=await L.handleMode();
    if(pal.world.scene!==scene0) return {ok:false,stop:'scene',scene:pal.world.scene,at:[pal.world.gx,pal.world.gy]};
    if(m!=='control') return {ok:false,stop:'mode',mode:m};
  }
  return {ok:false,stop:'rounds'};
};
L.fightT = async (opts)=>{
  opts=opts||{}; const trace=[];
  for(let i=0;i<(opts.max||140);i++){
    await pal.observe();
    const w=pal.world;
    if(w.mode!=='battle'){
      if(w.mode==='dialog'){ await pal.advance(20); continue; }
      if(w.mode==='menu'){ await pal.choose(0); continue; }
      if(w.mode==='busy'){ await pal.wait(250); continue; }
      return {done:true,mode:w.mode,trace,res:w.lastBattleResult};
    }
    const b=w.battle||{}, pr=b.turn||{};
    const mi=pr.member!==undefined?pr.member:0;
    const mem=w.members[mi]||{};
    const en=(b.enemies||[]).filter(e=>e.hp>0);
    if(!en.length){ await pal.wait(200); continue; }
    const boss=en.slice().sort((a,c)=>(c.maxHp||c.hp)-(a.maxHp||a.hp))[0];
    const target=boss.index;
    const f=mem.maxHp?mem.hp/mem.maxHp:1;
    let type='attack', extra={target};
    if(mi===0){
      if(f<0.35&&mem.mp>=6){ type='magic'; extra={magic:'氣療術',target:0}; }
      else if(mem.mp>=10){ type='magic'; extra={magic:'御劍術',target}; }
    } else if(mi===1){
      let low=-1, worst=1;
      for(let k=0;k<w.members.length;k++){ const g=w.members[k].hp/w.members[k].maxHp; if(g<worst){worst=g;low=k;} }
      if(worst<0.35&&mem.mp>=10){ type='magic'; extra={magic:'觀音咒',target:low}; }
      else if(mem.mp>=8){ type='magic'; extra={magic:'炎咒',target}; }
    } else {
      if(f<0.35&&mem.mp>=18){ type='magic'; extra={magic:'凝神歸元',target:2}; }
      else if(mem.mp>=7){ type='magic'; extra={magic:'氣劍指',target}; }
    }
    let r=null;
    try{ r=await pal.battle(type,extra); }catch(e){ r={err:String(e.message||e)}; }
    const rp=(r&&r.reply&&r.reply.op)||'';
    if(rp==='SMSG_REJECT'||(r&&r.err)){ try{ await pal.battle('attack',{target}); }catch(e){} }
    await pal.wait(650);
    trace.push(mi+':'+type+':'+(extra.magic||'')+' hp'+w.members.map(m=>m.hp).join('/')+' e'+(b.enemies||[]).map(e=>e.hp).join('/'));
  }
  return {done:false,timeout:true,trace};
};
L.heal = async (thresh)=>{
  thresh=thresh===undefined?0.95:thresh; const log=[];
  const waitMenu=async(tr)=>{ for(let i=0;i<(tr||12);i++){ await pal.observe(); if(pal.world.mode==='menu'&&pal.world.menu) return pal.world.menu; await pal.wait(250);} return null; };
  await pal.observe();
  if(pal.world.mode!=='menu') await pal.press('Menu');
  let mn=await waitMenu(10);
  for(let g=0;g<10&&mn&&mn.kind!=='magic';g++){
    if(mn.kind==='list'){ const i=mn.items.findIndex(it=>String(it.label).includes('仙術')); await pal.choose(i>=0?i:0); }
    else if(mn.kind==='party') await pal.choose(0);
    else await pal.press('Menu');
    await pal.wait(400); mn=await waitMenu(10);
  }
  for(let k=0;k<30&&mn&&mn.kind==='magic';k++){
    await pal.observe();
    let idx=-1, worst=1;
    for(let i=0;i<pal.world.members.length;i++){ const f2=pal.world.members[i].hp/pal.world.members[i].maxHp; if(f2<worst){worst=f2;idx=i;} }
    if(idx<0||worst>=thresh){ log.push('full'); break; }
    const j=mn.items.findIndex(it=>String(it.label).includes('氣療術'));
    if(j<0||!mn.items[j].enabled){ log.push('nospell'); break; }
    await pal.choose(j); await pal.wait(450);
    const pm=await waitMenu(10);
    if(!pm||pm.kind!=='party'){ log.push('noparty'); break; }
    await pal.choose(idx); await pal.wait(1300);
    mn=await waitMenu(12); await pal.observe();
    log.push('c'+pal.world.members.map(m=>m.hp).join('/'));
  }
  for(let i=0;i<10;i++){ await pal.observe(); if(pal.world.mode==='control') break; if(pal.world.mode==='menu'){ await pal.press('Menu'); await pal.wait(300);} else await pal.wait(200); }
  return log;
};
})();

;(function(){const L=(global.lib2=global.lib2||{});async (tx,ty,opts)=>{
  opts=opts||{}; const scene0=pal.world.scene; let path=null; let moves=0;
  const ban=new Set(opts.ban||[]); const reject=new Map();
  const maxIter=opts.maxIter||2500;
  for(let g=0; g<maxIter; g++){if(++__lg>2000000)throw new Error("Infinite synchronous loop detected (>2M iterations; check BFS visited condition e.g. falsy 0)");
    await pal.observe(); const w=pal.world;
    if(w.scene!==scene0) return {ok:false,stop:'scene',scene:w.scene,at:[w.gx,w.gy],moves};
    if(w.mode!=='control'){
      if(w.mode==='dialog'){ await pal.advance(40); continue; }
      if(w.mode==='battle'){ await L.fightT({max:120}); continue; }
      if(w.mode==='menu'){ await pal.press('Menu'); await pal.wait(200); continue; }
      await pal.wait(150); continue;
    }
    if(w.gx===tx&&w.gy===ty) return {ok:true,stop:'arrived',at:[w.gx,w.gy],moves};
    let idx=-1;
    if(path){ for(let i=0;i<path.length;i++){if(++__lg>2000000)throw new Error("Infinite synchronous loop detected (>2M iterations; check BFS visited condition e.g. falsy 0)"); if(path[i][0]===w.gx&&path[i][1]===w.gy){ idx=i; break; } } }
    if(idx<0||idx>=path.length-1){ path=await L.bfs(w.map,w.gx,w.gy,tx,ty,ban); if(!path||path.length<2) return {ok:false,stop:'nopath',at:[w.gx,w.gy],moves}; idx=0; }
    const nxt=path[idx+1];
    const key=w.gx+','+w.gy+'->'+nxt[0]+','+nxt[1];
    await pal.step(L.dir([w.gx,w.gy],nxt),1); moves++;
    await pal.wait(80); await pal.observe();
    if(pal.world.gx===w.gx&&pal.world.gy===w.gy){
      // didn't move. If a mode started, loop handles it (retry next iter). Else count reject.
      if(pal.world.mode==='control'){
        const c=(reject.get(key)||0)+1; reject.set(key,c);
        if(c>=2){ ban.add(nxt[0]+','+nxt[1]); path=null; }
        else { await pal.wait(120); await pal.observe(); if(pal.world.mode!=='control'||(pal.world.gx===w.gx&&pal.world.gy===w.gy)){ /* retry */ } }
      }
    } else { reject.delete(key); }
  }
  return {ok:false,stop:'iters',at:[pal.world.gx,pal.world.gy],moves};
};global.walkB=L.walkB;})();

;(function(){const L=(global.lib2=global.lib2||{});async (tx,ty,opts)=>{
  opts=opts||{}; const scene0=pal.world.scene; let path=null; let moves=0;
  const learnWall=new Set(opts.ban||[]); // permanent walls (map rejections, non-touch obstacles, avoided warp cells)
  const avoid=new Set((opts.avoid||[]).map(a=>a[0]+','+a[1]));
  const bumpCount=new Map();
  const maxIter=opts.maxIter||3000;
  const blockedNonTouch=(w)=>{ const s=new Set(); for(const o of (w.objectList||[])){if(++__lg>2000000)throw new Error("Infinite synchronous loop detected (>2M iterations; check BFS visited condition e.g. falsy 0)"); if(o.blocking){ const tm=o.triggerMode==null?0:o.triggerMode; const isTouch = (o.kind==='touch-trigger')||tm===5; if(!isTouch) s.add(o.gx+','+o.gy); } } return s; };
  const blockedTouch=(w)=>{ const s=new Set(); for(const o of (w.objectList||[])){if(++__lg>2000000)throw new Error("Infinite synchronous loop detected (>2M iterations; check BFS visited condition e.g. falsy 0)"); if(o.blocking){ const tm=o.triggerMode==null?0:o.triggerMode; const isTouch=(o.kind==='touch-trigger')||tm===5; if(isTouch) s.add(o.gx+','+o.gy);} } return s; };
  for(let g=0; g<maxIter; g++){if(++__lg>2000000)throw new Error("Infinite synchronous loop detected (>2M iterations; check BFS visited condition e.g. falsy 0)");
    await pal.observe(); const w=pal.world;
    if(w.scene!==scene0) return {ok:false,stop:'scene',scene:w.scene,at:[w.gx,w.gy],moves};
    if(w.mode!=='control'){
      if(w.mode==='dialog'){ await pal.advance(40); continue; }
      if(w.mode==='battle'){ await L.fightT({max:120}); continue; }
      if(w.mode==='menu'){ await pal.press('Menu'); await pal.wait(180); continue; }
      await pal.wait(150); continue;
    }
    if(w.gx===tx&&w.gy===ty) return {ok:true,stop:'arrived',at:[w.gx,w.gy],moves};
    // recompute BFS ban = learned + nonTouchBlocked + avoid
    const bfsBan=new Set(learnWall);
    for(const k of blockedNonTouch(w)) bfsBan.add(k);
    for(const k of avoid) bfsBan.add(k);
    let idx=-1;
    if(path){ for(let i=0;i<path.length;i++){if(++__lg>2000000)throw new Error("Infinite synchronous loop detected (>2M iterations; check BFS visited condition e.g. falsy 0)"); if(path[i][0]===w.gx&&path[i][1]===w.gy){ idx=i; break; } } }
    if(idx<0||idx>=path.length-1){ path=await L.bfs(w.map,w.gx,w.gy,tx,ty,bfsBan); if(!path||path.length<2) return {ok:false,stop:'nopath',at:[w.gx,w.gy],moves}; idx=0; }
    const nxt=path[idx+1]; const nk=nxt[0]+','+nxt[1];
    const isBumpable = blockedTouch(w).has(nk);
    await pal.step(L.dir([w.gx,w.gy],nxt),1); moves++;
    await pal.wait(80); await pal.observe();
    if(pal.world.gx===w.gx&&pal.world.gy===w.gy){
      if(pal.world.mode==='control'){
        if(isBumpable){
          const c=(bumpCount.get(nk)||0)+1; bumpCount.set(nk,c);
          if(c>=4){ learnWall.add(nk); path=null; } // give up bumping, treat as wall
        } else { learnWall.add(nk); path=null; }
      }
    }
  }
  return {ok:false,stop:'iters',at:[pal.world.gx,pal.world.gy],moves};
};global.walkB2=L.walkB2;})();
