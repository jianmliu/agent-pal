// deepseek-pure-lib.js — pure-mode helper library\n\ntry { global.getRowsOf2 = async function(scene){
  const mn = global.SCENEMAP[scene];
  if (mn==null) throw new Error('nomap '+scene);
  let r = global.MAPS[mn];
  if (!Array.isArray(r)) { const d = await pal.readData('maps/'+mn+'.json'); r = d.rows; global.MAPS[mn]=r; }
  if (r.__padded) return r;
  const p = r.map(s=>{ s=s||''; return s.length>=192? s : s.padEnd(192,' '); });
  p.__padded = true;
  global.MAPS[mn] = p;
  return p;
}; } catch(e){}\n\ntry { global.patchCell = function(rows,x,y,ch){ const r=rows.slice(); let s=r[y]||''; if(s.length<192) s=s.padEnd(192,' '); r[y]=s.slice(0,x)+ch+s.slice(x+1); return r; }; } catch(e){}\n\ntry { global.buildPads = function buildPads(scene){
  const eos = (global.EOALL||[]).filter(e=>e.scene===scene);
  const pads=[];
  for (const e of eos){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if (!e.triggerScript) continue;
    const ops = global.opsOf(e.triggerScript);
    let dest=null, battle=false; const coords=[];
    for (const o of ops){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      if (o.op==='0059') dest=o.args[0];
      if (o.op==='0007') battle=true;
      if (['0046','007A','007B','0070','0044'].includes(o.op)) coords.push({op:o.op, args:o.args.slice()});
      if (o.op==='0000') break;
    }
    const conv = c => ht2g(c.args[0], c.args[1], c.args[2]||0);
    pads.push({id:e.id, own:[e.gx,e.gy], dest, battle,
      first: coords.length?conv(coords[0]):null,
      tele: (coords.find(c=>c.op==='0046')||null) && conv(coords.find(c=>c.op==='0046')),
      land: coords.length?conv(coords[coords.length-1]):null,
      coords, nops:ops.length, tm:e.triggerMode});
  }
  return pads;
}; } catch(e){}\n\ntry { global.padData = async function(scene){
  const rows = await global.getRowsOf2(scene);
  const built = global.buildPads(scene)||[];
  const live = {}; for (const o of (pal.world.objectList||[])) live[o.id]=[o.gx,o.gy];
  const tele = built.map(q=>({...q, own: live[q.id]||q.own})).filter(q=>q.own&&q.land);
  const zone = {}; const blocked = new Set();
  for(const p of tele){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const cells=[]; const [x,y]=p.own;
    for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=192||ny>=192) continue; cells.push([nx,ny]); blocked.add(nx+','+ny); }
    zone[p.id]=cells;
  }
  return {rows, tele, zone, blocked, byId:Object.fromEntries(tele.map(p=>[p.id,p]))};
}; } catch(e){}\n\ntry { global.firePadGo4 = async function(scene, padId, opts={}){
  const D = await global.padData(scene);
  const {rows, zone, blocked, byId} = D;
  const p = byId[padId]; if(!p) return {ok:false,err:'nopad'};
  const zc = zone[padId];
  const zset = new Set(zc.map(([x,y])=>x+','+y));
  const blockedOthers = new Set(); 
  for(const id in zone){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); if(+id===+padId) continue; for(const [x,y] of zone[id]) blockedOthers.add(x+','+y); }
  const K=(x,y)=>x+','+y;
  const N=192;
  const W=(x,y)=>{ if(x<0||y<0||x>=N||y>=N) return false; const r=rows[y]; return !!r && r[x]==='.';};
  const pass=(x,y)=>{ if(x<0||y<0||x>=N||y>=N) return false; const k=K(x,y); if(zset.has(k)) return true; return W(x,y)&&!blockedOthers.has(k); };
  const sx=pal.world.gx, sy=pal.world.gy;
  if(!pass(sx,sy)) return {ok:false,err:'startblocked',at:[sx,sy]};
  const prev=new Map([[K(sx,sy),null]]); const q=[[sx,sy]]; let h=0; let goal=null;
  while(h<q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const [x,y]=q[h++];
    if(zset.has(K(x,y))){ goal=[x,y]; break; }
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const nx=x+dx,ny=y+dy,k=K(nx,ny);
      if(prev.has(k)) continue; if(!pass(nx,ny)) continue;
      prev.set(k,[x,y]); q.push([nx,ny]); } }
  if(!goal) return {ok:false,err:'nopath',pad:padId,from:[sx,sy]};
  let c=goal; const rev=[]; while(c){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); rev.push(c); c=prev.get(K(c[0],c[1])); }
  rev.reverse();
  const DIRS=[[0,-1,'up'],[0,1,'down'],[-1,0,'left'],[1,0,'right']];
  const scene0=pal.world.scene; let steps=0; let jumped=false;
  for(let i=1;i<rev.length;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(pal.world.mode!=='control'){ await global.settleAll(30, opts.battleBudget||60000); await pal.observe(); }
    if(pal.world.scene!==scene0) return {ok:true, why:'scene', scene:pal.world.scene, at:[pal.world.gx,pal.world.gy], steps};
    if(pal.world.gx!==rev[i-1][0] || pal.world.gy!==rev[i-1][1]){ jumped=true; break; }
    const dx=rev[i][0]-pal.world.gx, dy=rev[i][1]-pal.world.gy;
    let d=null; for(const [ax,ay,dd] of DIRS) if(ax===dx&&ay===dy) d=dd;
    if(!d){ jumped=true; break; }
    const res = await pal.step(d,1); steps++;
    await pal.wait(opts.delay||22);
    await pal.observe();
    if(res && res.rejected){ break; }
    if (rev[i][0]!==pal.world.gx || rev[i][1]!==pal.world.gy) { jumped=true; break; }
  }
  for(let i=0;i<30 && pal.world.mode!=='control';i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); await global.settleAll(15, opts.battleBudget||60000); await pal.wait(30); await pal.observe(); }
  await pal.observe();
  return {ok:true, at:[pal.world.gx,pal.world.gy], scene:pal.world.scene, mode:pal.world.mode, steps, jumped, expectLand:p.land, pathLen:rev.length-1};
}; } catch(e){}\n\ntry { global.execChain = async function(scene, ids, opts={}){
  const D = await global.padData(scene);
  const log=[];
  for(const id of ids){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(pal.world.scene!==scene) return {ok:true, why:'scene', scene:pal.world.scene, at:[pal.world.gx,pal.world.gy], log};
    const p = D.byId[id];
    const r = await global.firePadGo4(scene, id, opts);
    log.push({hop:id, ok:r.ok, err:r.err, at:r.at, want:p?p.land:null, scene:r.scene||pal.world.scene, jumped:r.jumped, steps:r.steps});
    if(!r.ok) return {ok:false, why:'hopfail', hop:id, r, log};
    if(r.scene && r.scene!==scene) return {ok:true, why:'scene', scene:r.scene, at:r.at, log};
    if(p && p.land && (r.at[0]!==p.land[0] || r.at[1]!==p.land[1])) return {ok:false, why:'landmismatch', hop:id, at:r.at, want:p.land, log};
  }
  return {ok:true, why:'done', log};
}; } catch(e){}\n\ntry { global.mazePlan6 = async function(scene, goalPad, startXY, noFireIds){
  const nf = new Set((noFireIds||[]).map(Number));
  const D = await global.padData(scene);
  const {rows, zone, byId} = D;
  const allPads = D.tele;
  const blocked = new Set();
  for(const p of allPads) for(const [x,y] of zone[p.id]) blocked.add(x+','+y);
  const tele = allPads.filter(p=>!nf.has(p.id));
  const N=192; const K=(x,y)=>x+','+y;
  const W=(x,y)=>{const r=rows[y]; return !!r && r[x]==='.';};
  const regionFrom=function(sx,sy){
    const seen=new Set(); if(!W(sx,sy)) return {seen,size:0};
    seen.add(K(sx,sy)); const q=[sx,sy]; let h=0;
    while(h<q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const x=q[h++], y=q[h++];
      for(const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
        const k=K(nx,ny); if(seen.has(k)) continue;
        if(!W(nx,ny)) continue; if(blocked.has(k)) continue;
        seen.add(k); q.push(nx,ny); } }
    return {seen,size:seen.size};
  };
  const reach=function(reg){
    const out=[];
    for(const p of tele){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); let ok=false;
      for(const [zx,zy] of zone[p.id]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
          const nx=zx+dx, ny=zy+dy; if(nx<0||ny<0||nx>=N||ny>=N) continue;
          if(reg.seen.has(K(nx,ny))){ ok=true; break; } }
        if(ok) break; }
      if(ok) out.push(p.id); }
    return out;
  };
  const src = startXY || [pal.world.gx,pal.world.gy];
  const edges={}; const R={};
  R['start']=regionFrom(src[0],src[1]); edges['start']=reach(R['start']);
  for(const p of tele){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const r=regionFrom(p.land[0],p.land[1]); R[p.id]=r; if(r.size>0) edges[p.id]=reach(r); }
  const prev=new Map([['start',null]]); const q=['start'];
  while(q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const cur=q.shift(); if(cur===goalPad) break;
    for(const nxt of (edges[cur]||[])){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); if(prev.has(nxt)) continue; prev.set(nxt,cur); q.push(nxt); } }
  let chain=null;
  if(prev.has(goalPad)){ chain=[]; let c=goalPad; while(c!=null){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); chain.unshift(c); c=prev.get(c);} chain.shift(); }
  return {edges, chain, hasGoal:prev.has(goalPad), startEdges:edges['start'], startSize:R['start'].size, byId, R};
}; } catch(e){}\n\ntry { global.avoidPads = function(scene, keepIds){
  const keep = new Set((keepIds||[]).map(Number));
  const pads = global.buildPads(scene) || [];
  const s = new Set();
  for (const p of pads){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if (keep.has(p.id)) continue;
    const [x,y]=p.own;
    for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) s.add((x+dx)+','+(y+dy));
  }
  return s;
}; } catch(e){}\n\ntry { global.healNow = async function(targetPct=0.95, maxCasts=30){
  // 氣療術 heals 75 HP for 6 MP
  for (let i=0;i<maxCasts;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const me = pal.world.members[0];
    if (!me || me.hp >= me.maxHp*targetPct) break;
    if (pal.world.mode!=='control') await global.settleAll(10);
    await pal.press('Menu'); await pal.wait(250); await pal.observe();
    if (pal.world.mode!=='menu') { continue; }
    // choose 仙術
    const items = pal.world.menu.items.map(x=>String(x.label||x));
    let idx = items.findIndex(t=>t.includes('仙術'));
    if (idx<0) { await pal.press('Menu'); await pal.wait(150); await pal.observe(); continue; }
    await pal.choose(idx); await pal.wait(350); await pal.observe();
    if (pal.world.mode!=='menu') continue;
    const mi = pal.world.menu.items.findIndex(x=>String(x.label||x).includes('氣療術'));
    if (mi<0) { await pal.press('Menu'); await pal.press('Menu'); await pal.wait(150); await pal.observe(); continue; }
    await pal.choose(mi); await pal.wait(350); await pal.observe();
    if (pal.world.mode==='menu'){ await pal.choose(0); await pal.wait(700); await pal.observe(); }
    await global.settleAll(10);
  }
  const me=pal.world.members[0];
  return {hp:me.hp, mhp:me.maxHp, mp:me.mp};
}; } catch(e){}\n\ntry { global.settleAll = async function(maxIter=40, budget=60000){
  for (let i=0;i<maxIter;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const ww = pal.world;
    if (ww.mode==='control') return {mode:'control'};
    if (ww.mode==='dialog'){ await pal.advance(30); continue; }
    if (ww.mode==='busy'){ await pal.wait(300); continue; }
    if (ww.mode==='menu'){ await pal.press('Menu'); await pal.wait(120); await pal.observe(); continue; }
    if (ww.mode==='battle'){ await global.battleAI({budget}); await pal.observe(); continue; }
    await pal.wait(200);
  }
  return {mode:pal.world.mode};
}; } catch(e){}\n\ntry { global.battleAI = async function(opts={}){
  const log=[]; let turns=0; const t0=Date.now(); const budget=opts.budget||70000;
  let dump=null;
  while (Date.now()-t0 < budget){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const w = pal.world;
    if (w.mode==='dialog'){ await pal.advance(20); continue; }
    if (w.mode==='busy'){ await pal.wait(120); continue; }
    if (w.mode==='menu'){ await pal.press('Menu'); await pal.wait(120); await pal.observe(); continue; }
    if (w.mode!=='battle') return {done:true, mode:w.mode, res:w.lastBattleResult, turns, log:log.slice(-60)};
    const b = w.battle || {};
    if (!dump) { try { dump = JSON.parse(JSON.stringify(b)); } catch(e){ dump = String(b); } }
    if (!b.turn || b.turn.kind!=='command'){ await pal.wait(90); continue; }
    turns++;
    if (turns>120) return {err:'too many turns', dump, log:log.slice(-40)};
    const mems = w.members||[];
    const mi = b.turn.member;
    const me = mems.find(m=>m.roleId===mi) || mems[mi] || mems[0] || {};
    const en = (b.enemies||[]).filter(e=>(e.hp===undefined||e.hp>0));
    let tgt = 0;
    if (en.length){ let best=en[0]; for(const e of en){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); if((e.hp||0) < (best.hp||0)) best=e; } tgt = (best.index!==undefined? best.index : 0); }
    const hpPct = me.maxHp? me.hp/me.maxHp : 1;
    let acted=false;
    // heal if low
    if (hpPct < 0.35 && (me.mp||0) >= 18){
      for (const sp of ['凝神歸元','氣療術']){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
        try { const r = await pal.battle('magic',{magic:sp, target: mi}); acted=true; log.push({heal:sp, hp:me.hp}); break; } catch(e){ }
      }
    }
    if (!acted){
      const cands = [];
      if ((me.mp||0)>=44) cands.push('天劍');
      if ((me.mp||0)>=25) cands.push('萬劍訣');
      if ((me.mp||0)>=18) cands.push('天師符法');
      if ((me.mp||0)>=10) cands.push('御劍術');
      for (const sp of cands){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
        try { await pal.battle('magic',{magic:sp, target:tgt}); acted=true; log.push({sp, tgt, en:en.length, hp:me.hp, mp:me.mp}); break; } catch(e){ log.push({fail:sp, e:String(e).slice(0,80)}); }
      }
    }
    if (!acted){
      try { await pal.battle('attack',{target:tgt}); acted=true; log.push({atk:tgt, hp:me.hp}); }
      catch(e){ try { await pal.battle('defend'); } catch(e2){ await pal.wait(150); } }
    }
    await pal.wait(150);
  }
  return {timeout:true, dump, log:log.slice(-60), turns};
}; } catch(e){}\n\ntry { global.NV = async function(tx,ty, opts={}){
  const log=[]; let steps=0;
  const maxSteps = opts.maxSteps||300;
  const scene0 = pal.world.scene;
  while (steps < maxSteps){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if (pal.world.mode!=='control'){ const r = await global.settleAll(30, opts.battleBudget||60000); if (pal.world.mode!=='control'){ return {ok:false, why:'mode', mode:pal.world.mode, log}; } }
    if (pal.world.scene!==scene0) return {ok:true, why:'scene', scene:pal.world.scene, at:[pal.world.gx,pal.world.gy], steps, log};
    const px=pal.world.gx, py=pal.world.gy;
    if (px===tx && py===ty) return {ok:true, at:[px,py], steps, log};
    const rows = await global.rowsOfScene(pal.world.scene);
    const path = global.NVpath(rows, px,py,tx,ty, opts.blocked);
    if (!path) return {ok:false, why:'nopath', from:[px,py], to:[tx,ty], rows:undefined, log};
    // take one step
    const d = path[0];
    const res = await pal.step(d, 1);
    steps++;
    if (res && res.rejected) { if(!opts.blocked) opts.blocked=new Set(); opts.blocked.add((px+(d==='right'?1:d==='left'?-1:0))+','+(py+(d==='down'?1:d==='up'?-1:0))); log.push('rej '+d); continue; }
    await pal.wait(opts.delay||60);
    await pal.observe();
    if (steps%15===0) log.push('at '+pal.world.gx+','+pal.world.gy);
  }
  return {ok:false, why:'maxsteps', at:[pal.world.gx,pal.world.gy], steps, log};
}; } catch(e){}\n\ntry { global.NVpath = function(rows, sx,sy,tx,ty, blockSet){
  const K=(x,y)=>x+','+y;
  const prev=new Map([[K(sx,sy),null]]); const q=[[sx,sy]]; const goal=K(tx,ty); let found=false;
  while(q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=q.shift(); const k=K(x,y);
    if (k===goal){found=true;break;}
    for (const [dx,dy,d] of [[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const nx=x+dx, ny=y+dy, nk=K(nx,ny);
      if (prev.has(nk)) continue;
      if (!global.isW(rows,nx,ny)) continue;
      if (blockSet && blockSet.has(nk)) continue;
      prev.set(nk,{from:k,dir:d}); q.push([nx,ny]);
    }
  }
  if (!found) return null;
  const path=[]; let cur=goal;
  while(prev.get(cur)){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const p=prev.get(cur); path.push(p.dir); cur=p.from; }
  return path.reverse();
}; } catch(e){}\n\ntry { global.opsOf = function(addr){
  const txt = global.dumpScript(addr)||'';
  const out=[];
  for (const line of txt.split('\n')){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const m = line.match(/^(\d+): ([0-9A-Fa-f]{4}) .*?\[([^\]]*)\]/);
    if (m) out.push({addr:+m[1], op:m[2].toUpperCase(), args:m[3].split(',').map(s=>parseInt(s.trim(),10))});
    else {
      const m2 = line.match(/^(\d+): ([0-9A-Fa-f]{4})/);
      if (m2) out.push({addr:+m2[1], op:m2[2].toUpperCase(), args:[]});
    }
  }
  return out;
}; } catch(e){}\n\ntry { global.ht2g = function(tx,ty,h){ return {gx: tx+ty+h, gy: ty-tx+64}; }; } catch(e){}\n\ntry { global.rowsOfScene = async function(scene){
  const mn = global.SCENEMAP[scene];
  if (mn==null) throw new Error('nomap '+scene);
  let r = global.MAPS[mn];
  if (!Array.isArray(r)) { const d = await pal.readData('maps/'+mn+'.json'); r = d.rows; global.MAPS[mn]=r; }
  if (r.__padded) return r;
  const p = r.map(s=>{ s=s||''; return s.length>=192? s : s.padEnd(192,' '); });
  p.__padded = true;
  global.MAPS[mn] = p;
  return p;
}; } catch(e){}\n\ntry { global.bfsPath = function(rows, sx, sy, tx, ty, blockSet){
  const key=(x,y)=>x+','+y;
  const prev=new Map(); const start=key(sx,sy); prev.set(start,null);
  const q=[[sx,sy]];
  const goal=key(tx,ty);
  while(q.length){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const [x,y]=q.shift(); const k=key(x,y);
    if (k===goal) break;
    for (const [dx,dy,d] of [[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
      const nx=x+dx, ny=y+dy, nk=key(nx,ny);
      if (prev.has(nk)) continue;
      if (!global.isW(rows,nx,ny)) continue;
      if (blockSet && blockSet.has(nk)) continue;
      prev.set(nk, {from:k, dir:d});
      q.push([nx,ny]);
    }
  }
  if (!prev.has(goal)) return null;
  const path=[]; let cur=goal;
  while(prev.get(cur)){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const p=prev.get(cur); path.push(p.dir); cur=p.from; }
  return path.reverse();
}; } catch(e){}\n\ntry { global.isW = (rows,x,y)=>{ const r=rows[y]; return !!r && r[x]==='.'; }; } catch(e){}\n\ntry { global.rowsForScene = async (scene)=>{ const mn = global.SCENEMAP[scene]; if(mn==null) throw new Error('no map for scene '+scene); return await global.loadMap(mn); }; } catch(e){}\n\nglobal.CHAIN192 = [3427,3429,3431,3433,3435,3480,3437,3439,3441,3443,3445,3447,3449,3453,3481,3455,3457,3459,3461,3470,3469,3471,3473,3475,3477,3479];\n\ntry { global.EXITS = {}; } catch(e){}// deepseek-pure-lib.js  (auto-appended Round 374)
// Region model + maze route helpers
async function(maxIter=40){
  for(let i=0;i<maxIter;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    const m = pal.world.mode;
    if(m==='control') return true;
    if(m==='dialog'){ await pal.advance(30); }
    else if(m==='menu'){ await pal.choose(0); }
    else if(m==='battle'){ await global.BATTLE(); }
    else { await pal.wait(150); }
  }
  return pal.world.mode==='control';
}

async function(){
  let g=0;
  while(pal.world.mode==='battle' && g++<400){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    await pal.battle('attack');
    await pal.wait(60);
    if(pal.world.mode==='dialog') await pal.advance(30);
  }
}

async function(tx,ty,opts={}){
  const scene=pal.world.scene;
  const mn=global.SCENEMAP[scene];
  global.__ROWS = global.__ROWS||{};
  let rows=global.__ROWS[mn];
  if(!rows){ const d=await pal.readData(`maps/${mn}.json`); rows=(d.rows||[]).map(r=>(r||'').padEnd(192,' ')); global.__ROWS[mn]=rows; }
  const K=(x,y)=>y*1000+x, N=rows.length, M=192;
  const blk=new Set();
  for(const o of pal.world.objectList) if(o.blocking) blk.add(K(o.gx,o.gy));
  const avoid = opts.avoid||new Set();
  const walk=(x,y)=> x>=0&&y>=0&&x<M&&y<N && rows[y][x]==='.' && !blk.has(K(x,y)) && !avoid.has(K(x,y));
  const sx=pal.world.gx, sy=pal.world.gy;
  const prev=new Map(); const q=[[sx,sy]]; prev.set(K(sx,sy),null); let found=(sx===tx&&sy===ty);
  while(q.length&&!found){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const [x,y]=q.shift();
    for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); const nx=x+dx,ny=y+dy;
      if(!walk(nx,ny)||prev.has(K(nx,ny))) continue; prev.set(K(nx,ny),[x,y]); if(nx===tx&&ny===ty){found=true;break;} q.push([nx,ny]); } }
  if(!found) return {ok:false,reason:'nopath',from:[sx,sy],to:[tx,ty]};
  const path=[]; let cur=[tx,ty];
  while(cur){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)"); path.unshift(cur); cur=prev.get(K(cur[0],cur[1])); }
  let steps=0;
  for(let i=1;i<path.length;i++){if(++globalThis.__lg>5000000||((globalThis.__lg&63)===0&&globalThis.__lgCheck&&globalThis.__lgCheck()))throw new Error("Infinite synchronous loop detected (>3s without await; check while/continue condition)");
    if(pal.world.mode!=='control'){ await global.PUMP(); if(pal.world.mode!=='control') return {ok:false,reason:'mode:'+pal.world.mode,at:[pal.world.gx,pal.world.gy]}; }
    const [ax,ay]=path[i-1], [bx,by]=path[i];
    const dir = bx>ax?'right':bx<ax?'left':by>ay?'down':'up';
    if(pal.world.gx!==ax||pal.world.gy!==ay) return {ok:false,reason:'offpath',at:[pal.world.gx,pal.world.gy],want:[ax,ay]};
    await pal.step(dir,1); await pal.observe();
    if(pal.world.scene!==scene) return {ok:false,reason:'scene',scene:pal.world.scene,at:[pal.world.gx,pal.world.gy]};
    if(pal.world.gx===ax&&pal.world.gy===ay&&pal.world.mode==='control') return {ok:false,reason:'blocked',dir,at:[ax,ay]};
    steps++;
  }
  return {ok:true,steps,at:[pal.world.gx,pal.world.gy]};
}

async function(dir){
  const before={x:pal.world.gx,y:pal.world.gy,scene:pal.world.scene};
  await pal.step(dir,1); await pal.observe();
  if(pal.world.mode!=='control') await global.PUMP();
  return {dir,from:before,to:{x:pal.world.gx,y:pal.world.gy,scene:pal.world.scene},moved:(pal.world.gx!==before.x||pal.world.gy!==before.y||pal.world.scene!==before.scene),mode:pal.world.mode};
}

// ===== R402/R403 additions (pasted into deepseek-pure-lib.js) =====
// global.palRows(mapNum) -> cached rows array (char rows: '.' walkable, '#'/' ' blocked)
// global.MAPCACHE = {}
// global.BLKMAP = {}  learned blocked tiles per map
// global.settle2(maxRounds=40)
// global.walkOnMap(mapNum, tx, ty, {scene})  <-- BFS walker; returns {ok:false, why:'scene changed', scene, at} on warp
// NOTE: do NOT use global.getRows() (Uint8Array). Use pal.readData('maps/<n>.json').rows
// sc203 statue EO 3641 @(84,72) triggerMode2 = past transition (巫后 cutscene)
// sc227 EO 4253@(144,141) 婦人 rescue (2 battles); EO 4267@(100,108) -> warp to 235
// EXITS 227-252 table captured in round 402 handover.
