// Usage in run_code:  eval(pal.fs.readFileSync(PATH,'utf8')); await global.loadData();
global.loadData = async () => {
  if (!global._scenes) global._scenes = await pal.readData('scenes.json');
  if (!global._objs) global._objs = await pal.readData('objects.json');
  if (!global._eo) global._eo = await pal.readData('event-objects.json');
  if (!global._sc) global._sc = await pal.readData('scripts.json');
  if (!global._se) global._se = await pal.readData('script-entries.json');
  if (!global._byAddr) global._byAddr = new Map(global._sc.map(s=>[s.addr,s]));
  if (!global._seMap) global._seMap = new Map(global._se.map(e=>[e.addr,e.refs]));
  if (!global._et) global._et = await pal.readData('enemy-teams.json');
  if (!global._stores) global._stores = await pal.readData('stores.json');
  global.MAG = Object.fromEntries(global._objs.filter(x=>x.kind==='magic').map(m=>[m.name,{id:m.id,cost:m.magic.costMP,dmg:m.magic.baseDamage,all:m.magic.flags.includes('applyToAll'),enemy:m.magic.flags.includes('usableToEnemy'),el:m.magic.elemental}]));
  await global.loadMagicData();
};
// opus pure helper lib; load via run_code: eval(pal.fs.readFileSync(path))

global.L = global.L || {};
global.dlog = global.dlog || [];
pal.clearListeners && pal.clearListeners();
pal.on('SMSG_DIALOG', d => { global.dlog.push((d.speaker? d.speaker+':':'')+d.text); if (global.dlog.length>400) global.dlog.splice(0,200); });
global.takeD = () => { const o=global.dlog.slice(); global.dlog.length=0; return o; };
global.has = (n) => (pal.world.items||[]).find(i => i.name && i.name.includes(n) && i.amount>0);

// ---- script disassembly
global.dis = (addr, n=60, stopAtEnd=true) => {
  const out=[]; const B=global._byAddr;
  for (let a=addr, k=0; k<n; a++, k++) { const s=B.get(a); if(!s) continue;
    out.push(a+' '+s.op+' '+s.name+' '+s.operands.join(',')+(s.text?' |'+s.text:''));
    if (stopAtEnd && (s.op==='0000'||s.op==='0001') && k>0) break; }
  return out.join('\n');
};
global.eoOf = (id) => global._eo.find(e => e.id===id);

// ---- scene info
global.info = (filter) => {
  const p=pal.world.player||{};
  return (pal.world.objectList||[]).map(o => { const e=global.eoOf(o.id)||{};
    return {id:o.id, gx:o.gx, gy:o.gy, k:o.kind, tm:o.triggerMode, ts:e.triggerScript, as:e.autoScript, sp:e.spriteNum, st:e.state, d:Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy)}; })
    .filter(o => !filter || filter(o)).sort((a,b)=>a.d-b.d);
};

// ---- battle AI
global.fight = async (opts={}) => {
  const log=[]; let g=0;
  while (g++<300) {
    const m=pal.world.mode;
    if (m==='dialog') { await pal.advance(100); continue; }
    if (m!=='battle') { if (m==='busy') { await pal.wait(300); if (pal.world.mode==='busy' && g>5) break; continue;} break; }
    const b=pal.world.battle; if (!b || !b.turn) { await pal.wait(200); continue; }
    const party=b.party||[]; const mi=b.turn.member??0; const me=party[mi]||{};
    const en=(b.enemies||[]).filter(e=>(e.hp??1)>0);
    let act=null;
    if (opts.custom) act = await opts.custom({b,party,mi,me,en,log});
    if (!act) act = global.defaultAct({b,party,mi,me,en,opts});
    let r = await pal.battle(act[0], act[1]||{});
    if (!r.ok) { log.push('rej:'+JSON.stringify(act)); r = await pal.battle('attack', {}); }
    log.push((me.name||mi)+':'+act[0]+(act[1]&&act[1].magic?'/'+act[1].magic:'')+(act[1]&&act[1].item?'/'+act[1].item:''));
  }
  return {res: pal.world.lastBattleResult, n: log.length, tail: log.slice(-6)};
};
global.HEALSP = ['五氣朝元','觀音咒','還魂咒','凝神歸元','氣療術'];
global.defaultAct = ({b,party,mi,me,en,opts}) => {
  const alive=party.map((p,i)=>({...p,i})).filter(p=>(p.hp??0)>0);
  const dead=party.map((p,i)=>({...p,i})).filter(p=>(p.hp??0)<=0);
  const low=alive.slice().sort((a,c)=>a.hp/a.maxHp-c.hp/c.maxHp)[0];
  const mags=(pal.world.members.find(x=>x.name===me.name)||{}).magics||me.magics||[];
  const hasM=n=>mags.some(x=>(x.name||x)===n);
  const totalHp=en.reduce((s,e)=>s+(e.hp||0),0);
  // revive
  if (dead.length) { const it=global.has('還魂香')||global.has('贖魂燈'); if (it) return ['item',{item:it.name,target:dead[0].i}]; }
  if (low && low.hp/low.maxHp < (opts.heal||0.4)) {
    for (const sp of ['觀音咒','凝神歸元','氣療術']) if (hasM(sp) && me.mp>=30) return ['magic',{magic:sp,target:low.i}];
    const it=global.has('金創藥')||global.has('止血草')||global.has('行軍丹')||global.has('蜂王蜜')||global.has('還魂香');
    if (it) return ['item',{item:it.name,target:low.i}];
  }
  if (opts.attackOnly) return ['attack',{}];
  const pref = opts.spells || global.SPELLS;
  if (totalHp > (opts.magicHp||150) || en.length>=3 || opts.boss) {
    for (const sp of pref) { if (hasM(sp.n) && me.mp >= sp.mp && (!sp.multi || en.length>=2 || opts.boss)) return ['magic',{magic:sp.n}]; }
  }
  return ['attack',{}];
};
global.SPELLS = [ // name, mp cost (approx)
 {n:'劍神',mp:300},{n:'萬劍訣',mp:60},{n:'天劍',mp:150},{n:'雷神',mp:200},{n:'泰山壓頂',mp:120},{n:'風雪冰天',mp:80},{n:'煉獄真火',mp:80},{n:'天雷破',mp:60},
 {n:'三昧真火',mp:40},{n:'玄冰咒',mp:30},{n:'五雷咒',mp:30},{n:'旋風咒',mp:20},{n:'飛岩術',mp:30},
 {n:'斬龍訣',mp:50},{n:'七訣劍氣',mp:30},{n:'御劍術',mp:15},{n:'雷咒',mp:7},{n:'炎咒',mp:7},{n:'冰咒',mp:7},{n:'風咒',mp:5},{n:'土咒',mp:7},{n:'氣劍指',mp:10},{n:'銅錢鏢',mp:1},{n:'一陽指',mp:10}
];

// ---- drain non-control modes
global.drain = async (opts={}, max=60) => {
  const battles=[];
  for (let i=0;i<max;i++) {
    const m=pal.world.mode;
    if (m==='control') break;
    if (m==='dialog') await pal.advance(200);
    else if (m==='battle') battles.push(await global.fight(opts.battle||{}));
    else if (m==='menu') { if (opts.choice!=null) { await pal.choose(opts.choice); } else break; }
    else if (m==='anykey') await pal.press('Search');
    else await pal.wait(500);
    if (pal.world.gameOver) break;
  }
  return battles;
};
global.res = (extra={}) => ({scene:pal.world.scene, pos:pal.world.player&&[pal.world.player.gx,pal.world.player.gy], mode:pal.world.mode, lines:global.takeD(), ...extra});

global.go = async (x,y,opts={}) => {
  const sc=pal.world.scene; let r, bt=[];
  for (let k=0;k<30;k++) {
    r = await pal.invoke('nav__walk_to',{x,y});
    bt.push(...await global.drain(opts));
    if (pal.world.scene!==sc || pal.world.mode!=='control') break;
    const p=pal.world.player; if (p.gx===x&&p.gy===y) break;
    if (!/interrupt|stopped|trigger/i.test(JSON.stringify(r))) break;
  }
  return global.res({note: r && (r.note||r.reason||r.ok), battles: bt.map(b=>b.res&&b.res.result||b.res)});
};
global.talk = async (id, opts={}) => {
  let r = await pal.invoke('nav__interact',{id});
  const bt = await global.drain(opts);
  return global.res({note:r&&(r.note||r.ok), battles:bt.map(b=>b.res)});
};
global.st = async (dir,n=1,opts={}) => { const r=await pal.step(dir,n); const bt=await global.drain(opts); return global.res({ok:r.ok, battles:bt.length}); };
global.party = () => (pal.world.members||[]).map(m=>m.name+' L'+m.level+' '+m.hp+'/'+m.maxHp+' '+m.mp+'/'+m.maxMp);
global.inv = () => (pal.world.items||[]).map(i=>i.name+'x'+i.amount);
global.view = async () => { const r=await pal.invoke('nav__view',{}); return r.text||r.view||r; };
global.saveTo = async (slot,note) => { if (pal.world.mode!=='control') await global.drain(); return pal.save(slot,note); };

global.closeMenus = async (n=8) => { for (let i=0;i<n && pal.world.mode==='menu';i++){ await pal.press('Menu'); if(pal.world.mode==='dialog') await pal.advance(20);} return pal.world.mode; };
global.equip = async (name, who=0) => {
  await global.closeMenus(); await pal.press('Menu'); if (pal.world.mode!=='menu') return 'nomenu';
  await pal.choose(2); await pal.choose(0);
  const it=(pal.world.menu.items||[]); const idx=it.findIndex(x=>x.enabled && x.label===name);
  if (idx<0) { await global.closeMenus(); return 'notfound '+name; }
  await pal.choose(idx);
  let w = typeof who==='string' ? pal.world.menu.items.findIndex(x=>x.label.startsWith(who)) : who;
  if (pal.world.menu && pal.world.menu.kind==='party') await pal.choose(Math.max(0,w));
  const lbl = pal.world.menu && pal.world.menu.items[Math.max(0,w)] && pal.world.menu.items[Math.max(0,w)].label;
  await global.closeMenus(); await global.drain(); return lbl;
};

global.sum = (addr, n=80) => { const B=global._byAddr; const o=[]; for(let a=addr,k=0;k<n;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='FFFF') o.push(s.text); else if(!/^(0005|0009|003B|003C|003D|0016|0015|0085|0043|0044)$/.test(s.op)) o.push('['+a+' '+s.op+' '+s.name+' '+s.operands.join(',')+']'); if((s.op==='0000'||s.op==='0001')&&k>0) break;} return o.join(' '); };

global.b2g = (bx,by,h) => { const x=bx*32+h*16, y=by*16+h*8; return [Math.round(x/32+y/16), Math.round(y/16-x/32+64)]; };
global.exitOf = (addr) => { const B=global._byAddr; let pos=null; for(let a=addr,k=0;k<40;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='0046') pos=s.operands; if(s.op==='0059') return {to:s.operands[0], at: pos? global.b2g(...pos):null}; if(s.op==='0000') break;} return null; };
global.exits = () => global.info(o=>o.ts).map(o=>{const x=global.exitOf(o.ts); return x? {id:o.id,gx:o.gx,gy:o.gy,tm:o.tm,to:x.to,at:x.at,d:o.d}:null}).filter(Boolean);

global.findOps = (pred) => global._sc.filter(pred).map(s=>s.addr+' '+s.op+' '+s.name+' '+s.operands.join(','));
global.whoSets = (obj, addr) => global.findOps(s=>(s.op==='0025'||s.op==='0024') && s.operands[0]===obj && (addr==null || s.operands[1]===addr));
global.entryOf = (addr) => { const B=global._byAddr; const s=B.get(addr); return s && s.entry; };

global.useOn = async (item, facing, target=0) => { const r=await pal.invoke('nav__use_item',{item,target,...(facing!=null?{facing}:{})}); const bt=await global.drain(); return global.res({note:r&&(r.note||r.ok), battles:bt.map(b=>b.res)}); };

global.refsOf = (addr) => { const e=global._se.find(x=>x.addr===addr); return e? e.refs: null; };

global._seMap = global._seMap || new Map(global._se.map(e=>[e.addr,e.refs]));
global.ctx = (addr) => { let a=addr; while(a>0 && !global._seMap.has(a)) a--; return {root:a, refs:(global._seMap.get(a)||[]).slice(0,4)}; };

global.exitOf = (addr) => { const B=global._byAddr; let pos=null, to=null; for(let a=addr,k=0;k<40;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='0046') pos=s.operands; if(s.op==='0059') to=s.operands[0]; if(s.op==='0000'||s.op==='0001') break;} return to!=null? {to, at: pos? global.b2g(...pos):null}:null; };

// in a shop menu: buy item by name n times
global.buy = async (name, n=1) => { let got=0; for(let i=0;i<n;i++){ const m=pal.world.menu; if(!m) break; const idx=m.items.findIndex(x=>x.label===name); if(idx<0) break; await pal.choose(idx); const c=pal.world.menu; if(c && c.items && c.items[0] && /是/.test(c.items[0].label)) await pal.choose(0); if(pal.world.mode==='dialog') await pal.advance(10); got++; } return {got, cash:pal.world.cash}; };

global.buy = async (name, n=1) => { let got=0; for(let i=0;i<n;i++){ const m=pal.world.menu; if(!m) break; const idx=m.items.findIndex(x=>x.label===name); if(idx<0) break; await pal.choose(idx); const c=pal.world.menu; if(c && c.items){ const yi=c.items.findIndex(x=>x.label==='是'); if(yi>=0) await pal.choose(yi);} if(pal.world.mode==='dialog') await pal.advance(10); got++; } return {got, cash:pal.world.cash}; };
global.shop = async (npcId, list) => { await pal.invoke('nav__interact',{id:npcId}); for(let i=0;i<10 && pal.world.mode==='dialog';i++) await pal.advance(1); const out=[]; if(pal.world.mode==='menu' && /shop/.test(pal.world.menu.title||'')) { for (const [n,c] of list) out.push(n+':'+JSON.stringify(await global.buy(n,c))); } else out.push('noshop '+pal.world.mode+' '+JSON.stringify(pal.world.menu||{}).slice(0,200)); await global.closeMenus(); await global.drain(); return out; };

global._maps = global._maps || {};
global.mapRows = async () => { const n=pal.world.map; if(!global._maps[n]) global._maps[n]=(await pal.readData('maps/'+n+'.json')).rows; return global._maps[n]; };
// teleport links from moving-platform objects (007A targets in trigger script)
global.teleLinks = () => { const B=global._byAddr; const L=[]; for (const o of pal.world.objectList||[]) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue; const t=[]; for(let a=e.triggerScript,k=0;k<14;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='007A'||s.op==='0070') t.push(global.b2g(...s.operands)); if(s.op==='0000'||s.op==='0059') break;} if(!t.length) continue; t.sort((p,q)=>(Math.abs(q[0]-o.gx)+Math.abs(q[1]-o.gy))-(Math.abs(p[0]-o.gx)+Math.abs(p[1]-o.gy))); L.push({id:o.id, from:[o.gx,o.gy], to:t[0]}); } return L; };
global.path = async (goal, opts={}) => { // goal: fn(x,y)->bool
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const block=new Set(), avoid=new Set(); const tele=new Map();
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking) block.add(k); else if (o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) avoid.add(k); }
  if (opts.tele!==false) for (const l of global.teleLinks()) { tele.set(l.from.join(','), l); avoid.delete(l.from.join(',')); }
  const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps};
};
global.walkPath = async (goal, opts={}) => { const sc=pal.world.scene; let log=[]; for (let iter=0; iter<40; iter++) {
    const pth=await global.path(goal, opts); if(!pth) return {ok:false, why:'nopath', pos:[pal.world.player.gx,pal.world.player.gy], log};
    if (!pth.steps.length) return {ok:true, log};
    // execute until a teleport step (then replan)
    let i=0; let moved=false;
    while (i<pth.steps.length) { const s=pth.steps[i]; if (s[0]==='T') { i++; await pal.wait(300); await global.drain(); moved=true; break; }
      let n=1; while(n<4 && pth.steps[i+n]===s) n++; const before=[pal.world.player.gx,pal.world.player.gy]; await pal.step(s,n); const bt=await global.drain(opts); if(bt.length) log.push('battle'); i+=n;
      const now=[pal.world.player.gx,pal.world.player.gy]; if (pal.world.scene!==sc) return {ok:true, scene:pal.world.scene, log}; if (bt.length || (now[0]===before[0]&&now[1]===before[1])) { moved=true; break; } }
    const pp=pal.world.player; if (goal(pp.gx,pp.gy)) return {ok:true, log, pos:[pp.gx,pp.gy]};
  } return {ok:false, why:'iter', log}; };
global.goNear = (id) => async () => { const o=pal.world.objects.get(id); return global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)===1); };
global.goXY = (tx,ty,opts) => global.walkPath((x,y)=>x===tx&&y===ty, opts);

global.walkPath = async (goal, opts={}) => { const sc=pal.world.scene; let log=[]; let lastPos=null, same=0; for (let iter=0; iter<60; iter++) {
    const pth=await global.path(goal, opts); const pp0=pal.world.player; if(!pth) return {ok:false, why:'nopath', pos:[pp0.gx,pp0.gy], log};
    if (!pth.steps.length) return {ok:true, log};
    let i=0; while (i<pth.steps.length) { const s=pth.steps[i]; if (s[0]==='T') { i++; await pal.wait(200); await global.drain(opts); break; }
      let n=1; while(n<4 && pth.steps[i+n]===s) n++; const before=[pal.world.player.gx,pal.world.player.gy]; await pal.step(s,n); const bt=await global.drain(opts); if(bt.length) log.push('battle'); i+=n;
      const now=[pal.world.player.gx,pal.world.player.gy]; if (pal.world.scene!==sc) return {ok:true, scene:pal.world.scene, log}; if (bt.length || (now[0]===before[0]&&now[1]===before[1]) || now[0]!==before[0]+(s==='right'?n:s==='left'?-n:0) || now[1]!==before[1]+(s==='down'?n:s==='up'?-n:0)) { if (pth.steps[i] && pth.steps[i][0]==='T') i++; break; } }
    const pp=pal.world.player; if (goal(pp.gx,pp.gy)) return {ok:true, log, pos:[pp.gx,pp.gy]};
    const k=pp.gx+','+pp.gy; if (k===lastPos) { if(++same>3) return {ok:false, why:'stuck', pos:k, log}; } else { same=0; lastPos=k; }
  } return {ok:false, why:'iter', log}; };

global.teleLinks = () => { const B=global._byAddr; const L=[]; for (const o of pal.world.objectList||[]) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue; const t=[]; for(let a=e.triggerScript,k=0;k<14;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='007A'||s.op==='0070') t.push(global.b2g(...s.operands)); if(s.op==='0000'||s.op==='0059') break;} if(t.length<2) { if(t.length===1) L.push({id:o.id, from:[o.gx,o.gy], to:t[0]}); continue; }
  const [A,Bp]=t; const sg=(v)=>Math.sign(v); const trigA=[A[0]+sg(Bp[0]-A[0])*(Math.abs(Bp[0]-A[0])>=Math.abs(Bp[1]-A[1])?1:0), A[1]+sg(Bp[1]-A[1])*(Math.abs(Bp[1]-A[1])>Math.abs(Bp[0]-A[0])?1:0)];
  const trigB=[Bp[0]+sg(A[0]-Bp[0])*(Math.abs(Bp[0]-A[0])>=Math.abs(Bp[1]-A[1])?1:0), Bp[1]+sg(A[1]-Bp[1])*(Math.abs(Bp[1]-A[1])>Math.abs(Bp[0]-A[0])?1:0)];
  L.push({id:o.id, from:[o.gx,o.gy], to: (Math.abs(A[0]-o.gx)+Math.abs(A[1]-o.gy) < Math.abs(Bp[0]-o.gx)+Math.abs(Bp[1]-o.gy)) ? Bp : A});
  } return L; };

global.teleLinks = () => { const B=global._byAddr; const L=[]; for (const o of pal.world.objectList||[]) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue; const t=[]; for(let a=e.triggerScript,k=0;k<14;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='007A'||s.op==='0070') t.push(global.b2g(...s.operands)); if(s.op==='0000'||s.op==='0059') break;}
  if (!t.length) continue; if (t.length===1) { L.push({id:o.id, from:[o.gx,o.gy], to:t[0]}); continue; }
  const d=(p)=>Math.abs(p[0]-o.gx)+Math.abs(p[1]-o.gy); const N=d(t[0])<=d(t[1])?t[0]:t[1], F=N===t[0]?t[1]:t[0];
  L.push({id:o.id, from:[o.gx,o.gy], to:F});
  const dx=Math.sign(N[0]-F[0]), dy=Math.sign(N[1]-F[1]); const step = Math.abs(N[0]-F[0])>=Math.abs(N[1]-F[1]) ? [F[0]+dx,F[1]] : [F[0],F[1]+dy];
  L.push({id:o.id, from:step, to:N, back:true});
  } return L; };

global.teleLinks = () => { const B=global._byAddr; const L=[]; for (const o of pal.world.objectList||[]) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue;
  const halves=[]; let cur={p:null,t:null}; for(let a=e.triggerScript,k=0;k<20;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='0044') cur.p=global.b2g(...s.operands); if(s.op==='007A'||s.op==='0070') cur.t=global.b2g(...s.operands); if(s.op==='0001'||s.op==='0002'||s.op==='0000'){ if(cur.t) halves.push(cur); cur={p:null,t:null}; if(s.op!=='0001') break; } if(s.op==='0059') break;}
  if (!halves.length) continue;
  if (halves.length===1) { L.push({id:o.id, from:[o.gx,o.gy], to:halves[0].t}); continue; }
  const [H1,H2]=halves; L.push({id:o.id, from:H2.p||[o.gx,o.gy], to:H1.t}); L.push({id:o.id, from:H1.p, to:H2.t});
  } return L; };

global.reach = async (id) => { const o=pal.world.objects.get(id); if(!o) return {ok:false, why:'noobj'}; return global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)===1 && !(x===o.gx&&y===o.gy)); };
global.grab = async (id) => { const w=await global.reach(id); if(!w.ok) return {id, w}; return {id, ...(await global.talk(id))}; };

global.goTo = async (x,y,opts={}) => { const sc=pal.world.scene; let r=await global.go(x,y,opts); if (pal.world.scene!==sc) return r; const p=pal.world.player; if (p.gx===x&&p.gy===y) return r; const w=await global.walkPath((a,b)=>a===x&&b===y, opts); return {...global.res(), w, navnote:r.note}; };
global.goExit = async (toScene) => { const e=global.exits().find(x=>x.to===toScene); if(!e) return {ok:false, why:'no exit to '+toScene}; return global.goTo(e.gx,e.gy); };

global.isLoot = (o) => { const e=global.eoOf(o.id); if(!e||!e.triggerScript||o.triggerMode>3) return false; const B=global._byAddr; let item=false; for(let a=e.triggerScript,k=0;k<10;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='001F'||s.op==='001E') item=true; if(s.op==='FFFF' && !/得|獲|發現|摘|採|找到/.test(s.text||'')) return false; if(s.op==='0007'||s.op==='0059') return false; if(s.op==='0000'||s.op==='0001') break;} return item; };
global.loot = async (maxDist=999) => { const out=[]; for (let k=0;k<30;k++) { const p=pal.world.player; const c=(pal.world.objectList||[]).filter(o=>global.isLoot(o) && !global._looted?.has(pal.world.scene+':'+o.id)).sort((a,b)=>(Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy))-(Math.abs(b.gx-p.gx)+Math.abs(b.gy-p.gy)))[0]; if(!c) break; global._looted=global._looted||new Set(); global._looted.add(pal.world.scene+':'+c.id); let r=await global.talk(c.id); if (/no reachable|no path/.test(r.note||'')) { r=await global.grab(c.id); } out.push(c.id+':'+(r.lines||[]).join('/')); } return out; };

global.route = async (scenes) => { const out=[]; for (const s of scenes) { const r=await global.goExit(s); out.push(s+':'+pal.world.scene+(r.lines&&r.lines.length?' '+r.lines.slice(0,3).join('/'):'')+(r.why?' '+r.why:'')); if (pal.world.scene!==s) break; } return out; };

global.exitsTo = (sc) => global._eo.filter(e=>e.triggerScript && (()=>{const x=global.exitOf(e.triggerScript); return x&&x.to===sc;})()).map(e=>({id:e.id, scene:e.scene, gx:e.gx, gy:e.gy, tm:e.triggerMode, st:e.state}));

global.sceneGraph = () => { if (global._sg) return global._sg; const g=new Map(); for (const e of global._eo) { if(!e.triggerScript) continue; const x=global.exitOf(e.triggerScript); if(!x) continue; if(!g.has(e.scene)) g.set(e.scene,new Set()); g.get(e.scene).add(x.to); } global._sg=g; return g; };
global.scenePath = (from, to) => { const g=global.sceneGraph(); const prev=new Map([[from,null]]); const q=[from]; while(q.length){ const s=q.shift(); if(s===to) break; for (const n of (g.get(s)||[])) if(!prev.has(n)){prev.set(n,s); q.push(n);} } if(!prev.has(to)) return null; const p=[]; let c=to; while(c!==from){p.unshift(c); c=prev.get(c);} return p; };
global.travel = async (to) => { const p=global.scenePath(pal.world.scene, to); if(!p) return 'no scene path'; return global.route(p); };

global.goExit = async (toScene) => { const sc=pal.world.scene; const c=global.exits().filter(x=>x.to===toScene).sort((a,b)=>a.d-b.d); if(!c.length) return {ok:false, why:'no exit to '+toScene}; let r; for (const e of c) { r=await global.goTo(e.gx,e.gy); if (pal.world.scene!==sc) return r; } return {...r, why:'exit unreachable'}; };

global._teleBase = global.teleLinks;
global.teleLinks = () => { const L=global._teleBase(); const B=global._byAddr; const have=new Set(L.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { if (have.has(o.id) || !(o.triggerMode>=4)) continue; const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; let X=0,Y=0,n=0,pos=null,bad=false; for(let a=e.triggerScript,k=0;k<80;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='006E'){ let [dx,dy]=s.operands; if(dx>32767) dx-=65536; if(dy>32767) dy-=65536; X+=dx; Y+=dy; n++;} if(s.op==='0046') pos=global.b2g(...s.operands); if(s.op==='0059'||s.op==='0007'||s.op==='FFFF') {bad=true;break;} if(s.op==='0000'||s.op==='0001') break;}
    if (bad) continue; if (pos) L.push({id:o.id, from:[o.gx,o.gy], to:pos}); else if (n) L.push({id:o.id, from:[o.gx,o.gy], to:[o.gx+Math.round(X/32+Y/16), o.gy+Math.round(Y/16-X/32)]}); }
  return L; };

global.goTo = async (x,y,opts={}) => { const sc=pal.world.scene; const w=await global.walkPath((a,b)=>a===x&&b===y, opts); if (pal.world.scene!==sc || (w.ok)) return {...global.res(), w}; const r=await global.go(x,y,opts); return {...r, w}; };
global.talkTo = async (id, opts={}) => { let t=await global.talk(id, opts); if (/no reachable|no path|not found/.test(t.note||'') && pal.world.objects.get(id)) { const w=await global.reach(id); t=await global.talk(id, opts); t.w=w; } return t; };

global.MAG = global.MAG || Object.fromEntries(global._objs.filter(x=>x.kind==='magic').map(m=>[m.name,{id:m.id,cost:m.magic.costMP,dmg:m.magic.baseDamage,all:m.magic.flags.includes('applyToAll'),enemy:m.magic.flags.includes('usableToEnemy'),el:m.magic.elemental}]));
global._partyData = global._partyData || null; global._lu = global._lu || null;
global.loadMagicData = async () => { if(!global._partyData) global._partyData = await pal.readData('party.json'); if(!global._lu) global._lu=(await pal.readData('level-up.json')).magic; };
global.extraMagic = global.extraMagic || {'李逍遙':['御劍術']};
global.knownSpells = (name, level) => { const p=(global._partyData||[]).find(x=>x.name===name); const s=new Set((p&&p.magic||[]).map(m=>m.name)); if(p) for (const l of global._lu||[]) if (l.role===p.role && l.level<=level) s.add(l.name); for (const x of (global.extraMagic[name]||[])) s.add(x); return s; };
global.BAD_SPELLS = new Set(['酒神','乾坤一擲','飛龍探雲手','靈葫咒','迴夢','奪魂','鬼降','夢蛇','金蟬脫殼','三屍咒']);
global.HEAL_ITEMS = ['止血草','金創藥','行軍丹','蜂王蜜','紫菁玉蓉膏','天香續命露','療傷藥','靈山仙芝','人參','醃肉','水果','糯米糕'];
global.MP_ITEMS = ['還神丹','鼠兒果','龍涎草','雪蓮子','靈山仙芝','天仙玉露','九節菖蒲'];
global.REVIVE_ITEMS = ['還魂香','贖魂燈','孟婆湯','天香續命露'];
global.planAct = (ctx) => { const {b,party,mi,me,en,opts}=ctx; const cands=[];
  const alive=party.map((p,i)=>({...p,i})).filter(p=>(p.hp??0)>0); const dead=party.map((p,i)=>({...p,i})).filter(p=>(p.hp??0)<=0);
  const lvl=(pal.world.members.find(x=>x.name===me.name)||{}).level||1; const known=global.knownSpells(me.name,lvl);
  const can=(n)=>known.has(n) && !global._rej.has(me.name+':'+n) && global.MAG[n] && me.mp>=global.MAG[n].cost;
  const it=(list)=>{ for (const n of list){ const x=global.has(n); if(x) return x.name;} return null; };
  const boss=!!(b.boss||opts.boss); const totalHp=en.reduce((s,e)=>s+(e.hp||0),0);
  // revive
  if (dead.length) { for (const n of ['還魂咒','贖魂','靈血咒']) if (can(n)) cands.push(['magic',{magic:n,target:dead[0].i}]); const r=it(global.REVIVE_ITEMS); if(r) cands.push(['item',{item:r,target:dead[0].i}]); }
  // heal
  const lowList=alive.filter(p=>p.hp/p.maxHp < (opts.heal|| (boss?0.5:0.35))).sort((a,c)=>a.hp/a.maxHp-c.hp/c.maxHp);
  if (lowList.length) { const t=lowList[0].i; if (lowList.length>=2 && can('五氣朝元')) cands.push(['magic',{magic:'五氣朝元'}]); for (const n of ['元靈歸心術','觀音咒','凝神歸元','氣療術']) if (can(n) && !(n==='氣療術' && lowList[0].maxHp>300)) cands.push(['magic',{magic:n,target:t}]); const h=it(global.HEAL_ITEMS); if(h) cands.push(['item',{item:h,target:t}]); }
  // mp refill in boss fights
  if (boss && me.mp < 20 && me.maxMp>=60) { const m=it(global.MP_ITEMS); if (m) cands.push(['item',{item:m,target:mi}]); }
  // offense
  const tgt = en.slice().sort((a,c)=>(a.hp||0)-(c.hp||0))[0]; const ti = tgt ? tgt.index : 0;
  const useMagic = !opts.attackOnly && (boss || en.length>=3 || totalHp > (opts.magicHp||120*alive.length) || opts.magic);
  if (useMagic) { const sp=[...known].filter(n=>global.MAG[n] && global.MAG[n].enemy && global.MAG[n].dmg>0 && global.MAG[n].dmg<60000 && !global.BAD_SPELLS.has(n) && can(n));
    const score=(n)=>{ const m=global.MAG[n]; return m.dmg*((m.all && en.length>1)? Math.min(en.length,3):1) - (boss?0:m.cost*1.5); };
    sp.sort((a,c)=>score(c)-score(a)); const reserve = boss?0:10;
    for (const n of sp) if (me.mp - global.MAG[n].cost >= reserve || boss) { cands.push(['magic',{magic:n, target: global.MAG[n].all?undefined:ti}]); break; } }
  cands.push(['attack',{target:ti}]);
  return cands; };
global.fight = async (opts={}) => { await global.loadMagicData(); global._rej=new Set(); const log=[]; let g=0;
  while (g++<400) { const m=pal.world.mode;
    if (m==='dialog') { await pal.advance(100); continue; }
    if (m!=='battle') { if (m==='busy') { await pal.wait(300); continue; } break; }
    const b=pal.world.battle; if (!b || !b.turn || b.turn.kind!=='command') { await pal.wait(150); continue; }
    const party=b.party||[]; const mi=b.turn.member??0; const me=party[mi]||{}; const en=(b.enemies||[]).filter(e=>(e.hp??1)>0);
    let cands = opts.custom ? (await opts.custom({b,party,mi,me,en,log})) : null; if (!cands || !cands.length) cands=global.planAct({b,party,mi,me,en,opts}); else if (!Array.isArray(cands[0])) cands=[cands];
    let ok=false; for (const c of cands) { const a=c[1]||{}; Object.keys(a).forEach(k=>a[k]===undefined&&delete a[k]); const r=await pal.battle(c[0],a); if (r.ok) { log.push((me.name||mi)+':'+c[0]+(a.magic?'/'+a.magic:'')+(a.item?'/'+a.item:'')); ok=true; break; } if (a.magic) global._rej.add(me.name+':'+a.magic); }
    if (!ok) { await pal.battle('defend',{}); log.push('defend'); }
  }
  return {res: pal.world.lastBattleResult, n: log.length, tail: log.slice(-8)};
};
global._origFight = global.fight;

global.HEALT = global.HEALT || {'趙靈兒':0.5, '林月如':0.35, '阿奴':0.45, '巫后':0.5, default:0.3};
global._planBase = global._planBase || global.planAct;
global.planAct = (ctx) => { const th = (ctx.opts.healBy && ctx.opts.healBy[ctx.me.name]) ?? global.HEALT[ctx.me.name] ?? global.HEALT.default; return global._planBase({...ctx, opts:{...ctx.opts, heal: ctx.opts.heal ?? th}}); };

global.teamExp = (t) => { const team=global._et[t]; if(!team) return null; let exp=0, hp=0; const names=[]; for (const e of team.enemies) { const o=global._objs.find(x=>x.id===e.id); if(o&&o.enemy){exp+=o.enemy.exp; hp+=o.enemy.health; names.push(o.name+'L'+o.enemy.level);} } return {t, exp, hp, names:names.join(',')}; };
global.sceneBattles = (sc) => { const out=[]; for (const e of global._eo.filter(x=>x.scene===sc && x.triggerScript)) { const s=global._byAddr.get(e.triggerScript); if (s && s.op==='0007') out.push({id:e.id, gx:e.gx, gy:e.gy, ...global.teamExp(s.operands[0])}); } return out; };

global.shopsIn = (sc) => { const out=[]; for (const e of global._eo.filter(x=>x.scene===sc && x.triggerScript)) { for (let a=e.triggerScript,k=0;k<40;a++,k++){ const s=global._byAddr.get(a); if(!s) continue; if(s.op==='0026'){ out.push({id:e.id, gx:e.gx, gy:e.gy, store:s.operands[0], items:(global._stores[s.operands[0]]||{items:[]}).items.map(i=>i.name+':'+i.price).join(' ')}); break;} if(s.op==='0000') break; } } return out; };

global.isFoe = (o) => { const e=global.eoOf(o.id); if(!e||!e.triggerScript) return false; const s=global._byAddr.get(e.triggerScript); return s && s.op==='0007'; };
global.sweep = async (opts={}) => { const out=[]; const sc=pal.world.scene; for (let k=0;k<(opts.max||30);k++) { if (pal.world.scene!==sc) break; const p=pal.world.player; const foes=(pal.world.objectList||[]).filter(o=>global.isFoe(o) && !(opts.skip||[]).includes(o.id)).sort((a,b)=>(Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy))-(Math.abs(b.gx-p.gx)+Math.abs(b.gy-p.gy))); if(!foes.length) break; const f=foes[0]; const before=pal.world.lastBattleResult&&pal.world.lastBattleResult.battle; let r=await global.talk(f.id); if (/no reachable|no path/.test(r.note||'')) { const w=await global.walkPath((x,y)=>Math.abs(x-f.gx)+Math.abs(y-f.gy)<=1); await global.drain(); }
    const lb=pal.world.lastBattleResult; if (lb && lb.battle!==before) out.push(f.id+':'+lb.result+':'+lb.exp); else { opts.skip=(opts.skip||[]).concat([f.id]); out.push(f.id+':skip'); }
    if (lb && lb.result==='lost') break; if (opts.hpStop && pal.world.members.some(m=>m.hp<m.maxHp*opts.hpStop)) { out.push('lowhp'); break; } }
  return out; };

global.grind = async (lvl, maxMs=100000, opts={}) => { const t0=Date.now(); let n=0; while (Date.now()-t0<maxMs) { const lv=Math.min(...pal.world.members.map(m=>m.level)); if (lv>=lvl) break; const s=await global.sweep({hpStop:0.25, max:20, ...opts}); n+=s.length; if (s.some(x=>/lost/.test(x))) return {lost:true}; if (!s.length) await pal.wait(2000); if (s.includes('lowhp')) { /* rest: use heal spells */ await global.restHeal(); } } return {n, party:global.party(), cash:pal.world.cash}; };
global.restHeal = async () => { for (const m of pal.world.members) { if (m.hp < m.maxHp*0.6) { const it=['止血草','金創藥'].map(n=>global.has(n)).find(Boolean); if (it) await pal.useItem(it.name, pal.world.members.indexOf(m)); await global.drain(); } } };

global.openDoorsNear = async (x,y) => { let n=0; for (const o of (pal.world.objectList||[])) { const e=global.eoOf(o.id); if (e && e.triggerScript===20 && Math.abs(o.gx-x)+Math.abs(o.gy-y)<=2) { await global.talk(o.id); n++; } } return n; };
global.goExit = async (toScene) => { const sc=pal.world.scene; const c=global.exits().filter(x=>x.to===toScene).sort((a,b)=>a.d-b.d); if(!c.length) return {ok:false, why:'no exit to '+toScene}; let r; for (let pass=0; pass<2; pass++) { for (const e of c) { if (pass===1) await global.openDoorsNear(e.gx,e.gy); r=await global.goTo(e.gx,e.gy); if (pal.world.scene!==sc) return r; } } return {...r, why:'exit unreachable'}; };

global.opsAfter = (text, n=60) => { const s=global._sc.filter(x=>x.op==='FFFF' && x.text && x.text.includes(text)); return s.map(h=>{ const out=[]; for (let a=h.addr, k=0; k<n; a++, k++){ const t=global._byAddr.get(a); if(!t) continue; if (/^(0025|0024|0049|006D|0040|009A|0059|0046|0075|001F|0007)$/.test(t.op)) out.push(a+' '+t.op+' '+t.name+' '+t.operands.join(',')); if (t.op==='0000') break; } return h.addr+': '+out.join(' | '); }); };
global.objWhere = (id) => { const e=global.eoOf(id); return e? {scene:e.scene, gx:e.gx, gy:e.gy, tm:e.triggerMode, name: e.spriteNum}:null; };

global.innDown = async () => { if (pal.world.scene!==3) return; await global.go(121,113); await global.st('right',1); };
global.innUp = async () => { if (pal.world.scene!==3) return; await global.go(131,116); await global.st('left',1); };

global.goTo = async (x,y,opts={}) => { const sc=pal.world.scene; const r=await global.go(x,y,opts); if (pal.world.scene!==sc) return r; const p=pal.world.player; if (p.gx===x&&p.gy===y) return r; const w=await global.walkPath((a,b)=>a===x&&b===y, opts); return {...global.res(), w, navnote:r.note}; };

global.isDoor = (o) => { const e=global.eoOf(o.id); if(!e||!e.triggerScript) return false; if (e.triggerScript===20) return true; const s=global._byAddr.get(e.triggerScript); return !!(s && s.op==='0004' && s.operands[0]===22); };
global.openDoorsNear = async (x,y,r=2) => { let n=0; for (const o of (pal.world.objectList||[])) { if (o.blocking && global.isDoor(o) && Math.abs(o.gx-x)+Math.abs(o.gy-y)<=r) { await global.talk(o.id); n++; } } return n; };

global.scriptOps = (addr, n=300) => { const out=[]; const B=global._byAddr; for(let a=addr,k=0;k<n;a++,k++){const s=B.get(a); if(!s) continue; out.push(s); if(s.op==='0000' && k>0) break;} return out; };
global.hints = (sc) => { const objs = sc==null ? (pal.world.objectList||[]).map(o=>global.eoOf(o.id)).filter(Boolean) : global._eo.filter(e=>e.scene===sc); return objs.filter(e=>e.triggerScript).map(e=>{ const ops=global.scriptOps(e.triggerScript); const k=ops.filter(s=>/^(0025|0024|006D|0075|001F|0007|0059|0055)$/.test(s.op)).length; const t=ops.filter(s=>s.op==='FFFF').map(s=>s.text).join('').slice(0,60); return {id:e.id, gx:e.gx, gy:e.gy, tm:e.triggerMode, k, t}; }).filter(x=>x.k>0).sort((a,b)=>b.k-a.k); };

global.drain = async (opts={}, max=200) => { const battles=[]; let ctl=0;
  for (let i=0;i<max;i++) { const m=pal.world.mode;
    if (m==='control') { if (++ctl>=2) break; await pal.wait(120); continue; } ctl=0;
    if (m==='dialog') await pal.advance(200);
    else if (m==='battle') battles.push(await global.fight(opts.battle||{}));
    else if (m==='menu') { if (opts.choice!=null) { await pal.choose(opts.choice); } else break; }
    else if (m==='anykey') await pal.press('Search');
    else await pal.wait(400);
    if (pal.world.gameOver) break; }
  return battles; };

global.trigR = (tm) => Math.max(0, tm-4);
global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id)) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { tele.set(l.from.join(','), l); }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };
global.learnBlock = global.learnBlock || {};
global.walkPath = async (goal, opts={}) => { const sc=pal.world.scene; let log=[]; let lastPos=null, same=0; for (let iter=0; iter<60; iter++) {
    const pth=await global.path(goal, opts); const pp0=pal.world.player; if(!pth) return {ok:false, why:'nopath', pos:[pp0.gx,pp0.gy], log};
    if (!pth.steps.length) return {ok:true, log};
    let i=0; while (i<pth.steps.length) { const s=pth.steps[i]; if (s[0]==='T') { i++; await pal.wait(200); await global.drain(opts); break; }
      const before=[pal.world.player.gx,pal.world.player.gy]; await pal.step(s,1); const bt=await global.drain(opts); if(bt.length) log.push('battle'); i++;
      const now=[pal.world.player.gx,pal.world.player.gy]; if (pal.world.scene!==sc) return {ok:true, scene:pal.world.scene, log};
      const ex=[before[0]+(s==='right'?1:s==='left'?-1:0), before[1]+(s==='down'?1:s==='up'?-1:0)];
      if (now[0]===before[0]&&now[1]===before[1] && !bt.length) { (global.learnBlock[sc]=global.learnBlock[sc]||new Set()).add(before.join(',')+'>'+ex.join(',')); log.push('blk '+ex.join(',')); break; }
      if (bt.length || now[0]!==ex[0] || now[1]!==ex[1]) { if (pth.steps[i] && pth.steps[i][0]==='T') i++; break; } }
    const pp=pal.world.player; if (goal(pp.gx,pp.gy)) return {ok:true, log, pos:[pp.gx,pp.gy]};
    const k=pp.gx+','+pp.gy; if (k===lastPos) { if(++same>6) return {ok:false, why:'stuck', pos:k, log}; } else { same=0; lastPos=k; }
  } return {ok:false, why:'iter', log}; };
global.goExit = async (toScene) => { const sc=pal.world.scene; const c=global.exits().filter(x=>x.to===toScene).sort((a,b)=>a.d-b.d); if(!c.length) return {ok:false, why:'no exit to '+toScene}; let r; for (let pass=0; pass<2; pass++) { for (const e of c) { if (pass===1) await global.openDoorsNear(e.gx,e.gy); r=await global.go(e.gx,e.gy); if (pal.world.scene!==sc) return r; const R=global.trigR(e.tm); const w=await global.walkPath((x,y)=>Math.abs(x-e.gx)+Math.abs(y-e.gy)<=R, {allow:[e.id]}); await global.drain(); if (pal.world.scene!==sc) return {...global.res(), w}; } } return {...r, why:'exit unreachable'}; };

global.lastOps = (n=40) => { const lines=global.dlog.slice(-3); for (let i=lines.length-1;i>=0;i--) { const txt=lines[i].split(':').slice(-1)[0]; if (txt.length<3) continue; const r=global.opsAfter(txt.slice(0,12), n); if (r.length) return r; } return []; };
global.tgt = (id, addr) => { const e=global.eoOf(id); return {id, scene:e.scene, gx:e.gx, gy:e.gy, tm:e.triggerMode, s: global.sum(addr||e.triggerScript,30).slice(0,160)}; };

global.findBossScenes = (re) => { const ids=new Set(global._objs.filter(o=>o.kind==='enemy' && re.test(o.name)).map(o=>o.id)); const teams=global._et.filter(t=>t.enemies.some(e=>ids.has(e.id))).map(t=>t.id); const hits=global.findOps(s=>s.op==='0007' && teams.includes(s.operands[0])); return hits.map(h=>{ const a=+h.split(' ')[0]; const c=global.ctx(a); return {h, team:global.teamExp(global._byAddr.get(a).operands[0]), refs:c.refs.slice(0,2)}; }); };

global.scenePathX = (from, to, bad) => { const g=global.sceneGraph(); const prev=new Map([[from,null]]); const q=[from]; while(q.length){ const s=q.shift(); if(s===to) break; for (const n of (g.get(s)||[])) if(!prev.has(n) && !bad.has(s+'>'+n)){prev.set(n,s); q.push(n);} } if(!prev.has(to)) return null; const p=[]; let c=to; while(c!==from){p.unshift(c); c=prev.get(c);} return p; };
global.travel = async (to, maxHops=30) => { const bad=global._badEdges=global._badEdges||new Set(); const log=[]; for (let hop=0; hop<maxHops && pal.world.scene!==to; hop++) { const from=pal.world.scene; const p=global.scenePathX(from,to,bad); if(!p) { log.push('nopath from '+from); break; } const nxt=p[0]; const r=await global.goExit(nxt); const now=pal.world.scene; log.push(from+'>'+nxt+':'+now+(r.lines&&r.lines.length?' '+r.lines.slice(0,2).join('/'):'')); if (now===from) bad.add(from+'>'+nxt); if (pal.world.mode!=='control') await global.drain(); } return log; };

global._rowsByMap = global._rowsByMap || {};
global.rowsOfScene = async (sc) => { const s=global._scenes.find(x=>x.id===sc); if(!s) return null; const n=s.mapNum; if(!global._rowsByMap[n]) { try { global._rowsByMap[n]=(await pal.readData('maps/'+n+'.json')).rows; } catch(e) { global._rowsByMap[n]=null; } } return global._rowsByMap[n]; };
global.exitObjs = (sc) => { if(!global._exitCache) global._exitCache={}; if (global._exitCache[sc]) return global._exitCache[sc]; const out=[]; for (const e of global._eo.filter(x=>x.scene===sc && x.triggerScript)) { const x=global.exitOf(e.triggerScript); if (x && x.to!==sc) out.push({id:e.id, gx:e.gx, gy:e.gy, tm:e.triggerMode, to:x.to, at:x.at}); } global._exitCache[sc]=out; return out; };
global.reachExits = async (sc, start, liveObjs) => { const rows=await global.rowsOfScene(sc); const ex=global.exitObjs(sc); if(!rows||!start) return ex.map(e=>e.id); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const seen=new Set([start.join(',')]); const q=[start]; const exitCells=new Map(); for (const e of ex) { const r=Math.max(1,global.trigR(e.tm)); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) { const k=(e.gx+dx)+','+(e.gy+dy); if(!exitCells.has(k)) exitCells.set(k,[]); exitCells.get(k).push(e.id);} } const found=new Set(); let n=0; while(q.length && n++<60000){ const [x,y]=q.shift(); const k=x+','+y; for (const id of (exitCells.get(k)||[])) found.add(id); for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return [...found]; };
global.planRoute = async (to) => { const startScene=pal.world.scene, p=pal.world.player; const key=(s,c)=>s+'@'+(c?c.join(','):'?'); const startK=key(startScene,[p.gx,p.gy]); const prev=new Map([[startK,null]]); const q=[[startScene,[p.gx,p.gy]]]; let goal=null; let n=0;
  while(q.length && n++<400) { const [s,c]=q.shift(); if (s===to) { goal=key(s,c); break; } const ids=await global.reachExits(s,c); for (const id of ids) { const e=global.exitObjs(s).find(x=>x.id===id); if(!e) continue; if (global._badExit && global._badExit.has(s+':'+id)) continue; const nk=key(e.to, e.at); if (prev.has(nk)) continue; prev.set(nk,{from:key(s,c), exit:id, scene:s}); q.push([e.to, e.at]); } }
  if (!goal) return null; const steps=[]; let c=goal; while(prev.get(c)) { const v=prev.get(c); steps.unshift({scene:v.scene, exit:v.exit}); c=v.from; } return steps; };
global.travel = async (to, maxHops=40) => { global._badExit=global._badExit||new Set(); const log=[]; for (let hop=0; hop<maxHops && pal.world.scene!==to; hop++) { const plan=await global.planRoute(to); if(!plan||!plan.length) { log.push('noplan@'+pal.world.scene); break; } const st=plan[0]; const from=pal.world.scene; const e=global.exitObjs(from).find(x=>x.id===st.exit); const R=global.trigR(e.tm); let r=await global.go(e.gx,e.gy); if (pal.world.scene===from) { await global.walkPath((x,y)=>Math.abs(x-e.gx)+Math.abs(y-e.gy)<=R, {allow:[e.id]}); } if (pal.world.mode!=='control') await global.drain(); if (pal.world.scene===from) { await global.openDoorsNear(e.gx,e.gy); await global.go(e.gx,e.gy); await global.drain(); } const now=pal.world.scene; log.push(from+'>'+e.to+'('+e.id+'):'+now+(global.dlog.length?' '+global.dlog.slice(-2).join('/'):'')); global.dlog.length=0; if (now===from) global._badExit.add(from+':'+e.id); } return log; };

global.reachExits = async (sc, start) => { const rows=await global.rowsOfScene(sc); const ex=global.exitObjs(sc); if(!rows||!start) return ex.map(e=>e.id); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const exitCells=new Map(); for (const e of ex) { const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) { const k=(e.gx+dx)+','+(e.gy+dy); if(!exitCells.has(k)) exitCells.set(k,[]); exitCells.get(k).push(e.id);} }
  const sk=start.join(','); const seen=new Set([sk]); const q=[start]; const found=new Set(); let n=0;
  while(q.length && n++<80000){ const [x,y]=q.shift(); const k=x+','+y; if (k!==sk && exitCells.has(k)) { for (const id of exitCells.get(k)) found.add(id); continue; } for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return [...found]; };

global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id) && !global.isFoe(o)) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { tele.set(l.from.join(','), l); }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.reachSet = async (sc, start) => { const rows=await global.rowsOfScene(sc); if(!rows) return null; const ex=global.exitObjs(sc); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const zone=new Set(); for (const e of ex) { const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) zone.add((e.gx+dx)+','+(e.gy+dy)); } const sk=start.join(','); const seen=new Set([sk]); const q=[start]; let n=0; while(q.length && n++<80000){ const [x,y]=q.shift(); const k=x+','+y; if (k!==sk && zone.has(k)) continue; for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return seen; };
global.planTo = async (toScene, tx, ty, rad=1) => { const startScene=pal.world.scene, p=pal.world.player; const key=(s,c)=>s+'@'+(c?c.join(','):'?'); const startK=key(startScene,[p.gx,p.gy]); const prev=new Map([[startK,null]]); const q=[[startScene,[p.gx,p.gy]]]; let goal=null; let n=0;
  while(q.length && n++<500) { const [s,c]=q.shift(); if (s===toScene) { const seen=await global.reachSet(s,c); let ok=false; if (seen) for(let dx=-rad;dx<=rad&&!ok;dx++) for(let dy=-rad;dy<=rad&&!ok;dy++) if (Math.abs(dx)+Math.abs(dy)<=rad && seen.has((tx+dx)+','+(ty+dy))) ok=true; if (ok) { goal=key(s,c); break; } }
    const ids=await global.reachExits(s,c); for (const id of ids) { const e=global.exitObjs(s).find(x=>x.id===id); if(!e) continue; if (global._badExit && global._badExit.has(s+':'+id)) continue; const nk=key(e.to, e.at); if (prev.has(nk)) continue; prev.set(nk,{from:key(s,c), exit:id, scene:s}); q.push([e.to, e.at]); } }
  if (!goal) return null; const steps=[]; let c=goal; while(prev.get(c)) { const v=prev.get(c); steps.unshift({scene:v.scene, exit:v.exit}); c=v.from; } return steps; };
global.takeExit = async (id) => { const from=pal.world.scene; const e=global.exitObjs(from).find(x=>x.id===id); const R=global.trigR(e.tm); await global.go(e.gx,e.gy); if (pal.world.scene===from) await global.walkPath((x,y)=>Math.abs(x-e.gx)+Math.abs(y-e.gy)<=R, {allow:[e.id]}); if (pal.world.mode!=='control') await global.drain(); if (pal.world.scene===from) { await global.openDoorsNear(e.gx,e.gy); await global.go(e.gx,e.gy); await global.drain(); } if (pal.world.scene===from) (global._badExit=global._badExit||new Set()).add(from+':'+id); return pal.world.scene!==from; };
global.goObj = async (sc, id, rad) => { const e=global.eoOf(id); const R = rad ?? Math.max(1, global.trigR(e.triggerMode)); const log=[]; for (let hop=0; hop<30; hop++) { if (pal.world.scene===sc) { const o=pal.world.objects.get(id)||e; const w=await global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=R, {allow:[id]}); await global.drain(); if (w.ok || pal.world.scene!==sc) { log.push('reached '+JSON.stringify(w.pos||'')); return log; } }
    const plan=await global.planTo(sc, e.gx, e.gy, R); if(!plan||!plan.length) { log.push('noplan@'+pal.world.scene); return log; } const st=plan[0]; const ok=await global.takeExit(st.exit); log.push(st.scene+'>'+pal.world.scene+(ok?'':' FAIL')); } return log; };

global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id) && !global.isFoe(o) && (o.kind==='touch-trigger' ? true : !!global.exitOf((global.eoOf(o.id)||{}).triggerScript||0))) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { tele.set(l.from.join(','), l); }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id) && !global.isFoe(o) && !!global.exitOf((global.eoOf(o.id)||{}).triggerScript||0)) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { tele.set(l.from.join(','), l); }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global._goObjBase = global._goObjBase || global.goObj;
global.goObj = async (sc, id, rad) => { if (pal.world.scene===sc) { for (let k=0;k<4;k++){ const r=await global.talk(id); await global.drain(); if (pal.world.scene!==sc || !/no reachable|no path|not found/.test(r.note||'')) return ['nav '+(r.note||'')]; } } return global._goObjBase(sc,id,rad); };

global.THROW_ITEMS = ['蜂巢','毒蟾卵','蜘蛛卵','金蠶蠱','火蠶蠱','冰蠶蠱','爆烈蠱','袖裡劍','透骨釘','梅花鏢','無影神針','血玲瓏'];
global._planBase2 = global._planBase2 || global.planAct;
global.planAct = (ctx) => { const c=global._planBase2(ctx); const {b,me,en,opts}=ctx; const boss=!!(b.boss||opts.boss); const i=c.findIndex(x=>x[0]==='magic' && global.MAG[x[1].magic] && global.MAG[x[1].magic].enemy); const best = i>=0 ? global.MAG[c[i][1].magic].dmg : 0; const atkIdx=c.findIndex(x=>x[0]==='attack');
  if (boss || en.length>=3) { const th=global.THROW_ITEMS.map(n=>global.has(n)).find(Boolean); if (th && best < 150 && opts.noThrow!==true) { const pos = i>=0 ? i : atkIdx; c.splice(pos,0,['throw',{item:th.name, target:(en[0]||{}).index}]); } }
  return c; };

global.goObj = async (sc, id, rad) => { const log=[]; for (let hop=0; hop<30; hop++) { if (pal.world.scene===sc) { for (let k=0;k<4;k++){ const r=await global.talk(id); await global.drain(); if (pal.world.scene!==sc || !/no reachable|no path|not found/.test(r.note||'')) { log.push('nav '+(r.note||'').slice(0,60)); return log; } } const e=global.eoOf(id); const R = rad ?? Math.max(1, global.trigR(e.triggerMode)); const o=pal.world.objects.get(id)||e; const w=await global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=R, {allow:[id]}); await global.drain(); if (w.ok || pal.world.scene!==sc) { log.push('walk '+JSON.stringify(w.pos||'')); return log; } }
    const e=global.eoOf(id); const plan=await global.planTo(sc, e.gx, e.gy, rad ?? 1); if(!plan||!plan.length) { log.push('noplan@'+pal.world.scene); return log; } const st=plan[0]; const ok=await global.takeExit(st.exit); log.push(st.scene+'>'+pal.world.scene+(ok?'':' FAIL')); } return log; };

global.goObj = async (sc, id, rad) => { const log=[]; const near=()=>{ const o=pal.world.objects.get(id); const p=pal.world.player; return !o || (Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy) <= (rad??Math.max(1,global.trigR(o.triggerMode)))+1); };
  for (let hop=0; hop<30; hop++) { if (pal.world.scene===sc) { for (let k=0;k<6;k++){ const r=await global.talk(id); await global.drain(); if (pal.world.scene!==sc) { log.push('left scene'); return log; } if (/no reachable|no path|not found/.test(r.note||'')) break; if (near() || !/interrupted/.test(r.note||'')) { log.push('nav '+(r.note||'').slice(0,50)); return log; } }
      const e=global.eoOf(id); const R = rad ?? Math.max(1, global.trigR(e.triggerMode)); const o=pal.world.objects.get(id)||e; const w=await global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=R, {allow:[id]}); await global.drain(); if (w.ok || pal.world.scene!==sc) { log.push('walk '+JSON.stringify(w.pos||'')); return log; } }
    const e=global.eoOf(id); const plan=await global.planTo(sc, e.gx, e.gy, rad ?? 1); if(!plan||!plan.length) { log.push('noplan@'+pal.world.scene); return log; } const st=plan[0]; const ok=await global.takeExit(st.exit); log.push(st.scene+'>'+pal.world.scene+(ok?'':' FAIL')); } return log; };

global.hist = global.hist || [];
global.takeD = () => { const o=global.dlog.slice(); global.dlog.length=0; global.hist.push(...o); if (global.hist.length>600) global.hist.splice(0,300); return o; };
global.recent = (n=15) => { global.takeD(); return global.hist.slice(-n); };

global._goObj3 = global._goObj3 || global.goObj; global.goObj = async (...a) => { global._badExit=new Set(); return global._goObj3(...a); };
global._travel3 = global._travel3 || global.travel; global.travel = async (...a) => { global._badExit=new Set(); return global._travel3(...a); };

global.teleLinksFor = (objs) => { const B=global._byAddr; const L=[]; for (const o of objs) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue; if (global.exitOf(e.triggerScript)) continue;
  const halves=[]; let cur={p:null,t:null}; let X=0,Y=0,n=0,pos=null,bad=false;
  for(let a=e.triggerScript,k=0;k<80;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='0044') cur.p=global.b2g(...s.operands); if(s.op==='007A'||s.op==='0070') cur.t=global.b2g(...s.operands); if(s.op==='006E'){ let [dx,dy]=s.operands; if(dx>32767) dx-=65536; if(dy>32767) dy-=65536; X+=dx; Y+=dy; n++;} if(s.op==='0046') pos=global.b2g(...s.operands); if(s.op==='0007'||s.op==='0059') {bad=true;break;} if(s.op==='0001'||s.op==='0002'||s.op==='0000'){ if(cur.t) halves.push(cur); cur={p:null,t:null}; if(s.op!=='0001') break; } }
  if (bad) continue; if (halves.length>=2) { const [H1,H2]=halves; L.push({id:o.id, from:H2.p||[o.gx,o.gy], to:H1.t}); L.push({id:o.id, from:H1.p||[o.gx,o.gy], to:H2.t}); } else if (halves.length===1) L.push({id:o.id, from:[o.gx,o.gy], to:halves[0].t}); else if (pos) L.push({id:o.id, from:[o.gx,o.gy], to:pos}); else if (n) L.push({id:o.id, from:[o.gx,o.gy], to:[o.gx+Math.round(X/32+Y/16), o.gy+Math.round(Y/16-X/32)]}); }
  return L; };
global.reachSet = async (sc, start) => { const rows=await global.rowsOfScene(sc); if(!rows) return null; const ex=global.exitObjs(sc); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const zone=new Set(); for (const e of ex) { const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) zone.add((e.gx+dx)+','+(e.gy+dy)); }
  const tl=new Map(); for (const l of global.teleLinksFor(global._eo.filter(x=>x.scene===sc).map(e=>({id:e.id,gx:e.gx,gy:e.gy,triggerMode:e.triggerMode})))) tl.set(l.from.join(','), l.to);
  const sk=start.join(','); const seen=new Set([sk]); const q=[start]; let n=0; while(q.length && n++<80000){ const [x,y]=q.shift(); const k=x+','+y; if (k!==sk && zone.has(k)) continue; if (tl.has(k)) { const t=tl.get(k); const tk=t.join(','); if(!seen.has(tk)){ seen.add(tk); q.push(t);} } for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return seen; };
global.reachExits = async (sc, start) => { const seen=await global.reachSet(sc,start); const ex=global.exitObjs(sc); if(!seen) return ex.map(e=>e.id); return ex.filter(e=>{ const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r && seen.has((e.gx+dx)+','+(e.gy+dy))) return true; return false; }).map(e=>e.id); };

global.teleLinksFor = (objs) => { const B=global._byAddr; const L=[]; for (const o of objs) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue; if (global.exitOf(e.triggerScript)) continue;
  const halves=[]; let cur={p:null,t:null}; let X=0,Y=0,n=0,pos=null,bad=false;
  for(let a=e.triggerScript,k=0;k<80;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='0044') cur.p=global.b2g(...s.operands); if(s.op==='007A'||s.op==='0070') cur.t=global.b2g(...s.operands); if(s.op==='006E'){ let [dx,dy]=s.operands; if(dx>32767) dx-=65536; if(dy>32767) dy-=65536; X+=dx; Y+=dy; n++;} if(s.op==='0046') pos=global.b2g(...s.operands); if(s.op==='0007'||s.op==='0059') {bad=true;break;} if(s.op==='0001'||s.op==='0002'||s.op==='0000'){ if(cur.t) halves.push(cur); cur={p:null,t:null}; if(s.op!=='0001') break; } }
  if (bad) continue; if (halves.length>=2) { const [H1,H2]=halves; L.push({id:o.id, from:H2.p||[o.gx,o.gy], to:H1.t}); L.push({id:o.id, from:H1.p||[o.gx,o.gy], to:H2.t}); } else if (halves.length===1) L.push({id:o.id, from:[o.gx,o.gy], to:halves[0].t}); else if (pos) L.push({id:o.id, from:[o.gx,o.gy], to:pos}); else if (n) L.push({id:o.id, from:[o.gx,o.gy], to:[o.gx+Math.round(X/32+Y/16), o.gy+Math.round(Y/16-X/32)]}); }
  return L.filter(l=>l.from&&l.to); };

global.reachSet = async (sc, start) => { const rows=await global.rowsOfScene(sc); if(!rows||!start) return null; const ex=global.exitObjs(sc); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const zone=new Set(); for (const e of ex) { const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) zone.add((e.gx+dx)+','+(e.gy+dy)); }
  const tl=new Map(); for (const l of global.teleLinksFor(global._eo.filter(x=>x.scene===sc).map(e=>({id:e.id,gx:e.gx,gy:e.gy,triggerMode:e.triggerMode})))) tl.set(l.from.join(','), l.to);
  const sk=start.join(','); const seen=new Set([sk]); const q=[start]; let n=0; while(q.length && n++<80000){ const [x,y]=q.shift(); const k=x+','+y; if (k!==sk && zone.has(k)) continue; if (tl.has(k)) { const t=tl.get(k); const tk=t.join(','); if(!seen.has(tk)){ seen.add(tk); q.push(t);} } for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return seen; };

global.isSwitch = (o) => { if (!(o.triggerMode>=4)) return false; const e=global.eoOf(o.id); if(!e||!e.triggerScript) return false; if (global.exitOf(e.triggerScript)) return false; if (global.isFoe(o)) return false; const ops=global.scriptOps(e.triggerScript,30); return ops.some(s=>s.op==='0049'||s.op==='0024'||s.op==='0025'||s.op==='009A'); };
global.solveWalk = async (goal, opts={}) => { const visited=new Set(opts.visited||[]); const log=[]; for (let it=0; it<16; it++) { const sc=pal.world.scene; const pth=await global.path(goal, opts); if (pth) { const w=await global.walkPath(goal, opts); log.push('walk:'+(w.ok?'ok':w.why)); if (w.ok || pal.world.scene!==sc) return {ok:true, log}; }
    const p=pal.world.player; const sw=(pal.world.objectList||[]).filter(o=>global.isSwitch(o) && !visited.has(o.id)).sort((a,b)=>(Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy))-(Math.abs(b.gx-p.gx)+Math.abs(b.gy-p.gy)));
    let moved=false; for (const s of sw) { const q=await global.path((x,y)=>x===s.gx&&y===s.gy, {allow:[s.id]}); if (!q) continue; visited.add(s.id); await global.walkPath((x,y)=>x===s.gx&&y===s.gy, {allow:[s.id]}); await global.drain(); log.push('sw'+s.id); moved=true; break; }
    if (!moved) { log.push('stuck'); return {ok:false, log, visited:[...visited]}; } } return {ok:false, log}; };

global.reachSet = async (sc, start, extraBlock) => { const rows=await global.rowsOfScene(sc); if(!rows||!start) return null; const ex=global.exitObjs(sc); const W=(x,y)=>rows[y]&&rows[y][x]==='.'&&!(extraBlock&&extraBlock.has(x+','+y)); const zone=new Set(); for (const e of ex) { const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) zone.add((e.gx+dx)+','+(e.gy+dy)); }
  const tl=new Map(); for (const l of global.teleLinksFor(global._eo.filter(x=>x.scene===sc).map(e=>({id:e.id,gx:e.gx,gy:e.gy,triggerMode:e.triggerMode})))) tl.set(l.from.join(','), l.to);
  const sk=start.join(','); const seen=new Set([sk]); const q=[start]; let n=0; while(q.length && n++<80000){ const [x,y]=q.shift(); const k=x+','+y; if (k!==sk && zone.has(k)) continue; if (tl.has(k)) { const t=tl.get(k); const tk=t.join(','); if(!seen.has(tk)){ seen.add(tk); q.push(t);} } for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return seen; };
global.reachExits = async (sc, start, extraBlock) => { const seen=await global.reachSet(sc,start,extraBlock); const ex=global.exitObjs(sc); if(!seen) return ex.map(e=>e.id); return ex.filter(e=>{ const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r && seen.has((e.gx+dx)+','+(e.gy+dy))) return true; return false; }).map(e=>e.id); };
global.planTo = async (toScene, tx, ty, rad=1) => { const startScene=pal.world.scene, p=pal.world.player; const key=(s,c)=>s+'@'+(c?c.join(','):'?'); const startK=key(startScene,[p.gx,p.gy]); const prev=new Map([[startK,null]]); const q=[[startScene,[p.gx,p.gy]]]; let goal=null; let n=0;
  while(q.length && n++<500) { const [s,c]=q.shift(); if (s===toScene) { const seen=await global.reachSet(s,c,(s===startScene && c[0]===p.gx && c[1]===p.gy) ? new Set((pal.world.objectList||[]).filter(o=>o.blocking).map(o=>o.gx+','+o.gy)) : null); let ok=false; if (seen) for(let dx=-rad;dx<=rad&&!ok;dx++) for(let dy=-rad;dy<=rad&&!ok;dy++) if (Math.abs(dx)+Math.abs(dy)<=rad && seen.has((tx+dx)+','+(ty+dy))) ok=true; if (ok) { goal=key(s,c); break; } }
    const eb = (s===startScene && c[0]===p.gx && c[1]===p.gy) ? new Set((pal.world.objectList||[]).filter(o=>o.blocking).map(o=>o.gx+','+o.gy)) : null; const ids=await global.reachExits(s,c,eb); for (const id of ids) { const e=global.exitObjs(s).find(x=>x.id===id); if(!e) continue; if (global._badExit && global._badExit.has(s+':'+id)) continue; const nk=key(e.to, e.at); if (prev.has(nk)) continue; prev.set(nk,{from:key(s,c), exit:id, scene:s}); q.push([e.to, e.at]); } }
  if (!goal) return null; const steps=[]; let c=goal; while(prev.get(c)) { const v=prev.get(c); steps.unshift({scene:v.scene, exit:v.exit}); c=v.from; } return steps; };

global._swDone = global._swDone || new Set();
global.activateSwitches = async () => { const log=[]; for (let k=0;k<10;k++) { const p=pal.world.player; const sw=(pal.world.objectList||[]).filter(o=>global.isSwitch(o) && !global._swDone.has(pal.world.scene+':'+o.id)).sort((a,b)=>(Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy))-(Math.abs(b.gx-p.gx)+Math.abs(b.gy-p.gy))); let did=false; for (const s of sw) { const q=await global.path((x,y)=>x===s.gx&&y===s.gy, {allow:[s.id]}); if(!q) continue; global._swDone.add(pal.world.scene+':'+s.id); const sc=pal.world.scene; await global.walkPath((x,y)=>x===s.gx&&y===s.gy, {allow:[s.id]}); await global.drain(); log.push('sw'+s.id); did=true; if (pal.world.scene!==sc) return log; break; } if(!did) break; } return log; };

global._goObj3 = async (sc, id, rad) => { const log=[]; const near=()=>{ const o=pal.world.objects.get(id); const p=pal.world.player; return !o || (Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy) <= (rad??Math.max(1,global.trigR(o.triggerMode)))+1); };
  for (let hop=0; hop<30; hop++) { if (pal.world.scene===sc) { for (let k=0;k<6;k++){ const r=await global.talk(id); await global.drain(); if (pal.world.scene!==sc) { log.push('left scene'); return log; } if (/no reachable|no path|not found/.test(r.note||'')) break; if (near() || !/interrupted/.test(r.note||'')) { log.push('nav '+(r.note||'').slice(0,50)); return log; } }
      const e=global.eoOf(id); const R = rad ?? Math.max(1, global.trigR(e.triggerMode)); const o=pal.world.objects.get(id)||e; const w=await global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=R, {allow:[id]}); await global.drain(); if (w.ok || pal.world.scene!==sc) { log.push('walk '+JSON.stringify(w.pos||'')); return log; } }
    const e=global.eoOf(id); const plan=await global.planTo(sc, e.gx, e.gy, rad ?? 1); if(!plan||!plan.length) { log.push('noplan@'+pal.world.scene); return log; } const st=plan[0]; global._exitCount=global._exitCount||{}; const ek=st.scene+':'+st.exit; global._exitCount[ek]=(global._exitCount[ek]||0)+1; if (global._exitCount[ek]>3) { log.push('osc '+ek); return log; } const ok=await global.takeExit(st.exit); if (ok) await global.activateSwitches(); log.push(st.scene+'>'+pal.world.scene+(ok?'':' FAIL')); } return log; };

global.liveBlock = () => new Set((pal.world.objectList||[]).filter(o=>o.blocking).map(o=>o.gx+','+o.gy));
global.explore = async (targetOk, maxHops=30) => { const taken=global._taken=global._taken||{}; const log=[]; for (let h=0; h<maxHops; h++) { await global.activateSwitches(); if (await targetOk()) { log.push('target reachable'); return {ok:true, log}; }
    const sc=pal.world.scene, p=pal.world.player; const ids=await global.reachExits(sc,[p.gx,p.gy],global.liveBlock()); const cands=ids.map(id=>({id, n:taken[sc+':'+id]||0})).sort((a,b)=>a.n-b.n); if(!cands.length) { log.push('no exits'); return {ok:false,log}; }
    let moved=false; for (const c of cands) { taken[sc+':'+c.id]=(taken[sc+':'+c.id]||0)+1; const ok=await global.takeExit(c.id); if (ok) { log.push(sc+'>'+pal.world.scene+'('+c.id+')'); moved=true; break; } }
    if(!moved) { log.push('cannot move'); return {ok:false,log}; } } return {ok:false, log}; };
global.canReach = async (sc, tx, ty, R) => { if (pal.world.scene!==sc) return false; const p=pal.world.player; const s=await global.reachSet(sc,[p.gx,p.gy],global.liveBlock()); if(!s) return false; for(let dx=-R;dx<=R;dx++)for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R && s.has((tx+dx)+','+(ty+dy))) return true; return false; };

global.BAD_SPELLS.add('銅錢鏢');

global.explore = async (targetOk, maxHops=30, allowScenes=null) => { const taken=global._taken=global._taken||{}; const log=[]; for (let h=0; h<maxHops; h++) { await global.activateSwitches(); if (await targetOk()) { log.push('target reachable'); return {ok:true, log}; }
    const sc=pal.world.scene, p=pal.world.player; const ids=await global.reachExits(sc,[p.gx,p.gy],global.liveBlock()); const cands=ids.filter(id=>{ if(!allowScenes) return true; const e=global.exitObjs(sc).find(x=>x.id===id); return e && allowScenes.includes(e.to); }).map(id=>({id, n:taken[sc+':'+id]||0})).sort((a,b)=>a.n-b.n); if(!cands.length) { log.push('no exits'); return {ok:false,log}; }
    let moved=false; for (const c of cands) { taken[sc+':'+c.id]=(taken[sc+':'+c.id]||0)+1; const ok=await global.takeExit(c.id); if (ok) { log.push(sc+'>'+pal.world.scene+'('+c.id+')'); moved=true; break; } }
    if(!moved) { log.push('cannot move'); return {ok:false,log}; } } return {ok:false, log}; };

global.liveBlock = () => new Set((pal.world.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy));

global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking && !global.isFoe(o)) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id) && !global.isFoe(o) && !!global.exitOf((global.eoOf(o.id)||{}).triggerScript||0)) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { tele.set(l.from.join(','), l); }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.castOut = async (caster, spell, target) => { await global.closeMenus(); await pal.press('Menu'); await pal.choose(1); const ci=pal.world.menu.items.findIndex(x=>x.label===caster); if(ci<0){await global.closeMenus(); return 'nocaster';} await pal.choose(ci); const si=pal.world.menu.items.findIndex(x=>x.label.startsWith(spell)&&x.enabled); if(si<0){await global.closeMenus(); return 'nospell';} await pal.choose(si); if (pal.world.mode==='menu' && pal.world.menu && pal.world.menu.kind==='party') { const ti= typeof target==='number'? target : Math.max(0,pal.world.menu.items.findIndex(x=>x.label.startsWith(target||caster))); await pal.choose(ti); } await global.drain(); await global.closeMenus(); await global.drain(); return 'ok'; };
global.restUp = async () => { const out=[]; for (let k=0;k<6;k++) { const ms=pal.world.members; const low=ms.filter(m=>m.hp<m.maxHp*0.8); if (!low.length) break; const ling=ms.find(m=>m.name==='趙靈兒'); if (ling && ling.mp>=40 && low.length>=2) out.push(await global.castOut('趙靈兒','五氣朝元')); else if (ling && ling.mp>=10) out.push(await global.castOut('趙靈兒','觀音咒', low[0].name)); else break; } return out; };

global.nextHints = (n=80) => { global.takeD(); const lines=global.hist.slice(-3).reverse(); for (const ln of lines) { const txt=ln.split(':').slice(-1)[0].replace(/~\d+$/,''); if (txt.length<2) continue; const hits=global._sc.filter(s=>s.op==='FFFF' && s.text && s.text.includes(txt.slice(0,10))); if (!hits.length) continue; const out=[]; for (const h of hits.slice(0,2)) { for (let a=h.addr, k=0; k<n; a++, k++){ const t=global._byAddr.get(a); if(!t) continue; if (t.op==='0025') { const e=global.eoOf(t.operands[0]); out.push('T'+t.operands[0]+'@'+(e?e.scene:'?')+'>'+t.operands[1]+': '+global.sum(t.operands[1],20).replace(/\[[^\]]*\]/g,'').slice(0,50)); } else if (t.op==='006D') out.push('ENTER '+t.operands[0]+'>'+(t.operands[1]||t.operands[2])); else if (t.op==='0059') out.push('GOTO '+t.operands[0]); else if (t.op==='0049' && t.operands[1]>0) { const e=global.eoOf(t.operands[0]); out.push('SHOW '+t.operands[0]+'@'+(e?e.scene:'?')+' st'+t.operands[1]); } if (t.op==='0000') break; } } return {line:txt, out}; } return null; };

global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking && !global.isFoe(o) && !global.isDoor(o)) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id) && !global.isFoe(o) && !!global.exitOf((global.eoOf(o.id)||{}).triggerScript||0)) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { tele.set(l.from.join(','), l); }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.walkPath = async (goal, opts={}) => { const sc=pal.world.scene; let log=[]; let lastPos=null, same=0; for (let iter=0; iter<60; iter++) {
    const pth=await global.path(goal, opts); const pp0=pal.world.player; if(!pth) return {ok:false, why:'nopath', pos:[pp0.gx,pp0.gy], log};
    if (!pth.steps.length) return {ok:true, log};
    let i=0; while (i<pth.steps.length) { const s=pth.steps[i]; if (s[0]==='T') { i++; await pal.wait(200); await global.drain(opts); break; }
      const before=[pal.world.player.gx,pal.world.player.gy]; { const ex0=[before[0]+(s==='right'?1:s==='left'?-1:0), before[1]+(s==='down'?1:s==='up'?-1:0)]; const d=(pal.world.objectList||[]).find(o=>o.gx===ex0[0]&&o.gy===ex0[1]&&o.blocking&&global.isDoor(o)); if (d) { await global.talk(d.id); } } await pal.step(s,1); const bt=await global.drain(opts); if(bt.length) log.push('battle'); i++;
      const now=[pal.world.player.gx,pal.world.player.gy]; if (pal.world.scene!==sc) return {ok:true, scene:pal.world.scene, log};
      const ex=[before[0]+(s==='right'?1:s==='left'?-1:0), before[1]+(s==='down'?1:s==='up'?-1:0)];
      if (now[0]===before[0]&&now[1]===before[1] && !bt.length) { (global.learnBlock[sc]=global.learnBlock[sc]||new Set()).add(before.join(',')+'>'+ex.join(',')); log.push('blk '+ex.join(',')); break; }
      if (bt.length || now[0]!==ex[0] || now[1]!==ex[1]) { if (pth.steps[i] && pth.steps[i][0]==='T') i++; break; } }
    const pp=pal.world.player; if (goal(pp.gx,pp.gy)) return {ok:true, log, pos:[pp.gx,pp.gy]};
    const k=pp.gx+','+pp.gy; if (k===lastPos) { if(++same>6) return {ok:false, why:'stuck', pos:k, log}; } else { same=0; lastPos=k; }
  } return {ok:false, why:'iter', log}; };

global.planTo = async (toScene, tx, ty, rad=1) => { const startScene=pal.world.scene, p=pal.world.player; const key=(s,c)=>s+'@'+(c?c.join(','):'?'); const startK=key(startScene,[p.gx,p.gy]); const prev=new Map([[startK,null]]); const q=[[startScene,[p.gx,p.gy]]]; let goal=null; let n=0;
  while(q.length && n++<500) { const [s,c]=q.shift(); if (s===toScene) { const seen=await global.reachSet(s,c,(s===startScene && c[0]===p.gx && c[1]===p.gy) ? new Set((pal.world.objectList||[]).filter(o=>o.blocking).map(o=>o.gx+','+o.gy)) : null); let ok=false; if (seen) for(let dx=-rad;dx<=rad&&!ok;dx++) for(let dy=-rad;dy<=rad&&!ok;dy++) if (Math.abs(dx)+Math.abs(dy)<=rad && seen.has((tx+dx)+','+(ty+dy))) ok=true; if (ok) { goal=key(s,c); break; } }
    const eb = (s===startScene && c[0]===p.gx && c[1]===p.gy) ? new Set((pal.world.objectList||[]).filter(o=>o.blocking).map(o=>o.gx+','+o.gy)) : null; const ids=await global.reachExits(s,c,eb); for (const id of ids) { const e=global.exitObjs(s).find(x=>x.id===id); if(!e||!e.at) continue; if (global._badExit && global._badExit.has(s+':'+id)) continue; const nk=key(e.to, e.at); if (prev.has(nk)) continue; prev.set(nk,{from:key(s,c), exit:id, scene:s}); q.push([e.to, e.at]); } }
  if (!goal) return null; const steps=[]; let c=goal; while(prev.get(c)) { const v=prev.get(c); steps.unshift({scene:v.scene, exit:v.exit}); c=v.from; } return steps; };

global._exitObjsBase = global._exitObjsBase || global.exitObjs;
global.exitObjs = (sc) => { const L=global._exitObjsBase(sc); for (const e of L) { if (!e.at && !e._fixed) { const back=global._exitObjsBase(e.to).find(x=>x.to===sc); if (back) e.at=[back.gx, back.gy]; e._fixed=true; } } return L; };

global._goObj3 = async (sc, id, rad) => { const log=[]; const near=()=>{ const o=pal.world.objects.get(id); const p=pal.world.player; return !o || (Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy) <= (rad??Math.max(1,global.trigR(o.triggerMode)))+1); };
  for (let hop=0; hop<30; hop++) { if (pal.world.scene===sc) { for (let k=0;k<6;k++){ const r=await global.talk(id); await global.drain(); if (pal.world.scene!==sc) { log.push('left scene'); return log; } if (/no reachable|no path|not found/.test(r.note||'')) break; if (near() || !/interrupted/.test(r.note||'')) { log.push('nav '+(r.note||'').slice(0,50)); return log; } }
      const e=global.eoOf(id); const R = rad ?? Math.max(1, global.trigR(e.triggerMode)); const o=pal.world.objects.get(id)||e; const w=await global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=R, {allow:[id]}); await global.drain(); if (w.ok || pal.world.scene!==sc) { log.push('walk '+JSON.stringify(w.pos||'')); return log; } }
    const e=global.eoOf(id); let plan=await global.planTo(sc, e.gx, e.gy, rad ?? 1); if(!plan) plan=await global.planTo(sc, e.gx, e.gy, Math.max(3,(rad??1)+2)); if(!plan||!plan.length) { log.push('noplan@'+pal.world.scene); return log; } const st=plan[0]; global._exitCount=global._exitCount||{}; const ek=st.scene+':'+st.exit; global._exitCount[ek]=(global._exitCount[ek]||0)+1; if (global._exitCount[ek]>3) { log.push('osc '+ek); return log; } const ok=await global.takeExit(st.exit); if (ok) await global.activateSwitches(); log.push(st.scene+'>'+pal.world.scene+(ok?'':' FAIL')); } return log; };

global.takeExit = async (id) => { const from=pal.world.scene; const e=global.exitObjs(from).find(x=>x.id===id); const R=global.trigR(e.tm); if (e.tm<4) { await global.talk(id); await global.drain(); if (pal.world.scene!==from) return true; } await global.go(e.gx,e.gy); if (pal.world.scene===from) await global.walkPath((x,y)=>Math.abs(x-e.gx)+Math.abs(y-e.gy)<=R, {allow:[e.id]}); if (pal.world.mode!=='control') await global.drain(); if (pal.world.scene===from) { await global.openDoorsNear(e.gx,e.gy); await global.go(e.gx,e.gy); await global.drain(); } if (pal.world.scene===from) (global._badExit=global._badExit||new Set()).add(from+':'+id); return pal.world.scene!==from; };

global.exitLive = (sc, e) => { if (sc===pal.world.scene) return !!(pal.world.objects && pal.world.objects.get(e.id)); const eo=global.eoOf(e.id); return eo && eo.state>0; };

global.reachSet = async (sc, start, extraBlock) => { const rows=await global.rowsOfScene(sc); if(!rows||!start) return null; const ex=global.exitObjs(sc); const W=(x,y)=>rows[y]&&rows[y][x]==='.'&&!(extraBlock&&extraBlock.has(x+','+y)); const zone=new Set(); for (const e of ex) { if (!global.exitLive(sc,e)) continue; const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r) zone.add((e.gx+dx)+','+(e.gy+dy)); }
  const tl=new Map(); for (const l of global.teleLinksFor(global._eo.filter(x=>x.scene===sc).map(e=>({id:e.id,gx:e.gx,gy:e.gy,triggerMode:e.triggerMode})))) tl.set(l.from.join(','), l.to);
  const sk=start.join(','); const seen=new Set([sk]); const q=[start]; let n=0; while(q.length && n++<80000){ const [x,y]=q.shift(); const k=x+','+y; if (k!==sk && zone.has(k)) continue; if (tl.has(k)) { const t=tl.get(k); const tk=t.join(','); if(!seen.has(tk)){ seen.add(tk); q.push(t);} } for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if (seen.has(nk) || !W(nx,ny)) continue; seen.add(nk); q.push([nx,ny]); } } return seen; };

global.reachExits = async (sc, start, extraBlock) => { const seen=await global.reachSet(sc,start,extraBlock); const ex=global.exitObjs(sc); if(!seen) return ex.map(e=>e.id); return ex.filter(e=>{ if (!global.exitLive(sc,e)) return false; const r=global.trigR(e.tm); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if(Math.abs(dx)+Math.abs(dy)<=r && seen.has((e.gx+dx)+','+(e.gy+dy))) return true; return false; }).map(e=>e.id); };

global.teleLinksFor = (objs) => { const B=global._byAddr; const L=[]; for (const o of objs) { const e=global.eoOf(o.id); if(!e||!e.triggerScript) continue; if(!(o.triggerMode>=4)) continue; { const xx=global.exitOf(e.triggerScript); if (xx) { if (xx.to===e.scene && xx.at) L.push({id:o.id, from:[o.gx,o.gy], to:xx.at}); continue; } }
  const halves=[]; let cur={p:null,t:null}; let X=0,Y=0,n=0,pos=null,bad=false;
  for(let a=e.triggerScript,k=0;k<80;a++,k++){const s=B.get(a); if(!s) continue; if(s.op==='0044') cur.p=global.b2g(...s.operands); if(s.op==='007A'||s.op==='0070') cur.t=global.b2g(...s.operands); if(s.op==='006E'){ let [dx,dy]=s.operands; if(dx>32767) dx-=65536; if(dy>32767) dy-=65536; X+=dx; Y+=dy; n++;} if(s.op==='0046') pos=global.b2g(...s.operands); if(s.op==='0007'||s.op==='0059') {bad=true;break;} if(s.op==='0001'||s.op==='0002'||s.op==='0000'){ if(cur.t) halves.push(cur); cur={p:null,t:null}; if(s.op!=='0001') break; } }
  if (bad) continue; if (halves.length>=2) { const [H1,H2]=halves; L.push({id:o.id, from:H2.p||[o.gx,o.gy], to:H1.t}); L.push({id:o.id, from:H1.p||[o.gx,o.gy], to:H2.t}); } else if (halves.length===1) L.push({id:o.id, from:[o.gx,o.gy], to:halves[0].t}); else if (pos) L.push({id:o.id, from:[o.gx,o.gy], to:pos}); else if (n) L.push({id:o.id, from:[o.gx,o.gy], to:[o.gx+Math.round(X/32+Y/16), o.gy+Math.round(Y/16-X/32)]}); }
  return L.filter(l=>l.from&&l.to); };

global.teleLinks = () => global.teleLinksFor((pal.world.objectList||[]).map(o=>({...o})));

global.path = async (goal, opts={}) => {
  const rows=await global.mapRows(); const p=pal.world.player; const W=(x,y)=>rows[y]&&rows[y][x]==='.';
  const lb=(global.learnBlock&&global.learnBlock[pal.world.scene])||new Set();
  const block=new Set(), avoid=new Set(); const tele=new Map();
  const links = opts.tele===false ? [] : global.teleLinks(); const teleIds=new Set(links.map(l=>l.id));
  for (const o of pal.world.objectList||[]) { const k=o.gx+','+o.gy; if (o.blocking && !global.isFoe(o) && !global.isDoor(o)) { block.add(k); continue; }
    if ((o.kind==='touch-trigger' || (o.kind==='npc' && o.triggerMode>=4)) && !teleIds.has(o.id) && !(opts.allow||[]).includes(o.id) && !global.isFoe(o) && !!global.exitOf((global.eoOf(o.id)||{}).triggerScript||0)) { const r=global.trigR(o.triggerMode); for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) if (Math.abs(dx)+Math.abs(dy)<=r) avoid.add((o.gx+dx)+','+(o.gy+dy)); } }
  for (const l of links) { const lo=(pal.world.objectList||[]).find(o=>o.id===l.id); const R=lo? global.trigR(lo.triggerMode):0; for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) { const kk=(l.from[0]+dx)+','+(l.from[1]+dy); if(!tele.has(kk)) tele.set(kk,l); } }
  const start=p.gx+','+p.gy; avoid.delete(start); const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
  const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; }
    if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; }
    for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)) continue; if(!W(nx,ny) || block.has(nk) || lb.has(k+'>'+nk)) continue; if(avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if (!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.sceneHints = (filter) => { const out=[]; for (const o of (pal.world.objectList||[])) { const e=global._eo.find(x=>x.id===o.id)||{}; if(!e.triggerScript) continue; let s=''; try{ s=String(global.sum(e.triggerScript)).slice(0,70);}catch(_){} if(filter && !filter.test(s)) continue; out.push(o.id+'@'+o.gx+','+o.gy+' tm'+o.triggerMode+': '+s); } return out; };

global.scriptLen = (a, max=400) => { let n=0; for (let k=a; k<a+max; k++) { const s=global._byAddr[k]; if(!s) break; if(s.op==='FFFF') n++; if(s.op==='0000'||s.op==='0001') break; } return n; };
global.storyObjs = (scene) => global._eo.filter(e=>e.scene===scene && e.triggerScript).map(e=>({id:e.id, tm:e.triggerMode, st:e.state, a:e.triggerScript, n:global.scriptLen(e.triggerScript), s:String(global.sum(e.triggerScript)).slice(0,50)})).filter(x=>x.n>=6).sort((a,b)=>b.n-a.n);

global.scriptLen = (a, max=400) => { let n=0; for (let k=a; k<a+max; k++) { const s=global._byAddr.get(k); if(!s) continue; if(s.op==='FFFF') n++; if(s.op==='0000'||s.op==='0001') break; } return n; };

global.sellItems = async (names) => { const log=[]; for (const nm of names) { for (let k=0;k<5;k++) { const m=pal.world.menu; if(!m||!m.items) { log.push('nomenu'); return log; } const idx=m.items.findIndex(i=>(i.label||i).replace(/^\[\d+\] /,'')===nm && i.enabled!==false); if(idx<0) break; await pal.choose(idx); let mm=pal.world.menu; if(mm && mm.items && mm.items.some(i=>(i.label||i)==='是')) { await pal.choose(mm.items.findIndex(i=>(i.label||i)==='是')); } log.push(nm+'->'+pal.world.cash); } } return log; };

global.buyItems = async (names) => { const log=[]; for (const nm of names) { const m=pal.world.menu; if(!m||!m.items) { log.push('nomenu'); return log; } const idx=m.items.findIndex(i=>(i.label||i).replace(/^\[\d+\] /,'').replace(/ \(disabled\)$/,'')===nm); if(idx<0) { log.push(nm+':missing'); continue; } await pal.choose(idx); const mm=pal.world.menu; if(mm && mm.items && mm.items.some(i=>(i.label||i)==='是')) await pal.choose(mm.items.findIndex(i=>(i.label||i)==='是')); log.push(nm+'->'+pal.world.cash); } return log; };

global.talkYes = async (id, yesFirst=true, maxQ=4) => { await global.talk(id); for (let k=0;k<maxQ+6;k++) { await global.drain(); const m=pal.world.menu; if (pal.world.mode==='menu' && m && m.items) { const i=m.items.findIndex(x=>(x.label||x)==='是'||String(x).includes('是')); await pal.choose(i>=0&&yesFirst?i:0); } else if (pal.world.mode==='dialog') { await pal.advance(); } else break; } await global.drain(); return global.recent(10); };

global._planSurviveBase = global._planSurviveBase || global.planAct;
global.SURVIVE_FOES = global.SURVIVE_FOES || ['林天南'];
global.planAct = (ctx) => { const {me,en}=ctx; if ((en||[]).some(e=>global.SURVIVE_FOES.includes(e.name)) || global.SURVIVE) { const c=[]; const mx=me.maxHp||me.maxhp||400; if (me.hp < mx*0.6) { for (const n of ['蜂王蜜','金創藥','行軍丹','醃肉','止血草']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); } c.push(['defend',{}]); return c; } return global._planSurviveBase(ctx); };

global.planAct = (ctx) => { const {me,en}=ctx; if ((en||[]).some(e=>global.SURVIVE_FOES.includes(e.name)) || global.SURVIVE) { const c=[]; if (me.hp < 260) { if (me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:me.index??0}]); for (const n of ['蜂王蜜','金創藥','行軍丹','醃肉','止血草']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); } c.push(['defend',{}]); return c; } return global._planSurviveBase(ctx); };

global.scriptStart = (addr) => { for(let a=addr-1;a>addr-1500;a--){ const s=global._byAddr.get(a); if(s&&(s.op==='0000'||s.op==='0001'||s.op==='0002')) return a+1; } return null; };
global.whoRuns = (addr) => { const st=global.scriptStart(addr)||addr; const cands=new Set([st]); for (let a=st; a<=addr; a++){ const s=global._byAddr.get(a); if(s && s.op!=='FFFF') cands.add(a); } const out=[]; for (const c of cands) { for (const e of global._eo) { if (e.triggerScript===c) out.push('trig obj '+e.id+'@'+e.scene); if (e.autoScript===c) out.push('auto obj '+e.id+'@'+e.scene); } for (const h of global.findOps(y=>['0025','0024','006D','0004','0003','0006'].includes(y.op) && y.operands.includes(c))) out.push(h+' (in '+global.scriptStart(+String(h).split(' ')[0])+')'); } return {st, out}; };
global.chainBack = (addr, depth=6) => { const out=[]; let cur=addr; for (let i=0;i<depth;i++){ const w=global.whoRuns(cur); out.push(cur+' <- '+JSON.stringify(w.out).slice(0,300)); const m=w.out.map(s=>/^(\d+) /.exec(s)).find(Boolean); if(!m) break; cur=+m[1]; } return out; };

global.loot = async (maxDist=999) => { const out=[]; global._looted=global._looted||new Set(); const tries={}; for (let k=0;k<40;k++) { const p=pal.world.player; const c=(pal.world.objectList||[]).filter(o=>global.isLoot(o) && !global._looted.has(pal.world.scene+':'+o.id) && (tries[o.id]||0)<3).sort((a,b)=>(Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy))-(Math.abs(b.gx-p.gx)+Math.abs(b.gy-p.gy)))[0]; if(!c) break; tries[c.id]=(tries[c.id]||0)+1; let r=await global.talk(c.id); if (/no reachable|no path/.test(r.note||'')) { r=await global.grab(c.id); } await global.drain(); const got=(r.lines||[]).some(l=>/獲得|發現|得到|拾得|摘得/.test(l)); if (got || !pal.world.objects.get(c.id) || tries[c.id]>=3) global._looted.add(pal.world.scene+':'+c.id); out.push(c.id+':'+(r.lines||[]).join('/').slice(0,40)); } return out; };

global._visited = global._visited || new Set();
global.yesDrain = async (n=60) => { for (let k=0;k<n;k++) { await global.drain(); const m=pal.world.menu; if (pal.world.mode==='menu' && m && m.items) { const i=m.items.findIndex(x=>(x.label||x)==='是'); await pal.choose(i>=0?i:0); } else if (pal.world.mode==='dialog') await pal.advance(); else break; } await global.drain(); };
global.storyCands = () => { const p=pal.world.player; const out=[]; for (const o of (pal.world.objectList||[])) { const e=global._eo.find(x=>x.id===o.id); if(!e||!e.triggerScript) continue; const a=e.triggerScript; const s=global._byAddr.get(a); let n=global.scriptLen(a); let isExit=false, isBattle=false; for(let k=a;k<a+6;k++){ const x=global._byAddr.get(k); if(!x) continue; if(x.op==='0059') isExit=true; if(x.op==='0007') isBattle=true; } if (isExit && n<2) continue; if (isBattle && n<2) continue; if (global.isLoot(o)) continue; const key=pal.world.scene+':'+o.id; out.push({id:o.id, n, tm:o.triggerMode, d:Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy), v:global._visited.has(key)}); } return out.filter(c=>c.n>=4).sort((a,b)=>(a.v-b.v)||(b.n-a.n)); };
global.advanceStory = async () => { const c=global.storyCands().filter(c=>!c.v)[0]; if(!c) return {none:true}; global._visited.add(pal.world.scene+':'+c.id); const o=pal.world.objects.get(c.id); if (c.tm>=4) { await global.walkPath((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=Math.max(0,global.trigR(c.tm)-0)); } else { await global.talk(c.id); } await global.yesDrain(); return {id:c.id, n:c.n, scene:pal.world.scene, d:global.recent(6)}; };

global.crawl = async (seq, slotBase, opts={}) => { const log=[]; for (let i=0;i<seq.length-1;i++) { const cur=seq[i], nxt=seq[i+1]; if (pal.world.scene!==cur) { log.push('not at '+cur+' (at '+pal.world.scene+')'); break; } if(!opts.noLoot) { try { await global.loot(); } catch(e){} } await global.activateSwitches?.(); const ex=global.exitObjs(cur).find(e=>e.to===nxt); if(!ex){ log.push('no exit '+cur+'>'+nxt); break; } const ok=await global.takeExit(ex.id); await global.yesDrain(); log.push(cur+'>'+pal.world.scene+(ok?'':'(fail)')+' hp '+pal.world.members.map(m=>m.hp).join('/')); if (pal.world.scene!==nxt) break; if (slotBase) await pal.send({op:'CMSG_SAVE', slot:slotBase+i, note:'tower '+nxt}); } return log; };

global.BOSS_PLANS = global.BOSS_PLANS || {};
global.BOSS_PLANS['明王'] = (ctx) => { const {me, party, en} = ctx; const c=[]; const tgt=(en[0]||{}).index||0; const ps=party||[]; const low=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp < (x.p.maxHp||500)*0.45).sort((a,b)=>a.p.hp-b.p.hp); const dead=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  if (me.name==='林月如') { if (low.length && low[0].p===me && me.hp< (me.maxHp||480)*0.3 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:me.index??0}]); if (pal.world.cash>=500) c.push(['magic',{magic:'乾坤一擲',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { if (!global._jiuUsed && me.mp>=250 && global.has('酒')) { global._jiuUsed=true; c.push(['magic',{magic:'酒神',target:tgt}]); } if (dead.length && global.has('還魂香')) c.push(['item',{item:'還魂香',target:dead[0].i}]); if (low.length && me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:low[0].i}]); if (low.length) for (const n of ['蜂王蜜','金創藥','龍涎草']) if (global.has(n)) c.push(['item',{item:n,target:low[0].i}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='趙靈兒') { if (dead.length && me.mp>=0) { /* no revive spell at L14 */ } if ((low.length>=1) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (me.mp>=16) c.push(['magic',{magic:'三昧真火',target:tgt}]); if (me.mp>=15) c.push(['magic',{magic:'五雷咒',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };
global._planBossBase = global._planBossBase || global.planAct;
global.planAct = (ctx) => { const en=ctx.en||[]; for (const e of en) { const f=global.BOSS_PLANS[e.name]; if (f) return f(ctx); } return global._planBossBase(ctx); };

global.BOSS_PLANS['明王'] = (ctx) => { const {me, party, en} = ctx; const c=[]; const tgt=(en[0]||{}).index||0; const ps=party||[]; const lowF=(r)=>ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp < (x.p.maxHp||500)*r).sort((a,b)=>a.p.hp-b.p.hp); const low=lowF(0.5); const dead=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  if (me.name==='林月如') { if (pal.world.cash>=500) c.push(['magic',{magic:'乾坤一擲',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { if (me.mp>=250 && global.has('酒') && !(lowF(0.3).length)) c.push(['magic',{magic:'酒神',target:tgt}]); if (dead.length && global.has('還魂香')) c.push(['item',{item:'還魂香',target:dead[0].i}]); if (low.length && me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:low[0].i}]); if (low.length) for (const n of ['蜂王蜜','金創藥','龍涎草']) if (global.has(n)) c.push(['item',{item:n,target:low[0].i}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='趙靈兒') { if (lowF(0.6).length && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (me.mp>=16) c.push(['magic',{magic:'三昧真火',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };

global.DRAGON_WEAK = {'土神龍':['三昧真火'], '火神龍':['風雪冰天','玄冰咒'], '冰神龍':['天雷破','五雷咒'], '風神龍':['地裂天崩','泰山壓頂','飛岩術'], '雷神龍':['風捲殘雲','旋風咒'], '毒神龍':['天雷破'], '金神龍':['天雷破','地裂天崩']};
global.dragonPlan = (ctx) => { const {me, party, en} = ctx; const c=[]; const e0=en[0]||{}; const tgt=e0.index||0; const ps=party||[]; const lowF=(r)=>ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp < (x.p.maxHp||500)*r).sort((a,b)=>a.p.hp-b.p.hp); const dead=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0); const phys = e0.name!=='金神龍';
  global._dragonTurn=(global._dragonTurn||0);
  if (me.name==='趙靈兒') { if ((lowF(0.5).length>=2 || lowF(0.3).length) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (dead.length && me.mp>=0) c.push(['magic',{magic:'還魂咒',target:dead[0].i}]); for (const s of (global.DRAGON_WEAK[e0.name]||['天雷破'])) c.push(['magic',{magic:s,target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { if (dead.length && global.has('還魂香')) c.push(['item',{item:'還魂香',target:dead[0].i}]); const lw=lowF(0.35); if (lw.length && me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:lw[0].i}]); if (!global._tg && phys && me.mp>=13) { global._tg=true; c.push(['magic',{magic:'天罡戰氣',target:0}]); } if (phys) c.push(['attack',{target:tgt}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]); if (me.mp>=25) c.push(['magic',{magic:'萬劍訣',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='林月如') { const lw=lowF(0.3); if (lw.length && lw[0].p===me && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:me.index??0}]); if (me.mp>=46) c.push(['magic',{magic:'斬龍訣',target:tgt}]); if (phys) c.push(['attack',{target:tgt}]); if (me.mp>=30) c.push(['magic',{magic:'七訣劍氣',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };
for (const n of ['土神龍','火神龍','冰神龍','風神龍','雷神龍','毒神龍','金神龍']) global.BOSS_PLANS[n]=global.dragonPlan;

global.healAll = async () => { for (let i=0;i<5;i++){ const ms=pal.world.members; if (!ms.some(m=>m.hp<m.maxHp-60)) break; const ling=ms.find(m=>m.name==='趙靈兒'); if (ling && ling.mp>=40) await global.castOut('趙靈兒','五氣朝元',0); else { const lo=ms.map((m,ix)=>[m,ix]).sort((a,b)=>a[0].hp/a[0].maxHp-b[0].hp/b[0].maxHp)[0]; await global.castOut('李逍遙','凝神歸元',lo[1]); } } };
global.dragonRun = async (ids, slot, budgetMs=100000) => { const t0=Date.now(); const log=[]; for (const id of ids) { if (Date.now()-t0>budgetMs) { log.push('time'); break; } if (!pal.world.objects.get(id)) { log.push(id+' gone'); continue; } await global.healAll(); await pal.send({op:'CMSG_SAVE', slot, note:'dragon '+id}); global._tg=false; global.fightLog.length=0; await global.talk(id); await global.yesDrain(); const r=pal.world.lastBattleResult; log.push(id+':'+(r&&r.result)+' '+pal.world.members.map(m=>m.hp+'/'+m.mp).join(',')+' fl:'+(global.fightLog.slice(-1)[0]||'').slice(-30)); if (r && r.result!=='won') break; } return log; };

global._dragonPlanBase = global._dragonPlanBase || global.dragonPlan;
global.dragonPlan = (ctx) => { const {me, party, en} = ctx; const tgt=(en[0]||{}).index||0; const ps=party||[]; const c=[];
  if (me.name==='林月如' && pal.world.cash>=5000 && global.DRAGON_CASH) c.push(['magic',{magic:'乾坤一擲',target:tgt}]);
  if (me.name==='李逍遙') { const ling=ps.map((p,i)=>({p,i})).find(x=>x.p.name==='趙靈兒'); if (ling && ling.p.hp>0 && ling.p.mp<50 && global.has('靈葫仙丹')) c.push(['item',{item:'靈葫仙丹',target:ling.i}]); }
  return c.concat(global._dragonPlanBase(ctx)); };
for (const n of ['土神龍','火神龍','冰神龍','風神龍','雷神龍','毒神龍','金神龍']) global.BOSS_PLANS[n]=global.dragonPlan;

global._dS = global._dS || {};
global.dragonPlan2 = (ctx) => { const {me, party, en} = ctx; const c=[]; const e0=en[0]||{}; const tgt=e0.index||0; const ps=party||[]; const bid=(pal.world.battle&&pal.world.battle.id)||pal.world.lastBattleResult?.battle||0; const bk=String(global._battleKey||''); 
  const lowF=(r)=>ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp < (x.p.maxHp||500)*r).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp); const dead=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0); const phys=e0.name!=='金神龍';
  const idx=n=>ps.findIndex(p=>p.name===n);
  global._dS[me.name]=(global._dS[me.name]||0)+1; const k=global._dS[me.name]-1;
  if (me.name==='李逍遙') { const lw=lowF(0.35); if (lw.length && me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:lw[0].i}]); const m8=k%8; if (m8===0 && me.mp>=18 && idx('趙靈兒')>=0 && ps[idx('趙靈兒')].hp>0) c.push(['magic',{magic:'真元護體',target:idx('趙靈兒')}]); if (m8===1 && me.mp>=18) c.push(['magic',{magic:'真元護體',target:idx('李逍遙')}]); if (m8===2 && phys && me.mp>=13) c.push(['magic',{magic:'天罡戰氣',target:idx('李逍遙')}]); if (m8===3 && me.mp>=18 && idx('林月如')>=0) c.push(['magic',{magic:'真元護體',target:idx('林月如')}]); if (phys) c.push(['attack',{target:tgt}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='趙靈兒') { if ((lowF(0.5).length>=2 || lowF(0.3).length) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (me.mp>=60) for (const s of (global.DRAGON_WEAK[e0.name]||['天雷破'])) c.push(['magic',{magic:s,target:tgt}]); else if (lowF(0.6).length && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='林月如') { const lw=lowF(0.3); if (lw.length && lw[0].p.name==='林月如' && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:idx('林月如')}]); if (!phys && me.mp>=46) c.push(['magic',{magic:'斬龍訣',target:tgt}]); if (phys) c.push(['attack',{target:tgt}]); if (me.mp>=46) c.push(['magic',{magic:'斬龍訣',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };
for (const n of ['土神龍','火神龍','冰神龍','風神龍','雷神龍','毒神龍','金神龍']) global.BOSS_PLANS[n]=global.dragonPlan2;
global.healAll = async () => { for (let i=0;i<6;i++){ const ms=pal.world.members; const lo=ms.map((m,ix)=>[m,ix]).filter(([m])=>m.hp<m.maxHp-100).sort((a,b)=>a[0].hp/a[0].maxHp-b[0].hp/b[0].maxHp)[0]; if(!lo) break; const xy=ms.find(m=>m.name==='李逍遙'); if (xy && xy.mp>=60) await global.castOut('李逍遙','凝神歸元',lo[1]); else break; } };
global.dragonRun = async (ids, slot, budgetMs=100000) => { const t0=Date.now(); const log=[]; for (const id of ids) { if (Date.now()-t0>budgetMs) { log.push('time'); break; } if (!pal.world.objects.get(id)) { log.push(id+' gone'); continue; } await global.healAll(); await pal.send({op:'CMSG_SAVE', slot, note:'dragon '+id}); global._dS={}; global.fightLog.length=0; await global.talk(id); await global.yesDrain(); const r=pal.world.lastBattleResult; log.push(id+':'+(r&&r.result)+' '+pal.world.members.map(m=>m.hp+'/'+m.mp).join(',')+' fl:'+(global.fightLog.slice(-1)[0]||'').slice(-34)); if (r && r.result!=='won') break; } return log; };

global.dragonPlan3 = (ctx) => { const {me, party, en} = ctx; const c=[]; const e0=en[0]||{}; const tgt=e0.index||0; const ps=party||[]; const phys=e0.name!=='金神龍';
  const lowF=(r)=>ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp < (x.p.maxHp||500)*r).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp); const idx=n=>ps.findIndex(p=>p.name===n);
  global._dS[me.name]=(global._dS[me.name]||0)+1; const k=global._dS[me.name]-1;
  if (me.name==='趙靈兒') { if (lowF(global.DH||0.65).length && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (me.mp>=28) for (const s of (global.DRAGON_WEAK[e0.name]||['天雷破'])) c.push(['magic',{magic:s,target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { const lw=lowF(0.45); if (lw.length && me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:lw[0].i}]); if (k===0 && phys && me.mp>=13) c.push(['magic',{magic:'天罡戰氣',target:idx('李逍遙')}]); if (phys) c.push(['attack',{target:tgt}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='林月如') { const lw=lowF(0.35); if (lw.length && lw[0].p.name==='林月如' && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:idx('林月如')}]); if (!phys && me.mp>=46) c.push(['magic',{magic:'斬龍訣',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };
for (const n of ['土神龍','火神龍','冰神龍','風神龍','雷神龍','毒神龍','金神龍']) global.BOSS_PLANS[n]=global.dragonPlan3;

global._dp3 = global._dp3 || global.dragonPlan3;
global.dragonPlan4 = (ctx) => { const {me, party} = ctx; const ps=party||[]; const c=[]; if (me.name==='李逍遙' || me.name==='林月如') { const li=ps.findIndex(p=>p.name==='趙靈兒'); if (li>=0 && ps[li].hp>0 && ps[li].mp<45 && global.has('靈葫仙丹')) c.push(['item',{item:'靈葫仙丹',target:li}]); } return c.concat(global._dp3(ctx)); };
for (const n of ['土神龍','火神龍','冰神龍','風神龍','雷神龍','毒神龍','金神龍']) global.BOSS_PLANS[n]=global.dragonPlan4;

global.castOut = async (caster, spell, target) => { await global.closeMenus(); await pal.press('Menu'); await pal.choose(1); let items=(pal.world.menu&&pal.world.menu.items)||[]; const ci=items.findIndex(x=>x.label===caster); if(ci>=0){ await pal.choose(ci); items=(pal.world.menu&&pal.world.menu.items)||[]; } else if (!items.some(x=>String(x.label).startsWith(spell))) { await global.closeMenus(); return 'nocaster'; } const si=items.findIndex(x=>String(x.label).startsWith(spell)&&x.enabled!==false); if(si<0){await global.closeMenus(); return 'nospell';} await pal.choose(si); if (pal.world.mode==='menu' && pal.world.menu && pal.world.menu.kind==='party') { const ti= typeof target==='number'? target : Math.max(0,pal.world.menu.items.findIndex(x=>x.label.startsWith(target||caster))); await pal.choose(Math.min(ti, pal.world.menu.items.length-1)); } await global.drain(); await global.closeMenus(); await global.drain(); return 'ok'; };

global.vineExplore = async (goalId, budgetMs=90000, maxD=25) => { const t0=Date.now(); const G=global._vine=global._vine||{edges:{}, tried:{}}; const log=[];
  const goal=()=>{ const g=pal.world.objects.get(goalId); if(!g) return false; const p=pal.world.player; return Math.abs(p.gx-g.gx)+Math.abs(p.gy-g.gy)<=2; };
  while (Date.now()-t0<budgetMs) { if (pal.world.scene!==192) { log.push('left scene '+pal.world.scene); break; }
    const g=pal.world.objects.get(goalId); const p=pal.world.player; const here=p.gx+','+p.gy;
    // try direct walk to goal
    const r0=await global.path((a,b)=>Math.abs(a-g.gx)+Math.abs(b-g.gy)<=1,{tele:false}); if (r0 && r0.steps.length<60) { await global.walkPath((a,b)=>Math.abs(a-g.gx)+Math.abs(b-g.gy)<=1); log.push('walk goal'); break; }
    const links=global.teleLinks().map(l=>({...l, d:Math.abs(l.from[0]-p.gx)+Math.abs(l.from[1]-p.gy), gd:Math.abs(l.to[0]-g.gx)+Math.abs(l.to[1]-g.gy)})).filter(l=>l.d<=maxD && !(G.tried[here+'>'+l.id]));
    if (!links.length) { log.push('stuck '+here); break; }
    links.sort((a,b)=>(a.gd-b.gd)+(a.d-b.d)*0.5);
    const l=links[0]; G.tried[here+'>'+l.id]=1;
    const res=await pal.send({op:'CMSG_NOOP'}).catch(()=>null);
    const w=await global.walkPath((a,b)=>a===l.from[0]&&b===l.from[1]); await global.yesDrain();
    const np=pal.world.player; const nk=np.gx+','+np.gy; G.edges[here+'>'+l.id]=nk; log.push(l.id+':'+here+'->'+nk);
  }
  return log; };

global.vineExplore = async (goalId, budgetMs=90000, maxD=25) => { const t0=Date.now(); const G=global._vine=global._vine||{edges:{}, tried:{}}; const log=[];
  const goal=()=>{ const g=pal.world.objects.get(goalId); if(!g) return false; const p=pal.world.player; return Math.abs(p.gx-g.gx)+Math.abs(p.gy-g.gy)<=2; };
  while (Date.now()-t0<budgetMs) { if (pal.world.scene!==192) { log.push('left scene '+pal.world.scene); break; }
    const g=pal.world.objects.get(goalId); const p=pal.world.player; const here=p.gx+','+p.gy;
    // try direct walk to goal
    const r0=await global.path((a,b)=>Math.abs(a-g.gx)+Math.abs(b-g.gy)<=1,{tele:false}); if (r0 && r0.steps.length<60) { await global.walkPath((a,b)=>Math.abs(a-g.gx)+Math.abs(b-g.gy)<=1); log.push('walk goal'); break; }
    const links=global.teleLinks().map(l=>({...l, d:Math.abs(l.from[0]-p.gx)+Math.abs(l.from[1]-p.gy), gd:Math.abs(l.to[0]-g.gx)+Math.abs(l.to[1]-g.gy)})).filter(l=>l.d<=maxD && !(G.tried[here+'>'+l.id]));
    if (!links.length) { log.push('stuck '+here); break; }
    links.sort((a,b)=>(a.gd-b.gd)+(a.d-b.d)*0.5);
    const l=links[0]; G.tried[here+'>'+l.id]=1;
    const res=await pal.send({op:'CMSG_NOOP'}).catch(()=>null);
    const w=await global.walkPath((a,b)=>Math.abs(a-l.from[0])+Math.abs(b-l.from[1])<=1); await global.yesDrain();
    const np=pal.world.player; const nk=np.gx+','+np.gy; G.edges[here+'>'+l.id]=nk; log.push(l.id+':'+here+'->'+nk);
  }
  return log; };

global.path2 = async (goal) => { const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const block=new Set((pal.world.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy)); const links=global.teleLinks(); const tele=new Map(); for (const l of links) { const lo=pal.world.objects.get(l.id); const R=lo?global.trigR(lo.triggerMode):1; for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) { const kk=(l.from[0]+dx)+','+(l.from[1]+dy); if(!tele.has(kk)) tele.set(kk,l); } }
  const p=pal.world.player; const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null; const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; } if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){ prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; } for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)||!W(nx,ny)||block.has(nk)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if(!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };
global.walk2 = async (goal, budgetMs=90000) => { const t0=Date.now(); const sc=pal.world.scene; let n=0; while (Date.now()-t0<budgetMs) { if (pal.world.scene!==sc) return {ok:true, left:true}; const p=pal.world.player; if (goal(p.gx,p.gy)) return {ok:true}; const pth=await global.path2(goal); if(!pth) return {ok:false, why:'nopath', pos:[p.gx,p.gy]}; const s=pth.steps[0]; if (!s) return {ok:true}; if (s[0]==='T') { return {ok:false, why:'tele-first?'}; } const before=p.gx+','+p.gy; await pal.step(s,1); await global.drain(); if (pal.world.mode==='battle') { await global.fight(); await global.yesDrain(); } n++; const a=pal.world.player; if (a.gx+','+a.gy===before) { global._w2stuck=(global._w2stuck||0)+1; if (global._w2stuck>3) return {ok:false, why:'stuck', pos:[a.gx,a.gy], step:s}; } else global._w2stuck=0; } return {ok:false, why:'time', n}; };

global.path2 = async (goal) => { const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const block=new Set((pal.world.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy)); const links=global.teleLinks(); const tele=new Map(); for (const l of links) { const lo=pal.world.objects.get(l.id); const R=lo?global.trigR(lo.triggerMode):1; for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) { const kk=(l.from[0]+dx)+','+(l.from[1]+dy); if(!tele.has(kk)) tele.set(kk,l); } }
  const avoid=new Set(); for (const o of (pal.world.objectList||[])) { if (links.some(l=>l.id===o.id)) continue; if (o.triggerMode<4) continue; const e=global.eoOf(o.id)||{}; if (!global.exitOf(e.triggerScript||0)) continue; const R=global.trigR(o.triggerMode); for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) avoid.add((o.gx+dx)+','+(o.gy+dy)); } const p=pal.world.player; avoid.delete(p.gx+','+p.gy); const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null; const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; } if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){ prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; } for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)||!W(nx,ny)||block.has(nk)) continue; if (avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if(!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.path2 = async (goal) => { const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const block=new Set((pal.world.objectList||[]).filter(o=>o.blocking && !global.isFoe(o) && !(global.PASS_IDS||[]).includes(o.id)).map(o=>o.gx+','+o.gy)); const links=global.teleLinks(); const tele=new Map(); for (const l of links) { const lo=pal.world.objects.get(l.id); const R=lo?global.trigR(lo.triggerMode):1; for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) { const kk=(l.from[0]+dx)+','+(l.from[1]+dy); if(!tele.has(kk)) tele.set(kk,l); } }
  const avoid=new Set(); for (const o of (pal.world.objectList||[])) { if (links.some(l=>l.id===o.id)) continue; if (o.triggerMode<4) continue; const e=global.eoOf(o.id)||{}; if (!global.exitOf(e.triggerScript||0)) continue; const R=global.trigR(o.triggerMode); for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) avoid.add((o.gx+dx)+','+(o.gy+dy)); } const p=pal.world.player; avoid.delete(p.gx+','+p.gy); const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null; const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; } if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){ prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; } for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)||!W(nx,ny)||block.has(nk)) continue; if (avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if(!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global._teleLinksBase = global._teleLinksBase || global.teleLinks;
global.teleLinks = () => { const ls=global._teleLinksBase(); for (const l of ls) { if (l.to && l.from && l.to[0]===l.from[0] && l.to[1]===l.from[1]) { const e=global.eoOf(l.id)||{}; for (let a=e.triggerScript||0; a<(e.triggerScript||0)+30; a++) { const s=global._byAddr.get(a); if(!s) continue; if (s.op==='0044') { l.to=global.b2g(s.operands[0], s.operands[1], s.operands[2]); l.ride=true; break; } if (s.op==='0000') break; } } } return ls; };

global.walk2 = async (goal, budgetMs=90000) => { const t0=Date.now(); const sc=pal.world.scene; let n=0; while (Date.now()-t0<budgetMs) { if (pal.world.scene!==sc) return {ok:true, left:true}; const p=pal.world.player; if (goal(p.gx,p.gy)) return {ok:true}; const pth=await global.path2(goal); if(!pth) return {ok:false, why:'nopath', pos:[p.gx,p.gy]}; const s=pth.steps[0]; if (!s) return {ok:true}; if (s[0]==='T') { return {ok:false, why:'tele-first?'}; } const before=p.gx+','+p.gy; await pal.step(s,1); await global.drain(); if (pal.world.mode==='battle') { await global.fight(); await global.yesDrain(); } n++; const a=pal.world.player; if (a.gx+','+a.gy===before) { global._w2stuck=(global._w2stuck||0)+1; if (global._w2stuck===2) { for (const id of (global.PASS_IDS||[])) { const o=pal.world.objects.get(id); if (o && Math.abs(o.gx-a.gx)+Math.abs(o.gy-a.gy)<=2) { await global.talk(id); await global.yesDrain(); } } } if (global._w2stuck>4) return {ok:false, why:'stuck', pos:[a.gx,a.gy], step:s}; } else global._w2stuck=0; } return {ok:false, why:'time', n}; };

global.walk2 = async (goal, budgetMs=90000) => { const t0=Date.now(); const sc=pal.world.scene; let n=0; while (Date.now()-t0<budgetMs) { if (pal.world.scene!==sc) return {ok:true, left:true}; const p=pal.world.player; if (goal(p.gx,p.gy)) return {ok:true}; const pth=await global.path2(goal); if(!pth) return {ok:false, why:'nopath', pos:[p.gx,p.gy]}; const s=pth.steps[0]; if (!s) return {ok:true}; if (s[0]==='T') { return {ok:false, why:'tele-first?'}; } const before=p.gx+','+p.gy; await pal.step(s,1); await global.drain(); if (pal.world.mode==='battle') { await global.fight(); await global.yesDrain(); } if (pal.world.mode==='control') { const ms=pal.world.members; const lo=ms.map((m,i)=>[m,i]).filter(([m])=>m.hp<m.maxHp*0.65).sort((a,b)=>a[0].hp/a[0].maxHp-b[0].hp/b[0].maxHp)[0]; if (lo) { const c=ms.find(m=>m.name==='李逍遙'&&m.mp>=18); if (c) await global.castOut('李逍遙','凝神歸元',lo[1]); } } n++; const a=pal.world.player; if (a.gx+','+a.gy===before) { global._w2stuck=(global._w2stuck||0)+1; if (global._w2stuck===2) { for (const id of (global.PASS_IDS||[])) { const o=pal.world.objects.get(id); if (o && Math.abs(o.gx-a.gx)+Math.abs(o.gy-a.gy)<=2) { await global.talk(id); await global.yesDrain(); } } } if (global._w2stuck>4) return {ok:false, why:'stuck', pos:[a.gx,a.gy], step:s}; } else global._w2stuck=0; } return {ok:false, why:'time', n}; };

global._planSoloBase = global._planSoloBase || global.planAct;
global.planAct = (ctx) => { const c=global._planSoloBase(ctx); const {me, party}=ctx; if ((party||[]).length===1 && me.hp < (me.maxHp||500)*0.45 && me.mp>=18) return [['magic',{magic:'凝神歸元',target:me.index??0}], ...c]; return c; };

global.BOSS_PLANS['鳳凰'] = (ctx) => { const {me, en}=ctx; const tgt=(en[0]||{}).index||0; const c=[]; global._fh=(global._fh||0)+1; const k=global._fh-1;
  if (k===0 && global.has('無影毒')) c.push(['throw',{item:'無影毒',target:tgt}]);
  if (k===1 && global.has('金剛符')) c.push(['item',{item:'金剛符',target:me.index??0}]);
  if (me.hp < (me.maxHp||500)*0.45) { for (const n of ['蟠果','聖靈符']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); if (me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:me.index??0}]); }
  if (me.mp < 30) { for (const n of ['靈山仙芝','龍涎草']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); }
  if (me.mp>=25) c.push(['magic',{magic:'萬劍訣',target:tgt}]);
  c.push(['attack',{target:tgt}]); return c; };

global.BOSS_PLANS['鳳凰'] = (ctx) => { const {me, en}=ctx; const tgt=(en[0]||{}).index||0; const c=[]; global._fh=(global._fh||0)+1; const k=global._fh-1;
  if (k===0 && global.has('無影毒')) c.push(['throw',{item:'無影毒',target:tgt}]);
  if (me.hp < (me.maxHp||500)*0.55) { if (me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:me.index??0}]); for (const n of ['蟠果','聖靈符']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); if (me.mp>=18) c.push(['magic',{magic:'凝神歸元',target:me.index??0}]); }
  if (me.mp < 60) { for (const n of ['靈山仙芝','龍涎草','鼠兒果']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); }
  if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]);
  if (me.mp>=25) c.push(['magic',{magic:'萬劍訣',target:tgt}]);
  c.push(['attack',{target:tgt}]); return c; };

global.planAct = (ctx) => { const c=global._planSoloBase(ctx); const {me, party, en}=ctx; if ((en||[]).some(e=>global.BOSS_PLANS[e.name])) return c; if ((party||[]).length===1 && me.hp < (me.maxHp||500)*0.45 && me.mp>=18) return [['magic',{magic:'凝神歸元',target:me.index??0}], ...c]; return c; };

global.BOSS_PLANS['麒麟'] = (ctx) => { const {me, party, en}=ctx; const tgt=(en[0]||{}).index||0; const ps=party||[]; const c=[]; const low=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<(x.p.maxHp||500)*0.5).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp); const dead=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  if (me.name==='阿奴') { if (dead.length && global.has('還魂香')) c.push(['item',{item:'還魂香',target:dead[0].i}]); if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); if (me.mp<40) for (const n of ['靈山仙芝','龍涎草']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); if (me.mp>=28) c.push(['magic',{magic:'天雷破',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { if (me.hp<(me.maxHp||500)*0.45 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:me.index??0}]); if (me.mp<50) for (const n of ['靈山仙芝','龍涎草','靈葫仙丹']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };

global.BOSS_PLANS['麒麟'] = (ctx) => { const {me, party, en}=ctx; const tgt=(en[0]||{}).index||0; const ps=party||[]; const c=[]; const low=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<(x.p.maxHp||500)*0.6).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp); const dead=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  for (const n of ['還魂香','孟婆湯']) if (dead.length && global.has(n)) c.push(['item',{item:n,target:dead[0].i}]);
  if (low.length>=2 && global.has('聖靈符')) c.push(['item',{item:'聖靈符',target:0}]);
  if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
  if (low.length && global.has('蟠果')) c.push(['item',{item:'蟠果',target:low[0].i}]);
  if (me.mp<45) for (const n of ['靈山仙芝','龍涎草','靈葫仙丹']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]);
  if (me.name==='阿奴' && me.mp>=28) c.push(['magic',{magic:'天雷破',target:tgt}]);
  if (me.name==='李逍遙' && me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]);
  c.push(['attack',{target:tgt}]); return c; };

global.relJumps = () => { const out=[]; for (const o of (pal.world.objectList||[])) { if (o.triggerMode<4) continue; const e=global.eoOf(o.id)||{}; const a0=e.triggerScript||0; if(!a0) continue; let dx=0, dy=0, ok=true, n=0; for (let a=a0; a<a0+60; a++) { const s=global._byAddr.get(a); if(!s) continue; if (s.op==='006E') { const sx=s.operands[0]>32767?s.operands[0]-65536:s.operands[0]; const sy=s.operands[1]>32767?s.operands[1]-65536:s.operands[1]; dx+=sx; dy+=sy; n++; continue; } if (s.op==='0009') continue; if (s.op==='0000') break; ok=false; break; } if (ok && n>0) { const dgx=Math.round(dx/32+dy/16), dgy=Math.round(dy/16-dx/32); out.push({id:o.id, at:[o.gx,o.gy], R:global.trigR(o.triggerMode), rel:[dgx,dgy]}); } } return out; };

global.path2 = async (goal) => { const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const block=new Set((pal.world.objectList||[]).filter(o=>o.blocking && !global.isFoe(o) && !(global.PASS_IDS||[]).includes(o.id)).map(o=>o.gx+','+o.gy)); const links=global.teleLinks(); const tele=new Map(); for (const l of links) { const lo=pal.world.objects.get(l.id); const R=lo?global.trigR(lo.triggerMode):1; for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) { const kk=(l.from[0]+dx)+','+(l.from[1]+dy); if(!tele.has(kk)) tele.set(kk,l); } }
  const avoid=new Set(); for (const o of (pal.world.objectList||[])) { if (links.some(l=>l.id===o.id)) continue; if (o.triggerMode<4) continue; const e=global.eoOf(o.id)||{}; if (!global.exitOf(e.triggerScript||0)) continue; const R=global.trigR(o.triggerMode); for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) avoid.add((o.gx+dx)+','+(o.gy+dy)); } const rj=global.relJumps(); const relZ=new Map(); for (const j of rj) { for(let dx=-j.R;dx<=j.R;dx++) for(let dy=-j.R;dy<=j.R;dy++) if(Math.abs(dx)+Math.abs(dy)<=j.R) { const kk=(j.at[0]+dx)+','+(j.at[1]+dy); if(!relZ.has(kk)) relZ.set(kk,j); } } const p=pal.world.player; avoid.delete(p.gx+','+p.gy); const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null; const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; } if (k!==start && relZ.has(k)) { const j=relZ.get(k); const nx2=x+j.rel[0], ny2=y+j.rel[1]; const nk=nx2+','+ny2; if(!prev.has(nk)){ prev.set(nk,{k,tele:'R'+j.id}); q.push([nx2,ny2]); } continue; } if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){ prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; } for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)||!W(nx,ny)||block.has(nk)) continue; if (avoid.has(nk) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if(!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global.relJumps = () => { const out=[]; for (const o of (pal.world.objectList||[])) { if (o.triggerMode<4) continue; const e=global.eoOf(o.id)||{}; const a0=e.triggerScript||0; if(!a0) continue; let dx=0, dy=0, ok=true, n=0; for (let a=a0; a<a0+60; a++) { const s=global._byAddr.get(a); if(!s) continue; if (s.op==='006E') { const sx=s.operands[0]>32767?s.operands[0]-65536:s.operands[0]; const sy=s.operands[1]>32767?s.operands[1]-65536:s.operands[1]; dx+=sx; dy+=sy; n++; continue; } if (s.op==='0000') break; if (['0059','0007','0046','007A','0070','0044'].includes(s.op)) { ok=false; break; } continue; } if (ok && n>0) { const dgx=Math.round(dx/32+dy/16), dgy=Math.round(dy/16-dx/32); out.push({id:o.id, at:[o.gx,o.gy], R:global.trigR(o.triggerMode), rel:[dgx,dgy]}); } } return out; };

global.advanceStory2 = async (budgetMs=80000) => { const t0=Date.now(); const log=[]; while (Date.now()-t0<budgetMs) { const sc=pal.world.scene; const c=global.storyCands().filter(c=>!c.v)[0]; if(!c) { log.push('none@'+sc); break; } global._visited.add(sc+':'+c.id); const o=pal.world.objects.get(c.id); if(!o) continue; if (c.tm>=4) { const R=global.trigR(c.tm); await global.walk2((a,b)=>Math.abs(a-o.gx)+Math.abs(b-o.gy)<=R, Math.max(10000, budgetMs-(Date.now()-t0))); } else { await global.walk2((a,b)=>Math.abs(a-o.gx)+Math.abs(b-o.gy)===1, Math.max(10000, budgetMs-(Date.now()-t0))); await global.talk(c.id); } await global.yesDrain(); log.push(sc+':'+c.id+'->'+pal.world.scene+' '+(global.recent(1)[0]||'').slice(0,24)); } return log; };

global.BOSS_PLANS['八頭蛇'] = (ctx) => { const {me, party, en}=ctx; const tgt=(en[0]||{}).index||0; const ps=party||[]; const c=[]; const low=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<(x.p.maxHp||500)*0.55).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp);
  if (me.name==='巫后') { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); if (me.mp>=68) c.push(['magic',{magic:'雷神',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { if (me.hp<(me.maxHp||500)*0.45 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:me.index??0}]); if (me.mp<50) for (const n of ['靈山仙芝','龍涎草','靈葫仙丹']) if (global.has(n)) c.push(['item',{item:n,target:me.index??0}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };

global._snakeBase = global.BOSS_PLANS['八頭蛇'];
global.BOSS_PLANS['八頭蛇'] = (ctx) => global._fleeSnake ? [['flee',{}], ...global._snakeBase(ctx)] : global._snakeBase(ctx);

global.dash = async (goal, budgetMs=60000) => { const t0=Date.now(); let replans=0; while (Date.now()-t0<budgetMs) { const p=pal.world.player; if (goal(p.gx,p.gy)) return {ok:true}; const sc=pal.world.scene; const pth=await global.path2(goal); if(!pth) return {ok:false, why:'nopath'}; replans++; const st=pth.steps; let i=0; while (i<st.length) { const d=st[i]; if (d[0]==='T') { i++; break; } let n=1; while (i+n<st.length && st[i+n]===d && n<4) n++; const before=pal.world.player.gx+','+pal.world.player.gy; await pal.step(d,n); i+=n; if (pal.world.mode!=='control' || pal.world.scene!==sc) break; const after=pal.world.player.gx+','+pal.world.player.gy; if (after===before) break; } if (pal.world.mode==='battle') { await global.fight(); } await global.yesDrain(); if (pal.world.scene!==sc) return {ok:true, left:true, replans}; } return {ok:false, why:'time', replans}; };

global.path2 = async (goal) => { const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const block=new Set((pal.world.objectList||[]).filter(o=>o.blocking && !global.isFoe(o) && !(global.PASS_IDS||[]).includes(o.id)).map(o=>o.gx+','+o.gy)); const links=global.teleLinks(); const tele=new Map(); for (const l of links) { const lo=pal.world.objects.get(l.id); const R=lo?global.trigR(lo.triggerMode):1; for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) { const kk=(l.from[0]+dx)+','+(l.from[1]+dy); if(!tele.has(kk)) tele.set(kk,l); } }
  const avoid=new Set(); for (const o of (pal.world.objectList||[])) { if (links.some(l=>l.id===o.id)) continue; if (o.triggerMode<4) continue; const e=global.eoOf(o.id)||{}; if (!global.exitOf(e.triggerScript||0)) continue; const R=global.trigR(o.triggerMode); for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++) if(Math.abs(dx)+Math.abs(dy)<=R) avoid.add((o.gx+dx)+','+(o.gy+dy)); } const rj=global.relJumps(); const relZ=new Map(); for (const j of rj) { for(let dx=-j.R;dx<=j.R;dx++) for(let dy=-j.R;dy<=j.R;dy++) if(Math.abs(dx)+Math.abs(dy)<=j.R) { const kk=(j.at[0]+dx)+','+(j.at[1]+dy); if(!relZ.has(kk)) relZ.set(kk,j); } } global._avoidPts=(global.AVOID_IDS||[]).map(id=>pal.world.objects.get(id)).filter(Boolean).map(o=>[o.gx,o.gy]); const p=pal.world.player; avoid.delete(p.gx+','+p.gy); const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null; const D=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  while(q.length){ const [x,y]=q.shift(); const k=x+','+y; if (k!==start && goal(x,y)) { end=k; break; } if (k!==start && relZ.has(k)) { const j=relZ.get(k); const nx2=x+j.rel[0], ny2=y+j.rel[1]; const nk=nx2+','+ny2; if(!prev.has(nk)){ prev.set(nk,{k,tele:'R'+j.id}); q.push([nx2,ny2]); } continue; } if (k!==start && tele.has(k)) { const l=tele.get(k); const nk=l.to.join(','); if(!prev.has(nk)){ prev.set(nk,{k,tele:l.id}); q.push(l.to);} continue; } for (const [d,dx,dy] of D) { const nx=x+dx, ny=y+dy, nk=nx+','+ny; if(prev.has(nk)||!W(nx,ny)||block.has(nk)) continue; if (avoid.has(nk) && !goal(nx,ny)) continue; if (global.AVOID_R && global._avoidPts && global._avoidPts.some(([ax,ay])=>Math.abs(ax-nx)+Math.abs(ay-ny)<=global.AVOID_R) && !goal(nx,ny)) continue; prev.set(nk,{k,d}); q.push([nx,ny]); } }
  if(!end) return null; const steps=[]; let c=end; while(prev.get(c)){ const v=prev.get(c); steps.unshift(v.d||('T'+v.tele)); c=v.k; } return {end, steps}; };

global._snakeBase = (ctx) => { const {me, party, en}=ctx; const tgt=(en[0]||{}).index||0; const ps=party||[]; const c=[]; const low=ps.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<(x.p.maxHp||500)*0.5).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp);
  if (me.name==='巫后') { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); global._dhTries=(global._dhTries||0); if (global._dhTries<3 && me.mp>=83) { global._dhTries++; c.push(['magic',{magic:'奪魂',target:tgt}]); } if (me.mp>=68) c.push(['magic',{magic:'雷神',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  if (me.name==='李逍遙') { if (me.hp<(me.maxHp||500)*0.45 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:me.index??0}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]); c.push(['attack',{target:tgt}]); return c; }
  c.push(['attack',{target:tgt}]); return c; };
global.BOSS_PLANS['八頭蛇'] = (ctx) => global._snakeBase(ctx);

// ---- relay round 2 helpers (compact fight/walk/talk, cave region graph, bug farming, underground avoidance)
// NOTE runFight acts only on fresh prompt.revision and maps actor via prompt.role (battle state lags one turn otherwise)
global.snakeAct = (b) => {
  const mi=b.turn.member; const party=b.party; const me=party[mi]; const has=n=>global.has(n);
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<330).sort((a,b)=>a.p.hp-b.p.hp);
  const dead=party.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  const c=[];
  if (dead.length) { if(has('還魂香')) c.push(['item',{item:'還魂香',target:dead[0].i}]); }
  if (low.length) { for (const n of ['聖靈符','蟠果','觀音符']) if(has(n)) { c.push(['item',{item:n,target:low[0].i}]); break; } if (me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); }
  if (me.name==='巫后' && me.mp>=68) c.push(['magic',{magic:'雷神',target:0}]);
  if (me.name==='李逍遙' && me.mp>=44) c.push(['magic',{magic:'天劍',target:0}]);
  for (const n of ['無影神針','血玲瓏','天師符','雷靈符','火靈符','風靈符']) if(has(n)) { c.push(['throw',{item:n,target:0}]); }
  c.push(['attack',{target:0}]);
  return c;
};
global.runFight = async (actFn, maxTurns=200) => { const log=[]; let n=0; const b0=(pal.world.lastBattleResult||{}).battle; let lastRev=null;
  while (n<maxTurns*4) { n++; await pal.observe(); const w=pal.world;
    if (w.mode==='dialog') { await pal.advance(50); continue; }
    if (w.mode!=='battle') { if (w.mode==='busy') { await pal.wait(400); continue; } const lb=w.lastBattleResult; return {res: lb && lb.battle!==b0 ? lb : (lb||{result:'unknown'}), mode:w.mode, log:log.slice(-8)}; }
    const b=w.battle; if(!b||!b.turn||b.turn.kind!=='command'||!b.prompt) { await pal.wait(200); continue; }
    if (b.prompt.revision===lastRev) { await pal.wait(150); continue; }
    const mi=b.party.findIndex(p=>p.roleId===b.prompt.role); const bb=Object.assign({},b,{turn:Object.assign({},b.turn,{member: mi>=0?mi:b.turn.member})});
    const cands=actFn(bb); let ok=false;
    for (const [t,ex] of cands) { const r=await pal.battle(t,ex); const op=r&&r.reply&&r.reply.op; if (op!=='SMSG_REJECT') { ok=true; log.push(bb.party[bb.turn.member].name+':'+t+':'+(ex.magic||ex.item||'')+' E='+(b.enemies.map(e=>e.hp).join('/'))); break; } }
    if (!ok) await pal.battle('defend',{}); lastRev=b.prompt.revision; }
  return {res:{result:'limit'}, log:log.slice(-8)}; };
global.genAct = (b) => { const mi=b.turn.member; const party=b.party; const me=party[mi]; const c=[];
  const en=b.enemies.filter(e=>e.hp>0); const tgt=(en.sort((a,b)=>a.hp-b.hp)[0]||{}).index||0;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.4).sort((a,b)=>a.p.hp-b.p.hp);
  if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
  if (low.length) for (const n of ['金創藥','靈山仙芝','蟠果']) if(global.has(n)) c.push(['item',{item:n,target:low[0].i}]);
  const tot=en.reduce((s,e)=>s+e.hp,0);
  if (me.name==='巫后' && tot>1500 && me.mp>=68) c.push(['magic',{magic:'雷神',target:tgt}]);
  if (me.name==='李逍遙' && tot>2000 && me.mp>=44) c.push(['magic',{magic:'天劍',target:tgt}]);
  c.push(['attack',{target:tgt}]); return c; };
global.walkFight = async (x,y,maxTries=15) => { const sc0=pal.world.scene; const log=[];
  for (let i=0;i<maxTries;i++) { await pal.observe(); const w=pal.world;
    if (w.mode==='battle') { const r=await global.runFight(global.BATTLE_ACT||global.genAct); const rr=r.res&&r.res.result||r.res; log.push('fight:'+JSON.stringify(rr)); if (rr==='lost'||rr==='gameover') return {res:'gameover',log}; await global.settle(0); if (global.AUTO_HEAL!==false) await global.healUp(0.6); continue; }
    if (w.mode==='dialog') { await pal.advance(100); log.push('dlg'); continue; }
    if (w.mode==='busy') { await pal.wait(500); continue; }
    if (w.mode==='menu') { log.push('menu'); return {res:'menu',log}; }
    if (w.scene!==sc0) return {res:'scene', scene:w.scene, p:w.player, log};
    if (w.player.gx===x && w.player.gy===y) return {res:'arrived',log};
    const r=await pal.invoke('nav__walk_to',{x,y}); log.push((r.note||'').slice(0,80));
    if (r.ok) { await pal.observe(); if (pal.world.mode==='control' && pal.world.scene===sc0) return {res:'arrived', log}; }
    else if (/no path/i.test(r.note||'')) return {res:'nopath', log};
  } return {res:'tries',log}; };
global.go2 = async (x,y,tries=15) => { const r=await global.walkFight(x,y,tries); await pal.observe(); const w=pal.world;
  return {res:r.res, log:r.log.slice(-3), scene:w.scene, p:w.player, mode:w.mode, mem:w.members.map(m=>m.name+' '+m.level+' '+m.hp+'/'+m.maxHp+' '+m.mp), d:global.takeD().slice(-20), hints:(global.sceneHints()||[]).map(s=>s.slice(0,160))}; };
global.settle = async (choice=0, maxIt=60) => { const log=[]; for (let i=0;i<maxIt;i++){ await pal.observe(); const w=pal.world; if (w.gameOver) {log.push('GAMEOVER'); break;}
  if (w.mode==='dialog') { await pal.advance(100); continue; }
  if (w.mode==='busy') { await pal.wait(500); continue; }
  if (w.mode==='menu') { log.push('menu:'+JSON.stringify(w.menu.items).slice(0,200)); if (choice==null) break; await pal.choose(choice); continue; }
  if (w.mode==='battle') { const r=await global.runFight(global.BATTLE_ACT||global.genAct); log.push('fight:'+JSON.stringify(r.res&&r.res.result||r.res)+' '+(r.log||[]).slice(-3).join('|')); continue; }
  break; } return log; };
global.talk2 = async (id, choice=0) => { const r=await pal.invoke('nav__interact',{id}); const log=await global.settle(choice); await pal.observe(); const w=pal.world; return {r:(r.note||'').slice(0,100), log, scene:w.scene, p:w.player, mode:w.mode, mem:w.members.map(m=>m.name+' '+m.level+' '+m.hp+'/'+m.maxHp+' '+m.mp), d:global.takeD().slice(-25)}; };
global.hop = async (next) => { await pal.observe(); const cands=(pal.world.objectList||[]).map(o=>{const e=global.eoOf(o.id)||{}; const x=global.exitOf(e.triggerScript||0); return x&&x.to===next? o:null;}).filter(Boolean);
  if (!cands.length) return {err:'noexit', scene:pal.world.scene, next};
  const p=pal.world.player; cands.sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
  for (const o of cands) { await global.walkFight(o.gx,o.gy,25); await pal.observe(); if (pal.world.scene===next) return {ok:true};
    if (pal.world.scene!==next) { const R=global.trigR(o.triggerMode); for (let t=0;t<3 && pal.world.scene!==next;t++){ const r=await global.walk2((x,y)=>Math.abs(x-o.gx)+Math.abs(y-o.gy)<=R, 100000); await global.settle(0); await pal.observe(); if (r && r.why==='nopath') break; } }
    if (pal.world.scene===next) return {ok:true}; }
  return {err:'fail', scene:pal.world.scene, p:pal.world.player}; };
global.travelTo = async (dest) => { const out=[]; for (let k=0;k<20;k++){ await pal.observe(); if (pal.world.scene===dest) break; const sp=global.scenePath(pal.world.scene,dest); if(!sp||!sp.length){ out.push('nopath@'+pal.world.scene); break;} const r=await global.hop(sp[0]); out.push(pal.world.scene+(r.err?'!'+r.err:'')); if (r.err) break; } return out; };
global.compsOf = async (scene) => { global._compCache=global._compCache||{}; if (global._compCache[scene]) return global._compCache[scene];
  const rows=await global.rowsOfScene(scene); const H=rows.length; const comp=new Map(); let n=0;
  for (let y=0;y<H;y++) for (let x=0;x<(rows[y]||'').length;x++) { if (rows[y][x]!=='.' || comp.has(x+','+y)) continue; const q=[[x,y]]; comp.set(x+','+y,n); while(q.length){ const [a,b]=q.shift(); for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const k=(a+dx)+','+(b+dy); if(!comp.has(k) && rows[b+dy] && rows[b+dy][a+dx]==='.') { comp.set(k,n); q.push([a+dx,b+dy]); } } } n++; }
  const r={comp, n, rows}; global._compCache[scene]=r; return r; };
global.compAt = (C,x,y,R=1) => { for (let r=0;r<=R+1;r++) for (let dx=-r;dx<=r;dx++) for (let dy=-r;dy<=r;dy++) { const c=C.comp.get((x+dx)+','+(y+dy)); if (c!=null) return c; } return null; };
global.regionGraph = async (scenes) => { const edges=[]; for (const s of scenes) { const C=await global.compsOf(s); for (const e of global._eo.filter(e=>e.scene===s)) { const x=global.exitOf(e.triggerScript||0); if (!x || !x.at || !scenes.includes(x.to)) continue; const C2=await global.compsOf(x.to); const from=global.compAt(C,e.gx,e.gy,global.trigR(e.triggerMode)); const to=global.compAt(C2,x.at[0],x.at[1],0); if (from==null||to==null) continue; edges.push({from:s+':'+from, to:x.to+':'+to, id:e.id, gx:e.gx, gy:e.gy, tm:e.triggerMode, st:e.state}); } } return edges; };
global.curNode = async () => { await pal.observe(); const C=await global.compsOf(pal.world.scene); const p=pal.world.player; return pal.world.scene+':'+global.compAt(C,p.gx,p.gy,1); };
global.takeEdge = async (e) => { const sc=pal.world.scene; if (e.tm===1) { await pal.invoke('nav__interact',{id:e.id}); await global.settle(0); } else { await global.walkFight(e.gx,e.gy,6); } await pal.observe(); if (pal.world.mode==='battle') { await global.settle(0); } await pal.observe(); return pal.world.scene!==sc || (await global.curNode())===e.to; };
global.goNode = async (target, edges=global._caveEdges) => { const log=[]; for (let k=0;k<25;k++) { const here=await global.curNode(); if (here===target) return {ok:true,log}; const prev=new Map([[here,null]]); const q=[here]; while(q.length){ const n=q.shift(); if(n===target) break; for (const e of edges) if (e.from===n && !prev.has(e.to)) { prev.set(e.to,e); q.push(e.to); } } if(!prev.has(target)) return {ok:false, why:'nopath', here, log}; let c=target, first=null; while(prev.get(c)){ first=prev.get(c); c=first.from; } const ok=await global.takeEdge(first); log.push(first.from+'>'+first.to+(ok?'':'!')); if(!ok){ global._badEdges=global._badEdges||new Set(); global._badEdges.add(first.id); edges=edges.filter(e=>e.id!==first.id); } } return {ok:false, why:'loop', log}; };
global.farmAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[];
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.5).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp);
  if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
  if (low.length) for (const n of ['聖靈符','觀音符','蟠果']) if (global.has(n) && low[0].p.hp<low[0].p.maxHp*0.3) c.push(['item',{item:n,target:low[0].i}]);
  return c.concat(base(b)); };
global.farmAct2 = (b) => { const en=b.enemies.filter(e=>e.hp>0); const hasCar=en.some(e=>global.CARRIERS.has(e.name)); const dangerous=en.some(e=>/九頭蛇|五毒巨蛇|武士|角力士|醉羅漢|哈將/.test(e.name));
  if (!hasCar && dangerous) return [['flee',{}]].concat(global.farmAct(b)); return global.farmAct(b); };
global.healUp = async (th=0.75) => { const out=[]; for (let k=0;k<6;k++){ await pal.observe(); const ms=pal.world.members; const lows=ms.filter(m=>m.hp<m.maxHp*th); if(!lows.length) break; const lo=lows.sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0]; const ling=ms.find(m=>m.name==='趙靈兒');
  if (ling && lows.length>=2 && ling.mp>=50) out.push(await global.castOut('趙靈兒','五氣朝元'));
  else if (ling && ling.mp>=10) out.push(await global.castOut('趙靈兒','觀音咒',lo.name));
  else { const c=ms.filter(m=>m.mp>=40 && m.name!=='趙靈兒').sort((a,b)=>b.mp-a.mp)[0]; if(!c) break; out.push(await global.castOut(c.name,'元靈歸心術',lo.name)); }
  await global.closeMenus(); } return out; };
global.farmHere = async (budgetMs=60000) => { const t0=Date.now(); const bugs=()=>((global.has('傀儡蟲')||{}).amount||0); const log=[]; let fails=0;
  while (Date.now()-t0<budgetMs && bugs()<36) { await pal.observe(); if (pal.world.mode!=='control') { await global.settle(0); continue; }
    await global.healUp(); await pal.observe(); const ms=pal.world.members; if (ms.reduce((s,m)=>s+m.mp,0)<160) { log.push('lowMP'); break; }
    const C=await global.compsOf(pal.world.scene); const p=pal.world.player; const my=global.compAt(C,p.gx,p.gy,1);
    const d=o=>Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy)-(global.GOOD_FOES.has(o.id)?60:0);
    const foes=(pal.world.objectList||[]).filter(o=>global.isFoe(o) && global.compAt(C,o.gx,o.gy,2)===my).sort((a,b)=>d(a)-d(b));
    if (!foes.length || fails>3) break; const f=foes[fails % foes.length]; const n0=((pal.world.lastBattleResult)||{}).battle; const bb=bugs();
    await global.walkFight(f.gx,f.gy,3); await pal.observe(); const lb=pal.world.lastBattleResult||{}; if (lb.battle!==n0) { fails=0; log.push(f.id+(lb.result)+(bugs()>bb?'+'+(bugs()-bb):'')); if (lb.result==='lost') { log.push('GAMEOVER'); break; } if (bugs()>bb && pal.world.mode==='control') await pal.save(93,'試煉窟 bugs '+bugs()); } else fails++; }
  return log; };
global.storyAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0; const n=en.length;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.45).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp);
  const dead=party.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  if (me.name==='趙靈兒') { if (low.length>=2 && me.mp>=50) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (dead.length && me.mp>=60) c.push(['magic',{magic:'五氣朝元',target:0}]);
    if (n>=2 && me.mp>=60) c.push(['magic',{magic:'風雪冰天',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  else { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
    if (dead.length) for (const nm of ['還魂香','聖靈符']) if (global.has(nm)) c.push(['item',{item:nm,target:dead[0].i}]);
    if (me.name==='阿奴' && n>=2 && me.mp>=80) c.push(['magic',{magic:'炎殺咒',target:t}]);
    if (me.name==='李逍遙' && n>=2 && me.mp>=120) { c.push(['magic',{magic:'劍神',target:t}]); c.push(['magic',{magic:'萬劍訣',target:t}]); } }
  c.push(['attack',{target:t}]); return c; };
global.walk3 = async (gx,gy,R=0,budgetMs=100000) => { const t0=Date.now(); const sc=pal.world.scene; const log=[]; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world;
    if (w.mode==='battle') { const r=await global.runFight(global.BATTLE_ACT); const rr=r.res&&r.res.result||r.res; log.push('F:'+rr); if (rr==='lost'||rr==='gameover') return {res:'lost',log}; await global.settle(0); await global.healUp(0.6); continue; }
    if (w.mode!=='control') { await global.settle(0); continue; }
    if (w.scene!==sc) return {res:'scene',scene:w.scene,log};
    const p=w.player; if (Math.abs(p.gx-gx)+Math.abs(p.gy-gy)<=R) return {res:'arrived',log};
    const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.';
    const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy));
    const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
    while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-gx)+Math.abs(y-gy)<=R) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const k=(x+dx)+','+(y+dy); if (prev.has(k)||!W(x+dx,y+dy)||block.has(k)) continue; prev.set(k,{k:x+','+y,d}); q.push([x+dx,y+dy]); } }
    if (!end) return {res:'nopath',log}; const steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; }
    let i=0; const d=steps[0]; let n=1; while (n<steps.length && steps[n]===d && n<4) n++;
    const before=start; await pal.step(d,n); await pal.observe(); const after=pal.world.player.gx+','+pal.world.player.gy;
    if (after===before && pal.world.mode==='control') { stuck++; if (stuck>4) return {res:'stuck',at:after,log}; } else stuck=0; }
  return {res:'time',log}; };
global.walk4 = async (gx,gy,R=0,budgetMs=100000,avoidR=3) => { const t0=Date.now(); const sc=pal.world.scene; const log=[]; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world;
    if (w.mode==='battle') { const en=(w.battle&&w.battle.enemies||[]).map(e=>e.name).join('+'); const r=await global.runFight(global.BATTLE_ACT); const rr=r.res&&r.res.result||r.res; log.push('F['+en+']:'+rr); if (rr==='lost'||rr==='gameover') return {res:'lost',log}; await global.settle(0); await global.healUp(0.6); continue; }
    if (w.mode!=='control') { await global.settle(0); continue; }
    if (w.scene!==sc) return {res:'scene',scene:w.scene,log};
    const p=w.player; if (Math.abs(p.gx-gx)+Math.abs(p.gy-gy)<=R) return {res:'arrived',log};
    const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.';
    const foes=(w.objectList||[]).filter(o=>global.isFoe(o)); const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy));
    let steps=null;
    for (const ar of [avoidR, 2, 1, 0]) { const bad=(x,y)=>foes.some(f=>Math.abs(f.gx-x)+Math.abs(f.gy-y)<=ar);
      const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-gx)+Math.abs(y-gy)<=R) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (bad(nx,ny) && !(Math.abs(nx-gx)+Math.abs(ny-gy)<=R)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } if (ar<avoidR) log.push('ar'+ar); break; } }
    if (!steps) { await pal.wait(400); stuck++; if (stuck>10) return {res:'nopath',log}; continue; }
    const d=steps[0]; let n=1; while (n<steps.length && steps[n]===d && n<2) n++;
    const before=p.gx+','+p.gy; await pal.step(d,n); await pal.observe(); const after=pal.world.player.gx+','+pal.world.player.gy;
    if (after===before && pal.world.mode==='control') { stuck++; if (stuck>8) return {res:'stuck',at:after,log}; } else stuck=0; }
  return {res:'time',log}; };
global.walk5 = async (gx,gy,slot=86,budgetMs=105000,R=0) => { const t0=Date.now(); const log=[]; let reloads=0; let lastSave=Date.now();
  while (Date.now()-t0<budgetMs) { global.BATTLE_ACT=global.ugAct; global._fleeTries=0;
    const r=await global.walk4(gx,gy,R,Math.min(25000, budgetMs-(Date.now()-t0)),3); log.push(r.res+':'+r.log.filter(x=>x.startsWith('F')).join(','));
    if (r.res==='lost') { for (let i=0;i<30;i++){ await pal.observe(); const m=pal.world.mode; if (m==='dialog') await pal.advance(50); else if (m==='busy') await pal.wait(400); else break; } await pal.load(slot); pal.world.gameOver=false; reloads++; log.push('reload'); await pal.wait(300+Math.floor(Math.random()*2500)); if (reloads>6) break; continue; }
    if (r.res==='scene' || r.res==='arrived') return {res:r.res, log, reloads};
    await pal.observe(); const ms=pal.world.members; const p=pal.world.player; const near=(pal.world.objectList||[]).some(o=>global.isFoe(o)&&Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy)<=4);
    if (pal.world.mode==='control' && !near) { await global.healUp(0.7); await pal.observe(); if (pal.world.members.every(m=>m.hp>m.maxHp*0.6)) { await pal.save(slot,'291 progress '+p.gx+','+p.gy); log.push('saved@'+p.gx+','+p.gy); } }
  } return {res:'time', log, reloads}; };
global.travel5 = async (dest, budgetMs=100000) => { const t0=Date.now(); const log=[];
  while (Date.now()-t0<budgetMs) { await pal.observe(); if (pal.world.scene===dest) return {res:'arrived', log};
    const sp=global.scenePath(pal.world.scene,dest); if (!sp||!sp.length) return {res:'nopath', log}; const next=sp[0];
    const ex=(pal.world.objectList||[]).filter(o=>{ const e=global.eoOf(o.id)||{}; const x=global.exitOf(e.triggerScript||0); return x&&x.to===next; }); if (!ex.length) return {res:'noexit '+next, log};
    const p=pal.world.player; ex.sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    const sc=pal.world.scene; const r=await global.walk5(ex[0].gx,ex[0].gy,86,Math.max(10000,budgetMs-(Date.now()-t0)),Math.max(1,global.trigR(ex[0].triggerMode))); log.push(sc+':'+r.res+' '+r.log.slice(-3).join('|'));
    await pal.observe(); if (pal.world.scene!==sc && pal.world.mode==='control') { await global.settle(0); await global.healUp(0.7); await pal.save(86,'enter '+pal.world.scene); log.push('saved@'+pal.world.scene); }
    else if (r.res!=='time') { log.push('stop'); break; } }
  return {res:'time', log}; };
global.faceObj = async (id) => { await pal.observe(); const o=pal.world.objects.get(id); if(!o) return 'noobj'; for (const [dx,dy,dir] of [[0,1,'up'],[1,0,'left'],[-1,0,'right'],[0,-1,'down']]) { const tx=o.gx+dx, ty=o.gy+dy; const r=await global.walk3(tx,ty,0,20000); await pal.observe(); const p=pal.world.player; if (p.gx===tx && p.gy===ty) { await pal.step(dir,1); await pal.observe(); const p2=pal.world.player; if (p2.gx!==tx||p2.gy!==ty) continue; return 'ok '+dir; } } return 'fail'; };
global.ugAct = (b) => { const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/黑苗祭司/.test(e.name))) return global.surviveAct(b); if (en.some(e=>/瘟神/.test(e.name)) && global.FIGHT_WEN && pal.world.cash>=9000) return global.wenAct(b); return global.grindAct(b); };
global.grindAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0; const n=en.length;
  if (en.some(e=>global.DANGER.test(e.name)) && (global._fleeTries=(global._fleeTries||0)+1)<=6) c.push(['flee',{}]);
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.45).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp);
  if (me.name==='趙靈兒') { if (low.length>=2 && me.mp>=50) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (n>=2 && me.mp>=150) c.push(['magic',{magic:'風雪冰天',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  else { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
    if (me.name==='李逍遙' && me.mp>=100) { if (n>=2) c.push(['magic',{magic:'劍神',target:t}]); c.push(['magic',{magic:'天劍',target:t}]); }
    if (me.name==='阿奴' && me.mp>=100) { if (n>=2) c.push(['magic',{magic:'炎殺咒',target:t}]); c.push(['magic',{magic:'天雷破',target:t}]); } }
  c.push(['attack',{target:t}]); return c; };
global.wenAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0); const t=(en.find(e=>/瘟神/.test(e.name))||en[0]||{}).index||0;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.55); const dead=party.map((p,i)=>({p,i})).filter(x=>x.p.hp<=0);
  if (me.name==='趙靈兒') { if ((low.length>=2 || dead.length) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (me.mp>=88) c.push(['magic',{magic:'武神',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  if (me.name==='阿奴') { if (pal.world.cash>=4000) c.push(['magic',{magic:'乾坤一擲',target:t}]); if (me.hp<me.maxHp*0.4 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:b.turn.member}]); if (me.mp>=28) c.push(['magic',{magic:'天雷破',target:t}]); }
  if (me.name==='李逍遙') { if (me.hp<me.maxHp*0.4 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:b.turn.member}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:t}]); }
  c.push(['attack',{target:t}]); return c; };
global.surviveAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.7);
  if (me.name==='趙靈兒' && (low.length>=1) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]);
  if (me.name!=='趙靈兒' && low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
  c.push(['defend',{}]); return c; };
global.bossAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0); const boss=en.find(e=>/黑苗祭司|瘟神|魔獸武士|玩蛇女|巫王侍衛|牛鬼/.test(e.name)); const t=(boss||en.sort((a,b)=>a.hp-b.hp)[0]||{}).index||0;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.5); const dead=party.filter(p=>p.hp<=0).length;
  if (me.name==='趙靈兒') { if ((low.length>=2||dead) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  if (me.name==='阿奴') { if (pal.world.cash>=3000) c.push(['magic',{magic:'乾坤一擲',target:t}]); if (me.mp>=28) c.push(['magic',{magic:'天雷破',target:t}]); }
  if (me.name==='李逍遙') { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:t}]); }
  c.push(['attack',{target:t}]); return c; };
global.walkTo4 = async (target, budgetMs=30000) => { // walk toward a specific foe object, avoiding other foes
  const t0=Date.now(); const n0=(pal.world.lastBattleResult||{}).battle; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world; if (w.mode!=='control') return 'mode:'+w.mode; if ((w.lastBattleResult||{}).battle!==n0) return 'fought';
    const t=w.objects.get(target); if (!t || !global.isFoe(t)) return 'gone'; const p=w.player;
    const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const others=(w.objectList||[]).filter(o=>global.isFoe(o)&&o.id!==target);
    const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy)); let steps=null;
    for (const ar of [3,2,1]) { const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-t.gx)+Math.abs(y-t.gy)<=1) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (others.some(f=>Math.abs(f.gx-nx)+Math.abs(f.gy-ny)<=ar)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } break; } }
    if (!steps) return 'nopath'; if (!steps.length) { // adjacent: step into it
      const dx=t.gx-p.gx, dy=t.gy-p.gy; await pal.step(dx>0?'right':dx<0?'left':dy>0?'down':'up',1); stuck++; if (stuck>4) return 'stuck'; continue; }
    const bk=p.gx+','+p.gy; await pal.step(steps[0],1); await pal.observe(); if (pal.world.player.gx+','+pal.world.player.gy===bk && pal.world.mode==='control') { stuck++; if (stuck>3) return 'stuck'; } }
  return 'time'; };
global.grindHere = async (budgetMs=80000, slot=86) => { const t0=Date.now(); const log=[];
  while (Date.now()-t0<budgetMs) { await pal.observe(); if (pal.world.mode!=='control') { if (pal.world.mode==='battle') { const r=await global.runFight(global.ugAct); log.push('B:'+(r.res&&r.res.result)); } await global.settle(0); continue; }
    await global.healUp(0.7); await pal.observe(); const p=pal.world.player; const now=Date.now();
    const cands=(pal.world.objectList||[]).filter(o=>global.SAFE_SPAWNS.has(o.id)&&global.isFoe(o)&&!((global._skip.get(o.id)||0)>now)).sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    if (!cands.length) { log.push('none'); await pal.wait(2500); continue; }
    global._fleeTries=0; const wr=await global.walkTo4(cands[0].id, 20000); await pal.observe();
    if (pal.world.mode==='battle') { const en=pal.world.battle.enemies.map(e=>e.name).join('+'); const r=await global.runFight(global.ugAct); const rr=r.res&&r.res.result; log.push(en+':'+rr); await global.settle(0); await pal.observe();
      if (rr==='lost' || pal.world.members.every(m=>m.hp<=0)) { for (let i=0;i<30;i++){ await pal.observe(); const m=pal.world.mode; if (m==='dialog') await pal.advance(50); else if (m==='busy') await pal.wait(400); else break; } await pal.load(slot); pal.world.gameOver=false; log.push('reload'); continue; }
      if (rr==='won') { await global.healUp(0.7); await pal.observe(); if (pal.world.mode==='control' && pal.world.members.every(m=>m.hp>m.maxHp*0.5)) await pal.save(slot,'291 grind'); } }
    else { log.push('walk:'+wr); if (wr!=='fought') global._skip.set(cands[0].id, Date.now()+30000); }
  }
  await pal.observe(); return {log:log.slice(-14), mem:pal.world.members.map(m=>m.name+' '+m.level+' '+m.hp+'/'+m.maxHp+' mp'+m.mp), p:pal.world.player}; };
global.CARRIERS=new Set(['金蟾','五毒巨蠍','五毒蜈蚣','黑蜘蛛精']);
global.DANGER=/瘟神|巫王侍衛|玩蛇女|魔獸武士|牛鬼|土蜘蛛/;
global._skip=new Map(); global.FIGHT_WEN=false;

// ---- relay round 2 (late): palace boss helpers
global.runFight = async (actFn, maxTurns=200) => { const log=[]; let n=0; const b0=(pal.world.lastBattleResult||{}).battle; let lastRev=null;
  while (n<maxTurns*4) { n++; await pal.observe(); const w=pal.world;
    if (w.mode==='dialog') { await pal.advance(50); continue; }
    if (w.mode!=='battle') { if (w.mode==='busy') { await pal.wait(400); continue; } const lb=w.lastBattleResult; return {res: lb && lb.battle!==b0 ? lb : (lb||{result:'unknown'}), mode:w.mode, log:log.slice(-8)}; }
    const b=w.battle; if(!b||!b.turn||b.turn.kind!=='command'||!b.prompt) { await pal.wait(200); continue; }
    if (b.prompt.revision===lastRev) { await pal.wait(150); continue; }
    const mi=b.party.findIndex(p=>p.roleId===b.prompt.role); const bb=Object.assign({},b,{turn:Object.assign({},b.turn,{member: mi>=0?mi:b.turn.member})});
    const cands=actFn(bb); let ok=false;
    for (const [t,ex] of cands) { const r=await pal.battle(t,ex); const op=r&&r.reply&&r.reply.op; if (op!=='SMSG_REJECT') { ok=true; log.push(bb.party[bb.turn.member].name+':'+t+':'+(ex.magic||ex.item||'')+' E='+(b.enemies.map(e=>e.hp).join('/'))); break; } }
    if (!ok) await pal.battle('defend',{}); lastRev=b.prompt.revision; }
  return {res:{result:'limit'}, log:log.slice(-8)}; };
global.walk4 = async (gx,gy,R=0,budgetMs=100000,avoidR=3) => { const t0=Date.now(); const sc=pal.world.scene; const log=[]; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world;
    if (w.mode==='battle') { const en=(w.battle&&w.battle.enemies||[]).map(e=>e.name).join('+'); const r=await global.runFight(global.BATTLE_ACT); const rr=r.res&&r.res.result||r.res; log.push('F['+en+']:'+rr); if (rr==='lost'||rr==='gameover') return {res:'lost',log}; await global.settle(0); await global.healUp(0.6); continue; }
    if (w.mode!=='control') { await global.settle(0); continue; }
    if (w.scene!==sc) return {res:'scene',scene:w.scene,log};
    const p=w.player; if (Math.abs(p.gx-gx)+Math.abs(p.gy-gy)<=R) return {res:'arrived',log};
    const rows=await global.mapRows(); global._lb=global._lb||{}; const LB=(global._lb[w.scene]=global._lb[w.scene]||new Set()); const W=(x,y)=>rows[y]&&rows[y][x]==='.'&&!LB.has(x+','+y);
    const foes=(w.objectList||[]).filter(o=>global.isFoe(o)); const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy));
    let steps=null;
    for (const ar of [avoidR, 2, 1, 0]) { const bad=(x,y)=>foes.some(f=>Math.abs(f.gx-x)+Math.abs(f.gy-y)<=ar);
      const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-gx)+Math.abs(y-gy)<=R) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (bad(nx,ny) && !(Math.abs(nx-gx)+Math.abs(ny-gy)<=R)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } if (ar<avoidR) log.push('ar'+ar); break; } }
    if (!steps) { await pal.wait(400); stuck++; if (stuck>10) return {res:'nopath',log}; continue; }
    const d=steps[0]; let n=1; while (n<steps.length && steps[n]===d && n<2) n++;
    const before=p.gx+','+p.gy; await pal.step(d,n); await pal.observe(); const after=pal.world.player.gx+','+pal.world.player.gy;
    if (after===before && pal.world.mode==='control') { const dd={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[d]; LB.add((p.gx+dd[0])+','+(p.gy+dd[1])); stuck++; if (stuck>8) return {res:'stuck',at:after,log}; } else stuck=0; }
  return {res:'time',log}; };
global.walk5 = async (gx,gy,slot=86,budgetMs=105000,R=0) => { const t0=Date.now(); const log=[]; let reloads=0; let lastSave=Date.now();
  while (Date.now()-t0<budgetMs) { global.BATTLE_ACT=global.ugAct; global._fleeTries=0;
    const r=await global.walk4(gx,gy,R,Math.min(25000, budgetMs-(Date.now()-t0)),global.AVOID_R4||3); log.push(r.res+':'+r.log.filter(x=>x.startsWith('F')).join(','));
    if (r.res==='lost') { for (let i=0;i<30;i++){ await pal.observe(); const m=pal.world.mode; if (m==='dialog') await pal.advance(50); else if (m==='busy') await pal.wait(400); else break; } await pal.load(slot); pal.world.gameOver=false; reloads++; log.push('reload'); await pal.wait(300+Math.floor(Math.random()*2500)); if (reloads>6) break; continue; }
    if (r.res==='scene' || r.res==='arrived') return {res:r.res, log, reloads};
    await pal.observe(); const ms=pal.world.members; const p=pal.world.player; const near=(pal.world.objectList||[]).some(o=>global.isFoe(o)&&Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy)<=4);
    if (pal.world.mode==='control' && !near) { await global.healUp(0.7); await pal.observe(); if (pal.world.members.every(m=>m.hp>m.maxHp*0.6)) { await pal.save(slot,'291 progress '+p.gx+','+p.gy); log.push('saved@'+p.gx+','+p.gy); } }
  } return {res:'time', log, reloads}; };
global.travel5 = async (dest, budgetMs=100000) => { const t0=Date.now(); const log=[];
  while (Date.now()-t0<budgetMs) { await pal.observe(); if (pal.world.scene===dest) return {res:'arrived', log};
    const sp=global.scenePath(pal.world.scene,dest); if (!sp||!sp.length) return {res:'nopath', log}; const next=sp[0];
    const ex=(pal.world.objectList||[]).filter(o=>{ const e=global.eoOf(o.id)||{}; const x=global.exitOf(e.triggerScript||0); return x&&x.to===next; }); if (!ex.length) return {res:'noexit '+next, log};
    const p=pal.world.player; ex.sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    const sc=pal.world.scene; const r=await global.walk5(ex[0].gx,ex[0].gy,86,Math.max(10000,budgetMs-(Date.now()-t0)),Math.max(1,global.trigR(ex[0].triggerMode))); log.push(sc+':'+r.res+' '+r.log.slice(-3).join('|'));
    await pal.observe(); if (pal.world.scene!==sc && pal.world.mode==='control') { await global.settle(0); await global.healUp(0.7); await pal.save(86,'enter '+pal.world.scene); log.push('saved@'+pal.world.scene); }
    else if (r.res!=='time') { log.push('stop'); break; } }
  return {res:'time', log}; };
global.ugAct = (b) => { const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/巫王侍衛/.test(e.name))) return global.guardAct(b); if (en.some(e=>/瘟神|魔獸武士|玩蛇女/.test(e.name)) && (global._fleeTries=(global._fleeTries||0)+1)<=6) return [['flee',{}]].concat(global.bossAct(b)); if (en.some(e=>/黑苗祭司|牛鬼|土蜘蛛/.test(e.name))) return global.bossAct(b); return global.grindAct(b); };
global.grindAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0; const n=en.length;
  if (en.some(e=>global.DANGER.test(e.name)) && (global._fleeTries=(global._fleeTries||0)+1)<=6) c.push(['flee',{}]);
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.45).sort((a,b)=>a.p.hp/a.p.maxHp-b.p.hp/b.p.maxHp);
  if (me.name==='趙靈兒') { if (low.length>=2 && me.mp>=50) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (n>=2 && me.mp>=150) c.push(['magic',{magic:'風雪冰天',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  else { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]);
    if (me.name==='李逍遙' && me.mp>=100) { if (n>=2) c.push(['magic',{magic:'劍神',target:t}]); c.push(['magic',{magic:'天劍',target:t}]); }
    if (me.name==='阿奴' && me.mp>=100) { if (n>=2) c.push(['magic',{magic:'炎殺咒',target:t}]); c.push(['magic',{magic:'天雷破',target:t}]); } }
  c.push(['attack',{target:t}]); return c; };
global.bossAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0); const boss=en.find(e=>/黑苗祭司|瘟神|魔獸武士|玩蛇女|巫王侍衛|牛鬼/.test(e.name)); const t=(boss||en.sort((a,b)=>a.hp-b.hp)[0]||{}).index||0;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.5); const dead=party.filter(p=>p.hp<=0).length;
  if (me.name==='趙靈兒') { if ((low.length>=2||dead) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  if (me.name==='阿奴') { if (pal.world.cash>=(global.THROW_MIN||50000)) c.push(['magic',{magic:'乾坤一擲',target:t}]); if (me.mp>=28) c.push(['magic',{magic:'天雷破',target:t}]); }
  if (me.name==='李逍遙') { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); if (me.mp>=44) c.push(['magic',{magic:'天劍',target:t}]); }
  c.push(['attack',{target:t}]); return c; };
global.guardAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0; const n=en.length;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.5); const dead=party.filter(p=>p.hp<=0).length;
  if (me.name==='趙靈兒') { if ((low.length>=2||dead) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (n>=2 && me.mp>=44) c.push(['magic',{magic:'風雪冰天',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  if (me.name==='阿奴') { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); if (n>=2 && me.mp>=33) c.push(['magic',{magic:'炎殺咒',target:t}]); if (me.mp>=28) c.push(['magic',{magic:'天雷破',target:t}]); }
  if (me.name==='李逍遙') { if (me.hp<me.maxHp*0.4 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:b.turn.member}]); }
  c.push(['attack',{target:t}]); return c; };
global.palaceGuardAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0; const tot=en.reduce((s,e)=>s+e.hp,0);
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.5); const L=party.find(p=>p.name==='趙靈兒'); const lingUp=L && L.hp>0;
  if (me.name==='趙靈兒') { if (low.length && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (en.length>=2 && me.mp>=44) c.push(['magic',{magic:'風雪冰天',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  if (me.name==='李逍遙') { if (me.hp<me.maxHp*0.35 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:b.turn.member}]); if (en.length>=2 && global._g.js<2 && me.mp>=64) { global._g.js++; c.push(['magic',{magic:'劍神',target:t}]); } }
  if (me.name==='阿奴') { if (me.hp<me.maxHp*0.3 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:b.turn.member}]); if (!lingUp && tot>3000 && global._g.fire<3 && me.mp>=33) { global._g.fire++; c.push(['magic',{magic:'炎殺咒',target:t}]); } }
  c.push(['attack',{target:t}]); return c; };
global.treeAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0); const t=(en.find(e=>/樹妖/.test(e.name))||en[0]||{}).index||0;
  const xi=party.findIndex(p=>p.name==='李逍遙'), ai=party.findIndex(p=>p.name==='阿奴'); const X=party[xi]||{}, A=party[ai]||{}; const T=global._tree;
  if (me.name==='李逍遙') { const xr=X.hp/X.maxHp, ar=A.hp>0? A.hp/A.maxHp : 9;
    if (me.mp>=40) { if (xr<0.45 && xr<=ar) c.push(['magic',{magic:'元靈歸心術',target:xi}]); else if (ar<0.55) c.push(['magic',{magic:'元靈歸心術',target:ai}]); else if (xr<0.45) c.push(['magic',{magic:'元靈歸心術',target:xi}]); }
    if (!T.kA && global.has('金剛符') && A.hp>0) { T.kA=true; c.push(['item',{item:'金剛符',target:ai}]); }
    if (!T.kX && global.has('金剛符')) { T.kX=true; c.push(['item',{item:'金剛符',target:xi}]); }
    for (const it of ['火靈符','天師符','無影神針','血玲瓏','雷靈符','風靈符']) if (global.has(it)) c.push(['throw',{item:it,target:t}]);
    c.push(['attack',{target:t}]); return c; }
  if (me.name==='阿奴') { if (xi>=0 && X.hp<=0 && me.mp>=30) c.push(['magic',{magic:'贖魂',target:xi}]);
    if (me.hp<me.maxHp*0.33 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:ai}]);
    if (pal.world.cash>=4000) c.push(['magic',{magic:'乾坤一擲',target:t}]);
    if (me.mp>=33) c.push(['magic',{magic:'炎殺咒',target:t}]); c.push(['attack',{target:t}]); return c; }
  c.push(['attack',{target:t}]); return c; };
global.palaceAct = (b) => { const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/樹妖/.test(e.name))) return global.treeAct(b); if (en.some(e=>/巫王侍衛/.test(e.name))) return global.palaceGuardAct(b); return global.bossAct(b); };
global.driveStory = async (budgetMs=100000) => { const t0=Date.now(); let res=null;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const m=pal.world.mode; if (m==='dialog') { await pal.advance(30); continue; } if (m==='busy') { await pal.wait(300); continue; } if (m==='battle') { const rr=await global.runFight(global.BATTLE_ACT); res=rr.res&&rr.res.result; continue; } break; }
  await pal.observe(); return {mode:pal.world.mode, scene:pal.world.scene, p:pal.world.player, res, lb:pal.world.lastBattleResult&&pal.world.lastBattleResult.result}; };
global.bossStart = async () => { await pal.load(86); pal.world.gameOver=false; await pal.observe(); global._tree={throw:false, fire:false, guard:false}; global._g={js:0, fire:0}; global._blog=[];
  global.BATTLE_ACT = (b) => { const c=global.palaceAct(b); global._blog.push(b.party[b.turn.member].name+'>'+c[0][0]+(c[0][1].magic||c[0][1].item||'')+' P='+b.party.map(p=>p.hp+'/'+p.mp).join(' ')+' E='+b.enemies.map(e=>e.name.slice(0,2)+e.hp).join(',')); return c; };
  const sv=global.BATTLE_ACT; const r=await global.walk4(113,89,0,30000,0); return r.res; };
global.grindAny = async (budgetMs=95000, slot=86, cashGoal=30000) => { const t0=Date.now(); const log=[]; global._skip=global._skip||new Map();
  while (Date.now()-t0<budgetMs && pal.world.cash<cashGoal) { await pal.observe(); if (pal.world.mode!=='control') { if (pal.world.mode==='battle') { const r=await global.runFight(global.ugAct); log.push('B:'+(r.res&&r.res.result)); } await global.settle(0); continue; }
    await global.healUp(0.7); await pal.observe(); const p=pal.world.player; const now=Date.now();
    const cands=(pal.world.objectList||[]).filter(o=>global.isFoe(o)&&!((global._skip.get(o.id)||0)>now)).sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    if (!cands.length) { log.push('none'); await pal.wait(2500); continue; }
    global._fleeTries=0; const n0=(pal.world.lastBattleResult||{}).battle; const wr=await global.walkTo4(cands[0].id, 20000); await pal.observe();
    if (pal.world.mode==='battle') { const en=pal.world.battle.enemies.map(e=>e.name).join('+'); const r=await global.runFight(global.ugAct); const rr=r.res&&r.res.result; log.push(en+':'+rr+':'+pal.world.cash); await global.settle(0); await pal.observe();
      if (rr==='lost') { global._skip.set(cands[0].id, Date.now()+120000); continue; }
      if (rr==='fled') global._skip.set(cands[0].id, Date.now()+60000);
      if (rr==='won' && pal.world.mode==='control') { await global.healUp(0.7); await pal.observe(); if (pal.world.members.every(m=>m.hp>m.maxHp*0.5)) await pal.save(slot,'grind '+pal.world.scene+' $'+pal.world.cash); } }
    else { if ((pal.world.lastBattleResult||{}).battle===n0) global._skip.set(cands[0].id, Date.now()+30000); log.push('walk:'+wr); }
  }
  await pal.observe(); return {cash:pal.world.cash, log:log.slice(-12), scene:pal.world.scene, mem:pal.world.members.map(m=>m.name+' '+m.level+' '+m.hp+' mp'+m.mp)}; };
global.isFoe = (o) => { if (!o) return false; if (base(o)) return true; const e=global.eoOf(o.id); if (!e||!e.triggerScript) return false; const s=global._byAddr.get(e.triggerScript); return !!(s && s.op==='0007') && o.triggerMode>=4; };
global.walkTo4 = async (target, budgetMs=30000) => { // walk toward a specific foe object, avoiding other foes
  const t0=Date.now(); const n0=(pal.world.lastBattleResult||{}).battle; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world; if (w.mode!=='control') return 'mode:'+w.mode; if ((w.lastBattleResult||{}).battle!==n0) return 'fought';
    const t=w.objects.get(target); if (!t || !global.isFoe(t)) return 'gone'; const p=w.player;
    const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const others=(w.objectList||[]).filter(o=>global.isFoe(o)&&o.id!==target);
    const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy)); let steps=null;
    for (const ar of [3,2,1]) { const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-t.gx)+Math.abs(y-t.gy)<=1) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (others.some(f=>Math.abs(f.gx-nx)+Math.abs(f.gy-ny)<=ar)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } break; } }
    if (!steps) return 'nopath'; if (!steps.length) { // adjacent: step into it
      const dx=t.gx-p.gx, dy=t.gy-p.gy; await pal.step(dx>0?'right':dx<0?'left':dy>0?'down':'up',1); stuck++; if (stuck>4) return 'stuck'; continue; }
    const bk=p.gx+','+p.gy; await pal.step(steps[0],1); await pal.observe(); if (pal.world.player.gx+','+pal.world.player.gy===bk && pal.world.mode==='control') { stuck++; if (stuck>3) return 'stuck'; } }
  return 'time'; };

// ---- relay round 2 (latest): boss/grind
global.treeAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0); const t=(en.find(e=>/樹妖/.test(e.name))||en[0]||{}).index||0;
  const xi=party.findIndex(p=>p.name==='李逍遙'), ai=party.findIndex(p=>p.name==='阿奴'); const X=party[xi]||{}, A=party[ai]||{}; const T=global._tree;
  if (me.name==='李逍遙') { const xr=X.hp/X.maxHp, ar=A.hp>0? A.hp/A.maxHp : 9;
    if (me.mp>=40) { if (xr<0.3) c.push(['magic',{magic:'元靈歸心術',target:xi}]); else if (ar<0.7) c.push(['magic',{magic:'元靈歸心術',target:ai}]); else if (xr<0.45) c.push(['magic',{magic:'元靈歸心術',target:xi}]); }
    if (!T.kA && global.has('金剛符') && A.hp>0) { T.kA=true; c.push(['item',{item:'金剛符',target:ai}]); }
    if (!T.kX && global.has('金剛符')) { T.kX=true; c.push(['item',{item:'金剛符',target:xi}]); }
    for (const it of ['火靈符','天師符','無影神針','血玲瓏','雷靈符','風靈符']) if (global.has(it)) c.push(['throw',{item:it,target:t}]);
    c.push(['attack',{target:t}]); return c; }
  if (me.name==='阿奴') { if (xi>=0 && X.hp<=0 && me.mp>=30) c.push(['magic',{magic:'贖魂',target:xi}]);
    if (me.hp<me.maxHp*0.33 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:ai}]);
    if (pal.world.cash>=4000) c.push(['magic',{magic:'乾坤一擲',target:t}]);
    if (me.mp>=33) c.push(['magic',{magic:'炎殺咒',target:t}]); c.push(['attack',{target:t}]); return c; }
  c.push(['attack',{target:t}]); return c; };
global.guardAct = (b) => { const party=b.party; const me=party[b.turn.member]; const c=[]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0; const n=en.length;
  const low=party.map((p,i)=>({p,i})).filter(x=>x.p.hp>0 && x.p.hp<x.p.maxHp*0.5); const dead=party.filter(p=>p.hp<=0).length;
  if (me.name==='趙靈兒') { if ((low.length>=2||dead) && me.mp>=40) c.push(['magic',{magic:'五氣朝元',target:0}]); if (low.length && me.mp>=10) c.push(['magic',{magic:'觀音咒',target:low[0].i}]); if (n>=2 && me.mp>=44) c.push(['magic',{magic:'風雪冰天',target:t}]); if (me.mp>=7) c.push(['magic',{magic:'雷咒',target:t}]); }
  if (me.name==='阿奴') { if (low.length && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:low[0].i}]); if (n>=2 && me.mp>=33) c.push(['magic',{magic:'炎殺咒',target:t}]); if (me.mp>=28) c.push(['magic',{magic:'天雷破',target:t}]); }
  if (me.name==='李逍遙') { if (me.hp<me.maxHp*0.4 && me.mp>=40) c.push(['magic',{magic:'元靈歸心術',target:b.turn.member}]); }
  c.push(['attack',{target:t}]); return c; };
global.palaceAct = (b) => { const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/樹妖/.test(e.name))) return global.treeAct(b); if (en.some(e=>/巫王侍衛/.test(e.name))) return global.guardAct(b); return global.bossAct(b); };
global.driveStory = async (budgetMs=100000) => { const t0=Date.now(); let res=null;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const m=pal.world.mode; if (m==='dialog') { await pal.advance(30); continue; } if (m==='busy') { await pal.wait(300); continue; } if (m==='battle') { const rr=await global.runFight(global.BATTLE_ACT); res=rr.res&&rr.res.result; continue; } break; }
  await pal.observe(); return {mode:pal.world.mode, scene:pal.world.scene, p:pal.world.player, res, lb:pal.world.lastBattleResult&&pal.world.lastBattleResult.result}; };
global.bossStart = async () => { await pal.load(86); pal.world.gameOver=false; await pal.observe(); global._tree={throw:false, fire:false, guard:false}; global._g={js:0, fire:0}; global._blog=[];
  global.BATTLE_ACT = (b) => { const c=global.palaceAct(b); global._blog.push(b.party[b.turn.member].name+'>'+c[0][0]+(c[0][1].magic||c[0][1].item||'')+' P='+b.party.map(p=>p.hp+'/'+p.mp).join(' ')+' E='+b.enemies.map(e=>e.name.slice(0,2)+e.hp).join(',')); return c; };
  const sv=global.BATTLE_ACT; const r=await global.walk4(113,89,0,30000,0); return r.res; };
global.grindAny = async (budgetMs=95000, slot=86, cashGoal=30000) => { const t0=Date.now(); const log=[]; global._skip=global._skip||new Map();
  while (Date.now()-t0<budgetMs && pal.world.cash<cashGoal) { await pal.observe(); if (pal.world.mode!=='control') { if (pal.world.mode==='battle') { const r=await global.runFight(global.ugAct); log.push('B:'+(r.res&&r.res.result)); } await global.settle(0); continue; }
    await global.healUp(0.7); await pal.observe(); const p=pal.world.player; const now=Date.now();
    const cands=(pal.world.objectList||[]).filter(o=>global.isFoe(o)&&!((global._skip.get(o.id)||0)>now)).sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    if (!cands.length) { log.push('none'); await pal.wait(2500); continue; }
    global._fleeTries=0; const n0=(pal.world.lastBattleResult||{}).battle; const wr=await global.walkTo4(cands[0].id, 20000); await pal.observe();
    if (pal.world.mode==='battle') { const en=pal.world.battle.enemies.map(e=>e.name).join('+'); const r=await global.runFight(global.ugAct); const rr=r.res&&r.res.result; log.push(en+':'+rr+':'+pal.world.cash); await global.settle(0); await pal.observe();
      if (rr==='lost') { global._skip.set(cands[0].id, Date.now()+120000); continue; }
      if (rr==='fled') global._skip.set(cands[0].id, Date.now()+60000);
      if (rr==='won' && pal.world.mode==='control') { await global.healUp(0.7); await pal.observe(); if (pal.world.members.every(m=>m.hp>m.maxHp*0.5)) await pal.save(slot,'grind '+pal.world.scene+' $'+pal.world.cash); } }
    else { if ((pal.world.lastBattleResult||{}).battle===n0) global._skip.set(cands[0].id, Date.now()+30000); log.push('walk:'+wr); }
  }
  await pal.observe(); return {cash:pal.world.cash, log:log.slice(-12), scene:pal.world.scene, mem:pal.world.members.map(m=>m.name+' '+m.level+' '+m.hp+' mp'+m.mp)}; };
global.grindLoop = async (budgetMs=100000, goal=30000) => { const t0=Date.now(); const out=[]; let dry=0;
  while (Date.now()-t0<budgetMs && pal.world.cash<goal) { const r=await global.grindAny(Math.min(45000, budgetMs-(Date.now()-t0)), 86, goal); const nones=r.log.filter(x=>x==='none').length; out.push(pal.world.scene+':$'+pal.world.cash+' n'+nones);
    if (nones>=3) { const other = pal.world.scene===287? 285 : 287; await global.travel5(other, 30000); await pal.observe(); if (pal.world.mode==='control') await pal.save(86,'grind '+pal.world.scene); } }
  await pal.observe(); return {cash:pal.world.cash, out, mem:pal.world.members.map(m=>m.name+' '+m.level+' '+m.hp+' mp'+m.mp)}; };
global.walkTo4 = async (target, budgetMs=30000) => { // walk toward a specific foe object, avoiding other foes
  const t0=Date.now(); const n0=(pal.world.lastBattleResult||{}).battle; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world; if (w.mode!=='control') return 'mode:'+w.mode; if ((w.lastBattleResult||{}).battle!==n0) return 'fought';
    const t=w.objects.get(target); if (!t || !global.isFoe(t)) return 'gone'; const p=w.player;
    const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const others=(w.objectList||[]).filter(o=>global.isFoe(o)&&o.id!==target);
    const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy)); let steps=null;
    for (const ar of [3,2,1,0]) { const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-t.gx)+Math.abs(y-t.gy)<=1) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (others.some(f=>Math.abs(f.gx-nx)+Math.abs(f.gy-ny)<=ar)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } break; } }
    if (!steps) return 'nopath'; if (!steps.length) { // adjacent: step into it
      const dx=t.gx-p.gx, dy=t.gy-p.gy; await pal.step(dx>0?'right':dx<0?'left':dy>0?'down':'up',1); stuck++; if (stuck>4) return 'stuck'; continue; }
    const bk=p.gx+','+p.gy; await pal.step(steps[0],1); await pal.observe(); if (pal.world.player.gx+','+pal.world.player.gy===bk && pal.world.mode==='control') { stuck++; if (stuck>3) return 'stuck'; } }
  return 'time'; };
global.ugAct = (b) => { const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/巫王侍衛/.test(e.name))) return global.guardAct(b); if (en.some(e=>/瘟神|魔獸武士|玩蛇女|黑苗祭司|牛鬼|土蜘蛛/.test(e.name)) && (global._fleeTries=(global._fleeTries||0)+1)<=8) return [['flee',{}]].concat(global.bossAct(b)); return global.grindAct(b); };
// ---- relay round 2 (final-boss prep) — final dump 2026-01-01T07:49:08.430Z
// RESULT: 拜月教主 defeated (relay round 2), ending played to 4434, slot 99 saved, global.completedEnding=true.
// Recipe: farm ~$118k in 285/287 (grindLoop, FARM_SLOT=80) -> 278 palace: guardAct2 (3x 乾坤 kills both guards; 靈兒 五氣 top-up)
//   -> treeAct (逍遙 heals/protects 阿奴, 阿奴 乾坤 while 樹妖>6000 then 爆炸蠱) -> ~$85k at 281 -> finalAct9/finalAct8c.
// 拜月 notes: R1 boss idle (free buff round); then 2 big AoEs/round; turns interleave; 靈兒(仙女劍) has 2 actions; protect via 金剛咒/真元護體.
global.runFight = async (actFn, maxTurns=200) => { const log=[]; let n=0; const b0=(pal.world.lastBattleResult||{}).battle; let lastRev=null;
  while (n<maxTurns*4) { n++; await pal.observe(); const w=pal.world;
    if (w.mode==='dialog') { await pal.advance(50); continue; }
    if (w.mode!=='battle') { if (w.mode==='busy') { await pal.wait(400); continue; } const lb=w.lastBattleResult; return {res: lb && lb.battle!==b0 ? lb : (lb||{result:'unknown'}), mode:w.mode, log:log.slice(-8)}; }
    const b=w.battle; if(!b||!b.turn||b.turn.kind!=='command'||!b.prompt) { await pal.wait(200); continue; }
    if (b.prompt.revision===lastRev) { await pal.wait(150); continue; }
    const mi=b.party.findIndex(p=>p.roleId===b.prompt.role); const bb=Object.assign({},b,{turn:Object.assign({},b.turn,{member: mi>=0?mi:b.turn.member})});
    const cands=actFn(bb); let ok=false;
    for (const [t,ex] of cands) { const r=await pal.battle(t,ex); const op=r&&r.reply&&r.reply.op; if (op!=='SMSG_REJECT') { ok=true; log.push((b.party[mi]||{}).name+'>'+t+(ex&&(ex.magic||ex.item)||'')); break; } else { global._rejlog.push(t+':'+JSON.stringify(ex)+'=>'+JSON.stringify(r.reply).slice(0,160)); if(global._rejlog.length>50) global._rejlog.shift(); } }
    if (!ok) await pal.battle('defend',{}); lastRev=b.prompt.revision; }
  return {res:{result:'limit'}, log:log.slice(-8)}; };
global.driveStory = async (budgetMs=100000) => { const t0=Date.now(); let res=null;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const m=pal.world.mode; if (m==='dialog') { await pal.advance(30); continue; } if (m==='busy') { await pal.wait(300); continue; } if (m==='battle') { const rr=await global.runFight(global.BATTLE_ACT); res=rr.res&&rr.res.result; continue; } break; }
  await pal.observe(); return {mode:pal.world.mode, scene:pal.world.scene, p:pal.world.player, res, lb:pal.world.lastBattleResult&&pal.world.lastBattleResult.result}; };
global.grindLoop = async (budgetMs=100000, goal=30000) => { const t0=Date.now(); const out=[];
  while (Date.now()-t0<budgetMs && pal.world.cash<goal) { const r=await global.grindAny(Math.min(45000, budgetMs-(Date.now()-t0)), global.FARM_SLOT, goal); const nones=r.log.filter(x=>x==='none').length; out.push(pal.world.scene+':$'+pal.world.cash+' n'+nones+' '+r.log.filter(x=>x!=='none').slice(-3).join(';'));
    if (nones>=3) { const other = pal.world.scene===287? 285 : 287; await global.travel5(other, 30000); await pal.observe(); if (pal.world.mode==='control') await pal.save(global.FARM_SLOT,'grind '+pal.world.scene+' $'+pal.world.cash); } }
  await pal.observe(); return {cash:pal.world.cash, out, mem:pal.world.members.map(m=>m.name+' '+m.level+' '+m.hp+' mp'+m.mp)}; };
global.grindAny = async (budgetMs=95000, slot=86, cashGoal=30000) => { const t0=Date.now(); const log=[]; global._skip=global._skip||new Map();
  while (Date.now()-t0<budgetMs && pal.world.cash<cashGoal) { await pal.observe(); if (pal.world.mode!=='control') { if (pal.world.mode==='battle') { const r=await global.runFight(global.ugAct); log.push('B:'+(r.res&&r.res.result)); } await global.settle(0); continue; }
    await global.healUp(0.7); await pal.observe(); const p=pal.world.player; const now=Date.now();
    const cands=(pal.world.objectList||[]).filter(o=>global.isFoe(o)&&!((global._skip.get(o.id)||0)>now)).sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    if (!cands.length) { log.push('none'); await pal.wait(2500); continue; }
    global._fleeTries=0; const n0=(pal.world.lastBattleResult||{}).battle; const wr=await global.walkTo4(cands[0].id, 20000); await pal.observe();
    if (pal.world.mode==='battle') { const en=pal.world.battle.enemies.map(e=>e.name).join('+'); const r=await global.runFight(global.ugAct); const rr=r.res&&r.res.result; log.push(en+':'+rr+':'+pal.world.cash); await global.settle(0); await pal.observe();
      if (rr==='lost') { global._skip.set(cands[0].id, Date.now()+120000); continue; }
      if (rr==='fled') global._skip.set(cands[0].id, Date.now()+60000);
      if (rr==='won' && pal.world.mode==='control') { await global.healUp(0.7); await pal.observe(); if (pal.world.members.every(m=>m.hp>m.maxHp*0.5)) await pal.save(slot,'grind '+pal.world.scene+' $'+pal.world.cash); } }
    else { if ((pal.world.lastBattleResult||{}).battle===n0) global._skip.set(cands[0].id, Date.now()+30000); log.push('walk:'+wr); }
  }
  await pal.observe(); return {cash:pal.world.cash, log:log.slice(-12), scene:pal.world.scene, mem:pal.world.members.map(m=>m.name+' '+m.level+' '+m.hp+' mp'+m.mp)}; };
global.travel5 = async (dest, budgetMs=100000) => { const t0=Date.now(); const log=[];
  while (Date.now()-t0<budgetMs) { await pal.observe(); if (pal.world.scene===dest) return {res:'arrived', log};
    const sp=global.scenePath(pal.world.scene,dest); if (!sp||!sp.length) return {res:'nopath', log}; const next=sp[0];
    const ex=(pal.world.objectList||[]).filter(o=>{ const e=global.eoOf(o.id)||{}; const x=global.exitOf(e.triggerScript||0); return x&&x.to===next; }); if (!ex.length) return {res:'noexit '+next, log};
    const p=pal.world.player; ex.sort((a,b)=>Math.abs(a.gx-p.gx)+Math.abs(a.gy-p.gy)-Math.abs(b.gx-p.gx)-Math.abs(b.gy-p.gy));
    const sc=pal.world.scene; const r=await global.walk5(ex[0].gx,ex[0].gy,86,Math.max(10000,budgetMs-(Date.now()-t0)),Math.max(1,global.trigR(ex[0].triggerMode))); log.push(sc+':'+r.res+' '+r.log.slice(-3).join('|'));
    await pal.observe(); if (pal.world.scene!==sc && pal.world.mode==='control') { await global.settle(0); await global.healUp(0.7); await pal.save(global.FARM_SLOT,'enter '+pal.world.scene); log.push('saved@'+pal.world.scene); }
    else if (r.res!=='time') { log.push('stop'); break; } }
  return {res:'time', log}; };
global.walk5 = async (gx,gy,slot=global.FARM_SLOT,budgetMs=105000,R=0) => { const t0=Date.now(); const log=[]; let reloads=0; let lastSave=Date.now();
  while (Date.now()-t0<budgetMs) { global.BATTLE_ACT=global.ugAct; global._fleeTries=0;
    const r=await global.walk4(gx,gy,R,Math.min(25000, budgetMs-(Date.now()-t0)),global.AVOID_R4||3); log.push(r.res+':'+r.log.filter(x=>x.startsWith('F')).join(','));
    if (r.res==='lost') { for (let i=0;i<30;i++){ await pal.observe(); const m=pal.world.mode; if (m==='dialog') await pal.advance(50); else if (m==='busy') await pal.wait(400); else break; } await pal.load(slot); pal.world.gameOver=false; reloads++; log.push('reload'); await pal.wait(300+Math.floor(Math.random()*2500)); if (reloads>6) break; continue; }
    if (r.res==='scene' || r.res==='arrived') return {res:r.res, log, reloads};
    await pal.observe(); const ms=pal.world.members; const p=pal.world.player; const near=(pal.world.objectList||[]).some(o=>global.isFoe(o)&&Math.abs(o.gx-p.gx)+Math.abs(o.gy-p.gy)<=4);
    if (pal.world.mode==='control' && !near) { await global.healUp(0.7); await pal.observe(); if (pal.world.members.every(m=>m.hp>m.maxHp*0.6)) { await pal.save(slot,'291 progress '+p.gx+','+p.gy); log.push('saved@'+p.gx+','+p.gy); } }
  } return {res:'time', log, reloads}; };
global.walkTo4 = async (target, budgetMs=30000) => { // walk toward a specific foe object, avoiding other foes
  const t0=Date.now(); const n0=(pal.world.lastBattleResult||{}).battle; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world; if (w.mode!=='control') return 'mode:'+w.mode; if ((w.lastBattleResult||{}).battle!==n0) return 'fought';
    const t=w.objects.get(target); if (!t || !global.isFoe(t)) return 'gone'; const p=w.player;
    const rows=await global.mapRows(); const W=(x,y)=>rows[y]&&rows[y][x]==='.'; const others=(w.objectList||[]).filter(o=>global.isFoe(o)&&o.id!==target);
    const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy)); let steps=null;
    for (const ar of [3,2,1,0]) { const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-t.gx)+Math.abs(y-t.gy)<=1) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (others.some(f=>Math.abs(f.gx-nx)+Math.abs(f.gy-ny)<=ar)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } break; } }
    if (!steps) return 'nopath'; if (!steps.length) { // adjacent: step into it
      const dx=t.gx-p.gx, dy=t.gy-p.gy; await pal.step(dx>0?'right':dx<0?'left':dy>0?'down':'up',1); stuck++; if (stuck>4) return 'stuck'; continue; }
    const bk=p.gx+','+p.gy; await pal.step(steps[0],1); await pal.observe(); if (pal.world.player.gx+','+pal.world.player.gy===bk && pal.world.mode==='control') { stuck++; if (stuck>3) return 'stuck'; } }
  return 'time'; };
global.walk4 = async (gx,gy,R=0,budgetMs=100000,avoidR=3) => { const t0=Date.now(); const sc=pal.world.scene; const log=[]; let stuck=0;
  while (Date.now()-t0<budgetMs) { await pal.observe(); const w=pal.world;
    if (w.mode==='battle') { const en=(w.battle&&w.battle.enemies||[]).map(e=>e.name).join('+'); const r=await global.runFight(global.BATTLE_ACT); const rr=r.res&&r.res.result||r.res; log.push('F['+en+']:'+rr); if (rr==='lost'||rr==='gameover') return {res:'lost',log}; await global.settle(0); await global.healUp(0.6); continue; }
    if (w.mode!=='control') { await global.settle(0); continue; }
    if (w.scene!==sc) return {res:'scene',scene:w.scene,log};
    const p=w.player; if (Math.abs(p.gx-gx)+Math.abs(p.gy-gy)<=R) return {res:'arrived',log};
    const rows=await global.mapRows(); global._lb=global._lb||{}; const LB=(global._lb[w.scene]=global._lb[w.scene]||new Set()); const W=(x,y)=>rows[y]&&rows[y][x]==='.'&&!LB.has(x+','+y);
    const foes=(w.objectList||[]).filter(o=>global.isFoe(o)); const block=new Set((w.objectList||[]).filter(o=>o.blocking && !global.isFoe(o)).map(o=>o.gx+','+o.gy));
    let steps=null;
    for (const ar of [avoidR, 2, 1, 0]) { const bad=(x,y)=>foes.some(f=>Math.abs(f.gx-x)+Math.abs(f.gy-y)<=ar);
      const start=p.gx+','+p.gy; const prev=new Map([[start,null]]); const q=[[p.gx,p.gy]]; let end=null;
      while(q.length){ const [x,y]=q.shift(); if (Math.abs(x-gx)+Math.abs(y-gy)<=R) { end=x+','+y; break; } for (const [d,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]) { const nx=x+dx, ny=y+dy, k=nx+','+ny; if (prev.has(k)||!W(nx,ny)||block.has(k)) continue; if (bad(nx,ny) && !(Math.abs(nx-gx)+Math.abs(ny-gy)<=R)) continue; prev.set(k,{k:x+','+y,d}); q.push([nx,ny]); } }
      if (end) { steps=[]; let c=end; while(prev.get(c)){ steps.unshift(prev.get(c).d); c=prev.get(c).k; } if (ar<avoidR) log.push('ar'+ar); break; } }
    if (!steps) { await pal.wait(400); stuck++; if (stuck>10) return {res:'nopath',log}; continue; }
    const d=steps[0]; let n=1; while (n<steps.length && steps[n]===d && n<2) n++;
    const before=p.gx+','+p.gy; await pal.step(d,n); await pal.observe(); const after=pal.world.player.gx+','+pal.world.player.gy;
    if (after===before && pal.world.mode==='control') { const dd={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[d]; LB.add((p.gx+dd[0])+','+(p.gy+dd[1])); stuck++; if (stuck>8) return {res:'stuck',at:after,log}; } else stuck=0; }
  return {res:'time',log}; };
global.isFoe = (o) => { if (!o) return false; if (base(o)) return true; const e=global.eoOf(o.id); if (!e||!e.triggerScript) return false; const s=global._byAddr.get(e.triggerScript); return !!(s && s.op==='0007') && o.triggerMode>=4; };
global.ugAct = (b)=>{ global._bsnap=b; return global._ugBase(b); };
global._ugBase = (b) => { const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/巫王侍衛/.test(e.name))) return global.guardAct(b); if (en.some(e=>/瘟神|魔獸武士|玩蛇女|黑苗祭司|牛鬼|土蜘蛛/.test(e.name)) && (global._fleeTries=(global._fleeTries||0)+1)<=8) return [['flee',{}]].concat(global.bossAct(b)); return global.grindAct(b); };
global.palaceAct = (b)=>{ const en=b.enemies.filter(e=>e.hp>0); if (en.some(e=>/樹妖/.test(e.name))) return global.treeAct(b); if (en.some(e=>/侍衛/.test(e.name))) return global.guardAct2(b); return global.bossAct(b); };
global.guardAct2 = (b)=>{ const P=b.party; const mi=b.turn.member; const me=P[mi]; const en=b.enemies.filter(e=>e.hp>0).sort((a,b)=>a.hp-b.hp); const t=(en[0]||{}).index||0;
  const low=(f)=>P.map((p,i)=>[p,i]).filter(([p])=>p.hp>0&&p.hp<p.maxHp*f).sort((a,b)=>a[0].hp/a[0].maxHp-b[0].hp/b[0].maxHp);
  if (/阿奴/.test(me.name)) { if (pal.world.cash>=5000 && (en.length>=2 || (en[0]&&en[0].hp>1200))) return [['magic',{magic:'乾坤一擲',target:t}],['attack',{target:t}]]; return [['attack',{target:t}]]; }
  if (/靈兒/.test(me.name)) { if (low(0.88).length && me.mp>=40) return [['magic',{magic:'五氣朝元'}],['defend',{}]]; return [['defend',{}]]; }
  if (/逍遙/.test(me.name)) { const l=low(0.3); if (l.length && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:l[0][1]}],['attack',{target:t}]]; return [['attack',{target:t}]]; }
  return [['attack',{target:t}]]; };
global.treeAct = (b)=>{ const P=b.party; const mi=b.turn.member; const me=P[mi]; const en=b.enemies.filter(e=>e.hp>0); const tr=en.find(e=>/樹妖/.test(e.name)); const t=(tr||en[0]||{}).index||0; const thp=tr?tr.hp:0;
  const xi=P.findIndex(p=>/逍遙/.test(p.name)), ai=P.findIndex(p=>/阿奴/.test(p.name)); const X=P[xi]||{}, A=P[ai]||{};
  const prot=(p)=>(p.status||[]).includes('protect'); const r=(p)=>p.hp/p.maxHp;
  if (/逍遙/.test(me.name)) {
    if (A.hp>0 && r(A)<0.6 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:ai}],['attack',{target:t}]];
    if (r(me)<0.45 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:mi}],['attack',{target:t}]];
    if (A.hp>0 && !prot(A) && me.mp>=18) return [['magic',{magic:'真元護體',target:ai}],['attack',{target:t}]];
    if (!prot(me) && me.mp>=18) return [['magic',{magic:'真元護體',target:mi}],['attack',{target:t}]];
    return [['attack',{target:t}]]; }
  if (/阿奴/.test(me.name)) {
    if (r(me)<0.45 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:mi}],['attack',{target:t}]];
    if (X.hp>0 && r(X)<0.3 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:xi}],['attack',{target:t}]];
    if (thp>6000 && pal.world.cash>=5000) return [['magic',{magic:'乾坤一擲',target:t}],['attack',{target:t}]];
    if (me.mp>=49) return [['magic',{magic:'爆炸蠱',target:t}],['attack',{target:t}]];
    if (pal.world.cash>=5000) return [['magic',{magic:'乾坤一擲',target:t}],['attack',{target:t}]];
    return [['attack',{target:t}]]; }
  return [['attack',{target:t}]]; };
global.finalAct8 = (b)=>{ const F=global._f6; const P=b.party; const mi=b.turn.member; const me=P[mi]; const nm=me.name;
  const lim=/靈兒/.test(nm)?2:1; F.cnt[mi]=(F.cnt[mi]||0)+1; if (F.cnt[mi]>lim || F.round===0) { F.round++; F.cnt={}; F.cnt[mi]=1; F.pend={}; }
  const R=F.round; const en=(b.enemies||[]).filter(e=>e.hp>0); const boss=en.find(e=>/拜月/.test(e.name)); const t=(boss||en[0]||{}).index||0; const bhp=boss?boss.hp:0;
  const st=(p)=>p.status||[]; const r=(p)=>p.hp/p.maxHp; const alive=P.map((p,i)=>[p,i]).filter(([p])=>p.hp>0); const low=(f)=>alive.filter(([p])=>r(p)<f).sort((a,c)=>r(a[0])-r(c[0]));
  const xi=P.findIndex(p=>/逍遙/.test(p.name)), li=P.findIndex(p=>/靈兒/.test(p.name)), ai=P.findIndex(p=>/阿奴/.test(p.name)); const A=P[ai]||{};
  global._blog.push('R'+R+' '+nm+' $'+pal.world.cash+' P='+P.map(p=>p.hp+'/'+p.mp+(st(p).filter(s=>s!=='dual-attack').length?'['+st(p).filter(s=>s!=='dual-attack').join(',')+']':'')).join(' ')+' E='+en.map(e=>e.name.slice(0,2)+e.hp).join(','));
  const hasProt=(i)=>st(P[i]||{}).includes('protect');
  const needProt=(i)=>P[i]&&P[i].hp>0&&!F.pend['p'+i]&&(!hasProt(i) || (F.prot[i]!==undefined && R>=F.prot[i]-1));
  const setProt=(i,d)=>{F.prot[i]=R+d; F.pend['p'+i]=1;};
  if (/阿奴/.test(nm)) {
     if (r(me)<0.33 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:mi}],['defend',{}]];
     if (pal.world.cash>=1) return [['magic',{magic:'乾坤一擲',target:t}],['attack',{target:t}]];
     const l=low(0.6); if (l.length && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:l[0][1]}],['defend',{}]];
     if (me.mp>=49) return [['magic',{magic:'爆炸蠱',target:t}],['attack',{target:t}]];
     return [['attack',{target:t}]]; }
  if (/靈兒/.test(nm)) {
     if (R===1) { if (!F.pend.wq) { F.pend.wq=1; return [['magic',{magic:'五氣朝元'}],['defend',{}]]; } if (needProt(li)) { setProt(li,6); return [['magic',{magic:'金剛咒',target:li}],['defend',{}]]; } }
     if (me.mp>=40 && !F.pend.wq && low(0.7).length>=1) { F.pend.wq=1; return [['magic',{magic:'五氣朝元'}],['defend',{}]]; }
     if (me.mp>=11) for (const i of [ai,li,xi]) if (needProt(i)) { setProt(i,6); return [['magic',{magic:'金剛咒',target:i}],['defend',{}]]; }
     if (me.mp>=40 && !F.pend.wq2 && low(0.8).length>=1) { F.pend.wq2=1; return [['magic',{magic:'五氣朝元'}],['defend',{}]]; }
     if (me.mp>=88+450) return [['magic',{magic:'武神',target:t}],['defend',{}]];
     return [['defend',{}]]; }
  if (/逍遙/.test(nm)) {
     if (global.has('酒') && bhp>0 && bhp <= me.mp*8*0.9) return [['magic',{magic:'酒神',target:t}],['attack',{target:t}]];
     if (R===1) { setProt(ai,8); return [['magic',{magic:'真元護體',target:ai}],['defend',{}]]; }
     if (A.hp>0 && r(A)<0.5 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:ai}],['defend',{}]];
     const l=low(0.5); if (l.length && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:l[0][1]}],['defend',{}]];
     for (const i of [ai,xi,li]) if (needProt(i) && me.mp>=18) { setProt(i,8); return [['magic',{magic:'真元護體',target:i}],['defend',{}]]; }
     if (pal.world.cash<1 && global.has('酒') && me.mp>=150 && low(0.5).length===0) return [['magic',{magic:'酒神',target:t}],['defend',{}]];
     return [['defend',{}]]; }
  return [['defend',{}]]; };
global.finalAct8c = (b)=>{ const F=global._f6; const P=b.party; const mi=b.turn.member; const me=P[mi]; const nm=me.name;
  const lim=/靈兒/.test(nm)?2:1; F.cnt[mi]=(F.cnt[mi]||0)+1; if (F.cnt[mi]>lim || F.round===0) { F.round++; F.cnt={}; F.cnt[mi]=1; F.pend={}; }
  const R=F.round; const en=(b.enemies||[]).filter(e=>e.hp>0); const boss=en.find(e=>/拜月/.test(e.name)); const t=(boss||en[0]||{}).index||0; const bhp=boss?boss.hp:0;
  const st=(p)=>p.status||[]; const r=(p)=>p.hp/p.maxHp; const alive=P.map((p,i)=>[p,i]).filter(([p])=>p.hp>0); const low=(f)=>alive.filter(([p])=>r(p)<f).sort((a,c)=>r(a[0])-r(c[0]));
  const xi=P.findIndex(p=>/逍遙/.test(p.name)), li=P.findIndex(p=>/靈兒/.test(p.name)), ai=P.findIndex(p=>/阿奴/.test(p.name)); const A=P[ai]||{};
  global._blog.push('R'+R+' '+nm+' $'+pal.world.cash+' P='+P.map(p=>p.hp+'/'+p.mp+(st(p).filter(s=>s!=='dual-attack').length?'['+st(p).filter(s=>s!=='dual-attack').join(',')+']':'')).join(' ')+' E='+en.map(e=>e.name.slice(0,2)+e.hp).join(','));
  const hasProt=(i)=>st(P[i]||{}).includes('protect');
  const needProt=(i)=>P[i]&&P[i].hp>0&&!F.pend['p'+i]&&(!hasProt(i) || (F.prot[i]!==undefined && R>=F.prot[i]-1));
  const setProt=(i,d)=>{F.prot[i]=R+d; F.pend['p'+i]=1;};
  if (/阿奴/.test(nm)) {
     if (r(me)<0.33 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:mi}],['defend',{}]];
     if (pal.world.cash>=1) return [['magic',{magic:'乾坤一擲',target:t}],['attack',{target:t}]];
     const l=low(0.6); if (l.length && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:l[0][1]}],['defend',{}]];
     if (me.mp>=49) return [['magic',{magic:'爆炸蠱',target:t}],['attack',{target:t}]];
     return [['attack',{target:t}]]; }
  if (/靈兒/.test(nm)) {
     if (R===1) { if (!F.pend.wq) { F.pend.wq=1; return [['magic',{magic:'五氣朝元'}],['defend',{}]]; } if (needProt(li)) { setProt(li,6); return [['magic',{magic:'金剛咒',target:li}],['defend',{}]]; } }
     if (me.mp>=40 && !F.pend.wq && low(0.75).length>=1) { F.pend.wq=1; return [['magic',{magic:'五氣朝元'}],['defend',{}]]; }
     if (me.mp>=11) for (const i of [ai,li,xi]) if (needProt(i)) { setProt(i,6); return [['magic',{magic:'金剛咒',target:i}],['defend',{}]]; }
     if (me.mp>=40 && !F.pend.wq2 && low(0.8).length>=1) { F.pend.wq2=1; return [['magic',{magic:'五氣朝元'}],['defend',{}]]; }
     if (me.mp>=88+450) return [['magic',{magic:'武神',target:t}],['defend',{}]];
     return [['defend',{}]]; }
  if (/逍遙/.test(nm)) {
     if (global.has('酒') && bhp>0 && bhp <= me.mp*8*0.9) return [['magic',{magic:'酒神',target:t}],['attack',{target:t}]];
     if (R===1) { setProt(ai,8); return [['magic',{magic:'真元護體',target:ai}],['defend',{}]]; }
     if (A.hp>0 && r(A)<0.65 && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:ai}],['defend',{}]];
     const l=low(0.5); if (l.length && me.mp>=40) return [['magic',{magic:'元靈歸心術',target:l[0][1]}],['defend',{}]];
     for (const i of [ai,xi,li]) if (needProt(i) && me.mp>=18) { setProt(i,8); return [['magic',{magic:'真元護體',target:i}],['defend',{}]]; }
     if (pal.world.cash<1 && global.has('酒') && me.mp>=150 && low(0.5).length===0) return [['magic',{magic:'酒神',target:t}],['defend',{}]];
     return [['defend',{}]]; }
  return [['defend',{}]]; };
global.finalAct9 = (b)=>{ const P=b.party; const mi=b.turn.member; const me=P[mi]; const nm=me.name;
  const en=(b.enemies||[]).filter(e=>e.hp>0); const boss=en.find(e=>/拜月/.test(e.name)); const t=(boss||en[0]||{}).index||0; const bhp=boss?boss.hp:99999;
  let c;
  if (bhp<2500) {
    if (/阿奴/.test(nm) && pal.world.cash>=1) c=[['magic',{magic:'乾坤一擲',target:t}],['attack',{target:t}]];
    else if (/逍遙/.test(nm)) c=[['magic',{magic:'酒神',target:t}],['magic',{magic:'劍神',target:t}],['attack',{target:t}]];
    else if (/靈兒/.test(nm) && me.mp>=88) c=[['magic',{magic:'武神',target:t}],['attack',{target:t}]];
  }
  if (!c) c=global.finalAct8c(b); else global._blog.push('FIN '+nm+' bhp'+bhp);
  global._blog.push('  -> '+nm+' '+c[0][0]+(c[0][1].magic||c[0][1].item||'')); return c; };
global.finalPrep = async()=>{ global._f6={round:0,cnt:{},pend:{},prot:{}}; global._blog=[]; global._rejlog=[]; global.BATTLE_ACT=global.finalAct9; await pal.load(98); pal.world.gameOver=false; await pal.wait(300); await pal.observe(); return pal.world.scene; };
global.endingDrive = async(budget=110000)=>{ const t0=Date.now(); const seen=[]; let last='';
  while(Date.now()-t0<budget){ await pal.observe(); const w=pal.world; const m=w.mode;
    if (m==='dialog'){ const d=w.dialog||{}; const s=(d.speaker||'')+':'+(d.text||''); if(s!==last){seen.push(s); last=s;} await pal.advance(20); continue; }
    if (m==='anykey'){ await pal.press('Search'); await pal.wait(200); continue; }
    if (m==='busy'){ await pal.wait(500); continue; }
    if (m==='menu'){ const it=(w.menu&&w.menu.items||[]).map(x=>x.label).join('|'); seen.push('MENU '+it); await pal.choose(0); continue; }
    if (m==='battle'){ await global.runFight(global.BATTLE_ACT); continue; }
    if (m==='control'){ seen.push('CONTROL scene'+w.scene+' '+w.gx+','+w.gy); break; }
    seen.push('MODE '+m); await pal.wait(500); }
  await pal.observe(); return {mode:pal.world.mode, scene:pal.world.scene, seen:seen.slice(-40)}; };
global.FARM_SLOT = 80;
