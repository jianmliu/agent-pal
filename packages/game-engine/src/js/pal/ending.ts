import resourceService from '../../services/resource-service';
import worldService from '../../services/world-service';
import Sprite from './sprite';
import scene from './scene';
import {
  shouldFadeIn,
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled
} from '../../services/environment-adapter';
import { Files } from './pal-global';
import Palette from './palette';
import input from './input';
import { log, sleep, hrtime, PAL_XY, RECT } from './common';

log.trace('script module load');

var surface: any;
var screen: any;
var initGeneration = 0;

var ending: any = {
};

var curEffectSprite = 0;
var spriteCache: any = {};

function setLegacyCanvasVisible(show: boolean) {
  if (typeof document === 'undefined') {
    return;
  }
  const canvas = document.getElementById('cvs');
  if (canvas) {
    canvas.style.display = show ? '' : 'none';
  }
}

function enterFbpOverlayMode() {
  if (typeof window === 'undefined') {
    return;
  }
  const win = window as any;
  if (!win.PAL_FBP_ACTIVE) {
    win.PAL_FBP_ACTIVE = true;
    win.PAL_FBP_OVERLAY_PREV = win.PAL_OVERLAY_ACTIVE || win.PAL_OVERLAY_PREFERENCE || 'off';
  }
  if (typeof win.PAL_SET_OVERLAY_MODE === 'function') {
    win.PAL_SET_OVERLAY_MODE('off');
  }
  if (win.PAL_PANORAMA_DIALOG && typeof win.PAL_PANORAMA_DIALOG.setMode === 'function') {
    win.PAL_PANORAMA_DIALOG.setMode('off');
  }
  setLegacyCanvasVisible(true);
}

ending.init = function*(surf: any) {
  log.debug('[ENDING] init');
  (globalThis as any).ending = ending;
  initGeneration++;
  surface = surf;
  screen = surface.byteBuffer;
  yield resourceService.loadMKF('FBP', 'MGO');
  Files.FBP = resourceService.getMKF('FBP');
  Files.MGO = resourceService.getMKF('MGO');
};

/**
 * Set the effect sprite of the ending.
 * @param  {Number} spriteNum the number of the sprite.
 */
ending.setEffectSprite = function(spriteNum: number) {
  log.debug(['ending.setEffectSprite', spriteNum].join(' '));
  curEffectSprite = spriteNum;
};

/**
 * Draw an FBP picture to the screen.
 * @param  {Number} chunkNum number of chunk in fbp.mkf file.
 * @param  {Number} fade     fading speed of showing the picture.
 */
/** Native operations shared with the owned background-only source. */
ending.getShowBinding = () => ({surface, screen, reader: Files.FBP, decompress: Files.FBP?.decompressChunk});
ending.getEffectSpriteId = () => curEffectSprite;
ending.beginShowFBP = function(chunkNum: number, fade: number) {
  log.debug(['ending.showFBP', chunkNum, fade].join(' '));
  enterFbpOverlayMode();
  const debugFBP = typeof globalThis !== 'undefined' && (globalThis as any).PAL_DEBUG_FBP === true;
  let bitmap = Files.FBP.decompressChunk(chunkNum);
  if (!bitmap) bitmap = new Uint8Array(320 * 200);
  let p = null;
  const fading = !!fade;
  if (fading) {
    fade++;
    fade *= 10;
    p = surface.getRect(0, 0, 320, 200);
    surface.blit(bitmap, p);
    surface.backupScreen();
  }
  return {bitmap, p, debugFBP, fading, effectiveFade: fade};
};
ending.showFBPBackgroundStep = function(p: any, step: number) {
  const i = Math.floor(step / 6), j = step % 6, indices = [0, 3, 1, 5, 2, 4];
  for (let k = indices[j]; k < surface.pitch * surface.height; k += 6) {
    const a = p[k];
    let b = surface.backup[k];
    if (i > 0) {
      if ((a & 0x0F) > (b & 0x0F)) b++;
      else if ((a & 0x0F) < (b & 0x0F)) b--;
    }
    surface.backup[k] = (a & 0xF0) | (b & 0x0F);
  }
  surface.blitSurface(surface.backup, null, screen, null);
};
ending.finishShowFBP = function(chunkNum: number, fade: number, bitmap: any, debugFBP: boolean) {
  if (chunkNum !== 0x0031) surface.blit(bitmap);
  surface.updateScreen(null);
  if (debugFBP) {
    const sample = Array.from(bitmap.slice(0, 8));
    const screenSample = Array.from(surface.byteBuffer.slice(0, 8));
    console.warn('[FBP] showFBP rendered', { chunkNum, fade, sample, screenSample });
  }
  if (surface && typeof surface.backupScreen === 'function') surface.backupScreen();
  if (typeof globalThis !== 'undefined' && (globalThis as any).ui?.invalidateDialogBackup) {
    (globalThis as any).ui.invalidateDialogBackup('ending.showFBP');
  }
};
/** Owned caller supplies the declared root clock; native helper keeps lexical hrtime. */
ending.peekCachedShowEffect = (id:number)=>id in spriteCache?spriteCache[id]:undefined;
ending.drawOwnedShowEffect = function(sample:()=>number,bind:(sprite:any,id:number)=>void) {
  const id=curEffectSprite,sprite=getSprite(id);
  bind(sprite,id);
  const f=~~(sample()/150);
  if(sprite){const frame=sprite.getFrame(f%sprite.frameCount);surface.blitRLE(frame,PAL_XY(0,0));}
};
ending.showFBP = function*(chunkNum: number, fade: number) {
  const {bitmap, p, debugFBP, fading, effectiveFade} = ending.beginShowFBP(chunkNum, fade);
  fade = effectiveFade;
  if (fading) {
    for (let step = 0; step < 96; step++) {
      ending.showFBPBackgroundStep(p, step);
      if (curEffectSprite != 0) {
        const sprite = getSprite(curEffectSprite);
        const f = ~~(hrtime() / 150);
        if (sprite) {
          const frame = sprite.getFrame(f % sprite.frameCount);
          surface.blitRLE(frame, PAL_XY(0, 0));
        }
      }
      surface.updateScreen(null);
      yield sleep(fade);
    }
  }
  ending.finishShowFBP(chunkNum, fade, bitmap, debugFBP);
};

/**
 * Scroll up an FBP picture to the screen.
 * @param {Number} chunkNum      number of chunk in fbp.mkf file.
 * @param {Number} scrollSpeed   scrolling speed of showing the picture.
 * @param {Boolean} scrollDown   true if scroll down, false if scroll up.
 */
ending.getScrollBinding = () => ({...ending.getShowBinding(),initGeneration,resourceGeneration:resourceService.getBindingGeneration(),begin:ending.beginScrollFBP,step:ending.scrollFBPBackgroundStep,finish:ending.finishScrollFBP,scene:scene.getWaveBinding()});
ending.beginScrollFBP = function(chunkNum:number,scrollSpeed:number,scrollDown:boolean) {
  log.debug(['ending.scrollFBP', chunkNum, scrollSpeed, scrollDown].join(' '));
  enterFbpOverlayMode();
  const debugFBP = typeof globalThis !== 'undefined' && (globalThis as any).PAL_DEBUG_FBP === true;
  var bitmap = Files.FBP.decompressChunk(chunkNum);
  if (!bitmap) {
    bitmap = new Uint8Array(320 * 200);
  }

  var p = surface.getRect(0, 0, 320, 200);
  surface.backupScreen();
  surface.blit(bitmap, p);

  if (scrollSpeed == 0) {
    scrollSpeed = 1;
  }

  var rect = new (RECT as any)(0, 0, 320, 200);
  var dstrect = new (RECT as any)(0, 0, 320, 200);

  rect.x = 0;
  rect.w = 320;
  dstrect.x = 0;
  dstrect.w = 320;

  return {bitmap,p,debugFBP,scrollSpeed,scrollDown,rect,dstrect};
};
ending.scrollFBPBackgroundStep = function(p:any,l:number,scrollDown:boolean,rect:any,dstrect:any) {
    var i = l;
    if (i > 200) {
      i = 200;
    }

    if (scrollDown) {
      rect.y = 0;
      dstrect.y = i;
      rect.h = 200 - i;
      dstrect.h = 200 - i;
    } else {
       rect.y = i;
       dstrect.y = 0;
       rect.h = 200 - i;
       dstrect.h = 200 - i;
    }

    surface.blitSurface(surface.backup, rect, screen, dstrect);

    if (scrollDown) {
       rect.y = 200 - i;
       dstrect.y = 0;
       rect.h = i;
       dstrect.h = i;
    } else {
       rect.y = 0;
       dstrect.y = 200 - i;
       rect.h = i;
       dstrect.h = i;
    }

    surface.blitSurface(p, rect, screen, dstrect);

    scene.applyWave(screen);

 };
ending.finishScrollFBP = function(chunkNum:number,scrollSpeed:number,scrollDown:boolean,bitmap:any,p:any,debugFBP:boolean) {
  surface.putRect(p);
  surface.updateScreen(null);
  if (debugFBP) {
    const sample = Array.from(bitmap.slice(0, 8));
    const screenSample = Array.from(surface.byteBuffer.slice(0, 8));
    console.warn('[FBP] scrollFBP rendered', { chunkNum, scrollSpeed, scrollDown, sample, screenSample });
  }
  if (surface && typeof surface.backupScreen === 'function') {
    surface.backupScreen();
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).ui?.invalidateDialogBackup) {
    (globalThis as any).ui.invalidateDialogBackup('ending.scrollFBP');
  }
 };
ending.scrollFBP = function*(chunkNum:number,scrollSpeed:number,scrollDown:boolean) {
  const entry=ending.beginScrollFBP(chunkNum,scrollSpeed,scrollDown);
  scrollSpeed=entry.scrollSpeed;
  for(let l=0;l<220;l++) {
    ending.scrollFBPBackgroundStep(entry.p,l,scrollDown,entry.rect,entry.dstrect);
    if(curEffectSprite!=0) {
      const sprite=getSprite(curEffectSprite),f=~~(hrtime()/150);
      if(sprite)surface.blitRLE(sprite.getFrame(f%sprite.frameCount),PAL_XY(0,0));
    }
    surface.updateScreen(null);
    if(shouldFadeIn()) {yield surface.fadeIn(getPaletteIdSnapshot(),!!isNightPaletteEnabled(),1);worldService.setNeedToFadeIn(false);}
    yield sleep(800/scrollSpeed);
  }
  ending.finishScrollFBP(chunkNum,scrollSpeed,scrollDown,entry.bitmap,entry.p,entry.debugFBP);
};

/**
 * Show the ending animation.
 */
ending.getAnimationBinding = () => ({...ending.getScrollBinding(),begin:ending.beginAnimation,step:ending.animationStep,finish:ending.finishAnimation});
ending.beginAnimation = function() {
  log.debug(['ending.endingAnimation'].join(' '));
  var girlPos = 180;

  var upper = surface.getRect(0, 0, 320, 200);
  var lower = surface.getRect(0, 0, 320, 200);

  surface.blit(Files.FBP.decompressChunk(0x3d), upper); // 图片61
  surface.blit(Files.FBP.decompressChunk(0x3e), lower); // 图片62

  var sprite = getSprite(571);
  var girl = getSprite(572);

  var srcrect = new (RECT as any)(0, 0, 320, 200);
  var dstrect = new (RECT as any)(0, 0, 320, 200);
  srcrect.x = 0;
  dstrect.x = 0;
  srcrect.w = 320;
  dstrect.w = 320;

  worldService.setScreenWave(2);

  return {girlPos,upper,lower,sprite,girl,srcrect,dstrect};
};
ending.animationStep = function(entry:any,i:number,sample:()=>number) {
  const {upper,lower,sprite,girl,srcrect,dstrect}=entry;
    // Draw the background
    srcrect.y = 0;
    srcrect.h = 200 - ~~(i / 2);

    dstrect.y = ~~(i / 2);
    dstrect.h = 200 - ~~(i / 2);

    surface.blitSurface(lower, srcrect, screen, dstrect);

    srcrect.y = 200 - ~~(i / 2);
    srcrect.h = ~~(i / 2);

    dstrect.y = 0;
    dstrect.h = ~~(i / 2);

    surface.blitSurface(upper, srcrect, screen, dstrect);

    scene.applyWave(screen);

    // Draw the beast
    surface.blitRLE(sprite.getFrame(0), PAL_XY(0, -400 + i));
    surface.blitRLE(sprite.getFrame(1), PAL_XY(0, -200 + i));

    // Draw the girl
    entry.girlPos -= i & 1;
    if (entry.girlPos < 80) {
       entry.girlPos = 80;
    }

    var f = ~~(sample() / 50) % 4;
    surface.blitRLE(girl.getFrame(f), PAL_XY(220, entry.girlPos));

    // Update the screen
    surface.updateScreen(null);

 };
ending.finishAnimation = function() {worldService.setScreenWave(0);};
ending.endingAnimation = function*() {
  const entry=ending.beginAnimation();
  for(let i=0;i<400;i++) {
    ending.animationStep(entry,i,hrtime);
    if(shouldFadeIn()){yield surface.fadeIn(getPaletteIdSnapshot(),!!isNightPaletteEnabled(),1);worldService.setNeedToFadeIn(false);}
    yield sleep(50);
  }
  ending.finishAnimation();
};

function getSprite(n: number) {
  if (n === 0) return null;
  if (n in spriteCache) {
    return spriteCache[n];
  }
  var sprite = new Sprite(Files.MGO.decompressChunk(n));
  spriteCache[n] = sprite;
  return sprite;
}

/**
 * Build a Big5 text line from ASCII strings and Big5 byte sequences (hex).
 */
function creditsLine(parts: Array<string | { big5: string }>) {
  var bytes: number[] = [];
  parts.forEach(function(part) {
    if (typeof part === 'string') {
      for (var i = 0; i < part.length; i++) {
        bytes.push(part.charCodeAt(i) & 0x7F);
      }
    } else {
      for (var j = 0; j < part.big5.length; j += 2) {
        bytes.push(parseInt(part.big5.substr(j, 2), 16));
      }
    }
  });
  return new Uint8Array(bytes);
}

// Traditional Chinese lines of PAL_AdditionalCredits (the game data is Big5).
// SDLPAL prints its own build date (__DATE__) after "經典特別篇"; this port has no such
// date, so it is left out rather than made up.
var ADDITIONAL_CREDITS = [
  creditsLine(['  SDLPAL (http://sdlpal.github.io/)']),
  creditsLine(['         ', { big5: 'b867a8e5af53a74fbd67' } /* 經典特別篇 */]),
  creditsLine([' ']),
  creditsLine(['    (c) 2009-2011, Wei Mingzhi']),
  creditsLine(['        <whistler_wmz@users.sf.net>.']),
  creditsLine(['    (c) 2011-2026, SDLPAL Team']),
  creditsLine(['']),
  creditsLine(['']),
  creditsLine(['   ', { big5: 'a5bbb57ba6a1ac4fa6dba5d1b36ec5e9a141abf6b7d3' } /* 本程式是自由軟體，按照 */, ' GNU General']),
  creditsLine(['   Public License v3 ', { big5: 'a9cea7f3b0aaaaa9a5bbb56fa747' } /* 或更高版本發佈 */]),
  creditsLine(['']),
  creditsLine(['                    ...', { big5: 'abf6' } /* 按 */, ' Enter ', { big5: 'b5b2a7f4' } /* 結束 */])
];

/**
 * Show the additional credits (PAL_AdditionalCredits).
 */
ending.additionalCredits = function*(): Generator<any, any, any> {
  log.debug('ending.additionalCredits');
  var ui = (globalThis as any).ui;

  // PAL_DrawOpeningMenuBackground
  var bitmap = Files.FBP && Files.FBP.decompressChunk(ui ? ui.MAINMENU_BACKGROUND_FBPNUM : 60);
  if (bitmap) {
    surface.blit(bitmap);
  }
  surface.updateScreen(null);

  if (ui && typeof ui.drawText === 'function') {
    for (var i = 0; i < 12; i++) {
      ui.drawText(ADDITIONAL_CREDITS[i], PAL_XY(0, 2 + i * 16), ui.DESCTEXT_COLOR, true, false);
    }
  }

  surface.setPalette(Palette.get(0).day);
  surface.updateScreen(null);

  yield input.waitForKey(0);
};

export default ending;
