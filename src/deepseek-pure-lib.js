// deepseek-pure-lib.js — auto-generated helper library
global.settleAll = async function(){
  for(let i=0;i<12;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    await pal.observe();
    const m=pal.world.mode;
    if(m==='dialog'){ await pal.advance(20); continue; }
    if(m==='menu'){ await pal.press('Menu'); continue; }
    if(m==='busy'){ await pal.wait(400); continue; }
    if(m==='battle'){ await pal.battle('auto'); continue; }
    break;
  }
  await pal.observe();
  return pal.world.mode;
};

global.getRows = async function(mapNum){
  if(global.MAPROWS[mapNum]) return global.MAPROWS[mapNum];
  const m = await pal.readData('maps/'+mapNum+'.json');
  global.MAPROWS[mapNum]=m.rows;
  return m.rows;
};

global.bfsP = function(rows, start, isTarget, blk){
  const k=(x,y)=>x+','+y;
  const prev=new Map([[k(...start),null]]); const q=[start]; let qi=0; let goal=null;
  while(qi<q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=q[qi++];
    if(isTarget(x,y)){ goal=[x,y]; break; }
    for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const nx=x+dx, ny=y+dy, kk=k(nx,ny);
      if((rows[ny]||'')[nx]!=='.'||prev.has(kk)||blk.has(kk)) continue;
      prev.set(kk,k(x,y)); q.push([nx,ny]);
    }
  }
  if(!goal) return null;
  const path=[]; let c=k(...goal);
  while(c){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const [a,b]=c.split(',').map(Number); path.push([a,b]); c=prev.get(c); }
  return path.reverse();
};

global.walkPathLog = async function(path, opt={}){
  const sc0 = pal.world.scene;
  const trace=[]; let blocked=0;
  for(let i=1;i<path.length;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [cx,cy]=path[i];
    const dx = cx - pal.world.player.gx, dy = cy - pal.world.player.gy;
    const dir = dy===-1?'up':dy===1?'down':dx===-1?'left':dx===1?'right':null;
    if(!dir) return {err:'offpath', at:[pal.world.player.gx,pal.world.player.gy], i, want:[cx,cy], trace};
    const r = await global.step1(dir);
    trace.push([r.scene,r.at[0],r.at[1],r.mode]);
    if(r.scene!==sc0) return {moved:true, scene:r.scene, at:r.at, i, trace};
    if(r.mode!=='control') return {mode:r.mode, scene:r.scene, at:r.at, i, trace};
    if(!r.moved){ blocked++; if(blocked>2) return {err:'stuck', at:r.at, i, trace}; }
    else blocked=0;
  }
  return {done:true, scene:pal.world.scene, at:[pal.world.player.gx,pal.world.player.gy], trace};
};

global.goObjA = async function(id){
  await global.settleAll();
  const w=pal.world;
  const o=(w.objectList||[]).find(o=>o.id===id) || global.EOIDX[id];
  if(!o) return {err:'noobj'};
  const mn=(global.SC_NAME[w.scene]||{}).mapNum||w.map;
  const rows=await global.getRows(mn);
  const blk=new Set();
  for(const q of (w.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(q.kind==='touch-trigger' && q.id!==id) for(const [x,y] of global.trigZone(q)) blk.add(x+','+y);
    if(q.blocking) blk.add(q.gx+','+q.gy);
  }
  const adj=[[o.gx,o.gy-1],[o.gx,o.gy+1],[o.gx-1,o.gy],[o.gx+1,o.gy]].filter(([x,y])=>(rows[y]||'')[x]==='.');
  const tset=new Set(adj.map(a=>a.join(',')));
  if((rows[o.gy]||'')[o.gx]==='.') tset.add(o.gx+','+o.gy);
  let p = global.bfsP(rows,[w.player.gx,w.player.gy],(x,y)=>tset.has(x+','+y),blk);
  if(!p) return {err:'nopath', to:[o.gx,o.gy]};
  if(!(p.length===1 && p[0][0]===o.gx && p[0][1]===o.gy)){
    const r0 = await global.walkPathLog(p);
    if(r0.scene!==w.scene || r0.mode!=='control'){ await global.settleAll(); return {phase:'walk', ...r0, now:[pal.world.scene,pal.world.gx,pal.world.gy]}; }
  }
  // step into object
  await pal.observe();
  const dx=o.gx-pal.world.gx, dy=o.gy-pal.world.gy;
  const dir = dy<0?'up':dy>0?'down':dx<0?'left':dx>0?'right':null;
  if(!dir) return {err:'notadj', at:[pal.world.gx,pal.world.gy]};
  await pal.step(dir,1);
  await global.settleAll();
  return {phase:'step', now:{scene:pal.world.scene,pos:[pal.world.gx,pal.world.gy],mode:pal.world.mode}};
};

global.avWalkBox = async function(tx,ty,opt={}){
  const W0=pal.world; const sc0=W0.scene;
  const rows=await global.getRows(W0.map);
  const blk=new Set(); const allow=new Set(opt.allow||[]);
  for(const q of (W0.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(allow.has(q.id)) continue;
    if(q.kind==='touch-trigger'){ for(const [x,y] of global.box2(q.gx,q.gy)) blk.add(x+','+y); }
    else if(q.blocking) blk.add(q.gx+','+q.gy);
  }
  const isW=(x,y)=>((rows[y]||'')[x]==='.')&&!blk.has(x+','+y);
  const sx=W0.gx,sy=W0.gy;
  if(!isW(tx,ty)) return {err:'target blocked'};
  const prev=new Map(); const seen=new Set([sx+','+sy]); const qq=[[sx,sy]]; let found=false;
  while(qq.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");const [x,y]=qq.shift(); if(x===tx&&y===ty){found=true;break;}
    for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");const nx=x+dx,ny=y+dy,kk=nx+','+ny;if(seen.has(kk))continue;if(!isW(nx,ny))continue;seen.add(kk);prev.set(kk,x+','+y);qq.push([nx,ny]);}}
  if(!found) return {err:'nopath'};
  const path=[]; let k=tx+','+ty; while(k){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");path.push(k.split(',').map(Number)); k=prev.get(k);} path.reverse();
  for(let i=1;i<path.length;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=path[i];
    const dx=x-pal.world.gx, dy=y-pal.world.gy;
    if(Math.abs(dx)+Math.abs(dy)!==1) return {err:'lost',at:[pal.world.gx,pal.world.gy],i};
    const dir= dx===1?'right':dx===-1?'left':dy===1?'down':'up';
    await pal.step(dir,1);
    if(pal.world.scene!==sc0) return {scene:pal.world.scene,at:[pal.world.gx,pal.world.gy],i};
    if(pal.world.mode!=='control'){ await global.settleAll(); if(pal.world.scene!==sc0) return {scene:pal.world.scene,at:[pal.world.gx,pal.world.gy],i}; }
  }
  return {arrived:true,at:[pal.world.gx,pal.world.gy],len:path.length};
};

global.box2 = (x,y)=>[[x-1,y-1],[x,y-1],[x-1,y],[x,y]];

global.trigZone = function(eo){
  const x=eo.gx, y=eo.gy, out=[];
  for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) out.push([x+dx,y+dy]);
  return out;
};

global.goObjB = async function(id, boxFn){
  await global.settleAll();
  const w=pal.world;
  const o=(w.objectList||[]).find(o=>o.id===id) || global.EOIDX[id];
  if(!o) return {err:'noobj'};
  const mn=(global.SC_NAME[w.scene]||{}).mapNum||w.map;
  const rows=await global.getRows(mn);
  const blk=new Set();
  for(const q of (w.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(q.kind==='touch-trigger' && q.id!==id) for(const [x,y] of (boxFn||global.box2)(q.gx,q.gy)) blk.add(x+','+y);
    if(q.blocking) blk.add(q.gx+','+q.gy);
  }
  const adj=[[o.gx,o.gy-1],[o.gx,o.gy+1],[o.gx-1,o.gy],[o.gx+1,o.gy]].filter(([x,y])=>(rows[y]||'')[x]==='.');
  const tset=new Set(adj.map(a=>a.join(',')));
  if((rows[o.gy]||'')[o.gx]==='.') tset.add(o.gx+','+o.gy);
  let p = global.bfsP(rows,[w.player.gx,w.player.gy],(x,y)=>tset.has(x+','+y),blk);
  if(!p) return {err:'nopath'};
  const r0 = await global.walkPathLog(p);
  if(r0.scene!==w.scene || r0.mode!=='control'){ await global.settleAll(); return {phase:'walk', ...r0, now:[pal.world.scene,pal.world.gx,pal.world.gy]}; }
  await pal.observe();
  const dx=o.gx-pal.world.gx, dy=o.gy-pal.world.gy;
  const dir = dy<0?'up':dy>0?'down':dx<0?'left':dx>0?'right':null;
  if(!dir) return {err:'notadj'};
  await pal.step(dir,1); await global.settleAll();
  return {phase:'step', now:{scene:pal.world.scene,pos:[pal.world.gx,pal.world.gy]}};
};

global.goObj = async function(id){
  await global.settleAll();
  const w=pal.world;
  const o=(w.objectList||[]).find(o=>o.id===id) || global.EOIDX[id];
  if(!o) return {err:'noobj '+id};
  const mn = (global.SC_NAME[w.scene]||{}).mapNum || w.map;
  const rows = await global.getRows(mn);
  const blk=new Set();
  for(const q of (w.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(q.kind==='touch-trigger' && q.id!==id) for(const [x,y] of global.trigZone(q)) blk.add(x+','+y);
    if(q.blocking) blk.add(q.gx+','+q.gy);
  }
  const p = global.bfsP(rows,[w.player.gx,w.player.gy],(x,y)=>x===o.gx&&y===o.gy,blk);
  if(!p) return {err:'nopath', to:[o.gx,o.gy], scene:w.scene};
  const r = await global.walkPathLog(p);
  await global.settleAll();
  return {len:p.length, ...r, now:{scene:pal.world.scene, pos:[pal.world.gx,pal.world.gy], mode:pal.world.mode}};
};

global.travel = async function(steps){
  const log=[];
  for(const [id,exp] of steps){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const r = await global.goObjA(id);
    await global.settleAll();
    log.push({id, exp, res:(r&&r.err)?r:undefined, scene:pal.world.scene, pos:[pal.world.gx,pal.world.gy], mode:pal.world.mode});
    if(r && r.err) { log.push("ERR at "+id); break; }
    if(pal.world.scene!==exp) log.push("WARN expected "+exp);
  }
  return log;
};

global.fightSmart = async (opts={})=>{
  const max=opts.max||300; let n=0; const log=[];
  while(n<max){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const w=pal.world;
    if(w.mode==='battle'){ await global.oneBattleAction(log); n++; await pal.wait(70); }
    else if(w.mode==='dialog'){ await pal.advance(40); }
    else if(w.mode==='busy'){ await pal.wait(180); }
    else if(w.mode==='menu'){ await pal.press('Menu'); await pal.wait(150); }
    else return {result:(w.lastBattleResult&&JSON.stringify(w.lastBattleResult))||'ended', turns:n, log:log.slice(-12)};
  }
  return {result:'maxturns', turns:n, log:log.slice(-12)};
};

global.heal = async (frac=0.9)=>{
  // use healing items out of battle: 止血草(heal), 行軍丹 etc. Simple: use 止血草 on lowest hp member
  return;
};

// SC_NAME is data

// EOIDX is data

global.castSpellOut = async function(h, spellName, tgtIdx){
  const m = await global.openMagic(h);
  if(!m) return false;
  const spi = pal.world.menu.items.findIndex(x=>x.label.startsWith(spellName) && x.enabled);
  if(spi<0){ await global.closeAllMenus(); return false; }
  if(!(await global.menuSeek(spi))) { await global.closeAllMenus(); return false; }
  await pal.press('Search'); await pal.observe();
  if(pal.world.menu && pal.world.menu.kind==='party'){
    // 2-column layout: 0,1 / 2
    if(tgtIdx===1) { await pal.press('Right'); await pal.observe(); }
    else if(tgtIdx===2) { await pal.press('Down'); await pal.observe(); }
    await pal.press('Search'); await pal.wait(350);
  }
  await global.closeAllMenus();
  return true;
};

global.bossAI5 = async function(opt={}){
  const w=pal.world, b=w.battle;
  if(!b||!b.turn) return null;
  const mi=b.turn.member;
  const en=(b.enemies||[]).filter(e=>e.hp>0);
  if(!en.length) return null;
  const boss=en.slice().sort((a,c)=>((c.maxHp||0)-(a.maxHp||0)))[0];
  const target=boss.index;
  const ms=w.members, mem=ms[mi], mp=mem.mp||0;
  const alive=ms.filter(m=>m.hp>0);
  let low=-1, worst=2;
  for(let k=0;k<ms.length;k++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); if(ms[k].hp<=0) continue; const g=ms[k].hp/ms[k].maxHp; if(g<worst){worst=g;low=k;} }
  const deadIdx=ms.findIndex(m=>m.hp<=0);
  const hurtCount=ms.filter(m=>m.hp>0 && m.hp<m.maxHp*0.6).length;
  const hasSoup = w.items.some(i=>i.name==='孟婆湯');
  const hasMPitem = w.items.some(i=>i.name==='龍涎草');
  let type='attack', extra={target};
  if(mi===0){
    if(deadIdx===2 && hasSoup){ type='item'; extra={item:'孟婆湯', target:2}; }
    else if(worst<0.35 && mp>=18){ type='magic'; extra={magic:'凝神歸元', target:low}; }
    else if(mp>=18){ type='magic'; extra={magic:'天師符法', target}; }
    else type='attack';
  } else if(mi===1){
    if(deadIdx===2 && mp>=16){ type='magic'; extra={magic:'還魂咒', target:2}; }
    else if(hurtCount>=2 && mp>=40){ type='magic'; extra={magic:'五氣朝元', target:1}; }
    else if(mp>=12){ type='magic'; extra={magic:'玄冰咒', target}; }
    else if(mp<12 && hasMPitem){ type='item'; extra={item:'龍涎草', target:1}; }
    else if(mp>=5){ type='magic'; extra={magic:'冰咒', target}; }
    else type='attack';
  } else {
    if(mem.hp/mem.maxHp<0.3 && mp>=18){ type='magic'; extra={magic:'凝神歸元', target:2}; }
    else if(deadIdx===0 && hasSoup){ type='item'; extra={item:'孟婆湯', target:0}; }
    else if(deadIdx===1 && hasSoup){ type='item'; extra={item:'孟婆湯', target:1}; }
    else if(w.cash>=250){ type='magic'; extra={magic:'銅錢鏢', target}; }
    else if(mp>=18){ type='magic'; extra={magic:'一陽指', target}; }
    else type='attack';
  }
  let note='';
  try{ note=(await pal.battle(type, extra))?.reply?.note || ''; }catch(e){ note='ERR '+e.message; }
  if(/is .*'s spell/.test(note)){ try{ await pal.battle('attack',{target}); note='fallback'; }catch(e){} }
  return `${mi}:${extra.magic||extra.item||type}`;
};

global.avWalk = async function(tx,ty,opt={}){
  const W0 = pal.world; const sc0=W0.scene;
  const rows = await global.getRows(W0.map);
  const blk = new Set();
  const allow = new Set(opt.allow||[]);
  const pad = opt.pad===undefined?1:opt.pad;
  for(const q of (W0.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(allow.has(q.id)) continue;
    if(q.kind==='touch-trigger'){
      for(let dx=-pad;dx<=pad;dx++)for(let dy=-pad;dy<=pad;dy++) blk.add((q.gx+dx)+','+(q.gy+dy));
    } else if(q.blocking) blk.add(q.gx+','+q.gy);
  }
  const isW=(x,y)=>((rows[y]||'')[x]==='.') && !blk.has(x+','+y);
  const sx=W0.gx, sy=W0.gy;
  if(!isW(tx,ty)) return {err:'target blocked',t:[tx,ty]};
  const prev=new Map(); const seen=new Set([sx+','+sy]); const qq=[[sx,sy]];
  let found=false;
  while(qq.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");const [x,y]=qq.shift(); if(x===tx&&y===ty){found=true;break;}
    for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");const nx=x+dx,ny=y+dy;const kk=nx+','+ny;if(seen.has(kk))continue;if(!isW(nx,ny))continue;seen.add(kk);prev.set(kk,x+','+y);qq.push([nx,ny]);}}
  if(!found) return {err:'nopath',t:[tx,ty]};
  const path=[]; let k=tx+','+ty; while(k){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");path.push(k.split(',').map(Number)); k=prev.get(k);} path.reverse();
  for(let i=1;i<path.length;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=path[i];
    const dx=x-pal.world.gx, dy=y-pal.world.gy;
    if(Math.abs(dx)+Math.abs(dy)!==1) return {err:'lost',at:[pal.world.gx,pal.world.gy],i};
    const dir= dx===1?'right':dx===-1?'left':dy===1?'down':'up';
    await pal.step(dir,1);
    if(pal.world.scene!==sc0) return {scene:pal.world.scene,at:[pal.world.gx,pal.world.gy],i};
    if(pal.world.mode!=='control'){ await global.settleAll(); if(pal.world.scene!==sc0) return {scene:pal.world.scene,at:[pal.world.gx,pal.world.gy],i}; }
  }
  return {arrived:true,at:[pal.world.gx,pal.world.gy],len:path.length};
};

// SCGRAPH is data

global.sceneRoute = function(from,to){
  if(from===to) return [];
  const seen=new Set([from]); const q=[[from,[]]];
  while(q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [s,path]=q.shift();
    for(const ed of (g.get(s)||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      if(seen.has(ed.dest)) continue;
      const np=[...path,{from:s,id:ed.id,pos:ed.pos,dest:ed.dest,mode:ed.mode,state:ed.state}];
      if(ed.dest===to) return np;
      seen.add(ed.dest); q.push([ed.dest,np]);
    }
  }
  return null;
};

// deepseek-pure-lib.js — auto-generated helper library (compact snapshot)
if(typeof global.getRows!=='function'){ global.getRows = async function(mapNum){
  if(global.MAPROWS[mapNum]) return global.MAPROWS[mapNum];
  const m = await pal.readData('maps/'+mapNum+'.json');
  global.MAPROWS[mapNum]=m.rows;
  return m.rows;
}; }
if(typeof global.loadMap!=='function'){ global.loadMap = async (n)=>{ if(!global.maps[n]) global.maps[n]=await pal.readData(`maps/${n}.json`); return global.maps[n]; }; }
if(typeof global.isWalk!=='function'){ global.isWalk = (map,x,y)=>{
  const ov = global.wallOv[map+':'+x+','+y];
  if(ov!==undefined) return ov;
  const rows=global.maps[map]?.rows; if(!rows) return false;
  if(y<0||y>=rows.length) return false;
  const row=rows[y]; if(!row||x<0||x>=row.length) return false;
  return row[x]==='.';
}; }
if(typeof global.settle2!=='function'){ global.settle2 = async ()=>{
  for(let i=0;i<12;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const w=pal.world, m=w.mode;
    if(m==='control') return true;
    if(m==='dialog'){ await pal.advance(60); continue; }
    if(m==='battle'){ await global.fightSmart({max:400}); continue; }
    if(m==='busy'){ await pal.wait(250); continue; }
    if(m==='menu'){ await pal.press('Menu'); await pal.wait(150); continue; }
    await pal.wait(150);
  }
  return pal.world.mode==='control';
}; }
if(typeof global.settleAll!=='function'){ global.settleAll = async function(){
  for(let i=0;i<12;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    await pal.observe();
    const m=pal.world.mode;
    if(m==='dialog'){ await pal.advance(20); continue; }
    if(m==='menu'){ await pal.press('Menu'); continue; }
    if(m==='busy'){ await pal.wait(400); continue; }
    if(m==='battle'){ await pal.battle('auto'); continue; }
    break;
  }
  await pal.observe();
  return pal.world.mode;
}; }
if(typeof global.walkB!=='function'){ global.walkB = async (tx,ty,opts={})=>{
  const maxIter=opts.maxIter||3000;
  const scene0=pal.world.scene;
  const dbg=[];
  for(let it=0; it<maxIter; it++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(!await global.settle2()) return {stop:'mode',mode:pal.world.mode,dbg};
    const w=pal.world;
    if(w.scene!==scene0) return {stop:'scene',scene:w.scene,x:w.player.gx,y:w.player.gy,dbg};
    const cx=w.player.gx, cy=w.player.gy;
    if(cx===tx&&cy===ty) return {stop:'arrived',iter:it,dbg};
    const map=w.map;
    if(!global.maps[map]) await global.loadMap(map);
    const R=global.maps[map].rows;
    const goal=tx+','+ty, startKey=cx+','+cy;
    const warps=new Set(global.warpCells()); warps.delete(goal);
    const blkObj=new Set(); for(const o of w.objectList) if(o.blocking) blkObj.add(o.gx+','+o.gy);
    const path=(avoidObj)=>{
      const blocked=new Set(warps);
      if(avoidObj) for(const c of blkObj) blocked.add(c);
      const prev={}; const q=[[cx,cy]]; let head=0; const sn=new Set([startKey]);
      while(head<q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
        const cell=q[head++]; const x=cell[0], y=cell[1];
        if(x===tx&&y===ty){ const p=[]; let cur=goal; while(cur&&cur!==startKey){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");const pp=cur.split(',');p.push([+pp[0],+pp[1]]);cur=prev[cur];} return p.reverse(); }
        for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
          const nx=x+dx,ny=y+dy,k=nx+','+ny;
          if(sn.has(k))continue;
          if(!(R[ny]&&R[ny][nx]==='.'))continue;
          if(blocked.has(k)&&k!==goal)continue;
          sn.add(k);prev[k]=x+','+y;q.push([nx,ny]);
        }
      }
      return null;
    };
    let p=path(true); if(!p){ p=path(false); if(p) dbg.push('bumpmode'); }
    if(!p) return {stop:'nopath',x:cx,y:cy};
    let prog=false;
    for(const [nx,ny] of p){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const dir=global.dirBetween(pal.world.player.gx,pal.world.player.gy,nx,ny);
      if(!dir) break;
      await pal.step(dir,1); await pal.observe();
      const w2=pal.world;
      if(w2.scene!==scene0) return {stop:'scene',scene:w2.scene,x:w2.player.gx,y:w2.player.gy,dbg};
      if(w2.mode!=='control'){ await global.settle2(); continue; }
      prog=true;
      if(w2.player.gx===tx&&w2.player.gy===ty) return {stop:'arrived',iter:it,dbg};
      if(w2.player.gx!==nx||w2.player.gy!==ny){ break; }
    }
    if(!prog) await pal.wait(200);
  }
  return {stop:'maxiter',x:pal.world.player.gx,y:pal.world.player.gy,dbg};
}; }
if(typeof global.reachMap!=='function'){ global.reachMap = async function(mapNum, sx, sy, opts={}){
  const rows = await global.getRows(mapNum);
  const blk = new Set(opts.blk||[]);
  const free=(x,y)=>{const r=rows[y]; return !!r && r[x]==='.' && !blk.has(x+','+y);};
  const seen=new Set(); const key=(x,y)=>x+','+y;
  if(!free(sx,sy)) return {seen, free};
  seen.add(key(sx,sy)); const q=[[sx,sy]];
  for(let h=0;h<q.length;h++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=q[h];
    for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const nx=x+dx, ny=y+dy, k=key(nx,ny);
      if(seen.has(k)||!free(nx,ny)) continue;
      seen.add(k); q.push([nx,ny]);
    }
  }
  return {seen, free};
}; }
if(typeof global.pathAvoidTrig!=='function'){ global.pathAvoidTrig = async function(tx,ty,opts={}){
  const rows = await global.getRows(pal.world.map);
  const blk=new Set();
  for(const o of (pal.world.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const tm = o.tm!==undefined?o.tm:o.triggerMode;
    if(o.kind==='touch-trigger' && !(o.gx===tx&&o.gy===ty)) blk.add(o.gx+','+o.gy);
    if(o.blocking) blk.add(o.gx+','+o.gy);
  }
  for(const k of (opts.extraBlk||[])) blk.add(k);
  const free=(x,y)=>{const r=rows[y]; return !!r && r[x]==='.' && !blk.has(x+','+y);};
  const sx=pal.world.player.gx, sy=pal.world.player.gy;
  const prev=new Map(); const key=(x,y)=>x+','+y;
  const q=[[sx,sy]]; const seen=new Set([key(sx,sy)]);
  const dirs=[[0,-1,'up'],[0,1,'down'],[-1,0,'left'],[1,0,'right']];
  let found=false;
  for(let h=0;h<q.length;h++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=q[h];
    if(x===tx&&y===ty){found=true;break;}
    for(const [dx,dy,d] of dirs){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const nx=x+dx, ny=y+dy, k=key(nx,ny);
      if(seen.has(k)||!free(nx,ny)) continue;
      seen.add(k); prev.set(k,{p:key(x,y),d}); q.push([nx,ny]);
    }
  }
  if(!found) return null;
  const out=[]; let cur=key(tx,ty);
  while(cur!==key(sx,sy)){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const p=prev.get(cur); if(!p) return null; out.push(p.d); cur=p.p; }
  return out.reverse();
}; }
if(typeof global.findRefs!=='function'){ global.findRefs = function(target){
  const S=global.scripts; const out=[];
  for(let i=0;i<S.length;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const o=S[i]; if(!o||!o.op) continue;
    const a=o.operands||[];
    const hit = a.includes(target);
    if(!hit) continue;
    // 009A batch: operands [lo,hi,0]
    out.push({addr:o.addr,op:o.op,name:o.name,operands:a,entry:o.entry,depth:o.depth});
  }
  return out;
}; }
if(typeof global.pathSafeFP!=='function'){ global.pathSafeFP = async function(tx,ty,opts={}){
  const rows = await global.getRows(pal.world.map);
  const trig=[]; const obst=new Set();
  for(const o of (pal.world.objectList||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const tm = o.tm!==undefined?o.tm:o.triggerMode;
    if(o.kind==='touch-trigger' || tm===5||tm===6||tm===4) trig.push([o.gx,o.gy,o.id]);
    if(o.blocking) obst.add(o.gx+','+o.gy);
  }
  for(const k of (opts.extraBlk||[])) obst.add(k);
  const bad=new Set();
  const ignore = opts.ignoreIds||[];
  for(const [x,y,id] of trig){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(ignore.includes(id)) continue;
    for(const dx of [0,-1]) for(const dy of [-1,0,1]) bad.add((x+dx)+','+(y+dy));
  }
  const free=(x,y)=>{const r=rows[y]; return !!r && r[x]==='.' && !obst.has(x+','+y) && !bad.has(x+','+y);};
  const sx=pal.world.player.gx, sy=pal.world.player.gy;
  const key=(x,y)=>x+','+y;
  const prev=new Map(); const q=[[sx,sy]]; const seen=new Set([key(sx,sy)]);
  const dirs=[[0,-1,'up'],[0,1,'down'],[-1,0,'left'],[1,0,'right']];
  let found=(sx===tx&&sy===ty);
  for(let h=0;h<q.length&&!found;h++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=q[h];
    for(const [dx,dy,d] of dirs){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const nx=x+dx, ny=y+dy, k=key(nx,ny);
      if(seen.has(k)||!free(nx,ny)) continue;
      seen.add(k); prev.set(k,{p:key(x,y),d}); q.push([nx,ny]);
      if(nx===tx&&ny===ty){found=true;break;}
    }
  }
  if(!found) return null;
  const out=[]; let cur=key(tx,ty);
  while(cur!==key(sx,sy)){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const p=prev.get(cur); if(!p) return null; out.push(p.d); cur=p.p; }
  return out.reverse();
}; }
if(typeof global.fightSmart!=='function'){ global.fightSmart = async (opts={})=>{
  const max=opts.max||300; let n=0; const log=[];
  while(n<max){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const w=pal.world;
    if(w.mode==='battle'){ await global.oneBattleAction(log); n++; await pal.wait(70); }
    else if(w.mode==='dialog'){ await pal.advance(40); }
    else if(w.mode==='busy'){ await pal.wait(180); }
    else if(w.mode==='menu'){ await pal.press('Menu'); await pal.wait(150); }
    else return {result:(w.lastBattleResult&&JSON.stringify(w.lastBattleResult))||'ended', turns:n, log:log.slice(-12)};
  }
  return {result:'maxturns', turns:n, log:log.slice(-12)};
}; }
if(typeof global.walkTo!=='function'){ global.walkTo = async (tx,ty, opts={})=>{
  const maxSteps = opts.maxSteps||600;
  let steps=0;
  for(let iter=0; iter<maxSteps; iter++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(!await global.settle()) return {stop:'stuck-mode',mode:pal.world.mode};
    const w=pal.world;
    if(w.gameOver) return {stop:'gameover'};
    const cx=w.player.gx, cy=w.player.gy;
    if(cx===tx&&cy===ty) return {stop:'arrived',x:cx,y:cy};
    const map=w.map;
    if(opts.stopScene && w.scene!==opts.stopScene) return {stop:'scene',scene:w.scene};
    const path=global.bfsPath(map,cx,cy,tx,ty);
    if(!path){ return {stop:'nopath',x:cx,y:cy,map}; }
    // take up to a few steps along path
    let advanced=0;
    for(const [nx,ny] of path){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const dir=global.dirBetween(pal.world.player.gx,pal.world.player.gy,nx,ny);
      if(!dir) break;
      const before={x:pal.world.player.gx,y:pal.world.player.gy,sc:pal.world.scene,mode:pal.world.mode};
      await pal.step(dir,1);
      steps++; advanced++;
      const w2=pal.world;
      if(w2.scene!==before.sc){ return {stop:'scene',scene:w2.scene,x:w2.player.gx,y:w2.player.gy}; }
      if(w2.mode!=='control'){ break; }
      if(w2.player.gx===before.x && w2.player.gy===before.y){
        // rejected: mark this cell blocked
        global.wallOv[map+':'+nx+','+ny]=false;
        break;
      }
      if(w2.player.gx===tx&&w2.player.gy===ty) return {stop:'arrived',x:tx,y:ty};
    }
    if(advanced===0) return {stop:'nopass',x:pal.world.player.gx,y:pal.world.player.gy};
  }
  return {stop:'maxsteps',x:pal.world.player.gx,y:pal.world.player.gy};
}; }
if(typeof global.warpCells!=='function'){ global.warpCells = ()=>{ const s=new Set(); for(const o of pal.world.objectList){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); if(o.kind==='touch-trigger') s.add(o.gx+','+o.gy); } return s; }; }
if(typeof global.blockedLive!=='function'){ global.blockedLive = function(){
  const set = new Set();
  for (const o of pal.world.objectList){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if (o.blocking) set.add(o.gx+','+o.gy);
  }
  return set;
}; }
if(typeof global.entryInfo!=='function'){ global.entryInfo = (addr)=>{
  const ops = byEntry.get(addr)||[];
  const out={addr, n:ops.length, scenes:[], warps:[], battles:[], flags:[]};
  for (const o of ops){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if (o.name.includes('切换场景')) out.scenes.push(o.operands[0]);
    if (o.name.includes('开战')) out.battles.push(o.operands[0]);
    if (o.name.includes('设队伍在地图上的位置')||o.name.includes('0046')) out.warps.push(o.operands.join(','));
    if (o.name.includes('设事件对象状态')||o.name.includes('设标志')) out.flags.push(o.name+'['+o.operands.join(',')+']');
  }
  return out;
}; }
