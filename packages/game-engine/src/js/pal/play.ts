import { battleCommandRuntime } from '../../services/battle-command-runtime';
import {registerPaletteSceneHook} from '../../services/script-palette-hook';
import {ManualExecutionSignal} from '../../services/script-delay-checkpoint';
import {orderWorldCursorEntries,type WorldUpdateCursor,type WorldUpdateHooks} from '../../services/world-update-cursor';
import scene from './scene';
import input from '../../services/input-service';
import script from '../../services/script-service';
import battleModule from './battle';
import battleService from '../../services/battle-service';
import ending from './ending';
import sound from './sound';
import worldService from '../../services/world-service';
import sceneEventAdapter from '../../services/scene-event-adapter';
import partyTrailAdapter from '../../services/party-trail-adapter';
import scriptObjectAdapter from '../../services/script-object-adapter';
import dialogService from '../../services/dialog-service';
import {
  getViewportValue as getViewportSnapshot,
  getPartyOffsetValue as getPartyOffsetSnapshot,
  getPartyDirectionValue as getPartyDirectionSnapshot
} from '../../services/environment-adapter';
import { getSceneIdValue as getSceneIdSnapshot } from '../../services/scene-state-adapter';
import {
  getSceneEntry as getSceneEntrySnapshot,
  getSceneEventObjectRange as getSceneEventObjectRangeSnapshot
} from '../../services/scene-data-adapter';
import { getChaseSpeedChangeCycles } from '../../services/game-flags-adapter';
import _uigame from './uigame';
import _itemmenu from './itemmenu';
import ui from './ui';
import { PAL_X, PAL_Y, PAL_XY, Key, Direction, ObjectState, TriggerMode, ItemFlag } from './pal-global';
import res from './res';
import { LoadFlag } from './pal-global';
import { timelineActive, consumeTimelineJump } from '../../ai/timeline';
import { aiNpcForEvent, getOverlayEntriesForScene, overlayInfoFor } from '../../ai/npc-overlay';
import { openWorldChat } from '../../ai/world-panel';

const itemmenu = _itemmenu as any;

function getUIGame() {
  return _uigame as any;
}

const log = (globalThis as any).log || console;
const sleep = (globalThis as any).sleep;

const play: any = {};

var surface: any = null;
var abs = Math.abs;


function clearStaleFbpOverlay(reason: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as any;
  if (!win.PAL_FBP_ACTIVE) {
    return false;
  }
  if (worldService.isInBattle() || worldService.isEnteringScene()) {
    return false;
  }
  const status = dialogService && typeof dialogService.getStatus === 'function'
    ? dialogService.getStatus()
    : null;
  if (status && status.active) {
    return false;
  }
  const previous = win.PAL_FBP_OVERLAY_PREV || win.PAL_OVERLAY_ACTIVE || win.PAL_OVERLAY_PREFERENCE || 'off';
  win.PAL_FBP_ACTIVE = false;
  win.PAL_FBP_OVERLAY_PREV = null;
  if (!win.PAL_NEWGAME_CLASSIC_DIALOG) {
    if (previous === 'panorama' && typeof win.PAL_SET_OVERLAY_MODE === 'function') {
      win.PAL_SET_OVERLAY_MODE('panorama');
    } else if (previous === 'gps' && typeof win.PAL_SET_GPS_MODE === 'function') {
      win.PAL_SET_GPS_MODE(true);
    }
  }
  log.warn('[PLAY] cleared stale FBP overlay', { reason, previous });
  return true;
}

play.init = function*(surf: any): Generator<any, any, any> {
  log.debug('[PLAY] init');
  (globalThis as any).play = play;
  surface = surf;
  if (surf) {
    // Scene update step used by Surface.paletteFade (PAL_PaletteFade with fUpdateScene).
    surf.sceneUpdateHook = function*(): Generator<any, any, any> {
      input.clear();
      input.dir = Direction.Unknown;
      input.prevDir = Direction.Unknown;
      yield* play.update(false);
      yield* scene.makeScene();
    };
    registerPaletteSceneHook(surf.sceneUpdateHook);
  }

  if (battleService && typeof battleService.bindModule === 'function') {
    battleService.bindModule(battleModule);
  }

  worldService.init();
  yield script.init(surf);
  yield battleService.init(surf);
  yield ending.init(surf);
  yield sound.init();
  scene.updatePartyGestures(false, null);
  scene.updateParty();
};

/**
 * The main game logic routine. Update the status of everything.
 *
 * @param {Boolean} trigger       whether to process trigger events or not.
 */
// Hoisted without an initializer: existing PAL ESM cycles may install before this module evaluates.
var rewardWorldEntryConsumer:((hooks:unknown)=>void)|undefined;
/** One static validator installation; this cannot register or issue native entries. */
export function installRewardWorldEntryConsumer(consume:(hooks:unknown)=>void):void {
 if(rewardWorldEntryConsumer)throw new Error('native World entry validator already installed');
 if(typeof consume!=='function')throw new TypeError('native World entry validator required');
 rewardWorldEntryConsumer=consume;
}
const rewardWorldEntryMarker=Object.freeze({});
const rewardWorldCalls=new WeakMap<object,{hooks:WorldUpdateHooks;kind:'trigger'|'auto';entry:number;event:number}>();
/** Consumes only an exact original lexical World call; this function cannot issue one. */
export function consumeRewardWorldCallSite(hooks:WorldUpdateHooks,token:unknown,kind:'trigger'|'auto',entry:number,event:number):boolean {
 const proof=token&&typeof token==='object'?rewardWorldCalls.get(token as object):undefined;
 if(token&&typeof token==='object')rewardWorldCalls.delete(token as object);
 return !!proof&&proof.hooks===hooks&&proof.kind===kind&&proof.entry===entry&&proof.event===event;
}

function* originalWorldUpdate(trigger: boolean, cursor?:WorldUpdateCursor, hooks?:WorldUpdateHooks,entryMarker?:unknown): Generator<any, any, any> {
  const rewardHooks=hooks as (WorldUpdateHooks&{rewardBegin?:()=>void})|undefined;
  if(rewardHooks?.rewardBegin&&entryMarker!==rewardWorldEntryMarker)throw new Error('Native battle task is opaque: World entry provenance required');
  var currentSceneId = cursor?.sceneId ?? (getSceneIdSnapshot() || 0);
  const invokeHook=(kind:'trigger'|'auto',entry:number,event:number,current?:WorldUpdateCursor)=>{
    if(!rewardHooks?.rewardBegin)return hooks!.invoke(kind,entry,event,current!);
    const token={};rewardWorldCalls.set(token,{hooks:hooks!,kind,entry,event});try{return (hooks!.invoke as any)(kind,entry,event,current,token);}finally{rewardWorldCalls.delete(token);}
  };
  const invoke = (kind:'trigger'|'auto',entry:number,eventId:number,field:'scriptOnEnter'|'triggerScript'|'autoScript') => {
    if (!cursor || !hooks) {
      if(hooks)return invokeHook(kind,entry,eventId,cursor);
      return kind==='trigger' ? script.runTriggerScript(entry,eventId) : script.runAutoScript(entry,eventId);
    }
    cursor.pendingReturn ??= {kind,entry,eventId,field};
    cursor.phase=field==='scriptOnEnter'?'entry-return':field==='triggerScript'?'proximity-return':'auto-return';
    const pending=cursor.pendingReturn;
    return invokeHook(pending.kind,pending.entry,pending.eventId,cursor);
  };

  let resumedProximityCompose=false;
  if (trigger) {
    // Dispatch the saved helper before consulting the current scene/table.
    // Its selection is a retained alias and cannot be cancelled by a new row.
    if(cursor?.phase==='proximity-compose') {
      yield hooks!.compose!(cursor);surface.updateScreen(null);resumedProximityCompose=true;
    }
    if(cursor?.phase==='entry-compose') {
      yield hooks!.compose!(cursor);delete cursor.composition;cursor.phase='proximity';
    }
    const isEnteringScene = worldService.isEnteringScene();
    console.log('[PLAY] update: trigger=true', { isEnteringScene, currentSceneId });

    if ((!cursor && isEnteringScene) || (cursor?.phase==='entry' && isEnteringScene) || cursor?.phase==='entry-return') {
      if (cursor?.phase!=='entry-return') worldService.setEnteringScene(false);
      console.log('[PLAY] update: handling scene enter, setEnteringScene(false)');

      // aigg-mud-pal new timeline: the first scene-enter redirects to the
      // configured spawn (one-shot), and the story layer (scriptOnEnter)
      // stays suppressed — the canon is a stage, not a script.
      const timelineJump = cursor?.phase==='entry-return' ? null : consumeTimelineJump();
      if (timelineJump && currentSceneId !== timelineJump.startScene) {
        console.log('[PLAY] 新时间线 spawn →', timelineJump.name, timelineJump.startScene);
        worldService.setSceneId(timelineJump.startScene);
        worldService.setViewport(PAL_XY(timelineJump.partyX - 160, timelineJump.partyY - 112));
        worldService.setPartyOffset(PAL_XY(160, 112));
        worldService.setEnteringScene(true);
        res.setLoadFlags(LoadFlag.Scene | LoadFlag.PlayerSprite);
        return;
      }

      var sceneData = getSceneEntrySnapshot(currentSceneId);
      var scriptOnEnter = sceneData && typeof sceneData.scriptOnEnter === 'number'
        ? sceneData.scriptOnEnter
        : 0;
      var nextScriptOnEnter: any = null;
      if (timelineActive()) {
        console.log('[PLAY] 新时间线: scriptOnEnter suppressed', { scriptOnEnter });
        // the intro dialog gate belongs to the canon story (game.main slot 0
        // opens it; the story script would close it). With the story
        // suppressed it would linger forever and swallow the Search key.
        dialogService.setAwaitingInput(false);
        if (typeof (dialogService as any).clearDialog === 'function') (dialogService as any).clearDialog();
      } else {
      console.log('[PLAY] update: running scriptOnEnter', { scriptOnEnter });
      try {
        nextScriptOnEnter = yield invoke('trigger',scriptOnEnter,0xFFFF,'scriptOnEnter');
        console.log('[PLAY] update: scriptOnEnter completed', { nextScriptOnEnter });
      } catch (err) {
        if (err instanceof ManualExecutionSignal) throw err;
        console.error('[PLAY] scriptOnEnter failed', err);
        nextScriptOnEnter = null;
      }
      }

      if (sceneData && typeof nextScriptOnEnter === 'number' && currentSceneId > 0) {
        worldService.mutateSceneEntry(currentSceneId, function(entry) {
          if (entry) {
            entry.scriptOnEnter = nextScriptOnEnter;
          }
          return entry;
        });
      }

      if (cursor) {cursor.pendingReturn=null;cursor.phase='proximity';}
      if (worldService.isEnteringScene()) {
        // Don't go further as we're switching to another scene
        return;
      }

      input.clear();
      if(cursor && hooks?.compose) {
        cursor.phase='entry-compose';cursor.composition={site:'entry-compose',sceneId:currentSceneId,eventId:0xffff,eventIndex:null};
        yield hooks.compose(cursor);delete cursor.composition;cursor.phase='proximity';
      } else yield scene.makeScene();
    }

    if (cursor?.phase==='entry') cursor.phase='proximity';
    var viewportValue = cursor && cursor.phase==='proximity-return' ? cursor.viewport : getViewportSnapshot();
    var partyOffsetValue = cursor && cursor.phase==='proximity-return' ? cursor.partyOffset : getPartyOffsetSnapshot();
    var sceneEventObjects = sceneEventAdapter.getEventObjects();

    if (cursor && cursor.phase==='proximity' && !cursor.eventIds.length) cursor.eventIds=sceneEventObjects.filter(e=>e.id!==null).map(e=>e.id!);
    if (cursor) sceneEventObjects=orderWorldCursorEntries(sceneEventObjects,cursor,id=>sceneEventAdapter.getEventObjectEntryById(id)) as any;
    for (var ei = cursor ? cursor.index : 0; (!cursor || cursor.phase==='proximity' || cursor.phase==='proximity-return' || cursor.phase==='proximity-compose') && ei < sceneEventObjects.length; ei++) {
      if (cursor) cursor.index=ei+1;
      var entry = sceneEventObjects[ei];
      if (!entry) continue;
      var eventObjectID = entry.id;
      if (eventObjectID === null) continue;
      var eventIndex = cursor?.phase==='proximity-compose' ? cursor.composition!.eventIndex : entry.index;
      const resumingCompose=cursor?.phase==='proximity-compose';
      var obj: any = resumingCompose ? hooks!.resolveComposition!(cursor!) : entry.state;

      if (!obj) {
        continue;
      }

      if (!resumingCompose && cursor?.phase!=='proximity-return' && obj.vanishTime !== 0) {
        // As in SDLPAL: count the vanish time down and skip this object for the
        // rest of this frame, even when it just reached zero.
        worldService.mutateEventObjectById(eventObjectID, function(eventObject: any) {
          if (eventObject && eventObject.vanishTime !== 0) {
            eventObject.vanishTime += (eventObject.vanishTime < 0 ? 1 : -1);
          }
          return eventObject;
        });
        continue;
      }

      if (!resumingCompose && cursor?.phase!=='proximity-return' && obj.state < 0) {
        if (obj.x < PAL_X(viewportValue) ||
            obj.x > PAL_X(viewportValue) + 320 ||
            obj.y < PAL_Y(viewportValue) ||
            obj.y > PAL_Y(viewportValue) + 320) {
          var updatedState = worldService.mutateEventObjectById(eventObjectID, (evt: any) => {
            evt.state = abs(evt.state);
            evt.currentFrameNum = 0;
            return evt;
          });
          if (updatedState) {
            obj = updatedState;
          } else {
            obj = sceneEventAdapter.getEventObjectStateByIndex(eventIndex);
          }
        }
      } else if (resumingCompose || cursor?.phase==='proximity-return' || (obj.state > 0 && obj.triggerMode >= TriggerMode.TouchNear)) {
        var heroX = PAL_X(viewportValue) + PAL_X(partyOffsetValue);
        var heroY = PAL_Y(viewportValue) + PAL_Y(partyOffsetValue);
        if (resumingCompose || cursor?.phase==='proximity-return' || abs(heroX - obj.x) + abs(heroY - obj.y) * 2 <
            (obj.triggerMode - TriggerMode.TouchNear) * 32 + 16) {
          if (resumingCompose || (cursor?.phase!=='proximity-return' && obj.spriteFrames)) {
            if(!resumingCompose) {
              var mutatedState = worldService.mutateEventObjectById(eventObjectID, (evt: any) => {
                evt.currentFrameNum = 0;
                var xOffset = heroX - evt.x;
                var yOffset = heroY - evt.y;
                if (xOffset > 0) {
                  evt.direction = (yOffset > 0 ? Direction.East : Direction.North);
                } else {
                  evt.direction = (yOffset > 0 ? Direction.South : Direction.West);
                }
                return evt;
              });
              if (mutatedState) {
                obj = mutatedState;
              } else {
                obj = sceneEventAdapter.getEventObjectStateByIndex(eventIndex);
              }

              // SDLPAL only refreshes the gestures here; moving the party as well made it take
              // an extra step into the trigger before the script ran.
              scene.updatePartyGestures(false, null);
            }
            if(cursor && hooks?.compose) {
              cursor.index=ei;
              if(!resumingCompose) {
                cursor.phase='proximity-compose';
                cursor.composition={site:'proximity-compose',sceneId:currentSceneId,eventId:eventObjectID,eventIndex};
              }
              if(!(resumingCompose && resumedProximityCompose))yield hooks.compose(cursor,obj);
            } else yield scene.makeScene();
            if(!(resumingCompose && resumedProximityCompose))surface.updateScreen(null);

            viewportValue = getViewportSnapshot();
            partyOffsetValue = getPartyOffsetSnapshot();
            heroX = PAL_X(viewportValue) + PAL_X(partyOffsetValue);
            heroY = PAL_Y(viewportValue) + PAL_Y(partyOffsetValue);
          }

          // aigg-mud-pal new timeline: this event object IS an AI NPC →
          // greet it via the PAL server (the reply arrives as an injected AI
          // line); its canon trigger script never runs.
          const aiNpc = timelineActive() ? aiNpcForEvent(eventObjectID) : null;
          if (aiNpc) {
            if (cursor) throw new ManualExecutionSignal({status:'unsupported',reason:'World AI chat cannot be manually resumed'});
            // free-text live play: open the talk box — whatever the player
            // types goes to the PAL server; the reply renders in the game's
            // own dialog box via the say→inject pipeline.
            openWorldChat({ npcId: aiNpc.npcId, name: aiNpc.name });
            console.log('[PLAY] 新时间线: 与 AI NPC 攀谈 →', aiNpc.name ?? aiNpc.npcId);
            continue;
          }
          if (cursor) {cursor.index=ei;cursor.viewport=viewportValue;cursor.partyOffset=partyOffsetValue;}
          if(cursor?.composition) {
            // Read the retained native alias after render, then pin and release
            // synchronously. Replacement/removal never changes this selection.
            cursor.pendingReturn={kind:'trigger',entry:obj.triggerScript,eventId:eventObjectID,field:'triggerScript'};
            cursor.phase='proximity-return';hooks!.releaseComposition!(cursor);delete cursor.composition;
          }
          var updatedTrigger = yield invoke('trigger',cursor?.phase==='proximity-return'?cursor.pendingReturn!.entry:obj.triggerScript,eventObjectID,'triggerScript');
          var resolvedTrigger = Number.isFinite(updatedTrigger) ? updatedTrigger : 0;
          // The continuation is written back whether or not the script "succeeded" (SDLPAL);
          // scripts that end via 0x0041 or a failed check still move on to their next entry.
          var triggerState: any = worldService.mutateEventObjectById(eventObjectID, (evt: any) => {
            if (evt) {
              evt.triggerScript = resolvedTrigger;
            }
            return evt;
          });
          if (triggerState) {
            obj = triggerState;
          } else {
            obj = sceneEventAdapter.getEventObjectStateByIndex(eventIndex);
          }
          if (cursor) {cursor.pendingReturn=null;cursor.phase='proximity';cursor.index=ei+1;}
          if (!obj) {
            continue;
          }
          input.clear();

          if (worldService.isEnteringScene()) {
            return;
          }
        }
      }
    }
  }

  if (cursor && (cursor.phase==='entry' || cursor.phase==='proximity')) {cursor.phase='auto';cursor.index=0;cursor.eventIds=sceneEventAdapter.getEventObjects().filter(e=>e.id!==null).map(e=>e.id!);}
  var viewportCurrent = cursor?.phase==='auto-return' ? cursor.viewport : getViewportSnapshot();
  var partyOffsetCurrent = cursor?.phase==='auto-return' ? cursor.partyOffset : getPartyOffsetSnapshot();
  var sceneObjects = sceneEventAdapter.getEventObjects();

  if (cursor) sceneObjects=orderWorldCursorEntries(sceneObjects,cursor,id=>sceneEventAdapter.getEventObjectEntryById(id)) as any;
  for (var index = cursor ? cursor.index : 0; index < sceneObjects.length; index++) {
    if (cursor) cursor.index=index+1;
    var currentEntry = sceneObjects[index];
    if (!currentEntry || !currentEntry.state) {
      continue;
    }
    var currentIdx = currentEntry.index;
    var currentEventId = currentEntry.id;
    if (currentEventId === null) continue;
    var currentObj: any = currentEntry.state;

    if (cursor?.phase==='auto-return' || (currentObj.state > 0 && currentObj.vanishTime === 0)) {
      var autoScriptEntry = cursor?.phase==='auto-return' ? cursor.pendingReturn!.entry : currentObj.autoScript;
      if (cursor?.phase==='auto-return' || autoScriptEntry !== 0) {
        if (cursor) {cursor.index=index;cursor.viewport=viewportCurrent;cursor.partyOffset=partyOffsetCurrent;}
        var autoScriptResult = yield invoke('auto',autoScriptEntry,currentEntry.id!,'autoScript');
        var resolvedAutoScript = Number.isFinite(autoScriptResult) ? autoScriptResult : 0;
        var updatedAutoScript = worldService.mutateEventObjectById(currentEventId, (evt: any) => {
          if (evt) {
            evt.autoScript = resolvedAutoScript;
          }
          return evt;
        });
        if (updatedAutoScript) {
          currentObj = updatedAutoScript;
        } else {
          currentObj = sceneEventAdapter.getEventObjectStateByIndex(currentIdx);
        }
        if (cursor) {cursor.pendingReturn=null;cursor.phase='auto';cursor.index=index+1;}
        if (!currentObj) {
          continue;
        }
        if (worldService.isEnteringScene()) {
          return;
        }
      }
    }

    if (trigger && currentObj.state >= ObjectState.Blocker && currentObj.spriteNum !== 0) {
      var heroPosX = PAL_X(viewportCurrent) + PAL_X(partyOffsetCurrent);
      var heroPosY = PAL_Y(viewportCurrent) + PAL_Y(partyOffsetCurrent);
      if (abs(currentObj.x - heroPosX) + abs(currentObj.y - heroPosY) * 2 <= 12) {
        var dir = (currentObj.direction + 1) % 4;
        for (var attempt = 0; attempt < 4; attempt++) {
          heroPosX = PAL_X(viewportCurrent) + PAL_X(partyOffsetCurrent);
          heroPosY = PAL_Y(viewportCurrent) + PAL_Y(partyOffsetCurrent);
          var targetX = heroPosX + ((dir === Direction.West || dir === Direction.South) ? -16 : 16);
          var targetY = heroPosY + ((dir === Direction.West || dir === Direction.North) ? -8 : 8);
          var targetPos = PAL_XY(targetX, targetY);

          if (!scene.checkObstacleWithRange(targetPos, true, 0)) {
            worldService.setViewport(PAL_XY(
              PAL_X(targetPos) - PAL_X(partyOffsetCurrent),
              PAL_Y(targetPos) - PAL_Y(partyOffsetCurrent)
            ));
            viewportCurrent = getViewportSnapshot();
            partyOffsetCurrent = getPartyOffsetSnapshot();
            break;
          }

          dir = (dir + 1) % 4;
        }
      }
    }
  }

  // As in SDLPAL, wChasespeedChangeCycles is a WORD decremented on every
  // update (with or without triggers); the range resets only when it hits 0.
  var remainingCycles = (getChaseSpeedChangeCycles() - 1) & 0xFFFF;
  worldService.setChaseSpeedChangeCycles(remainingCycles);
  if (remainingCycles === 0) {
    worldService.setChaseRange(1);
  }

  worldService.incrementFrameCount(1);
  if (cursor) cursor.phase='done';
}
play.update = originalWorldUpdate;
/** Routes existing private hooks through the lexical native body; it issues no proof. */
export function invokeRewardWorldUpdate(trigger:boolean,cursor:WorldUpdateCursor|undefined,hooks:WorldUpdateHooks):Generator<any,any,any> {
 if(!rewardWorldEntryConsumer)throw new Error('Native battle task is opaque: World entry provenance unavailable');
 rewardWorldEntryConsumer(hooks);
 return originalWorldUpdate(trigger,cursor,hooks,rewardWorldEntryMarker);
}

/**
 * Allow player use an item in the game.
 */
play.useItem = function*(): Generator<any, any, any> {
  while (true){
    var object = yield itemmenu.itemSelectMenu(null, ItemFlag.Usable);

    if (object === 0) {
      return;
    }

    var objectState = scriptObjectAdapter.getObjectEntry(object);
    if (!objectState || !objectState.item) {
      continue;
    }

    if (!(objectState.item.flags & ItemFlag.ApplyToAll)) {
      // Select the player to use the item on
      while (true) {
        var player = yield getUIGame().itemUseMenu(object);

        if (player == ui.MENUITEM_VALUE_CANCELLED) {
          break;
        }
        // Run the script
        var currentScript = objectState.item.scriptOnUse;
        var nextScript = yield script.runTriggerScript(currentScript, player);
        worldService.mutateObjectEntry(object, (entry) => {
          if (entry && entry.item) {
            entry.item.scriptOnUse = nextScript;
          }
          return entry;
        });
        // Remove the item if the item is consuming and the script succeeded
        var updatedState = scriptObjectAdapter.getObjectEntry(object);
        if (updatedState && updatedState.item && (updatedState.item.flags & ItemFlag.Consuming) && script.scriptSuccess) {
          script.addItemToInventory(object, -1);
        }
        objectState = scriptObjectAdapter.getObjectEntry(object);
      }
    } else {
      // Run the script
      var currentScriptAll = objectState.item.scriptOnUse;
      var nextScriptAll = yield script.runTriggerScript(currentScriptAll, 0xFFFF);
      worldService.mutateObjectEntry(object, (entry) => {
        if (entry && entry.item) {
          entry.item.scriptOnUse = nextScriptAll;
        }
        return entry;
      });

      // Remove the item if the item is consuming and the script succeeded
      var refreshedState = scriptObjectAdapter.getObjectEntry(object);
      if (refreshedState && refreshedState.item && (refreshedState.item.flags & ItemFlag.Consuming) && script.scriptSuccess) {
        script.addItemToInventory(object, -1);
      }

      return;
    }
  }
};

/**
 * Allow player equip an item in the game.
 */
play.equipItem = function*(): Generator<any, any, any> {
  while (true) {
    var object = yield itemmenu.itemSelectMenu(null, ItemFlag.Equipable);

    if (object === 0) {
       return;
    }

    var objectEntry = scriptObjectAdapter.getObjectEntry(object);
    if (!objectEntry) {
      continue;
    }

    yield getUIGame().equipItemMenu(object);
  }
};

/**
 * Process searching trigger events.
 */
play.search = function*(): Generator<any, any, any> {
  var x, y, xOffset, yOffset, dx, dy, dh, ex, ey, eh, i, k, l, p: any;
  var poses = [];

  // Get the party location
  var viewport = getViewportSnapshot();
  var partyOffset = getPartyOffsetSnapshot();
  var partyDirection = getPartyDirectionSnapshot();
  x = PAL_X(viewport) + PAL_X(partyOffset);
  y = PAL_Y(viewport) + PAL_Y(partyOffset);
  if (partyDirection == Direction.North || partyDirection == Direction.East) {
    xOffset = 16;
  } else {
    xOffset = -16;
  }

  if (partyDirection == Direction.East || partyDirection == Direction.South) {
    yOffset = 8;
  } else {
    yOffset = -8;
  }

  poses[0] = PAL_XY(x, y);

  for (i = 0; i < 4; i++) {
    poses[i * 3 + 1] = PAL_XY(x + xOffset, y + yOffset);
    poses[i * 3 + 2] = PAL_XY(x, y + yOffset * 2);
    poses[i * 3 + 3] = PAL_XY(x + 2 * xOffset, y);
    x += xOffset;
    y += yOffset;
  }

  var currentSceneId = getSceneIdSnapshot() || 0;
  var sceneData = getSceneEntrySnapshot(currentSceneId);
  var eventRange = getSceneEventObjectRangeSnapshot();
  var rangeStart = eventRange && Number.isFinite(eventRange.start) ? eventRange.start : 0;
  var rangeEnd = eventRange && Number.isFinite(eventRange.end) ? eventRange.end : rangeStart;
  var partyMembers = worldService.getParty();
  for (i = 0; i < 13; i++) {
    // Convert to map location
    dh = ((PAL_X(poses[i]) % 32) ? 1 : 0);
    dx = ~~(PAL_X(poses[i]) / 32);
    dy = ~~(PAL_Y(poses[i]) / 16);

    // Loop through all event objects
    for (k = rangeStart; k < rangeEnd; k++){
      var eventId = k + 1;
      p = sceneEventAdapter.getEventObjectStateByIndex(k);
      if (!p) {
        continue;
      }
      ex = ~~(p.x / 32);
      ey = ~~(p.y / 16);
      eh = ((p.x % 32) ? 1 : 0);

      if (p.state <= 0 || p.triggerMode >= TriggerMode.TouchNear ||
          p.triggerMode * 6 - 4 <= i || dx != ex || dy != ey || dh != eh) {
        continue;
      }

      // Adjust direction/gesture for party members and the event object
      if (p.spriteFrames * 4 > p.currentFrameNum) {
        worldService.mutateEventObjectById(eventId, (evt: any) => {
          evt.currentFrameNum = 0;
          evt.direction = (partyDirection + 2) % 4;
          return evt;
        });

        // Party members only: follower slots after wMaxPartyMemberIndex keep their gesture.
        var maxPartyIndex = worldService.getMaxPartyMemberIndex();
        for (l = 0; l <= maxPartyIndex && l < partyMembers.length; l++) {
          worldService.mutatePartyMember(l, (member) => {
            if (member) {
              member.frame = partyDirection * 3;
            }
            return member;
          });
        }

        // Redraw everything
        yield scene.makeScene();
        surface.updateScreen(null);
      }

      // aigg-mud-pal new timeline: a searched AI NPC opens the free-text talk
      // box (the NPC has already turned to face the player above); its canon
      // trigger script never runs.
      const searchedAiNpc = timelineActive() ? aiNpcForEvent(eventId) : null;
      if (searchedAiNpc) {
        openWorldChat({ npcId: searchedAiNpc.npcId, name: searchedAiNpc.name });
        console.log('[PLAY] 新时间线: 与 AI NPC 攀谈 →', searchedAiNpc.name ?? searchedAiNpc.npcId);
      } else {
      // Execute the script
      var nextTriggerScript = yield script.runTriggerScript(p.triggerScript, eventId);
      worldService.mutateEventObjectById(eventId, (evt: any) => {
        evt.triggerScript = nextTriggerScript;
        return evt;
      });
      }

      // Clear inputs and delay for a short time
      yield sleep(50); // WARNING param normalize
      input.clear();

      return; // don't go further
    }
  }

  // aigg-mud-pal new timeline: nothing canon answered the search — try the
  // OVERLAY NPCs (the wanderers + the all-overlay townsfolk). Proximity is a
  // friendly radius (no facing math): stand beside them and press search.
  if (timelineActive()) {
    const vp2 = getViewportSnapshot();
    const po2 = getPartyOffsetSnapshot();
    const px = PAL_X(vp2) + PAL_X(po2);
    const py = PAL_Y(vp2) + PAL_Y(po2);
    const sceneNow = getSceneIdSnapshot() || 0;
    for (const entry of getOverlayEntriesForScene(Number(sceneNow))) {
      const ex2 = Number(entry.state.x), ey2 = Number(entry.state.y);
      if (Math.abs(ex2 - px) <= 64 && Math.abs(ey2 - py) <= 48) {
        const info2 = overlayInfoFor(entry.id);
        if (info2) {
          openWorldChat({ npcId: info2.npcId, name: info2.name });
          console.log('[PLAY] 新时间线: 与 overlay NPC 攀谈 →', info2.name ?? info2.npcId);
          break;
        }
      }
    }
  }
  input.clear();
};

/**
 * PAL_ReloadInNextTick: the game is loaded by the next res.loadResources (kLoadGlobalData).
 * Used for a new game, the system menu "load game" and script 0x004E.
 */
play.reloadInNextTick = function(slot: number) {
  battleCommandRuntime.invalidate('reload requested');
  worldService.setCurrentSaveSlot(slot);
  res.saveSlot = slot;
  res.setLoadFlags(LoadFlag.GlobalData | LoadFlag.Scene | LoadFlag.PlayerSprite);
  worldService.setEnteringScene(true);
  worldService.setNeedToFadeIn(true);
  worldService.setFrameCount(0);
};

/**
 * Starts a video frame. Called once per video frame.
 */
play.startFrame =function*(): Generator<any, any, any> {
  if (!play._startLogged) {
    console.log('[PLAY] startFrame enter');
    play._startLogged = true;
  }
  // Ensure viewport and party offset are sane to avoid off-screen rendering artifacts.
  const defaultViewport = PAL_XY(0, 0);
  const defaultPartyOffset = PAL_XY(160, 112);
  // Map 12 has actual content around tiles x=13..42, y=11..31; start near that area to avoid blank view.
  const contentViewport = PAL_XY(13 * 32, 11 * 16);
  const forceViewport = typeof window !== 'undefined' && (window as any).PAL_FORCE_VIEWPORT === true;
  if (forceViewport && (!Number.isFinite(getViewportSnapshot()) || getViewportSnapshot() === 0)) {
    worldService.setViewport(contentViewport);
  }
  const currentOffset = getPartyOffsetSnapshot();
  const offsetX = PAL_X(currentOffset);
  const offsetY = PAL_Y(currentOffset);
  if (!Number.isFinite(currentOffset) || offsetX < 0 || offsetX > 320 || offsetY < 0 || offsetY > 200) {
    worldService.setPartyOffset(defaultPartyOffset);
  }
  // Run the game logic of one frame
  yield play.update(true);
  // M2 D4:一帧的逻辑跑完,把事件对象 / 场景 / 物件表里变了的条目抓进组件(含 script-runner 直接改字段的)
  worldService.captureWorldTables();

  if (clearStaleFbpOverlay('startFrame')) {
    yield scene.makeScene();
    surface.updateScreen(null);
  }

  const isEnteringScene = worldService.isEnteringScene();
  console.log('[PLAY] startFrame before makeScene', {
    isEnteringScene,
    sceneId: getSceneIdSnapshot(),
    willCallMakeScene: !isEnteringScene
  });

  // As in PAL_StartFrame: a scene change requested during this frame's update is loaded at the
  // start of the next frame, so skip moving, drawing and the menu keys until then (movement
  // here would still collide against the old map). Scripts that animate NPCs redraw the scene
  // themselves (that used to be broken: script-runner awaited scene.makeScene without running it,
  // which is why this early return had been removed).
  if (isEnteringScene) {
    return;
  }

 // Update the positions and gestures of party members
  scene.updateParty();

  // Update the scene
  console.log('[PLAY] startFrame: calling makeScene');
  yield scene.makeScene();
  if (!play._debugLogged) {
    console.debug('[PLAY] first frame', {
      sceneId: getSceneIdSnapshot(),
      viewport: getViewportSnapshot(),
      partyOffset: getPartyOffsetSnapshot(),
      bufferSample: surface && surface.byteBuffer ? surface.byteBuffer[0] : null
    });
    play._debugLogged = true;
  }
  surface.updateScreen(null);
  if (!play._bufferLogged) {
    const buf = surface && surface.byteBuffer;
    if (buf && buf.length) {
      let nonZero = 0;
      const sample: any[] = [];
      for (let i = 0; i < Math.min(buf.length, 64); i++) {
        const v = buf[i];
        if (v) nonZero += 1;
        if (i < 16) sample.push(v);
      }
      console.debug('[PLAY] buffer sample', { nonZero, first16: sample });
    }
    play._bufferLogged = true;
  }

  if (input.isKeyPressed(Key.Menu)) {
    // Show the in-game menu
    yield getUIGame().inGameMenu();
  } else if (input.isKeyPressed(Key.UseItem)) {
    // Show the use item menu
    yield play.useItem();
  } else if (input.isKeyPressed(Key.ThrowItem)) {
    // Show the equipment menu
    yield play.equipItem();
  } else if (input.isKeyPressed(Key.Force)) {
    // Show the magic menu
    yield getUIGame().inGameMagicMenu();
  } else if (input.isKeyPressed(Key.Status)) {
    // Show the player status
    yield getUIGame().playerStatus();
  } else if (input.isKeyPressed(Key.Search)) {
    // Process search events
    yield play.search();
  } else if (input.isKeyPressed(Key.Flee)) {
    // Quit Game
    if (yield getUIGame().confirmMenu()) {
      //music.play(0, false, 2);
      yield surface.fadeOut(2);
      //shutdown();

      //PAL_PlayMUS(0, FALSE, 2);
      //PAL_FadeOut(2);
      //PAL_Shutdown();
      //exit(0);
    }
  }

};

export default play;
