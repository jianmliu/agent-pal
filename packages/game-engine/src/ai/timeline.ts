/**
 * timeline — the aigg-mud-pal NEW TIMELINE: boot straight into the living
 * world and leave the original story behind.
 *
 *   ?timeline=yuhang   → spawn in scene 5 (余杭集市), by the market stalls
 *   ?timeline=suzhou   → spawn in scene 28 (苏州赌场)
 *   ?timeline=<number> → spawn in that scene id (debug)
 *
 * In timeline mode the canon becomes a STAGE, not a SCRIPT:
 *   - the start menu is skipped (new-game state, no opening),
 *   - scene scriptOnEnter (the story layer) is suppressed,
 *   - event objects that belong to AI NPCs route to the PAL server instead of
 *     running their canon trigger script (the townsfolk think for themselves),
 *   - structural triggers (doors, chests, herbs) keep their canon scripts —
 *     the world still works, it just isn't telling the old story.
 *
 * Pure module state; js/pal/main.ts configures it from the URL, js/pal/play.ts
 * consumes the jump + the suppression flags.
 */

export interface TimelineConfig {
  name: string;
  startScene: number;
  /** party world position (viewport derives from it; offset stays 160,112) */
  partyX: number;
  partyY: number;
}

export const TIMELINES: Record<string, Omit<TimelineConfig, 'name'>> = {
  // 余杭集市 — one step below 张四's pitch (960,1376): press search, start
  // talking; 渔翁/魚嫂/游方郎中 a few steps away
  yuhang: { startScene: 5, partyX: 960, partyY: 1408 },
  // 苏州赌场 — the floor below 賭場老闆 (1072,760)
  suzhou: { startScene: 28, partyX: 880, partyY: 800 }
};

let config: TimelineConfig | null = null;
let jumped = false;

/** Parse the ?timeline= param. Unknown names / garbage → no timeline (canon boot). */
export function configureTimeline(param: string | null | undefined): TimelineConfig | null {
  if (!param) { config = null; return null; }
  const preset = TIMELINES[param];
  if (preset) {
    config = { name: param, ...preset };
  } else if (Number.isFinite(Number(param)) && Number(param) > 0) {
    config = { name: `scene:${param}`, startScene: Number(param), partyX: 320, partyY: 320 };
  } else {
    config = null;
  }
  jumped = false;
  try { (globalThis as { PAL_TIMELINE?: TimelineConfig | null }).PAL_TIMELINE = config; } catch { /* SSR */ }
  return config;
}

export function timelineActive(): boolean {
  return config !== null;
}

export function timelineConfig(): TimelineConfig | null {
  return config;
}

/** The one-shot spawn jump — first scene-enter redirects here, then never again. */
export function consumeTimelineJump(): TimelineConfig | null {
  if (!config || jumped) return null;
  jumped = true;
  return config;
}

/** test/HMR hook */
export function resetTimeline(): void {
  config = null;
  jumped = false;
}
