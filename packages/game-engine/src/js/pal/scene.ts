import sceneService, {type SceneComposeFadeHook} from '../../services/scene-service';
import input from '../../services/input-service';
import { PAL_XY, PAL_X, PAL_Y, Scene } from './pal-global';

declare const global: any;

// Bridge for legacy global access
const scene = {
  init: function*(surf: any) {
    yield* sceneService.init(surf);
    if (typeof global !== 'undefined') global.scene = scene;
  },
  makeScene: function*(...[ownerFade]:[SceneComposeFadeHook?]) {
    if(ownerFade)yield* sceneService.makeScene(ownerFade);
    else yield* sceneService.makeScene();
  },
  getPlayerSprite: (i: number) => sceneService.getPlayerSprite(i),
  updateParty: () => {
    sceneService.updateParty(input.dir);
  },
  updatePartyGestures: (walking: boolean, options?: any) => sceneService.updatePartyGestures(walking, options),
  checkObstacle: (pos: number, checkEventObjects: boolean, selfObject: number) => sceneService.checkObstacle(pos, checkEventObjects, selfObject),
  checkObstacleWithRange: (pos: number, checkEventObjects: boolean, selfObject: number) => sceneService.checkObstacleWithRange(pos, checkEventObjects, selfObject),
  resetSceneCache: () => sceneService.resetSceneCache(),
  getApplyWaveIndex: () => sceneService.getApplyWaveIndex(),
  getWaveBinding: () => ({service:sceneService,surface:(sceneService as any).surface,apply:sceneService.applyWave,adapterApply:scene.applyWave,getIndex:sceneService.getApplyWaveIndex,index:sceneService.getApplyWaveIndex()}),
  applyWave: (buffer: Uint8Array) => sceneService.applyWave(buffer),
  loadEventObjectSprites: (version: number) => sceneService.loadEventObjectSprites(version),
  getEventObjectSprite: (eventObjectID: number) => sceneService.getEventObjectSprite(eventObjectID),
  addToDrawList: (frame: number, x: number, y: number, layer: number, meta: any) => sceneService.addToDrawList(frame, x, y, layer, meta),
  calcCoverTiles: (spriteToDraw: any) => sceneService.calcCoverTiles(spriteToDraw),
  getMap: () => sceneService.getMap(),
  renderMap: () => sceneService.renderMap(),
  renderSprites: (options: any) => sceneService.renderSprites(options),
  render: function*() {
    yield* sceneService.render();
  },
  // Properties that were directly accessed
  get surface() { return (sceneService as any).surface; },
  set surface(val) { (sceneService as any).surface = val; },
  get mapNum() { return (sceneService as any).mapNum; },
  set mapNum(val) { (sceneService as any).mapNum = val; },
  get currentSceneId() { return (sceneService as any).currentSceneId; },
  set currentSceneId(val) { (sceneService as any).currentSceneId = val; },
  get drawList() { return (sceneService as any).drawList; },
  set drawList(val) { (sceneService as any).drawList = val; },
  get eventObjectSprite() { return (sceneService as any).eventObjectSprite; },
  set eventObjectSprite(val) { (sceneService as any).eventObjectSprite = val; },
  get playerSpriteCache() { return (sceneService as any).playerSpriteCache; },
  get mapCache() { return (sceneService as any).mapCache; },
};

// Extend Scene prototype if it exists globally
if (typeof Scene !== 'undefined' && Scene.prototype) {
    (Scene.prototype as any).render = function*() {
        yield* sceneService.render();
    };
}

// Fixed installed wrapper and underlying coroutine methods; no function-body
// branding or registration of arbitrary replacement generators.
const generatedSceneCapability=Object.freeze({scene,service:sceneService,makeScene:scene.makeScene,updatePartyGestures:scene.updatePartyGestures,serviceMakeScene:sceneService.makeScene,serviceRender:sceneService.render,serviceGestures:sceneService.updatePartyGestures});
export function getGeneratedSceneCapability(){return generatedSceneCapability;}
export default scene;
