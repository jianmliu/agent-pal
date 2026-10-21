
/**
 * @module res
 * 地图/精灵在用时加载,这里只保留 PAL_LoadResources 里与资源无关的全局状态处理。
 */
import worldService from '../../services/world-service';
import music from './music';
import { LoadFlag, PAL_XY } from './pal-global';

var res = {
  loadFlag: 0,

  /**
   * PAL_InitGameData, registered by game.ts (importing game here would be circular).
   */
  initGameData: null as null | ((slot: number) => Generator<any, any, any>),

  /**
   * Slot for kLoadGlobalData (gpGlobals->bCurrentSaveSlot). Kept here because the stored
   * current save slot is clamped to 1-5, while slot 0 means a new game.
   */
  saveSlot: 0,

  /**
   * Set flags to load resources.
   * @param {number} flag flags to be set.
   */
  setLoadFlags: function(flag: number) {
    res.loadFlag |= flag;
  },

  /**
   * Load the game resources if needed.
   */
  loadResources: function*(): Generator<any, any, any> {
    if (res.loadFlag === 0) {
      return;
    }

    // Load global data
    if (res.loadFlag & LoadFlag.GlobalData) {
      if (!res.initGameData) {
        throw new Error('res.loadResources: initGameData is not registered');
      }
      yield res.initGameData(res.saveSlot);
      music.play(worldService.getMusicTrack(), true, 1);
    }

    if (res.loadFlag & LoadFlag.Scene) {
      if (worldService.isEnteringScene()) {
        worldService.setScreenWave(0);
        worldService.setWaveProgression(0);
      }
      // Free previous loaded scene (sprites and map)
      // Load map
      // Load sprites
      worldService.setPartyOffset(PAL_XY(160, 112));
    }
    if (res.loadFlag & LoadFlag.PlayerSprite) {
      // Free previous loaded player sprites
    }

    // Clear all of the load flags
    res.loadFlag = 0;
  }
};

export default res;
