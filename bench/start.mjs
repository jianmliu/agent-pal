/** One loading/setup contract shared by check, state, run and verify. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const saves = path.join(here, 'saves');
export const SETUP_TOOLS = new Set(['walk_to', 'advance', 'wait']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function taskFingerprint(task) {
  let bytes = null;
  if (task.start.saves) {
    bytes = zlib.gunzipSync(fs.readFileSync(path.join(saves, task.start.saves)));
  } else if (task.start.rpg && process.env.AGENT_PAL_CLASSIC_SAVES) {
    bytes = fs.readFileSync(path.join(process.env.AGENT_PAL_CLASSIC_SAVES, task.start.rpg));
  }
  return { task: hash(JSON.stringify(task)), save: bytes ? hash(bytes) : null };
}

export function expectStart(view, expected) {
  if (!expected) return;
  for (const k of ['scene', 'mode', 'inBattle']) {
    if (expected[k] != null && view[k] !== expected[k]) {
      throw Error(`start.expect ${k}: expected ${expected[k]}, got ${view[k]}`);
    }
  }
  if (expected.enemyObject != null && !view.enemies?.some(enemy =>
      enemy.objectId === expected.enemyObject && enemy.hp === expected.enemyHp)) {
    throw Error('start.expect enemy identity/HP mismatch');
  }
  if (expected.party) {
    if (view.party.length !== expected.party.length) throw Error('start.expect party size mismatch');
    for (let i = 0; i < expected.party.length; i++) {
      for (const [k, value] of Object.entries(expected.party[i])) {
        if (view.party[i][k] !== value) {
          throw Error(`start.expect party[${i}].${k}: expected ${value}, got ${view.party[i][k]}`);
        }
      }
    }
  }
  if (expected.cash != null && view.cash !== expected.cash) throw Error('start.expect cash mismatch');
  for (const [id, amount] of Object.entries(expected.items || {})) {
    if (view.inventory.find(item => item.itemId === Number(id))?.amount !== amount) {
      throw Error(`start.expect item ${id} mismatch`);
    }
  }
}

export async function initializeTask({ e, a, task, runTool, tracker }) {
  await e.drive(a.settle(60000));
  if (task.start.newGame) {
    await e.drive(runTool(a, 'choose', { index: 0 }));
  } else {
    await e.drive(runTool(a, 'choose', { index: 1 }));
    await e.drive(runTool(a, 'choose', { index: (task.start.slot ?? 1) - 1 }));
  }
  const setup = [];
  for (const [name, args] of task.start.setup || []) {
    if (!SETUP_TOOLS.has(name)) throw Error(`start.setup tool ${name} is not allowed`);
    const result = await e.drive(runTool(a, name, args));
    tracker.update();
    if (result?.unknown || result?.ok === false) throw Error(`start.setup ${name}: ${result?.note}`);
    setup.push({ name, args, result });
  }
  tracker.update();
  const view = tracker.view();
  expectStart(view, task.start.expect);
  return { setup, view };
}

/** Freeze the actual runtime and assets, including dirty source/build content. */
export function runtimeFingerprint() {
  const repo = path.resolve(here, '../../..');
  const excluded = new Set(['out', 'saves', 'reference', 'tasks', 'quiz', 'test']);
  const digestDir = (dir, filter = () => true) => {
    const h = crypto.createHash('sha256');
    const walk = at => {
      for (const name of fs.readdirSync(at).sort()) {
        const file = path.join(at, name), stat = fs.lstatSync(file);
        if (stat.isDirectory()) {
          if (at === here && excluded.has(name)) continue;
          walk(file);
        } else if (stat.isFile() && filter(file)) {
          h.update(path.relative(dir, file)); h.update('\0'); h.update(fs.readFileSync(file));
        }
      }
    };
    walk(dir);
    return h.digest('hex');
  };
  const assets = [process.env.PAL_ASSET_DIR,
    path.join(repo, 'apps/pal-playground/public/pal-assets'),
    path.join(repo, 'apps/pal-playground/dist/pal-assets')]
    .find(dir => dir && (fs.existsSync(path.join(dir, 'PAT.MKF')) || fs.existsSync(path.join(dir, 'pat.mkf'))));
  if (!assets) throw Error('cannot fingerprint missing game assets');
  return {
    node: process.version,
    agent: digestDir(path.resolve(here, '../src')),
    engine: digestDir(path.join(repo, 'packages/game-engine/dist')),
    bench: digestDir(here, file => file.endsWith('.mjs')),
    assets: digestDir(assets, file => !path.basename(file).startsWith('.'))
  };
}

/** Formal single battles use the existing owned command/round protocol. */
export function engineOptions(task) {
  return task.engineProfile === 'owned-battle' ? {
    commandProfile: 'owned-command', battleScriptProfile: 'owned-parent',
    battleExecutionProfile: 'round-boundary'
  } : {};
}

/** A single-battle command includes acknowledgement of non-choice combat dialogue. */
export async function executeTaskTool({e,a,task,runTool}, name, args) {
  const before = e.commandWait?.();
  let result = await e.drive(runTool(a,name,args));
  if(task.engineProfile!=='owned-battle' || name!=='battle') return result;
  const accepted = result?.ok || (result?.reason==='busy' && before?.kind==='battle.command' && e.commandWait?.()?.revision!==before.revision);
  if(!accepted) return result;
  let acknowledged=0;
  for(let poll=0;poll<1200 && e.worldService.isInBattle();poll++){
    const next=e.commandWait?.();
    if(next?.kind==='battle.command' && next.state==='waiting')break;
    if(a.mode()==='dialog' && acknowledged<8){
      const r=await e.drive(runTool(a,'advance',{max:1}));
      if(!r?.ok)break;
      acknowledged++;
    }else{
      await e.drive(new Promise(resolve=>setTimeout(resolve,50)));
    }
  }
  const next = e.commandWait?.();
  const ready = !e.worldService.isInBattle() || (next?.kind === 'battle.command' && next.state === 'waiting');
  if (!ready) return {...result, ok:false, reason:'busy', note:'accepted battle command did not reach the next decision boundary'};
  return {...result, ok:true, note:acknowledged ? `${result.note || ''}; acknowledged ${acknowledged} non-choice combat dialogue(s)` : result.note};
}
