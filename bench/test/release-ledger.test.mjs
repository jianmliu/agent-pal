import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeTrials, validateCampaign, campaignReport, appendTrialRecord, readEvidenceRecords, assertPinnedProtocol } from '../release-ledger.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fixture() {
  const c = { schemaVersion: 1, releaseId: 'ed-test', inferenceEnabled: false,
    conditions: ['original'], models: ['model-a'], repetitions: [1],
    tasks: [{ id: 'task-a', version: 1, seeds: [42] }, { id: 'task-b', version: 1, seeds: [42] }] };
  c.trials = makeTrials(c);
  return c;
}
function records(c) {
  return c.trials.map((trial, i) => ({ trial, outcome: i ? 'game-failure' : 'game-success',
    result: { success: !i, tokensIn: i ? null : 100, tokensOut: i ? null : 10, cost: i ? null : 1 },
    verification: { ok: true, backend: 'engine-replay', evidenceLevel: 'engine-replay', verdict: 'verified' } }));
}
test('complete scientific denominator retains success and failure, unknown usage stays unknown', () => {
  const c = fixture(), r = campaignReport(c, records(c));
  assert.equal(r.publishable, true);
  assert.equal(r.models[0].successRate, 0.5);
  assert.equal(r.models[0].planned, 2);
  assert.equal(r.models[0].costTotal, null);
  assert.equal(r.models[0].usageKnown, 1);
});
test('missing, duplicate and unscheduled records cannot produce a publishable result', () => {
  const c = fixture(), rs = records(c);
  for (const bad of [rs.slice(0, 1), [...rs, rs[0]], [...rs, { ...rs[0], trial: { ...rs[0].trial, seed: 99 } }]]) {
    const r = campaignReport(c, bad);
    assert.equal(r.publishable, false); assert.equal(r.models[0].successRate, null);
  }
});
test('log consistency and missing backend cannot certify a successful trial', () => {
  const c = fixture();
  for (const backend of ['log-consistency', undefined]) {
    const rs = records(c); rs[0].verification.backend = backend;
    assert.equal(campaignReport(c, rs).publishable, false);
  }
});
test('contradictory evidence labels cannot be promoted into formal certification',()=>{
  const c=fixture(),rs=records(c);rs[0].verification.evidenceLevel='log-consistency';
  assert.equal(campaignReport(c,rs).publishable,false);
});
test('infrastructure failure remains in scheduled denominator without a fabricated replay', () => {
  const c = fixture(), rs = records(c);
  rs[1] = { trial: c.trials[1], outcome: 'infra-failure', reason: 'startup-timeout', result: null, verification: null };
  const r = campaignReport(c, rs);
  assert.equal(r.publishable, true); assert.equal(r.models[0].successRate, 0.5);
  assert.equal(r.models[0].infraFailures, 1); assert.equal(r.models[0].engineReplayed, 1);
});
test('duplicate design dimensions and tampered task version/condition invalidate campaign', () => {
  const c = fixture();
  c.repetitions.push(1); assert.ok(validateCampaign(c).length);
  const b = fixture(); b.trials[0].version = 2; assert.ok(validateCampaign(b).length);
  const d = fixture(); d.trials[0].condition = 'ablation'; assert.ok(validateCampaign(d).length);
});
test('path traversal and an empty campaign cannot be accepted', () => {
  const c = fixture(); c.trials[0].runDir = '../outside'; assert.ok(validateCampaign(c).length);
  const d = fixture(); d.models = []; d.trials = []; assert.ok(validateCampaign(d).length);
});
test('same model/task/seed with separate repetitions has distinct identity and output', () => {
  const c = fixture(); c.repetitions = [1, 2, 3]; c.trials = makeTrials(c);
  assert.equal(new Set(c.trials.map(t => t.runDir)).size, 6);
  assert.deepEqual(validateCampaign(c), []);
});
test('append-only ledger rejects overwrites and permits a separately explained rerun', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-ledger-test-'));
  try {
    const file = path.join(dir, 'trials.jsonl'), c = fixture(), r = records(c)[0];
    appendTrialRecord(file, r);
    assert.throws(() => appendTrialRecord(file, r), /already|duplicate/i);
    assert.throws(() => appendTrialRecord(file, { ...r, trial: { ...r.trial, attempt: 2 } }), /reason/i);
    appendTrialRecord(file, { ...r, trial: { ...r.trial, attempt: 2 }, reason: 'recorded infrastructure recovery' });
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
    assert.equal(campaignReport(c, fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse)).publishable, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('outcome labels cannot disagree with game result and unknown numeric usage is not zero', () => {
  const c = fixture(), rs = records(c);
  rs[0].result.success = false;
  assert.equal(campaignReport(c, rs).publishable, false);
});
test('file-backed report refuses an unbound certification and evidence outside the campaign', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-ledger-proof-'));
  try {
    const c = fixture(), rs = records(c), file = path.join(dir, 'trials.jsonl');
    fs.writeFileSync(file, JSON.stringify(rs[0]) + '\n');
    assert.throws(() => readEvidenceRecords(file, dir), /evidence/i);
    fs.writeFileSync(file, JSON.stringify({ ...rs[0], evidence: { resultFile: '../outside.json', runFile: '../run.json', logFile: '../log.jsonl', verifyFile: '../verify.json' } }) + '\n');
    assert.throws(() => readEvidenceRecords(file, dir), /outside|unsafe/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('infrastructure evidence must belong to the exact scheduled trial, not a shared unrelated failure', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pal-ledger-infra-'));
  try {
    const trial=fixture().trials[0],file=path.join(dir,'trials.jsonl');
    fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({success:false,endReason:'budget-toolCalls',task:'unrelated'}));
    fs.writeFileSync(file,JSON.stringify({trial,outcome:'infra-failure',reason:'budget-toolCalls',evidence:{failureFile:'failure.json'}})+'\n');
    assert.throws(()=>readEvidenceRecords(file,dir),/planned trial|identity|infrastructure/i);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('formal evidence requires a frozen campaign pin and rejects budget or runtime drift',()=>{
  const c=fixture(),trial=c.trials[0], base={budget:{toolCalls:10},runtime:{engine:'build-a'}};
  const contract={...base,hash:crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex')};
  assert.throws(()=>assertPinnedProtocol(c,trial,contract),/frozen|pin/i);
  c.frozen=true;c.protocolPins=[{condition:trial.condition,model:trial.model,task:trial.task,version:trial.version,hash:contract.hash}];
  assert.doesNotThrow(()=>assertPinnedProtocol(c,trial,contract));
  for(const change of [{budget:{toolCalls:20}},{runtime:{engine:'build-b'}}]){
    const b={...base,...change};const drift={...b,hash:crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex')};
    assert.throws(()=>assertPinnedProtocol(c,trial,drift),/changed|pin/i);
  }
});
test('partially measured provider consumption never becomes a complete trial total',()=>{
  const c=fixture(),rs=records(c);rs[1].result={success:false,tokensIn:10,tokensOut:2,cost:0.1,accountingStatus:'incomplete'};
  const r=campaignReport(c,rs);assert.equal(r.models[0].usageKnown,1);assert.equal(r.models[0].costTotal,null);
});
