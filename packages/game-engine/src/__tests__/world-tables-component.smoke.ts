/**
 * 事件对象 / 场景条目 / 物件条目组件(docs/specs/agent-pal-m2.md D4,写穿 + 帧边界捕获)。不起引擎、不要资产。
 *
 * 守住:写口结束时组件 = 该条目的字节;script-runner 式的直接改字段在帧边界(captureWorldTables)进组件;
 * 没变的条目不记变更日志;场景 / 物件表经 gameDataChanged 抓。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:world-tables-component
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { EventObjectComponent, SceneTableComponent, ObjectTableComponent } from '../ecs/components/world-tables';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const EventObject = g.EventObject, Scene = g.Scene, ObjectUnion = g.ObjectUnion;

const events = Array.from({ length: 5 }, () => new EventObject(new Uint8Array(EventObject.size)));
worldService.setSceneTable([new Scene(new Uint8Array(Scene.size)), new Scene(new Uint8Array(Scene.size))] as any);
worldService.setEventObjectTable(events as any);
worldService.setObjectTable([new ObjectUnion(new Uint8Array(ObjectUnion.size))] as any);

const w = worldService.getWorldWriter();
const entityOf = (i: number) => (worldService as any).entityMaps.eventObject.get(i);
const evtWords = (i: number) => w.get(entityOf(i), EventObjectComponent)!.words;

// ---- 写口:立即抓这一条 ------------------------------------------------------------------
worldService.mutateEventObject(2, (e: any) => { e.x = 640; e.state = -1; return e; });
assert.equal(evtWords(2)[1], 640, 'x');
assert.equal(evtWords(2)[6], 0xffff, 'state = -1 is stored as the 16-bit word, like the save bytes');

// ---- 直接改字段(script-runner 的写法):帧边界才进组件 ---------------------------------------
events[4].scriptIdleFrameCountAuto = 7;
events[4].triggerMode = 3;
assert.equal(evtWords(4)[15], 0, 'not captured before the frame boundary');
worldService.captureWorldTables();
assert.equal(evtWords(4)[15], 7);
assert.equal(evtWords(4)[7], 3);

const seq = w.lastSeq;
worldService.captureWorldTables();                                  // 什么都没变
assert.equal(w.lastSeq, seq, 'an unchanged frame records nothing');

// ---- 场景 / 物件表 -------------------------------------------------------------------------
worldService.mutateSceneEntry(2, (s: any) => { s.scriptOnEnter = 0x1234; return s; });
assert.equal(w.get(w.world(), SceneTableComponent)!.words[4 + 1], 0x1234, 'scene 2 scriptOnEnter');
worldService.setObjectScriptValue(0, 3, 0x0bad);
assert.equal(w.get(w.world(), ObjectTableComponent)!.words[3], 0x0bad, 'object 0 word 3 (opcode 0x90)');
assert.equal(stateService.getGameData('object')[0].magic.scriptOnUse, 0x0bad);

console.log('world-tables-component: ok');
