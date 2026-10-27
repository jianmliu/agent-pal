import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {taskFingerprint} from '../start.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

test('default classic save fingerprint hashes the exact loader bytes', () => {
  const task = {start:{rpg:'10.rpg'}};
  const old = process.env.AGENT_PAL_CLASSIC_SAVES;
  try {
    delete process.env.AGENT_PAL_CLASSIC_SAVES;
    const defaultHash = taskFingerprint(task).save;
    assert.equal(defaultHash, sha(fs.readFileSync(path.join(root,'bench/saves/classic/10.rpg'))));
    process.env.AGENT_PAL_CLASSIC_SAVES = path.join(root,'bench/saves/classic');
    assert.equal(taskFingerprint(task).save, defaultHash);
  } finally { if (old === undefined) delete process.env.AGENT_PAL_CLASSIC_SAVES; else process.env.AGENT_PAL_CLASSIC_SAVES = old; }
});

test('bundled save fingerprint binds decoded bytes', () => {
  const filename = 'pal-ch1-island.saves.json.gz';
  assert.equal(taskFingerprint({start:{saves:filename}}).save,
    sha(zlib.gunzipSync(fs.readFileSync(path.join(root,'bench/saves',filename)))));
});

test('resource preflight fails missing and changed required assets without demanding executables', async () => {
  const {auditResources, preflightResources, REQUIRED_ASSETS} = await import('../resource-contract.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pal-resources-'));
  try {
    for (const name of REQUIRED_ASSETS) fs.writeFileSync(path.join(dir,name), name);
    const buildDir = path.join(dir,'build'); fs.mkdirSync(buildDir); fs.writeFileSync(path.join(buildDir,'index.js'),'fixture');
    const options = {assetsDir:dir, buildDir};
    const initial = auditResources(options);
    assert.equal(initial.ok,true);
    assert.equal(initial.assets.some(x => /\.exe$/i.test(x.name)),false);
    assert.equal(initial.startingFiles.length,15);
    assert.ok(initial.startingFiles.every(x => x.tracked && x.sha256 && (x.kind !== 'bundled-save' || x.decodedSha256)));
    fs.appendFileSync(path.join(dir,'DATA.MKF'),'mutation');
    assert.throws(() => preflightResources({...options, expected:initial}), /DATA.MKF.*digest/i);
    fs.unlinkSync(path.join(dir,'MAP.MKF'));
    assert.throws(() => preflightResources(options), /MAP.MKF.*missing/i);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('classic explicit override and asset fallback resolve absolute paths without engine boot', async () => {
  const {resolveClassicSave, resolveAssetsDir} = await import('../resource-contract.mjs');
  assert.equal(resolveClassicSave({start:{rpg:'10.rpg'}},{env:{}}),path.join(root,'bench/saves/classic/10.rpg'));
  assert.equal(resolveClassicSave('10.rpg',{env:{AGENT_PAL_CLASSIC_SAVES:'custom'}}),path.resolve('custom/10.rpg'));
  assert.equal(resolveAssetsDir({env:{}}),path.join(root,'pal-assets'));
});
