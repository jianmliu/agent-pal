/** Complete scientific trial accounting, separate from the successful-run showcase. */
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import crypto from 'node:crypto';
import { episodeDigest, runDigest, replayCertification } from './verify.mjs';

const slug = x => encodeURIComponent(String(x)).replace(/\./g, '%2E');
const key = t => JSON.stringify([t.releaseId, t.condition, t.model, t.task, t.version, t.seed, t.repetition, t.attempt]);
const unique = xs => Array.isArray(xs) && xs.length > 0 && new Set(xs).size === xs.length;
const nonempty = x => typeof x === 'string' && x.length > 0;
const positive = x => Number.isInteger(x) && x > 0;
const relative = p => nonempty(p) && !path.isAbsolute(p) && !p.includes('\\') && !p.split('/').some(x => x === '..' || x === '.' || !x);
const infraReason = reason => typeof reason === 'string' && /^(startup-(timeout|error|exit|invalid-ready)|harness-crash\b)/.test(reason);
const accountingComplete = r => r.result?.accountingStatus == null || r.result.accountingStatus === 'complete';
const dimensions = c => unique(c.conditions) && c.conditions.every(nonempty) && unique(c.models) && c.models.every(nonempty) &&
  unique(c.repetitions) && c.repetitions.every(positive) && Array.isArray(c.tasks) && c.tasks.length > 0 &&
  new Set(c.tasks.map(t => t.id)).size === c.tasks.length && c.tasks.every(t => nonempty(t.id) && positive(t.version) && unique(t.seeds) && t.seeds.every(s => Number.isInteger(s) && s >= 0));

export function makeTrials(c) {
  if (!nonempty(c.releaseId) || !dimensions(c)) throw Error('invalid campaign dimensions');
  const out = [];
  for (const condition of c.conditions) for (const model of c.models) for (const task of c.tasks)
    for (const seed of task.seeds) for (const repetition of c.repetitions) {
      out.push({ releaseId: c.releaseId, condition, model, task: task.id, version: task.version, seed, repetition, attempt: 1,
        runDir: `results/${slug(condition)}/${slug(model)}/${slug(task.id)}/s${seed}/r${repetition}/a1` });
    }
  return out;
}

export function validateCampaign(c) {
  if (!c || c.schemaVersion !== 1 || !nonempty(c.releaseId) || typeof c.inferenceEnabled !== 'boolean' || !dimensions(c)) return ['invalid campaign schema/dimensions'];
  if (!Array.isArray(c.trials)) return ['missing planned trials'];
  const expected = new Set(makeTrials(c).map(key)), seen = new Set(), dirs = new Set(), errors = [];
  for (const t of c.trials) {
    const k = key(t);
    if (!expected.has(k)) errors.push(`unscheduled trial ${k}`);
    if (seen.has(k)) errors.push(`duplicate planned trial ${k}`);
    if (!relative(t.runDir) || dirs.has(t.runDir)) errors.push(`unsafe or duplicate output directory ${t.runDir}`);
    seen.add(k); dirs.add(t.runDir);
  }
  for (const k of expected) if (!seen.has(k)) errors.push(`missing planned trial ${k}`);
  return errors;
}

/** The report never substitutes a successful rerun for a scheduled attempt. */
export function campaignReport(c, records) {
  const errors = validateCampaign(c), scheduled = new Map((c.trials || []).map(t => [key(t), t]));
  const seen = new Map();
  if (!Array.isArray(records)) return { publishable: false, errors: [...errors, 'records must be an array'], models: [] };
  for (const r of records) {
    const k = key(r.trial || {}), expected = scheduled.get(k);
    if (!expected) errors.push(`unscheduled record ${k}`);
    else if (expected.runDir !== r.trial.runDir) errors.push(`trial output directory changed ${k}`);
    if (seen.has(k)) errors.push(`duplicate record ${k}`);
    seen.set(k, r);
    if (!['game-success', 'game-failure', 'infra-failure'].includes(r.outcome)) errors.push(`unknown outcome ${k}`);
    if (r.outcome === 'infra-failure') {
      if (!infraReason(r.reason) || r.result?.success === true) errors.push(`invalid infrastructure outcome ${k}`);
    } else {
      if (typeof r.result?.success !== 'boolean' || r.result.success !== (r.outcome === 'game-success')) errors.push(`outcome/result mismatch ${k}`);
      if (!replayCertification(r.verification)) errors.push(`not engine-replayed ${k}`);
    }
    for (const field of ['tokensIn', 'tokensOut', 'cost']) {
      const n = r.result?.[field];
      if (n != null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0)) errors.push(`invalid ${field} ${k}`);
    }
  }
  const missing = [...scheduled].filter(([k]) => !seen.has(k)).map(([, t]) => t);
  for (const t of missing) errors.push(`missing outcome ${key(t)}`);
  const publishable = errors.length === 0;
  const models = (c.models || []).map(model => {
    const planned = (c.trials || []).filter(t => t.model === model);
    const rs = planned.map(t => seen.get(key(t))).filter(Boolean);
    const tasks = (c.tasks || []).map(task => {
      const ts = planned.filter(t => t.task === task.id), done = ts.map(t => seen.get(key(t))).filter(Boolean);
      const successes = done.filter(r => r.outcome === 'game-success').length;
      return { task: task.id, planned: ts.length, recorded: done.length, successes,
        successRate: publishable ? successes / ts.length : null };
    });
    const successes = rs.filter(r => r.outcome === 'game-success').length;
    const known = rs.filter(r => accountingComplete(r) && Number.isFinite(r.result?.tokensIn) && Number.isFinite(r.result?.tokensOut));
    const costKnown = rs.filter(r => accountingComplete(r) && Number.isFinite(r.result?.cost));
    return { model, planned: planned.length, recorded: rs.length, successes,
      successRate: publishable ? tasks.reduce((s, t) => s + t.successRate, 0) / tasks.length : null,
      scheduledTrialSuccessRate: publishable ? successes / planned.length : null,
      infraFailures: rs.filter(r => r.outcome === 'infra-failure').length,
      engineReplayed: rs.filter(r => replayCertification(r.verification)).length,
      usageKnown: known.length, costKnown: costKnown.length,
      tokensTotal: known.length === planned.length ? known.reduce((s, r) => s + r.result.tokensIn + r.result.tokensOut, 0) : null,
      costTotal: costKnown.length === planned.length ? costKnown.reduce((s, r) => s + r.result.cost, 0) : null, tasks };
  });
  return { releaseId: c.releaseId, inferenceEnabled: c.inferenceEnabled, publishable, errors, planned: scheduled.size, recorded: records.length,
    missing, models, note: 'Complete scheduled-trial accounting; no uncertainty or model-only capability claim is supplied by this contract report.' };
}

/** Append one new identity; retries are evidence, never replacements for attempt 1. */
export function appendTrialRecord(file, record) {
  if (!record?.trial || !positive(record.trial.attempt)) throw Error('invalid trial record');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const fd = fs.openSync(lock, 'wx');
  try {
    const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
    if (rows.some(r => key(r.trial) === key(record.trial))) throw Error('trial identity already recorded');
    if (record.trial.attempt > 1 && !nonempty(record.reason)) throw Error('rerun requires an append-only reason');
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

/** A report loaded from disk cannot self-assert that a trace was engine-replayed. */
export function assertPinnedProtocol(campaign, trial, protocol) {
  if (!campaign?.frozen || !Array.isArray(campaign.protocolPins)) throw Error('a frozen campaign protocol pin is required before publishing evidence');
  const pins = campaign.protocolPins.filter(p => ['condition','model','task','version'].every(k => p[k] === trial[k]));
  if (pins.length !== 1 || !protocol?.hash || pins[0].hash !== protocol.hash) throw Error('protocol changed or expected protocol pin missing');
  const {hash, ...body} = protocol;
  if (crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') !== hash) throw Error('protocol hash does not bind its content');
}

export function readEvidenceRecords(file, campaignRoot, {campaign} = {}) {
  if (!fs.existsSync(file)) return [];
  const root = fs.realpathSync(campaignRoot);
  const load = name => {
    if (!relative(name)) throw Error(`unsafe evidence path: ${name}`);
    const absolute = fs.realpathSync(path.join(root, name));
    if (path.relative(root, absolute).startsWith('..') || path.isAbsolute(path.relative(root, absolute))) throw Error('evidence outside campaign');
    return absolute;
  };
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    const r = JSON.parse(line), ev = r.evidence;
    if (!ev || !r.trial || !relative(r.trial.runDir)) throw Error('missing trial evidence');
    for (const name of Object.values(ev)) if (typeof name === 'string' && !name.startsWith(`${r.trial.runDir}/`)) throw Error('evidence outside planned trial directory');
    const assertIdentity = result => {
      if (result.task !== r.trial.task || result.taskVersion !== r.trial.version || result.seed !== r.trial.seed || result.model !== r.trial.model) throw Error('evidence trial identity mismatch');
      for (const k of ['releaseId', 'condition', 'model', 'seed', 'repetition', 'attempt']) {
        if (result.trial?.[k] !== r.trial[k]) throw Error(`missing or changed formal trial ${k}`);
      }
      assertPinnedProtocol(campaign, r.trial, result.protocol);
    };
    if (r.outcome === 'infra-failure') {
      if (!ev?.failureFile) throw Error('infrastructure record needs bound failure evidence');
      const result = JSON.parse(fs.readFileSync(load(ev.failureFile), 'utf8'));
      if (result.success !== false || result.endReason !== r.reason || !infraReason(r.reason)) throw Error('infrastructure failure evidence mismatch');
      assertIdentity(result);
      if (r.result && !isDeepStrictEqual(r.result,result)) throw Error('infrastructure result differs from bound evidence');
      return { ...r, result, verification: null };
    }
    if (!ev?.resultFile || !ev.runFile || !ev.logFile || !ev.verifyFile) throw Error('missing game evidence files');
    const resultFile = load(ev.resultFile), logFile = load(ev.logFile);
    if (resultFile !== logFile.replace(/\.jsonl$/, '.json')) throw Error('result is not bound to episode log');
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const meta = JSON.parse(fs.readFileSync(load(ev.runFile), 'utf8'));
    const cache = JSON.parse(fs.readFileSync(load(ev.verifyFile), 'utf8'));
    const verification = cache.episodes?.find(e => e.file === path.basename(logFile));
    if (cache.backend !== 'engine-replay' || cache.evidenceLevel !== 'engine-replay' || cache.runDigest !== runDigest(meta) || !replayCertification(verification) || verification.digest !== episodeDigest(logFile)) throw Error('stale or non-engine verification evidence');
    assertIdentity(result);
    if (r.result && !isDeepStrictEqual(r.result, result)) throw Error('ledger result differs from bound evidence');
    return { ...r, result, verification };
  });
}
