import resourceService from './resource-service.js';
import * as npcOverlay from '../ai/npc-overlay';
import worldService from './world-service.js';
import sceneEventAdapter from './scene-event-adapter.js';
import partyTrailAdapter from './party-trail-adapter.js';
import {
  getPlayerRoleField,
  getPlayerRoleFieldValue,
  getMaxPartyMemberIndex as getMaxPartyMemberIndexValue
} from './player-state-adapter.js';
import {
  getViewportValue as getViewportSnapshot,
  getPartyOffsetValue as getPartyOffsetSnapshot,
  getPartyDirectionValue as getPartyDirectionSnapshot,
  shouldFadeIn,
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled,
  getScreenWaveValue as getScreenWaveSnapshot,
  getLayerValue as getLayerSnapshot,
  getWaveProgressionValue as getWaveProgressionSnapshot
} from './environment-adapter.js';
import { getSceneIdValue as getSceneIdSnapshot } from './scene-state-adapter.js';
import {
  getSceneEntry as getSceneEntrySnapshot,
  getSceneEventObjectRange as getSceneEventObjectRangeSnapshot
} from './scene-data-adapter.js';
import overviewController from '../js/pal/overview-controller.js';
import panoramaRenderer from '../js/pal/panorama-renderer.js';
import Sprite from '../js/pal/sprite';
import Map from '../js/pal/map';
// import { PAL_XY, PAL_X, PAL_Y } from '../js/pal/utils.js';

// Re-implement PAL_XY, PAL_X, PAL_Y locally to avoid import issues if they are not exported
const PAL_XY = (x: number, y: number) => ((y << 16) | (x & 0xFFFF));
const PAL_X = (xy: number) => (xy & 0xFFFF);
const PAL_Y = (xy: number) => (xy >> 16);

// Helper types
interface Surface {
  byteBuffer: Uint8Array;
  pitch: number;
  width: number;
  height: number;
  ctx: CanvasRenderingContext2D;
  cvs?: HTMLCanvasElement;
  updateScreen: () => void;
  fadeIn: (paletteId: number, night: boolean, speed: number) => Promise<void>;
  blitRLE: (frame: any, pos: any) => void;
}

/** Optional owner callback at the stable boundary after the render prefix. */
export type SceneComposeFadeHook=(surface:Surface,paletteId:number,night:boolean)=>Promise<void>;

interface SpriteToDraw {
  frame: any;
  pos: number; // PAL_XY packed coordinate
  layer: number;
  meta: any;
}

enum Direction {
  South = 0,
  West = 1,
  North = 2,
  East = 3,
  Unknown = 4
}

// Event object states are SHORTs in the save data (e.g. hidden objects are negative).
function SHORT_STATE(value: number) {
  return ((value | 0) << 16) >> 16;
}

class SceneService {
  private surface: Surface | null = null;
  private playerSpriteCache: Record<number, any> = {};
  private mapCache: Record<number, any> = {};
  private thisStepFrame: number = 0;
  private applyWaveIndex: number = 0;
  getApplyWaveIndex():number {return this.applyWaveIndex;}
  private currentSceneId: number | null = null;
  private drawList: SpriteToDraw[] = [];
  private eventObjectSprite: any[] | null = null;
  private _eventSpriteVersion: number | null = null;
  private mapNum: number = 0;
  private _renderedMapId: number | null = null;

  // Caches for party trail
  private partyStateCache: any[] = [];
  private trailStateCache: any[] = [];
  private followerCountCache: number = 0;
  private unsubscribePartyTrail: (() => void) | null = null;

  constructor() {
    // Bind methods
    this.handlePartyTrailEvent = this.handlePartyTrailEvent.bind(this);
  }

  /**
   * Reset scene cache to force reload on next makeScene call
   * Called when starting a new game to ensure background updates
   */
  public resetSceneCache(): void {
    console.log('[SCENE] Resetting scene cache', {
      previousSceneId: this.currentSceneId
    });
    this.currentSceneId = null;
    this._renderedMapId = null;
    this.mapNum = 0;
  }

  public *init(surf: Surface): Generator<Promise<unknown>, void, unknown> {
    // console.debug('[SCENE] init');
    this.surface = surf;
    const list = ['MAP', 'GOP', 'MGO'];
    yield resourceService.loadMKF(...list);
    
    // Ensure Files global is populated for legacy compatibility if needed, 
    // but we should try to use resourceService directly where possible.
    // The original code did:
    // list.forEach(function(name) {
    //   Files[name] = resourceService.getMKF(name);
    // });
    
    this.ensurePartyTrailSubscription();
  }

  private handlePartyTrailEvent(event: any) {
    if (!event) {
      return;
    }
    switch (event.type) {
      case 'snapshot':
        this.partyStateCache = Array.isArray(event.party) ? event.party : this.partyStateCache;
        this.trailStateCache = Array.isArray(event.trail) ? event.trail : this.trailStateCache;
        this.followerCountCache = Number.isFinite(event.followerCount) ? event.followerCount : this.followerCountCache;
        break;
      case 'party':
        this.partyStateCache = Array.isArray(event.value) ? event.value : this.partyStateCache;
        break;
      case 'trail':
        this.trailStateCache = Array.isArray(event.value) ? event.value : this.trailStateCache;
        break;
      case 'followerCount':
        this.followerCountCache = Number.isFinite(event.value) ? event.value : this.followerCountCache;
        break;
      case 'disposed':
        if (typeof this.unsubscribePartyTrail === 'function') {
          this.unsubscribePartyTrail();
        }
        this.unsubscribePartyTrail = null;
        this.partyStateCache = [];
        this.trailStateCache = [];
        this.followerCountCache = 0;
        break;
      default:
        break;
    }
  }

  private ensurePartyTrailSubscription() {
    if (this.unsubscribePartyTrail) {
      return;
    }
    this.unsubscribePartyTrail = partyTrailAdapter.subscribe(this.handlePartyTrailEvent);
  }

  private getCachedPartyState() {
    this.ensurePartyTrailSubscription();
    if (!Array.isArray(this.partyStateCache)) {
      this.partyStateCache = partyTrailAdapter.getPartyState();
    }
    return this.partyStateCache;
  }

  private getCachedTrailState() {
    this.ensurePartyTrailSubscription();
    if (!Array.isArray(this.trailStateCache)) {
      this.trailStateCache = partyTrailAdapter.getTrailState();
    }
    return this.trailStateCache;
  }

  private getCachedFollowerCount() {
    this.ensurePartyTrailSubscription();
    if (!Number.isFinite(this.followerCountCache)) {
      this.followerCountCache = partyTrailAdapter.getFollowerCount();
    }
    return this.followerCountCache;
  }

  public *makeScene(...[ownerFade]:[SceneComposeFadeHook?]): Generator<Promise<unknown>, void, unknown> {
    const sceneId = getSceneIdSnapshot() || 0;
    const activeScene = sceneId ? getSceneEntrySnapshot(sceneId) : null;

    console.log('[SCENE] makeScene called', {
      sceneId,
      currentSceneId: this.currentSceneId,
      hasActiveScene: !!activeScene,
      willReloadScene: this.currentSceneId !== sceneId
    });

    if (!activeScene) {
      console.warn('[SCENE] makeScene: no active scene for sceneId', sceneId);
      return;
    }

    // Clear FBP overlay state at the start of makeScene
    // This ensures the scene background can render properly, even if FBP was active
    // (e.g., during opening cutscenes with scene changes)
    if (typeof window !== 'undefined' && (window as any).PAL_FBP_ACTIVE) {
      console.log('[SCENE] Clearing FBP state for makeScene', {
        sceneId,
        reason: 'makeScene called - need to render scene background'
      });
      const win = window as any;
      const previousOverlay = win.PAL_FBP_OVERLAY_PREV || win.PAL_OVERLAY_PREFERENCE || 'panorama';
      win.PAL_FBP_ACTIVE = false;
      win.PAL_FBP_OVERLAY_PREV = null;

      // Restore panorama mode if it was active before FBP
      if (previousOverlay === 'panorama' && typeof win.PAL_SET_OVERLAY_MODE === 'function') {
        win.PAL_SET_OVERLAY_MODE('panorama');
      }
    }

    if (this.currentSceneId !== sceneId) {
      console.log('[SCENE] Scene changed, reloading background', {
        from: this.currentSceneId,
        to: sceneId,
        mapNum: (activeScene as any).mapNum
      });
      this.currentSceneId = sceneId;

      if (activeScene) {
        (activeScene as any).eventObjectSprite = null;
        (activeScene as any)._renderedMapId = null;
      }
      if (overviewController && typeof overviewController.applyScene === 'function') {
        overviewController.applyScene(sceneId);
      }
      const mapMetaForPanorama = typeof worldService.getMapMetaComponent === 'function'
        ? worldService.getMapMetaComponent()
        : null;
      const fallbackMapId = activeScene && typeof (activeScene as any).mapNum === 'number'
        ? Math.max(0, (activeScene as any).mapNum)
        : 0;
      const panoramaMapId = mapMetaForPanorama && typeof mapMetaForPanorama.mapId === 'number'
        ? mapMetaForPanorama.mapId
        : fallbackMapId;
      
      if (fallbackMapId != null) {
        this.mapNum = fallbackMapId;
      }
      if (panoramaRenderer && typeof panoramaRenderer.applyScene === 'function') {
        panoramaRenderer.applyScene(sceneId, panoramaMapId);
      }
    }
    
    // In the original code, activeScene.render() was called. 
    // However, activeScene is just a data object from getSceneEntrySnapshot.
    // The original code might have been relying on some mixin or prototype extension.
    // Looking at the original code: `yield activeScene.render();`
    // But `getSceneEntrySnapshot` returns a plain object usually.
    // Let's assume we need to call our own render method or similar logic.
    // Wait, `activeScene` in original code comes from `getSceneEntrySnapshot`.
    // If `getSceneEntrySnapshot` returns a `Scene` object (from `worldService.getSceneEntry`), 
    // it might have a `render` method if it's an instance of a class.
    // But `worldService.getSceneEntry` returns `scenes[index]` which is likely data.
    // Let's check `Scene` definition in `pal-global.js` or similar.
    // The grep showed `global.Scene = defineStruct(...)`.
    // It seems `activeScene` might just be data.
    // However, the original code `yield activeScene.render()` implies it has a render method.
    // If `activeScene` is just data, then `render` must be missing and it would crash?
    // Or maybe `activeScene` is actually the `scene` object itself in some contexts?
    // No, `scene.makeScene` calls `activeScene.render()`.
    // Let's look at `worldService.getSceneEntry`. It returns `component.sceneRef` or `scenes[index]`.
    // If it returns `component.sceneRef`, that might be an object with methods.
    // But `scenes[index]` from `getGameDataStore()` is likely JSON data.
    
    // Actually, looking at `scene.js`:
    // `var activeScene = sceneId ? getSceneEntrySnapshot(sceneId) : null;`
    // `yield activeScene.render();`
    // This is very suspicious if `activeScene` is just data.
    // Maybe `activeScene` is expected to be the `scene` module itself? No.
    
    // Let's assume for now we just need to render the scene using our own `render` method
    // if `activeScene` doesn't have one, or if we are replacing the logic.
    // But wait, `scene.render` is defined in `scene.js`.
    // `scene.makeScene` calls `activeScene.render()`.
    // If `activeScene` is a `Scene` object (struct), maybe it has a `render` method attached?
    // In `pal-global.js`, `Scene` is a struct. Structs usually don't have methods in this codebase unless extended.
    // Let's check if `Scene.prototype` is extended.
    // `utils.extend(Scene.prototype, { ... render: function*() { ... } })`
    // Yes! In `scene.js` (lines 500+), `Scene.prototype` is extended with `render`.
    // So `activeScene` IS an instance of `Scene` (or has its prototype).
    // Since we are migrating `scene.js`, we need to handle this.
    
    // If we are replacing `scene.js`, we are replacing the `Scene` prototype extensions too?
    // Or should we just implement `render` here and call it?
    // The `Scene` struct is likely defined globally.
    // We should probably just call `this.render()` if we are the singleton handling the scene.
    // But `activeScene` is a specific scene entry.
    // The `render` method in `scene.js` (lines 500+) uses `this.mapNum` etc.
    // It seems `Scene.prototype.render` was the main render loop for a specific scene.
    // But `scene.js` also exports a `scene` object which has `render`.
    // Wait, `scene.render` in `scene.js` (line 500+) is attached to `Scene.prototype`.
    // But `scene.js` exports `scene` object.
    // Does `scene` object have `render`?
    // `scene.makeScene` calls `activeScene.render()`.
    // `activeScene` is an instance of `Scene`.
    
    // So, `SceneService` should probably expose a `render` method that takes a scene ID or uses the current one.
    // And `makeScene` should call that.
    
    if(ownerFade)yield* this.render(ownerFade);
    else yield* this.render();
  }

  public getPlayerSprite(i: number): any {
    const party = this.getCachedPartyState();
    const player = party[i];
    if (!player) {
      return null;
    }
    const playerID = player.playerRole;
    let spriteNum: number;
    const maxPartyMemberIndex = Math.max(0, getMaxPartyMemberIndexValue());
    const followerCount = this.getCachedFollowerCount();
    
    if (i > maxPartyMemberIndex && followerCount > 0) {
      // Follower
      spriteNum = playerID;
    } else {
      // Player
      spriteNum = getPlayerRoleFieldValue('spriteNum', playerID, undefined);
    }
    
    if (typeof spriteNum === 'undefined') {
      return null;
    }
    
    let sprite = this.playerSpriteCache[spriteNum];
    if (!sprite) {
      const MGO = resourceService.getMKF('MGO');
      if (MGO) {
        const chunk = (MGO as any).decompressChunk(spriteNum);
        sprite = this.playerSpriteCache[spriteNum] = new Sprite(chunk);
      }
    }
    return sprite;
  }

  public updateParty(inputDir: Direction) {
    this.ensurePartyTrailSubscription();
    let viewport = getViewportSnapshot();
    const partyOffset = getPartyOffsetSnapshot();

    if (inputDir !== Direction.Unknown) {
      const xOffset = ((inputDir === Direction.West || inputDir === Direction.South) ? -16 : 16);
      const yOffset = ((inputDir === Direction.West || inputDir === Direction.North) ? -8 : 8);

      const xSource = PAL_X(viewport) + PAL_X(partyOffset);
      const ySource = PAL_Y(viewport) + PAL_Y(partyOffset);

      const xTarget = xSource + xOffset;
      const yTarget = ySource + yOffset;

      worldService.setPartyDirection(inputDir);

      if (!this.checkObstacleWithRange(PAL_XY(xTarget, yTarget), true, 0)) {
        worldService.mutateTrail((trailState: any) => {
          if (!Array.isArray(trailState) || trailState.length === 0) {
            return trailState;
          }
          // Copy the fields (C struct assignment), not the object references:
          // sharing references would alias every trail entry to trail[0].
          for (let i = 3; i >= 0; i--) {
            const src = trailState[i];
            if (!src) {
              continue;
            }
            const dst = trailState[i + 1] || (trailState[i + 1] = {});
            dst.x = src.x;
            dst.y = src.y;
            dst.direction = src.direction;
          }
          trailState[0] = trailState[0] || {};
          trailState[0].direction = inputDir;
          trailState[0].x = xSource;
          trailState[0].y = ySource;
          return trailState;
        });

        viewport = worldService.setViewport(PAL_XY(PAL_X(viewport) + xOffset, PAL_Y(viewport) + yOffset));

        this.updatePartyGestures(true);
        return;
      }
    }

    this.updatePartyGestures(false);
  }

  public updatePartyGestures(walking: boolean, options?: { preserveFrames?: boolean }) {
    this.ensurePartyTrailSubscription();
    const preserveFrames = options && options.preserveFrames === true;
    const party = this.getCachedPartyState();
    const trail = this.getCachedTrailState();
    const walkFrames = getPlayerRoleField('walkFrames');
    const maxPartyMemberIndex = Math.max(0, getMaxPartyMemberIndexValue());
    const viewport = getViewportSnapshot();
    const partyOffset = getPartyOffsetSnapshot();
    const partyDirection = getPartyDirectionSnapshot();
    const followerCount = this.getCachedFollowerCount();

    console.log('[SCENE] updatePartyGestures called', {
      walking,
      preserveFrames,
      partyLength: party?.length,
      trailLength: trail?.length,
      party: party,
      partyFirst: party?.[0],
      viewport,
      partyOffset,
      partyDirection,
      followerCount
    });

    function resolveWalkFrame(roleId: number, fallback: number) {
      if (Array.isArray(walkFrames) && typeof walkFrames[roleId] === 'number') {
        return walkFrames[roleId];
      }
      return fallback;
    }

    if (!party.length || !trail.length) {
      console.log('[SCENE] updatePartyGestures: no party or trail data, returning early');
      return;
    }

    let stepFrameFollower = 0;
    let stepFrameLeader = 0;
    const leadTrail = trail[0] || { x: PAL_X(partyOffset), y: PAL_Y(partyOffset), direction: partyDirection };

    if (walking) {
      // Update the gesture for party leader
      this.thisStepFrame = (this.thisStepFrame + 1) % 4;
      if (this.thisStepFrame & 1) {
         stepFrameLeader = ~~((this.thisStepFrame + 1) / 2);
         stepFrameFollower = 3 - stepFrameLeader;
      } else {
         stepFrameLeader = 0;
         stepFrameFollower = 0;
      }

      party[0].x = PAL_X(partyOffset);
      party[0].y = PAL_Y(partyOffset);

      if (!preserveFrames) {
        if (resolveWalkFrame(party[0].playerRole, 0) === 4) {
          party[0].frame = partyDirection * 4 + this.thisStepFrame;
        } else {
          party[0].frame = partyDirection * 3 + stepFrameLeader;
        }
      }

      // Update the gestures and positions for other party members
      const firstTrail = trail[1] || leadTrail;
      for (let i = 1; i <= maxPartyMemberIndex && i < party.length; i++) {
        const baseTrail = i === 1 ? firstTrail : (trail[1] || leadTrail);
        party[i].x = baseTrail.x - PAL_X(viewport);
        party[i].y = baseTrail.y - PAL_Y(viewport);

        if (i === 2) {
          party[i].x += (baseTrail.direction === Direction.East || baseTrail.direction === Direction.West) ? -16 : 16;
          party[i].y += 8;
        } else {
          party[i].x += ((baseTrail.direction === Direction.West || baseTrail.direction === Direction.South) ? 16 : -16);
          party[i].y += ((baseTrail.direction === Direction.West || baseTrail.direction === Direction.North) ? 8 : -8);
        }

        // Adjust the position if there is obstacle
        const pos = PAL_XY(
          party[i].x + PAL_X(viewport),
          party[i].y + PAL_Y(viewport)
        );
        if (this.checkObstacleWithRange(pos, true, 0)){
          party[i].x = trail[1].x - PAL_X(viewport);
          party[i].y = trail[1].y - PAL_Y(viewport);
        }

        // Update gesture for this party member
        const gestureTrail = trail[2] || baseTrail;
        if (!preserveFrames) {
          if (resolveWalkFrame(party[i].playerRole, 0) === 4) {
            party[i].frame = gestureTrail.direction * 4 + this.thisStepFrame;
          } else {
            party[i].frame = gestureTrail.direction * 3 + stepFrameLeader;
          }
        }
      }

      // As in SDLPAL: follower i (1-based) is placed on rgTrail[2 + i].
      for (let f = 1; f <= followerCount && maxPartyMemberIndex + f < party.length; f++) {
        const follower = party[maxPartyMemberIndex + f];
        const followerTrail = trail[2 + f];
        if (!follower || !followerTrail) {
          continue;
        }
        follower.x = followerTrail.x - PAL_X(viewport);
        follower.y = followerTrail.y - PAL_Y(viewport);
        if (!preserveFrames) {
          follower.frame = followerTrail.direction * 3 + stepFrameFollower;
        }
      }
    } else {
      // Player is not moved. Use the "standing" gesture instead of "walking" one.
      let i = resolveWalkFrame(party[0].playerRole, 3);
      if (i === 0) {
        i = 3;
      }
      if (!preserveFrames) {
        party[0].frame = partyDirection * i;
      }

      // As in SDLPAL, the standing gesture only changes frames; positions are
      // left as they were.
      const idleTrail = trail[2] || leadTrail;
      for (i = 1; i <= maxPartyMemberIndex && i < party.length; i++) {
        let f = resolveWalkFrame(party[i].playerRole, 3);
        if (f === 0) {
          f = 3;
        }
        if (!preserveFrames) {
          party[i].frame = idleTrail.direction * f;
        }
      }

      for (let f = 1; f <= followerCount && maxPartyMemberIndex + f < party.length; f++) {
        const follower = party[maxPartyMemberIndex + f];
        const followerTrail = trail[2 + f];
        if (follower && followerTrail && !preserveFrames) {
          follower.frame = followerTrail.direction * 3;
        }
      }

      this.thisStepFrame &= 2;
      this.thisStepFrame ^= 2;
    }

    this.commitPartyGestures(party, maxPartyMemberIndex + followerCount);
  }

  /**
   * PAL_UpdatePartyGestures 写的是 gpGlobals->rgParty(位置 + 帧号,进存档)。上面在 party-trail-adapter 的缓存上算,
   * 这里提交进 Party 组件(M2 D2c-2);以前只停在缓存里,Global.party / 存档里一直是读档时的旧值。
   * 值没变就不提交(静止时每帧都会走到这里)。
   */
  private commitPartyGestures(party: any[], lastIndex: number) {
    const live = worldService.getParty();
    const upto = Math.min(lastIndex, party.length - 1, live.length - 1);
    let changed = false;
    for (let i = 0; i <= upto && !changed; i++) {
      const c = party[i], m: any = live[i];
      if (c && m && (m.x !== ((c.x << 16) >> 16) || m.y !== ((c.y << 16) >> 16) || m.frame !== (c.frame & 0xffff))) changed = true;
    }
    if (!changed) return;
    worldService.mutateParty((members) => {
      for (let i = 0; i <= upto; i++) {
        const c = party[i], m: any = members[i];
        if (!c || !m) continue;
        m.x = c.x;
        m.y = c.y;
        m.frame = c.frame;
      }
      return members;
    });
  }

  // PAL_CheckObstacleWithRange (scene.c). checkRange also keeps the party away from the map
  // edge (used for the party's own steps and placement).
  private legacyCheckObstacle(pos: number, checkEventObjects: boolean, selfObject: number, checkRange = false): boolean {
    if (PAL_X(pos) < 0 || PAL_X(pos) >= 2048 || PAL_Y(pos) < 0 || PAL_Y(pos) >= 2048) {
      return true;
    }
    let x = ~~(PAL_X(pos) / 32);
    let y = ~~(PAL_Y(pos) / 16);
    let h = 0;
    if (checkRange) {
      const partyOffset = getPartyOffsetSnapshot();
      const blockX = ~~(PAL_X(partyOffset) / 32);
      const blockY = ~~(PAL_Y(partyOffset) / 16);
      // As in SDLPAL PAL_CheckObstacleWithRange: x / y are tile indices but are compared
      // against 2048, so only the left / top edges are ever blocked. The old port blocked the
      // right edge too (x >= 2048 / 32 - blockX - 1), which SDLPAL never does (scene 186 exit).
      if (x < blockX || x >= 2048 || y < blockY || y >= 2048) {
        return true;
      }
    }
    const xr = PAL_X(pos) % 32;
    const yr = PAL_Y(pos) % 16;

    if (xr + yr * 2 >= 16) {
      if (xr + yr * 2 >= 48) {
        x++;
        y++;
      } else if (32 - xr + yr * 2 < 16) {
        x++;
      } else if (32 - xr + yr * 2 < 48) {
        h = 1;
      } else {
        y++;
      }
    }

    // const numScene = getSceneIdSnapshot() || 0;
    // const sc = numScene ? getSceneEntrySnapshot(numScene) : null;
    // if (!sc || typeof sc.getMap !== 'function') {
    //   return true;
    // }
    // In the new service, we use this.getMap()
    const map = this.getMap();
    if (!map) return true;

    if (map.isTileBlocked(x, y, h)) {
      return true;
    }

    if (checkEventObjects) {
      const eventEntries = sceneEventAdapter.getEventObjects();
      for (let idx = 0; idx < eventEntries.length; idx++) {
        const entry = eventEntries[idx];
        if (!entry || !entry.state) {
          continue;
        }
        if (entry.index === selfObject - 1) {
          continue;
        }
        const p = entry.state as any;
        if (SHORT_STATE(p.state) >= 2) { // kObjStateBlocker
          if (Math.abs(p.x - PAL_X(pos)) + Math.abs(p.y - PAL_Y(pos)) * 2 < 16) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Single authority for obstacles, as in SDLPAL. The ECS collision check used to be consulted
  // first and could only ever let things through (it allowed walls next to hidden event objects),
  // and the old fallback here used the wrong blocker threshold, so blockers were walkable.
  public checkObstacle(pos: number, checkEventObjects: boolean, selfObject: number): boolean {
    return this.legacyCheckObstacle(pos, checkEventObjects !== false, selfObject);
  }

  public checkObstacleWithRange(pos: number, checkEventObjects: boolean, selfObject: number): boolean {
    return this.legacyCheckObstacle(pos, checkEventObjects !== false, selfObject, true);
  }

  public applyWave(buffer: Uint8Array) {
    const wave = new Array(32);
    // wScreenWave is a WORD in SDLPAL: a negative result wraps to >= 256 and
    // is reset below.
    const screenWave = worldService.setScreenWave(
      ((getScreenWaveSnapshot() || 0) + (getWaveProgressionSnapshot() || 0)) & 0xFFFF
    );
    const buf = new Uint8Array(320);
    if (screenWave === 0 || screenWave >= 256) {
      // No need to wave the screen
      worldService.setScreenWave(0);
      worldService.setWaveProgression(0);
      return;
    }

    // Calculate the waving offsets.
    let a = 0;
    let b = 60 + 8;

    for (let i = 0; i < 16; i++) {
      b -= 8;
      a += b;

      // WARNING: assuming the screen width is 320
      wave[i] = ~~(a * screenWave / 256);
      wave[i + 16] = 320 - wave[i];
    }

    // Apply the effect.
    // WARNING: only works with 320x200 8-bit surface.
    a = this.applyWaveIndex;

    // Loop through all lines in the screen buffer.
    if (this.surface) {
        let bufferOffset = 0;
        for (let i = 0; i < 200; i++) {
            b = wave[a];

            if (b > 0 && b < 320) {
                // Do a shift on the current line with the calculated offset.
                // memcpy(buf, buffer, b);
                buf.set(buffer.subarray(bufferOffset, bufferOffset + b), 0);
                // memmove(buffer, buffer.subarray(b), 320 - b);
                buffer.copyWithin(bufferOffset, bufferOffset + b, bufferOffset + 320);
                // memcpy(buffer.subarray(320 - b), buf, b);
                buffer.set(buf.subarray(0, b), bufferOffset + 320 - b);
            }

            a = (a + 1) % 32;
            bufferOffset += this.surface.pitch;
        }
    }

    this.applyWaveIndex = (this.applyWaveIndex + 1) % 32;
  }

  public loadEventObjectSprites(version: number) {
    const entries = sceneEventAdapter.getEventObjects();
    if (!entries || !entries.length) {
      this.eventObjectSprite = [];
      this._eventSpriteVersion = version;
      return;
    }
    const MGO = resourceService.getMKF('MGO');
    const array = this.eventObjectSprite = new Array(entries.length);

    if (!MGO) {
      console.warn('[scene] MGO archive unavailable; skipping event object sprites');
      entries.forEach((_, i) => {
        array[i] = null;
      });
      this._eventSpriteVersion = version;
      return;
    }

    // const party = this.getPartySpriteCache && this.getPartySpriteCache(); // Not implemented in service yet
    const party: any[] = []; // Placeholder

    entries.forEach((entry, localIndex) => {
      const state = entry && entry.state ? entry.state : null;
      const spriteNum = state && typeof state.spriteNum === 'number' ? state.spriteNum : 0;
      if (!spriteNum && state && (state as any).playerRole != null && Array.isArray(party)) {
        const partySpriteEntry = party[(state as any).playerRole];
        if (partySpriteEntry && partySpriteEntry.sprite) {
          array[localIndex] = partySpriteEntry.sprite;
          return;
        }
      }
      if (!spriteNum) {
        array[localIndex] = null;
        return;
      }
      const chunk = (MGO as any).decompressChunk(spriteNum);
      const sprite = new Sprite(chunk);
      (sprite as any).__paletteSpriteNum = spriteNum;
      array[localIndex] = sprite;
      if (entry.id != null) {
        worldService.mutateEventObjectById(entry.id, (eventState: any) => {
          if (eventState) {
            eventState.spriteFramesAuto = sprite.frameCount;
          }
          return eventState;
        });
      }
    });
    this._eventSpriteVersion = version;
  }

  public getEventObjectSprite(eventObjectID: number) {
    const version = sceneEventAdapter.getEventObjectsVersion();
    if (!this.eventObjectSprite || (version != null && this._eventSpriteVersion !== version)) {
      this.loadEventObjectSprites(version || 0);
    }

    const eventRange = getSceneEventObjectRangeSnapshot();
    const rangeStart = eventRange && Number.isFinite(eventRange.start) ? eventRange.start : 0;
    const rangeEnd = eventRange && Number.isFinite(eventRange.end) ? eventRange.end : rangeStart;
    const targetIndex = eventObjectID - 1;
    if (targetIndex < rangeStart || targetIndex >= rangeEnd) {
      return null;
    }
    const localIndex = targetIndex - rangeStart;
    if (!this.eventObjectSprite || localIndex < 0 || localIndex >= this.eventObjectSprite.length) {
      return null;
    }

    const state = sceneEventAdapter.getEventObjectStateByIndex(targetIndex);
    const spriteNum = state && typeof state.spriteNum === 'number' ? state.spriteNum : 0;
    const cached = this.eventObjectSprite[localIndex];

    if (spriteNum <= 0) {
      if (cached) {
        this.eventObjectSprite[localIndex] = null;
      }
      return null;
    }

    if (!cached || cached.__paletteSpriteNum !== spriteNum) {
      const MGO = resourceService.getMKF('MGO');
      if (MGO) {
        const chunk = (MGO as any).decompressChunk(spriteNum);
        const sprite = new Sprite(chunk);
        (sprite as any).__paletteSpriteNum = spriteNum;
        this.eventObjectSprite[localIndex] = sprite;
        if (state) {
            worldService.mutateEventObjectById(eventObjectID, (eventState: any) => {
            if (eventState) {
                eventState.spriteFramesAuto = sprite.frameCount;
            }
            return eventState;
            });
        }
        return sprite;
      }
    }

    return cached;
  }

  public addToDrawList(frame: any, x: number, y: number, layer: number, meta: any): SpriteToDraw {
    const obj: SpriteToDraw = { frame, pos: PAL_XY(x, y), layer, meta: meta || null };
    this.drawList.push(obj);
    return obj;
  }

  public calcCoverTiles(spriteToDraw: SpriteToDraw) {
    const viewport = getViewportSnapshot();
    const viewportX = PAL_X(viewport);
    const viewportY = PAL_Y(viewport);
    const sx = viewportX + PAL_X(spriteToDraw.pos);
    const sy = viewportY + PAL_Y(spriteToDraw.pos);
    const sh = ((sx % 32) ? 1 : 0);

    const width = spriteToDraw.frame.width;
    const height = spriteToDraw.frame.height;

    let dx = 0, dy = 0, dh = 0;
    let x, y, i;
    // Loop through all the tiles in the area of the sprite.
    for (y = ~~((sy - height - 15) / 16); y <= ~~(sy / 16); y++) {
      for (x = ~~((sx - ~~(width / 2)) / 32); x <= ~~((sx + ~~(width / 2)) / 32); x++) {
        for (i = (x == ~~((sx - ~~(width / 2)) / 32) ? 0 : 3); i < 5; i++) {
          switch (i) {
            case 0:
              dx = x;
              dy = y;
              dh = sh;
              break;
            case 1:
              dx = x - 1;
              break;
            case 2:
              dx = (sh ? x : (x - 1));
              dy = (sh ? (y + 1) : y);
              dh = 1 - sh;
              break;
            case 3:
              dx = x + 1;
              dy = y;
              dh = sh;
              break;
            case 4:
              dx = (sh ? (x + 1) : x);
              dy = (sh ? (y + 1) : y);
              dh = 1 - sh;
              break;
          }

          for (let l = 0; l < 2; l++) {
            const map = this.getMap();
            if (!map) continue;
            const tile = map.getTileBitmap(dx, dy, dh, l);
            const tileHeight = map.getTileHeight(dx, dy, dh, l);

            // Check if this tile may cover the sprites
            if (tile && tileHeight > 0 && (dy + tileHeight) * 16 + dh * 8 >= sy) {
              // This tile may cover the sprite
              this.addToDrawList(
                tile,
                dx * 32 + dh * 16 - 16 - viewportX,
                dy * 16 + dh * 8 + 7 + l + tileHeight * 8 - viewportY,
                tileHeight * 8 + l,
                { kind: 'cover' }
              );
            }
          }
        }
      }
    }
  }

  public getMap(): any {
    const mapNum = this.mapNum;
    if (mapNum in this.mapCache) {
      return this.mapCache[mapNum];
    }
    const MAP = resourceService.getMKF('MAP');
    const GOP = resourceService.getMKF('GOP');
    if (!MAP || !GOP) return null;

    const map = Map.fromFile(mapNum, MAP as any, GOP as any);
    return (this.mapCache[mapNum] = map);
  }

  public renderMap() {
    const mapMeta = typeof worldService.getMapMetaComponent === 'function'
      ? worldService.getMapMetaComponent()
      : null;
    let resolvedMapId = this.mapNum;
    const previousRenderedMapId = this._renderedMapId;
    if (mapMeta && typeof mapMeta.mapId === 'number') {
      resolvedMapId = mapMeta.mapId;
      if (this._renderedMapId !== mapMeta.mapId) {
        this.eventObjectSprite = null;
        this._renderedMapId = mapMeta.mapId;
      }
      this.mapNum = resolvedMapId;
    }

    console.log('[SCENE] renderMap', {
      resolvedMapId,
      previousRenderedMapId,
      currentSceneId: this.currentSceneId,
      mapNumFromThis: this.mapNum,
      mapMetaMapId: mapMeta?.mapId,
      willRerenderMap: previousRenderedMapId !== resolvedMapId
    });

    worldService.runSystems('map', {
      surface: this.surface,
      mapCache: this.mapCache,
      Files: (globalThis as any).Files,
      viewportComponent: worldService.getViewportComponent(),
      mapId: resolvedMapId
    });
  }

  public renderSprites(options: { skipBlit?: boolean, includeOffscreen?: boolean } = {}) {
    const skipBlit = options.skipBlit === true;
    const includeOffscreen = options.includeOffscreen === true;
    this.ensurePartyTrailSubscription();
    worldService.runSystems(['collision', 'movement'], {
      mapCache: this.mapCache,
      Files: (globalThis as any).Files,
      viewportComponent: worldService.getViewportComponent(),
      sceneEventObjects: sceneEventAdapter.getEventObjects()
    });
    let viewport = getViewportSnapshot();
    if (overviewController && typeof overviewController.setViewport === 'function') {
      overviewController.setViewport(viewport);
    }
    const viewportX = PAL_X(viewport);
    const viewportY = PAL_Y(viewport);
    const party = this.getCachedPartyState();
    // Reset drawList
    this.drawList = [];

    const maxPartyMemberIndexSnapshot = getMaxPartyMemberIndexValue();
    const maxPartyMemberIndex = Number.isFinite(maxPartyMemberIndexSnapshot) && maxPartyMemberIndexSnapshot >= 0
      ? maxPartyMemberIndexSnapshot
      : 0;
    const followerCount = this.getCachedFollowerCount();

    console.log('[SCENE] renderSprites: party data', {
      partyLength: party?.length,
      party: party,
      maxPartyMemberIndex,
      followerCount,
      loopCount: maxPartyMemberIndex + followerCount + 1
    });

    // Players
    const layer = getLayerSnapshot();
    for (let i = 0; i <= maxPartyMemberIndex + followerCount; ++i) {
      const player = party[i];
      console.log(`[SCENE] renderSprites: rendering player ${i}`, {
        exists: !!player,
        player: player
      });
      if (!player) {
        continue;
      }
      const sprite = this.getPlayerSprite(i);
      console.log(`[SCENE] renderSprites: player ${i} sprite`, {
        exists: !!sprite,
        playerRole: player.playerRole,
        playerX: player.x,
        playerY: player.y,
        playerFrame: player.frame
      });
      if (!sprite) {
        continue;
      }
      let frameIndex = Number.isFinite(player.frame) ? player.frame : 0;
      const totalFrames = typeof sprite.frameCount === 'number' ? sprite.frameCount : 0;
      if (totalFrames > 0) {
        frameIndex = ((frameIndex % totalFrames) + totalFrames) % totalFrames;
      } else {
        frameIndex = 0;
      }
      let bitmap = sprite.getFrame(frameIndex);
      if (!bitmap) {
        bitmap = sprite.getFrame(0);
        frameIndex = 0;
        if (!bitmap) {
          console.log(`[SCENE] renderSprites: player ${i} NO BITMAP FOUND`);
          continue;
        }
      }
      player.frame = frameIndex;

      // Add it to our array
      const drawX = player.x - ~~(bitmap.width / 2);
      const drawY = player.y + layer + 10;

      console.log(`[SCENE] renderSprites: player ${i} drawing`, {
        playerX: player.x,
        playerY: player.y,
        drawX,
        drawY,
        layer,
        bitmapWidth: bitmap.width,
        bitmapHeight: bitmap.height,
        viewportX,
        viewportY,
        screenX: drawX - viewportX,
        screenY: drawY - viewportY
      });

      const obj = this.addToDrawList(
        bitmap,
        drawX,
        drawY,
        layer + 6,
        { kind: 'player' }
      );
      if (obj) {
        const worldX = drawX + viewportX;
        const worldY = drawY - bitmap.height - (layer + 6) + viewportY;
        obj.meta = Object.assign({}, obj.meta, {
          worldX,
          worldY,
          frame: bitmap
        });
      }
      // Calculate covering tiles on the map
      this.calcCoverTiles(obj);
    }
    // Event Objects (Monsters/NPCs/others)
    // npc-overlay (aigg-mud-pal Phase 4): merge roster visitors into the same
    // render path — synthetic entries + MGO sprites; canon untouched.
    const overlayEntries = npcOverlay.getOverlayEntriesForScene(Number(worldService.getSceneId?.() ?? -1));
    const baseEventObjects = sceneEventAdapter.getEventObjects();
    worldService.runSystems('eventObjects', {
      surface: this.surface,
      viewportValue: viewport,
      addToDrawList: this.addToDrawList.bind(this),
      calcCoverTiles: this.calcCoverTiles.bind(this),
      getEventObjectSprite: (id: number) => npcOverlay.isOverlayId(id)
        ? npcOverlay.getOverlaySprite(id, (spriteNum) => {
            const MGO = resourceService.getMKF('MGO') as any;
            return MGO ? new Sprite(MGO.decompressChunk(spriteNum)) : null;
          })
        : this.getEventObjectSprite(id),
      sceneEventObjects: overlayEntries.length ? [...baseEventObjects, ...overlayEntries] : baseEventObjects,
      includeOffscreen
    });

    // All sprites are now in our array; sort them by their vertical positions.
    this.drawList.sort((a, b) => PAL_Y(a.pos) - PAL_Y(b.pos)); // Sort by Y ascending
    
    // Draw all the sprites to the screen.
    if (!skipBlit && this.surface) {
      for (let i = 0; i < this.drawList.length; ++i) {
        const obj = this.drawList[i];
        const frame = obj.frame;
        const layer = obj.layer;
        const x = PAL_X(obj.pos);
        const y = PAL_Y(obj.pos) - frame.height - layer;
        this.surface.blitRLE(frame, PAL_XY(x, y));
      }
    }
  }

  public *render(...[ownerFade]:[SceneComposeFadeHook?]): Generator<Promise<unknown>, void, unknown> {
    if (!this.surface && (globalThis as any).ui && (globalThis as any).ui.surface) {
      this.surface = (globalThis as any).ui.surface;
    }
    if (!this.surface) {
      console.warn('[SCENE] render called before surface initialized');
      return;
    }

    const fbpActive = typeof window !== 'undefined' && (window as any).PAL_FBP_ACTIVE === true;
    if (fbpActive) {
      if (panoramaRenderer && typeof panoramaRenderer.setLegacyUiCapture === 'function') {
        panoramaRenderer.setLegacyUiCapture(false);
      }
      if (panoramaRenderer && typeof panoramaRenderer.hide === 'function') {
        panoramaRenderer.hide();
      }
      if (this.surface && this.surface.cvs) {
        this.surface.cvs.style.display = '';
      }
      const debugCanvas = (this.surface as any).debugcvs;
      if (debugCanvas && typeof debugCanvas.style !== 'undefined') {
        debugCanvas.style.display = '';
      }
      return;
    }
    
    const panoramaActive = !!(panoramaRenderer
      && typeof panoramaRenderer.getMode === 'function'
      && panoramaRenderer.getMode() === 'panorama');
    const skipSceneRender = panoramaActive;

    if (panoramaRenderer && typeof panoramaRenderer.setLegacyUiCapture === 'function') {
      panoramaRenderer.setLegacyUiCapture(panoramaActive);
    }

    if (skipSceneRender) {
      this.surface.ctx.clearRect(0, 0, this.surface.width, this.surface.height);
      if (panoramaRenderer && typeof panoramaRenderer.beginUiFrame === 'function') {
        panoramaRenderer.beginUiFrame(this.surface);
      }
      if (this.surface.byteBuffer && this.surface.byteBuffer.length) {
        this.surface.byteBuffer.fill(0);
      }
    }
    
    // Reset drawList
    this.drawList = [];
    
    if (!skipSceneRender) {
      this.renderMap();
      this.applyWave(this.surface.byteBuffer);
      this.renderSprites();
    } else {
      this.renderSprites({ skipBlit: true, includeOffscreen: true });
    }
    
    const shouldHideLegacyCanvas = panoramaActive;
    if (this.surface && this.surface.cvs) {
      this.surface.cvs.style.display = shouldHideLegacyCanvas ? 'none' : '';
    }
    const debugCanvas = (this.surface as any).debugcvs;
    if (debugCanvas && typeof debugCanvas.style !== 'undefined') {
      debugCanvas.style.display = shouldHideLegacyCanvas ? 'none' : '';
    }
    
    if (panoramaRenderer && typeof panoramaRenderer.render === 'function') {
      if (panoramaActive) {
        const viewport = getViewportSnapshot();
        const viewportX = PAL_X(viewport);
        const viewportY = PAL_Y(viewport);
        const overlays = this.drawList
          .map((entry) => {
            if (!entry || !entry.frame) {
              return null;
            }
            const meta = entry.meta || {};
            if (meta && meta.kind === 'cover') {
              return null;
            }
            const worldX = typeof meta.worldX === 'number'
              ? meta.worldX
              : (PAL_X(entry.pos) + viewportX);
            const worldY = typeof meta.worldY === 'number'
              ? meta.worldY
              : (PAL_Y(entry.pos) + viewportY);
            return {
              kind: meta.kind || 'entity',
              worldX,
              worldY,
              frame: meta.frame || entry.frame
            };
          })
          .filter(Boolean) as Array<{ kind?: string; worldX?: number; worldY?: number; frame?: Uint8Array | null }>;
        panoramaRenderer.render({
          mapInstance: this.getMap(),
          mapId: this.mapNum,
          paletteId: getPaletteIdSnapshot(),
          viewport,
          overlays
        });
        if (this.surface && this.surface.cvs) {
          this.surface.cvs.style.opacity = '0';
        }
      } else {
        panoramaRenderer.hide();
        if (this.surface && this.surface.cvs) {
          this.surface.cvs.style.opacity = '';
        }
      }
    }

    // Check if we need to fade in.
    const needToFadeIn = shouldFadeIn();
    if (needToFadeIn) {
      const paletteId = getPaletteIdSnapshot();
      const useNightPalette = isNightPaletteEnabled();
      if(ownerFade)yield ownerFade(this.surface,paletteId,!!useNightPalette);
      else yield this.surface.fadeIn(paletteId, !!useNightPalette, 1);
      worldService.setNeedToFadeIn(false);
    }
  }
}

const sceneService = new SceneService();
export default sceneService;
