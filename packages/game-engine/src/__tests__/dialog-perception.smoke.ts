/**
 * Headless smoke test for the live-wiring perception logic (DialogPerceptionMapper).
 * Pure module — no PAL runtime. Proves the trigger rules: attributable player line
 * → interaction; injected lines ignored (no loop); duplicates deduped; unknown
 * lines dropped; eventObjectId/source → npcId resolution.
 *
 * Run: pnpm --filter @onchainpal/game-engine test:perception
 */
import assert from 'node:assert/strict';
import { DialogPerceptionMapper, type DialogLineValue } from '../ai/dialog-perception';

// resolve like bootstrap does: eventObjectId or source-substring → card id
const byEvent = new Map<number, string>([[88, 'npc:jiu-jianxian']]);
const resolveNpcId = (v: DialogLineValue) => {
  if (v.eventObjectId != null && byEvent.has(v.eventObjectId)) return byEvent.get(v.eventObjectId);
  if (typeof v.source === 'string' && v.source.includes('酒剑仙')) return 'npc:jiu-jianxian';
  return undefined;
};

function mapper() {
  return new DialogPerceptionMapper({ playerId: 'player:hero', resolveNpcId, now: () => 7 });
}

function run() {
  // 1. player line attributable to 酒剑仙 (by eventObjectId) → interaction
  const m1 = mapper();
  const p = m1.toPerception({ text: '老伯请喝酒', eventObjectId: 88, msgId: 1 });
  assert.ok(p, 'attributable line produces a perception');
  assert.equal(p!.kind, 'interaction');
  assert.equal(p!.npcId, 'npc:jiu-jianxian', 'resolved npcId via eventObjectId');
  assert.equal(p!.playerId, 'player:hero');
  assert.equal(p!.timestamp, 7, 'injected clock used when value has no timestamp');

  // 2. injected line (the NPC's own reply) → ignored (prevents feedback loop)
  assert.equal(mapper().toPerception({ text: '哈哈好酒', eventObjectId: 88, msgId: 2, metadata: { injected: true } }), null,
    'injected line ignored');
  assert.equal(mapper().toPerception({ text: 'x', eventObjectId: 88, injected: true }), null, 'injected flag ignored');

  // 3. duplicate (same msgId) → deduped
  const m3 = mapper();
  assert.ok(m3.toPerception({ text: '喂', eventObjectId: 88, msgId: 5 }), 'first fires');
  assert.equal(m3.toPerception({ text: '喂', eventObjectId: 88, msgId: 5 }), null, 'same msgId deduped');
  assert.ok(m3.toPerception({ text: '喂', eventObjectId: 88, msgId: 6 }), 'new msgId fires again');

  // 4. line not attributable to any enabled NPC → dropped
  assert.equal(mapper().toPerception({ text: '随便一句旁白', eventObjectId: 999, msgId: 1 }), null, 'unknown event dropped');

  // 5. source-substring resolution
  const p5 = mapper().toPerception({ text: '前辈', source: 'event-酒剑仙-line', msgId: 1 });
  assert.equal(p5?.npcId, 'npc:jiu-jianxian', 'resolved npcId via source substring');

  // 6. empty/whitespace text → null
  assert.equal(mapper().toPerception({ text: '   ', eventObjectId: 88 }), null, 'empty text dropped');

  console.log('✓ interaction trigger / injected-skip / dedup / unknown-drop / source+event resolution');
  console.log('\nALL DIALOG-PERCEPTION SMOKE TESTS PASSED ✅');
}

run();
