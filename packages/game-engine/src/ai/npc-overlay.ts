/**
 * npc-overlay — project roster NPCs onto the REAL PAL maps without touching
 * the canon (aigg-mud-pal Phase 4).
 *
 * Two kinds of NPC arrive in the pal-server welcome roster:
 *   - CANONICAL ({sceneId, eventId}): their real event object already renders
 *     and byEvent attribution already routes their dialog — nothing to do here;
 *   - OVERLAY visitors ({sceneId, x, y, spriteNum}): no event object in this
 *     scene (游方郎中 working the market, 算命仙 on tour). This module turns
 *     them into synthetic event-object entries the existing render system
 *     draws through the SAME path (scene-service merges them into the render
 *     context; sprites load straight from MGO by spriteNum). SSS.MKF stays
 *     read-only; saves and event-object index ranges are untouched.
 *
 * Pure module state — updateOverlayFromRoster() is fed by PalServerClient on
 * every welcome; scene-service pulls per-frame via getOverlayEntriesForScene()
 * and resolves sprites via getOverlaySprite().
 */

import { timelineActive } from './timeline';

export interface OverlayNpc {
  npcId: string;
  name?: string;
  sceneId: number;
  x: number;
  y: number;
  spriteNum: number;
}

/** synthetic event-object ids — far above the canon's ~5331 entries. */
export const OVERLAY_ID_BASE = 900001;

interface RosterEntry {
  id: string;
  name?: string;
  pal?: { sceneId?: number; eventId?: number; x?: number; y?: number; spriteNum?: number };
}

let overlays: OverlayNpc[] = [];
const spriteCache = new Map<number, unknown>();

// --- walker (presentation layer) -------------------------------------------
// Anchor diffs become tiny movement scripts: same-scene change → walk there;
// scene change → walk OUT toward the road in the old scene (departure ghost)
// and walk IN from the road in the new one. Canon frame maths (direction ×
// spriteFrames + frame) animates the stride — pure functions of time, no
// per-frame mutation (the render's per-frame call computes positions lazily).
interface Walk { fromX: number; fromY: number; toX: number; toY: number; start: number }
interface Departure { npcId: string; name?: string; sceneId: number; spriteNum: number; walk: Walk }
const WALK_SPEED = 56;            // px/second (~canon stroll)
const STRIDE_MS = 160;            // frame cycle while walking
const ROAD = { dx: 128, dy: -64 };// "up the road" — entrances/exits lie NE
const walks = new Map<string, Walk>();
const departures: Departure[] = [];
const prevAnchors = new Map<string, { sceneId: number; x: number; y: number; spriteNum: number }>();
let clock: () => number = () => Date.now();

/** test hook — inject a fake clock. */
export function __setOverlayClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

/** PAL direction from a walk delta (screen-isometric: North = +x,-y). */
function dirOf(dx: number, dy: number): number {
  if (dx >= 0 && dy < 0) return 2;   // North
  if (dx > 0 && dy >= 0) return 3;   // East
  if (dx <= 0 && dy > 0) return 0;   // South
  return 1;                          // West
}

/** position along a walk at `now`; null = arrived. */
function walkPos(w: Walk, now: number): { x: number; y: number; dx: number; dy: number } | null {
  const dx = w.toX - w.fromX, dy = w.toY - w.fromY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const gone = Math.max(0, (now - w.start) / 1000) * WALK_SPEED;
  if (gone >= dist) return null;
  const t = gone / dist;
  return { x: Math.round(w.fromX + dx * t), y: Math.round(w.fromY + dy * t), dx, dy };
}
/** canonical anchors: the roster's eventId→npc mapping (timeline mode uses it
 *  to decide "this event object IS an AI NPC → route to the server"). */
const canonical = new Map<number, { npcId: string; name?: string }>();
/** canon event objects to HIDE in timeline mode (their NPC is overlay-rendered) */
const suppressed = new Set<number>();

/** Welcome roster → overlay set (canonical NPCs — those with an eventId — are skipped). */
export function updateOverlayFromRoster(npcs: RosterEntry[]): OverlayNpc[] {
  canonical.clear();
  suppressed.clear();
  for (const n of npcs ?? []) {
    if (n.pal && typeof n.pal.eventId === 'number' && n.pal.eventId > 0) {
      canonical.set(n.pal.eventId, { npcId: n.id, name: n.name });
      // a fully-anchored canonical NPC is overlay-rendered in timeline mode —
      // its canon event object gets hidden (one body, wherever it walks)
      if (typeof n.pal.x === 'number' && typeof n.pal.y === 'number' && (n.pal.spriteNum ?? 0) > 0) {
        suppressed.add(n.pal.eventId);
      }
    }
  }
  overlays = (npcs ?? [])
    .filter((n) => n.pal
      && typeof n.pal.sceneId === 'number'
      && typeof n.pal.x === 'number' && typeof n.pal.y === 'number'
      && typeof n.pal.spriteNum === 'number' && n.pal.spriteNum > 0
      // outside the timeline only record-less visitors overlay (canon untouched)
      && (timelineActive() || n.pal.eventId == null))
    .map((n) => ({
      npcId: n.id, name: n.name,
      sceneId: n.pal!.sceneId!, x: n.pal!.x!, y: n.pal!.y!, spriteNum: n.pal!.spriteNum!
    }));
  // anchor diffs → movement scripts (timeline only; canon mode snaps as before)
  if (timelineActive()) {
    const now = clock();
    const seen = new Set<string>();
    for (const o of overlays) {
      seen.add(o.npcId);
      const prev = prevAnchors.get(o.npcId);
      if (prev && prev.sceneId === o.sceneId && (prev.x !== o.x || prev.y !== o.y)) {
        // walk across the room (resume from mid-walk position if any)
        const mid = walks.get(o.npcId);
        const from = mid ? walkPos(mid, now) ?? { x: mid.toX, y: mid.toY } : prev;
        walks.set(o.npcId, { fromX: from.x, fromY: from.y, toX: o.x, toY: o.y, start: now });
      } else if (prev && prev.sceneId !== o.sceneId) {
        // leave the old scene toward the road…
        departures.push({
          npcId: o.npcId, name: o.name, sceneId: prev.sceneId, spriteNum: prev.spriteNum,
          walk: { fromX: prev.x, fromY: prev.y, toX: prev.x + ROAD.dx, toY: prev.y + ROAD.dy, start: now }
        });
        // …and walk in from the road in the new one
        walks.set(o.npcId, { fromX: o.x + ROAD.dx, fromY: o.y + ROAD.dy, toX: o.x, toY: o.y, start: now });
      }
      prevAnchors.set(o.npcId, { sceneId: o.sceneId, x: o.x, y: o.y, spriteNum: o.spriteNum });
    }
    for (const id of [...prevAnchors.keys()]) if (!seen.has(id)) { prevAnchors.delete(id); walks.delete(id); }
  }

  // debug/test handle (same pattern as window.PAL_SERVER)
  try { (globalThis as { PAL_OVERLAY?: OverlayNpc[] }).PAL_OVERLAY = overlays; } catch { /* SSR */ }
  return overlays;
}

export function overlayNpcs(): OverlayNpc[] {
  return overlays;
}

export function isOverlayId(id: number): boolean {
  return (id >= OVERLAY_ID_BASE && id < OVERLAY_ID_BASE + overlays.length)
    || departureFor(id) !== null;
}

export function overlayNpcIdFor(id: number): string | null {
  const dep = departureFor(id);
  if (dep) return dep.npcId;
  const o = overlays[id - OVERLAY_ID_BASE];
  return o ? o.npcId : null;
}

/**
 * Synthetic entries shaped exactly like the scene's event objects — the render
 * system draws them via the same processEntry path (direction 0, frame 0).
 */
export function getOverlayEntriesForScene(sceneId: number, nowMs?: number): Array<{ id: number; state: Record<string, number> }> {
  const now = nowMs ?? clock();
  const stride = Math.floor(now / STRIDE_MS) % 3;
  const out: Array<{ id: number; state: Record<string, number> }> = [];
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    if (o.sceneId !== sceneId) continue;
    const w = walks.get(o.npcId);
    const pos = w ? walkPos(w, now) : null;
    if (w && !pos) walks.delete(o.npcId);          // arrived — stand at the anchor
    out.push({
      id: OVERLAY_ID_BASE + i,
      state: {
        state: 1, vanishTime: 0,
        x: pos ? pos.x : o.x, y: pos ? pos.y : o.y, layer: 0,
        spriteNum: o.spriteNum, spriteFrames: 3,
        direction: pos ? dirOf(pos.dx, pos.dy) : 0,
        currentFrameNum: pos ? stride : 0
      }
    });
  }
  // departure ghosts walking out of THIS scene (pruned once out of road)
  for (let d = departures.length - 1; d >= 0; d--) {
    const dep = departures[d];
    if (dep.sceneId !== sceneId) continue;
    const pos = walkPos(dep.walk, now);
    if (!pos) { departures.splice(d, 1); continue; }
    out.push({
      id: OVERLAY_ID_BASE + 4096 + d,
      state: {
        state: 1, vanishTime: 0,
        x: pos.x, y: pos.y, layer: 0,
        spriteNum: dep.spriteNum, spriteFrames: 3,
        direction: dirOf(pos.dx, pos.dy), currentFrameNum: stride
      }
    });
  }
  return out;
}

/** departure-ghost ids resolve sprites too (same MGO path). */
function departureFor(id: number): Departure | null {
  const d = id - OVERLAY_ID_BASE - 4096;
  return d >= 0 && d < departures.length ? departures[d] : null;
}

/**
 * Sprite for a synthetic id — straight from MGO by spriteNum (cached). The
 * loader is injected so this module stays free of engine singletons:
 *   loadSprite: (spriteNum) => new Sprite(MGO.decompressChunk(spriteNum))
 */
export function getOverlaySprite(id: number, loadSprite: (spriteNum: number) => unknown): unknown {
  if (!isOverlayId(id)) return null;
  const spriteNum = departureFor(id)?.spriteNum ?? overlays[id - OVERLAY_ID_BASE]?.spriteNum;
  if (!spriteNum) return null;
  if (!spriteCache.has(spriteNum)) {
    try {
      spriteCache.set(spriteNum, loadSprite(spriteNum));
    } catch {
      spriteCache.set(spriteNum, null);
    }
  }
  return spriteCache.get(spriteNum) ?? null;
}

/** canon event-object ids whose NPC is overlay-rendered (timeline hides them). */
export function suppressedEventIds(): number[] {
  return timelineActive() ? [...suppressed] : [];
}

/** overlay info for a synthetic id (search/talk surface). */
export function overlayInfoFor(id: number): { npcId: string; name?: string; x: number; y: number } | null {
  const dep = departureFor(id);
  if (dep) return { npcId: dep.npcId, name: dep.name, x: dep.walk.toX, y: dep.walk.toY };
  const o = overlays[id - OVERLAY_ID_BASE];
  return o ? { npcId: o.npcId, name: o.name, x: o.x, y: o.y } : null;
}

/** an AI NPC anchored to this canonical event object, if any. */
export function aiNpcForEvent(eventId: number): { npcId: string; name?: string } | null {
  return canonical.get(eventId) ?? null;
}

/** test/HMR hook */
export function resetOverlay(): void {
  overlays = [];
  spriteCache.clear();
  canonical.clear();
  suppressed.clear();
  walks.clear();
  departures.length = 0;
  prevAnchors.clear();
}
