/** Local resource inventory only; hashes neither establish rights nor authorize inference. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const REQUIRED_ASSETS = Object.freeze(['ABC.MKF','BALL.MKF','DATA.MKF','F.MKF','FBP.MKF','FIRE.MKF','GOP.MKF','MAP.MKF','MGO.MKF','PAT.MKF','RGM.MKF','SSS.MKF','M.MSG','WORD.DAT','WOR16.ASC','WOR16.FON']);
export const OPTIONAL_ASSETS = Object.freeze(['DESC.DAT','VOC.MKF','SOUNDS.MKF','MIDI.MKF','MUS.MKF','RNG.MKF']);

export function resolveClassicSave(taskOrFilename, {env = process.env} = {}) {
  const filename = typeof taskOrFilename === 'string' ? taskOrFilename : taskOrFilename?.start?.rpg;
  if (!filename || path.basename(filename) !== filename) throw Error('classic save requires a basename from task.start.rpg');
  return path.resolve(env.AGENT_PAL_CLASSIC_SAVES || path.join(root,'bench/saves/classic'),filename);
}

/** Same ordered candidates and PAT marker as src/engine.mjs; importing never boots it. */
export function resolveAssetsDir({env = process.env} = {}) {
  const candidates = [env.PAL_ASSET_DIR, path.join(root,'pal-assets'),
    path.resolve(root,'../pal-playground/public/pal-assets'),path.resolve(root,'../pal-playground/dist/pal-assets')].filter(Boolean);
  return path.resolve(candidates.find(dir => fs.existsSync(path.join(dir,'PAT.MKF')) || fs.existsSync(path.join(dir,'pat.mkf'))) || candidates[0]);
}

export function digestDirectory(dir) {
  const entries = [];
  const walk = at => {
    for (const name of fs.readdirSync(at).sort()) {
      const file = path.join(at,name), stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) entries.push([path.relative(dir,file).split(path.sep).join('/'),fs.readFileSync(file)]);
    }
  };
  walk(dir);
  const digest = crypto.createHash('sha256');
  for (const [name,bytes] of entries) digest.update(name).update('\0').update(bytes);
  return {sha256:digest.digest('hex'),fileCount:entries.length};
}

/** Returns diagnostics without throwing. `expected` may be an earlier audit or resources.json. */
export function auditResources({assetsDir, buildDir = path.join(root,'packages/game-engine/dist'), env = process.env, expected} = {}) {
  assetsDir = assetsDir || resolveAssetsDir({env});
  const errors = [];
  let names = [];
  try { names = fs.readdirSync(assetsDir); } catch { errors.push(`assets directory missing: ${assetsDir}; set PAL_ASSET_DIR to your legally obtained supported DOS data`); }
  const expectedAssets = expected?.assets || expected?.localProfile?.assets || [];
  const assets = [...REQUIRED_ASSETS,...OPTIONAL_ASSETS].map(name => {
    const actualNames = names.filter(n => n.toUpperCase() === name).sort();
    const actual = actualNames.includes(name) ? name : actualNames[0];
    const file = actual && path.join(assetsDir,actual);
    const required = REQUIRED_ASSETS.includes(name);
    let bytes;
    try { if (file) bytes = fs.readFileSync(file); } catch { /* reported below */ }
    const entry = {name,required,present:!!bytes,size:bytes?.length ?? null,sha256:bytes ? sha(bytes) : null};
    if (required && !bytes) errors.push(`${name} missing; supply supported original data in ${assetsDir}`);
    if (required && bytes?.length === 0) errors.push(`${name} empty; supply intact original data`);
    // Ambiguous case aliases must not hide bytes the HTTP loader might select.
    for (const alias of actualNames) if (bytes && sha(fs.readFileSync(path.join(assetsDir,alias))) !== entry.sha256) errors.push(`${name} conflicting case alias ${alias}; keep byte-identical aliases only`);
    const pinned = expectedAssets.find(x => x.name === name);
    if (pinned && (pinned.sha256 !== entry.sha256 || pinned.size !== entry.size)) errors.push(`${name} digest/size differs from the pinned profile; restore supported bytes or create a reviewed new resource version`);
    return entry;
  });
  let tracked = [];
  try { tracked = execFileSync('git',['ls-files','bench/saves'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean); }
  catch { errors.push('cannot establish tracked starting-file provenance: git ls-files bench/saves failed'); }
  const startingFiles = tracked.filter(file => /\.rpg$|\.saves\.json\.gz$/i.test(file)).map(relative => {
    const kind = relative.endsWith('.gz') ? 'bundled-save' : 'classic-save';
    const filename = path.basename(relative);
    const file = kind === 'classic-save' ? resolveClassicSave(filename,{env}) : path.join(root,relative);
    try {
      const bytes = fs.readFileSync(file);
      const decoded = kind === 'bundled-save' ? zlib.gunzipSync(bytes) : bytes;
      const embeddedSlots = [];
      if (kind === 'bundled-save') {
        const container = JSON.parse(decoded.toString('utf8'));
        for (const [slot, value] of Object.entries(container)) {
          if (!/^PAL-SAVE-\d+$/.test(slot)) continue;
          const payload = typeof value === 'string' ? JSON.parse(value) : value;
          if (!Array.isArray(payload?.bytes)) throw Error(`save slot ${slot} lacks decoded bytes`);
          const stateBytes = Buffer.from(payload.bytes);
          embeddedSlots.push({slot,size:stateBytes.length,sha256:sha(stateBytes)});
        }
      }
      const entry = {path:relative,kind,tracked:true,source:kind === 'classic-save' && env.AGENT_PAL_CLASSIC_SAVES ? 'explicit-classic-directory' : 'repository',size:bytes.length,sha256:sha(bytes),decodedSize:decoded.length,decodedSha256:sha(decoded),rights:'not-independently-cleared',...(kind === 'bundled-save' ? {embeddedSlots} : {})};
      const pinned = (expected?.startingFiles || []).find(x => x.path === relative);
      if (pinned && (pinned.sha256 !== entry.sha256 || pinned.decodedSha256 !== entry.decodedSha256)) errors.push(`${relative} digest differs from the pinned starting state`);
      return entry;
    } catch (error) { errors.push(`${relative} missing or invalid: ${error.message}`); return {path:relative,kind,tracked:true,present:false}; }
  });
  let build = {present:false,sha256:null,fileCount:0};
  try { build = {present:true,...digestDirectory(buildDir)}; if (!build.fileCount) errors.push('engine build empty; run pnpm run build:engine'); }
  catch { errors.push('engine build missing; run pnpm install --frozen-lockfile then pnpm run build:engine'); }
  if (expected?.build?.sha256 && expected.build.sha256 !== build.sha256) errors.push('engine build digest differs from the pinned profile; rebuild the pinned revision');
  return {schemaVersion:1,ok:errors.length === 0,assets,startingFiles,build,errors};
}

export function preflightResources(options = {}) {
  const report = auditResources(options);
  if (!report.ok) throw Error(`Resource preflight failed:\n${report.errors.join('\n')}`);
  return report;
}
export const preflight = preflightResources;
