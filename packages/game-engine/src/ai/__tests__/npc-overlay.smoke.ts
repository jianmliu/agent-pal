/**
 * npc-overlay smoke — pure module, no engine/DOM:
 *   1. roster → overlay set: only visitors ({sceneId,x,y,spriteNum}, NO
 *      eventId) become overlays; canonical NPCs are skipped;
 *   2. per-scene entries: synthetic ids from OVERLAY_ID_BASE, event-object
 *      shape (state:1, direction 0, frame 0) the render system draws as-is;
 *   3. sprite resolution: loader called once per spriteNum (cached), throwing
 *      loaders degrade to null (no draw, no crash); id↔npcId mapping.
 *
 * Run: npx tsx src/ai/__tests__/npc-overlay.smoke.ts   (in packages/game-engine)
 */
import assert from 'node:assert/strict';
import {
  updateOverlayFromRoster, getOverlayEntriesForScene, getOverlaySprite,
  isOverlayId, overlayNpcIdFor, suppressedEventIds, overlayInfoFor, resetOverlay,
  __setOverlayClock, OVERLAY_ID_BASE
} from '../npc-overlay';
import { configureTimeline, resetTimeline } from '../timeline';

resetOverlay();
resetTimeline();

// 1. roster filter
// canon mode: only record-less visitors overlay; no suppression
const set = updateOverlayFromRoster([
  { id: 'npc:azhu', name: '阿珠', pal: { sceneId: 4, eventId: 88 } },                       // canonical → skip
  { id: 'npc:yuhang:youfang-langzhong', name: '游方郎中', pal: { sceneId: 5, x: 816, y: 1416, spriteNum: 122 } },
  { id: 'npc:suanming', name: '算命仙', pal: { sceneId: 5, x: 700, y: 1300, spriteNum: 123 } },
  { id: 'npc:aigg:merchant', name: '秦薇' },                                                // no pal → skip
  { id: 'npc:bad', name: '残锚', pal: { sceneId: 5, x: 1, y: 2, spriteNum: 0 } }            // spriteNum 0 → skip
]);
assert.equal(set.length, 2, 'canon mode: only well-anchored visitors become overlays');
assert.equal(suppressedEventIds().length, 0, 'canon mode: nothing suppressed');

// TIMELINE mode: fully-anchored canonical NPCs overlay too, their eo hidden
configureTimeline('yuhang');
const all = updateOverlayFromRoster([
  { id: 'npc:azhu', name: '阿珠', pal: { sceneId: 4, eventId: 88, x: 992, y: 944, spriteNum: 42 } },
  { id: 'npc:old', name: '旧锚', pal: { sceneId: 4, eventId: 50 } },                       // no x/y → stays canon
  { id: 'npc:yuhang:youfang-langzhong', name: '游方郎中', pal: { sceneId: 5, x: 816, y: 1416, spriteNum: 122 } }
]);
assert.equal(all.length, 2, 'timeline: anchored canonical + visitor both overlay');
assert.deepEqual(suppressedEventIds(), [88], 'the overlaid canonical eo is suppressed; bare anchors are not');
assert.equal(overlayInfoFor(OVERLAY_ID_BASE)?.npcId, 'npc:azhu', 'overlay info surfaces for search');
resetTimeline();
resetOverlay();
updateOverlayFromRoster([
  { id: 'npc:azhu', name: '阿珠', pal: { sceneId: 4, eventId: 88 } },
  { id: 'npc:yuhang:youfang-langzhong', name: '游方郎中', pal: { sceneId: 5, x: 816, y: 1416, spriteNum: 122 } },
  { id: 'npc:suanming', name: '算命仙', pal: { sceneId: 5, x: 700, y: 1300, spriteNum: 123 } }
]);
console.log('  ✓ roster filter: canon vs timeline modes, suppression set, search info');

// 2. per-scene synthetic entries
assert.equal(getOverlayEntriesForScene(4).length, 0, 'no visitors in scene 4');
const entries = getOverlayEntriesForScene(5);
assert.equal(entries.length, 2);
const e0 = entries[0];
assert.equal(e0.id, OVERLAY_ID_BASE);
assert.deepEqual(e0.state, {
  state: 1, vanishTime: 0, x: 816, y: 1416, layer: 0,
  spriteNum: 122, spriteFrames: 3, direction: 0, currentFrameNum: 0
}, 'event-object shape the render system draws as-is (canon 3-frame stride layout)');
assert.equal(isOverlayId(OVERLAY_ID_BASE + 1), true);
assert.equal(isOverlayId(OVERLAY_ID_BASE + 2), false);
assert.equal(isOverlayId(42), false, 'canonical ids never collide');
assert.equal(overlayNpcIdFor(OVERLAY_ID_BASE), 'npc:yuhang:youfang-langzhong', 'synthetic id ↔ npcId');
console.log('  ✓ per-scene entries: synthetic ids, render-ready shape, id↔npcId');

// 3. sprite cache + degradation
let loads = 0;
const fakeSprite = { getFrame: () => ({ width: 16, height: 32 }) };
const loader = (spriteNum: number) => { loads++; assert.equal(spriteNum, 122); return fakeSprite; };
assert.equal(getOverlaySprite(OVERLAY_ID_BASE, loader), fakeSprite);
assert.equal(getOverlaySprite(OVERLAY_ID_BASE, loader), fakeSprite);
assert.equal(loads, 1, 'MGO chunk decoded once, then cached');
assert.equal(getOverlaySprite(OVERLAY_ID_BASE + 1, () => { throw new Error('mgo missing'); }), null, 'throwing loader → null, no crash');
assert.equal(getOverlaySprite(123456, loader), null, 'non-overlay id → null');
console.log('  ✓ sprite: cached per spriteNum, failures degrade to null');

// 4. WALKER: anchor diffs become walks — same-scene = stroll there; scene
//    change = departure ghost walking out + arrival walking in from the road.
resetOverlay();
configureTimeline('yuhang');
let fakeNow = 100000;
__setOverlayClock(() => fakeNow);
updateOverlayFromRoster([{ id: 'npc:w', name: '旺财嫂', pal: { sceneId: 4, eventId: 86, x: 1072, y: 1016, spriteNum: 48 } }]);
let e4 = getOverlayEntriesForScene(4);
assert.equal(e4[0].state.x, 1072, 'first roster: standing at the anchor');
assert.equal(e4[0].state.currentFrameNum, 0, 'idle frame');

// she moves to scene 5 (赶集)
updateOverlayFromRoster([{ id: 'npc:w', name: '旺财嫂', pal: { sceneId: 5, eventId: 86, x: 880, y: 1460, spriteNum: 48 } }]);
e4 = getOverlayEntriesForScene(4);
assert.equal(e4.length, 1, 'a departure ghost still walks the OLD scene');
assert.ok(e4[0].id >= OVERLAY_ID_BASE + 4096, 'ghost rides the departure id range');
let e5 = getOverlayEntriesForScene(5);
assert.equal(e5.length, 1, 'and she is walking INTO the new scene');
assert.equal(e5[0].state.x, 880 + 128, 'arrival starts up the road');
assert.notEqual(e5[0].state.currentFrameNum, undefined, 'striding');
const xAtStart = Number(e5[0].state.x);
fakeNow += 1500;                                       // 1.5s later
e5 = getOverlayEntriesForScene(5);
assert.ok(Number(e5[0].state.x) < xAtStart, 'walking toward the stall (x decreasing)');
fakeNow += 60000;                                      // long after: everyone arrived
e5 = getOverlayEntriesForScene(5);
assert.equal(e5[0].state.x, 880, 'arrived at the anchor');
assert.equal(e5[0].state.currentFrameNum, 0, 'standing again');
assert.equal(getOverlayEntriesForScene(4).length, 0, 'the ghost walked off and was pruned');
__setOverlayClock(null);
resetTimeline();
console.log('  ✓ walker: stroll/departure-ghost/arrival, canon stride frames, lazy time-pure');

console.log('\nNPC-OVERLAY SMOKE PASSED ✅');
