/**
 * Headless smoke test for the sound-effect decoders (services/voc.ts).
 * Pure module — synthetic VOC/WAV buffers, no game assets, no Web Audio.
 *
 * Run: pnpm --filter @onchainpal/game-engine test:voc
 */
import assert from 'node:assert/strict';
import { decodeSoundChunk, isVoc, isWav, parseVoc, parseWav } from '../services/voc';

const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

function vocHeader(): number[] {
  // signature, data offset 26, version 1.10, checksum
  return [...str('Creative Voice File\x1A'), ...u16(26), 0x0a, 0x01, 0x29, 0x11];
}

function block(type: number, body: number[]): number[] {
  const n = body.length;
  return [type, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, ...body];
}

function run() {
  // 1. type 1 (tc=156 -> 10000 Hz, 8-bit unsigned) + type 5 text (skipped)
  //    + type 2 continuation + terminator; data after the terminator is ignored.
  const voc = new Uint8Array([
    ...vocHeader(),
    ...block(1, [156, 0, 128, 255, 0]),
    ...block(5, [0x41, 0x42, 0]),
    ...block(2, [192, 64]),
    0,
    ...block(1, [156, 0, 1, 2, 3])
  ]);
  assert.ok(isVoc(voc));
  const pcm = parseVoc(voc);
  assert.ok(pcm, 'VOC decodes');
  assert.equal(pcm!.sampleRate, 10000, '1000000 / (256 - tc)');
  assert.equal(pcm!.channels, 1);
  assert.deepEqual(Array.from(pcm!.samples), [0, 127 / 128, -1, 0.5, -0.5]);

  // 2. non-PCM codec is skipped together with its continuation -> nothing playable
  const adpcm = new Uint8Array([...vocHeader(), ...block(1, [156, 1, 1, 2]), ...block(2, [3, 4]), 0]);
  assert.equal(parseVoc(adpcm), null);

  // 3. truncated block (declared size beyond EOF) keeps what is present, no throw
  const truncated = new Uint8Array([...vocHeader(), 1, 10, 0, 0, 156, 0, 128, 128]);
  const t = parseVoc(truncated);
  assert.ok(t);
  assert.equal(t!.samples.length, 2);

  // 4. type 9 extended block, 16-bit signed mono at 22050 Hz
  const ext = new Uint8Array([
    ...vocHeader(),
    ...block(9, [...u32(22050), 16, 1, ...u16(4), 0, 0, 0, 0, 0x00, 0x40, 0x00, 0xc0]),
    0
  ]);
  const e = parseVoc(ext);
  assert.ok(e);
  assert.equal(e!.sampleRate, 22050);
  assert.deepEqual(Array.from(e!.samples), [0.5, -0.5]);

  // 5. garbage / empty input
  assert.equal(parseVoc(new Uint8Array(0)), null);
  assert.equal(decodeSoundChunk(new Uint8Array([1, 2, 3, 4])), null);

  // 6. PCM WAV, 16-bit stereo, with an odd-sized (padded) chunk before data
  const parts = [
    ...str('WAVE'),
    ...str('fmt '), ...u32(16), ...u16(1), ...u16(2), ...u32(8000), ...u32(32000), ...u16(4), ...u16(16),
    ...str('LIST'), ...u32(3), 1, 2, 3, 0,
    ...str('data'), ...u32(4), 0x00, 0x40, 0x00, 0xc0
  ];
  const wav = new Uint8Array([...str('RIFF'), ...u32(parts.length), ...parts]);
  assert.ok(isWav(wav));
  const w = parseWav(wav);
  assert.ok(w);
  assert.equal(w!.sampleRate, 8000);
  assert.equal(w!.channels, 2);
  assert.deepEqual(Array.from(w!.samples), [0.5, -0.5]);
  assert.deepEqual(decodeSoundChunk(wav), w);

  // 7. non-PCM WAV is left to the platform decoder
  const adpcmWav = wav.slice();
  adpcmWav[20] = 2;
  assert.equal(parseWav(adpcmWav), null);

  console.log('voc-parser smoke: ok');
}

run();
