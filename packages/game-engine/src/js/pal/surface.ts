import utils from './utils';
import {acquireOwnedCanvasPixels,createOwnedRetainedCanvas} from './owned-canvas-pixels';
import Palette, { type PaletteColor } from './palette';
import {
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled
} from '../../services/environment-adapter.js';

type AnyRecord = Record<string, any>;
type SurfaceBuffer = Uint8Array & { width?: number; height?: number };
type RectLike = { x: number; y: number; w: number; h: number; width?: number; height?: number };
type PanoramaHandler = {
  shouldCaptureUi?: () => boolean;
  isActive?: () => boolean;
  renderUiBuffer?: (rect: RectLike, surface: SurfaceInstance) => void;
};
type SurfaceInstance = AnyRecord & {
  cvs: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  pitch: number;
  debugcvs?: HTMLCanvasElement;
  debugctx?: CanvasRenderingContext2D | null;
  panoramaHandler: PanoramaHandler | null;
  len: number;
  palette: PaletteColor[];
  renderObjects: AnyRecord[];
  lastRefresh: number;
  alpha: number;
  byteBuffer: Uint8Array;
  backup: SurfaceBuffer;
  sceneUpdateHook?: (() => Generator<any, any, any>) | null;
};
type SurfaceCtor = {
  acquireOwnedCanvasPixels:typeof acquireOwnedCanvasPixels;
  createOwnedRetainedCanvas:typeof createOwnedRetainedCanvas;
  new (cvs: HTMLCanvasElement, width?: number, height?: number, debugcvs?: HTMLCanvasElement | null): SurfaceInstance;
  prototype: SurfaceInstance;
  shakeTime: number;
  shakeLevel: number;
};

const log = (globalThis as any).log || console;
declare const hrtime: () => number;
declare const timestamp: () => number;
declare const sleep: (ms: number) => Promise<void>;
declare const sleepByFrame: (frames: number) => Promise<void>;
declare const FrameTime: number;
declare const RECT: any;
declare const PAL_X: (pos: number) => number;
declare const PAL_Y: (pos: number) => number;
declare const PAL_XY: (x: number, y: number) => number;
declare const DEBUG: AnyRecord;
declare const $: any;

log.trace('surface module load');

const defaultPalette: PaletteColor[] = [];
for (var i=0; i<256; ++i) {
  var p: PaletteColor = { r: i, g: i, b: i };
  defaultPalette.push(p);
}

/**
 * 一个用于渲染的画布单位，被称为Surface
 * @constructor
 * @param  {Canvas} cvs
 */
const Surface = function(this: SurfaceInstance, cvs: HTMLCanvasElement, width?: number, height?: number, debugcvs?: HTMLCanvasElement | null) {
  this.cvs = cvs;
  this.ctx = cvs.getContext('2d') as CanvasRenderingContext2D;
  this.width = this.pitch = cvs.width = width || 320;
  this.height = cvs.height = height || 200;
  if (debugcvs) {
    this.debugcvs = debugcvs;
    debugcvs.width = (width || 320);
    debugcvs.height = (height || 200);
    this.debugctx = debugcvs.getContext('2d') as CanvasRenderingContext2D;
  }

  this.panoramaHandler = null;
  this.len = this.width * this.height;
  this.palette = defaultPalette;
  this.renderObjects = [];
  this.panoramaHandler = null;

  this.lastRefresh = hrtime();

  this.alpha = 1.0;
  this.byteBuffer = new Uint8Array(this.len);
  this.backup = new Uint8Array(this.len) as SurfaceBuffer;
  this.backup.width = this.width;
  this.backup.height = this.height;

  this.clear();
} as unknown as SurfaceCtor;

Surface.shakeTime = 0;
Surface.acquireOwnedCanvasPixels=acquireOwnedCanvasPixels;
Surface.createOwnedRetainedCanvas=createOwnedRetainedCanvas;
Surface.shakeLevel = 0;
// VIDEO_UpdateScreen counts the shake down once per screen update. Headless front ends that
// replace updateScreen call this too, so a shake still ends there.
(Surface as any).consumeShakeFrame = function() {
  if (Surface.shakeTime > 0) {
    Surface.shakeTime--;
  }
};

utils.extend(Surface.prototype, {
  init: function*() {
    log.debug('[VIDEO] init surface');
  },
  restoreScreen: function() {
    log.trace('[VIDEO] restoreScreen');
    //if (!this.backup) return;
    this.putRect(this.backup, 0, 0);
  },
  backupScreen: function() {
    log.trace('[VIDEO] backupScreen');
    //this.backup = this.getRect(0, 0, this.width, this.height);
    for (var i = 0; i < this.len; ++i) {
      this.backup[i] = this.byteBuffer[i];
    }
  },
  updateScreen: function(rect) {
    const fallbackRect = new RECT(0, 0, this.width, this.height);
    const hasRect = rect
      && typeof rect === 'object'
      && Number.isFinite(rect.x)
      && Number.isFinite(rect.y)
      && Number.isFinite(rect.w)
      && Number.isFinite(rect.h);
    rect = hasRect ? rect : fallbackRect;

    let x = rect.x | 0;
    let y = rect.y | 0;
    let w = rect.w | 0;
    let h = rect.h | 0;

    if (w <= 0 || h <= 0) {
      return;
    }
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    if (x >= this.width || y >= this.height) {
      return;
    }
    if (x + w > this.width) {
      w = this.width - x;
    }
    if (y + h > this.height) {
      h = this.height - y;
    }
    if (w <= 0 || h <= 0) {
      return;
    }

    const normalizedRect = new RECT(x, y, w, h);
    //this.__debugClear(normalizedRect.x, normalizedRect.y, normalizedRect.w, normalizedRect.h);
    log.trace('[VIDEO] updateScreen(%d, %d, %d, %d)', normalizedRect.x, normalizedRect.y, normalizedRect.w, normalizedRect.h);

    if (this.panoramaHandler) {
      const shouldCapture = typeof this.panoramaHandler.shouldCaptureUi === 'function'
        ? this.panoramaHandler.shouldCaptureUi()
        : (this.panoramaHandler.isActive && this.panoramaHandler.isActive());
      if (shouldCapture && typeof this.panoramaHandler.renderUiBuffer === 'function') {
        this.panoramaHandler.renderUiBuffer(normalizedRect, this);
        return;
      }
    }

    if (Surface.shakeTime > 0) {
      // Shake: the whole screen is shown shifted by shakeLevel rows, up on odd counts and down
      // on even ones, with the uncovered rows black (VIDEO_UpdateScreen).
      const level = Surface.shakeLevel | 0;
      const odd = (Surface.shakeTime & 1) !== 0;
      const shakeData = this.ctx.getImageData(0, 0, this.width, this.height);
      const out = shakeData.data;
      for (let dy = 0; dy < this.height; ++dy) {
        const sy = odd ? dy + level : dy - level;
        for (let dx = 0; dx < this.width; ++dx) {
          const o = (dy * this.width + dx) * 4;
          if (sy < 0 || sy >= this.height) {
            out[o] = out[o + 1] = out[o + 2] = 0;
          } else {
            const c = this.palette[this.byteBuffer[sy * this.width + dx]];
            out[o] = c.r;
            out[o + 1] = c.g;
            out[o + 2] = c.b;
          }
          out[o + 3] = 255;
        }
      }
      this.ctx.putImageData(shakeData, 0, 0);
      (Surface as any).consumeShakeFrame();
      return;
    }

    var ctx = this.ctx,
        imgdata = ctx.getImageData(normalizedRect.x, normalizedRect.y, normalizedRect.w, normalizedRect.h),
        pixels = imgdata.data,
        palette = this.palette,
        byteBuffer = this.byteBuffer,
        width = this.width,
        height = this.height;

    for (var i=0; i<normalizedRect.h; ++i) {
      var drawY = i + normalizedRect.y;
      for (var j=0; j<normalizedRect.w; ++j) {
        var drawX = j + normalizedRect.x;
        var offset = (i * normalizedRect.w + j) * 4;
        var bufferOffset = drawY * width + drawX;
        if (bufferOffset >= this.len) continue;
        var pixel = byteBuffer[bufferOffset],
            color = palette[pixel];
        pixels[offset]     = color.r;
        pixels[offset + 1] = color.g;
        pixels[offset + 2] = color.b;
        pixels[offset + 3] = 255;
      }
    }
    ctx.putImageData(imgdata, normalizedRect.x, normalizedRect.y);
  },
  /**
   * 获取一个矩形区域的byte buffer
   * @memberOf   Surface#
   * @param  {int} x
   * @param  {int} y
   * @param  {int} w
   * @param  {int} h
   * @return {Uint8Array}
   */
  getRect: function(x, y, w, h){
    var dst = new Uint8Array(w * h) as SurfaceBuffer,
        buf = this.byteBuffer;
    dst.width = w;
    dst.height = h;
    var dstpos = 0;
    for (var i=0; i<h; ++i) {
      for (var j=0; j<w; ++j) {
        var sy = i + y,
            sx = j + x,
            srcpos = sy * this.width + sx;
        dst[dstpos++] = buf[srcpos];
      }
    }
    return dst;
  },
  /**
   * 设置一个矩形区域的byte buffer，并刷新surface
   * @memberOf   Surface#
   * @param  {Uint8Array} src
   * @param  {int} x
   * @param  {int} y
   */
  putRect: function(src, x, y) {
    var w = src.width,
        h = src.height,
        dst = this.byteBuffer,
        srcpos = 0;
    for (var i=0; i<h; ++i) {
      for (var j=0; j<w; ++j) {
        var dy = i + y,
            dx = j + x,
            dstpos = dy * this.width + dx;
        dst[dstpos] = src[srcpos++];
      }
    }
    this.updateScreen(RECT(x, y, w, h));
  },
  tick: function(){
    var now = hrtime(),
        elapsed = now - this.lastRefresh,
        fps = 1000 / elapsed;
    this.lastRefresh = now;
  },
  /**
   * 清空一个矩形区域，重置为RGB(0, 0, 0)
   * @memberOf   Surface#
   * @param  {int} x
   * @param  {int} y
   * @param  {int} w
   * @param  {int} h
   * @param  {String} color
   */
  clearRect: function(x, y, w, h, color) {
    this.ctx.fillStyle = color || '#000';
    this.ctx.fillRect(x, y, w, h);
    this.__debugClear(x, y, w, h);
  },
  /**
   * 清空整个画布，重置为RGB(0, 0, 0)
   * @memberOf   Surface#
   * @param  {String} color
   */
  clear: function(color) {
    for (var i=0,len=this.byteBuffer.length; i<len; ++i) {
      this.byteBuffer[i] = 0;
    }
    return this.clearRect(0, 0, this.width, this.height, color);
  },
  __debugClear: function(x, y, w, h) {
    if (!this.debugctx) return;
    $('#debugLayer').empty();
    var ctx = this.debugctx;
    ctx.clearRect(x * 2, y * 2, w * 2, h * 2);
  },
  /**
   * 在指定位置上打一个字符串以显示其坐标
   * @memberOf   Surface#
   * @private
   * @param  {int} x
   * @param  {int} y
   */
  __debugPos: function(x, y) {
    if (!DEBUG.ShowSpritePos) return;
    if (!this.debugctx) return;
    this.__debugStr([x, y].join(','), x, y, '#0f0', 'top', 'left');
  },
  /**
   * 在指定位置上打一个字符串
   * @memberOf   Surface#
   * @private
   * @param  {String} str
   * @param  {int} x
   * @param  {int} y
   */
  __debugStr: function(str, x, y, color, baseline, align, size) {
    if (!this.debugctx) return;
    //$('<div class="debugObj" />').html(str).css({
    //  left: x * 2,
    //  top: y * 2
    //}).appendTo($('#debugLayer'));
    var ctx = this.debugctx;
    ctx.fillStyle = color || '#0f0';
    ctx.textBaseline = baseline || 'middle';
    ctx.textAlign = align || 'center';
    ctx.font = (size || 12) + 'px monospace';
    ctx.fillText(str, x * 2, y * 2);
  },
  /**
   * 打一个指定的红色矩形框
   * @memberOf   Surface#
   * @private
   * @param  {int} x
   * @param  {int} y
   * @param  {int} w
   * @param  {int} h
   */
  __debugRect: function(x, y, w, h, color) {
    if (w === 0 || h === 0) return;
    if (!DEBUG.ShowSpriteRect) return;
    if (!this.debugctx) return;
    var ctx = this.debugctx;
    ctx.lineWidth = 1;
    ctx.strokeStyle = color || '#00f';
    ctx.strokeRect(x * 2, y * 2, w * 2, h * 2);
  },
  __debugRLE: function(RLE, pos) {
    var i, j,
        x, y,
        width = 0,
        height = 0,
        T,
        dx = PAL_X(pos),
        dy = PAL_Y(pos);
    // Check for NULL pointer.
    if (!RLE) return false;

    width = RLE.width || 0;
    height = RLE.height || 0;

    this.__debugPos(dx, dy);
    this.__debugRect(dx, dy, width, height, '#00f');
    if (DEBUG.ShowSpriteSize){
      this.__debugStr([width, height].join('*'), dx + width, dy + height, '#0f0', 'bottom', 'right');
    }
  },
  /**
   * 设置当前surface的调色板
   * @memberOf   Surface#
   * @param {Palette} palette
   */
  setPalette: function(palette, norefresh) {
    this.palette = palette;
    if (!norefresh) {
      this.updateScreen(null);
    }
  },
  /**
   * 获取当前surface的调色板
   * @memberOf   Surface#
   * @return {Palette}
   */
  getPalette: function() {
    return this.palette;
  },
  /**
   * 设置一个像素的byte值，其颜色会从当前调色板中获取
   * @memberOf   Surface#
   * @param {int} x
   * @param {int} y
   * @param {byte} pixel
   */
  setPixel: function(x, y, pixel, buf) {
    var byteBuffer = buf || this.byteBuffer,
        palette = this.palette,
        width = this.width,
        height = this.height,
        color = palette[pixel];

    byteBuffer[y * width + x] = pixel;
  },
  /**
   * blit一个FBP位图到当前画布
   * @memberOf   Surface#
   * @param  {FBP} FBP
   * @param  {RECT} src
   * @param  {RECT} dst
   */
  blitFBP: function(FBP, src, dst, buf) {
    if (src.w <= 0 || src.h <= 0 || dst.w <= 0 || dst.h <= 0) return;

    this.__debugClear(dst.x, dst.y, dst.w, dst.h);
    var byteBuffer = buf || this.byteBuffer,
        palette = this.palette;

    for (var i=0; i<src.h; ++i) {
      var y = i + dst.y;
      for (var j=0; j<src.w; ++j) {
        var x = j + dst.x;
        var pixel = FBP[(i + src.y) * src.w + j + src.x];
        byteBuffer[y * dst.w + x] = pixel;
      }
    }
    const debugBg = typeof globalThis !== 'undefined' && (globalThis as any).PAL_DEBUG_BG === true;
    if (debugBg && src.w === this.width && src.h === this.height && dst.w === this.width && dst.h === this.height) {
      const sample = FBP && FBP.length >= 8 ? Array.from(FBP.slice(0, 8)) : [];
      const signature = `${FBP ? FBP.length : 0}:${sample.join(',')}`;
      if (this._debugBgLastSig !== signature) {
        this._debugBgLastSig = signature;
        const win = globalThis as any;
        const paletteId = win.services?.environment?.getPaletteIdValue?.() ?? null;
        console.warn('[surface] blitFBP full', {
          src: { x: src.x, y: src.y, w: src.w, h: src.h },
          dst: { x: dst.x, y: dst.y, w: dst.w, h: dst.h },
          len: FBP ? FBP.length : 0,
          sample,
          paletteId,
          overlay: win.PAL_OVERLAY_ACTIVE ?? null,
          fbpActive: win.PAL_FBP_ACTIVE ?? null
        });
      }
    }
    //this.__debugPos(dst.x, dst.y);
    //this.__debugRect(dst.x, dst.y, src.w, src.h);
  },
  /**
   * blit一个RLE到当前画布
   * @memberOf   Surface#
   * @param  {RLE} RLE
   * @param  {POS} pos
   */
  blitRLE: function(RLE, pos, buf, nodebug) {
    this.blitRLEWithColorShift(RLE, pos, 0, buf, nodebug);
  },
  blitRLEWithColorShift: function(RLE, pos, colorShift, buf, nodebug) {
    this.blitRLEWithMonoColorAndColorShift(RLE, pos, false, colorShift, buf, nodebug);
  },
  blitRLEMonoColor: function(RLE, pos, color, colorShift, buf, nodebug) {
    this.blitRLEWithMonoColorAndColorShift(RLE, pos, color, colorShift, buf, nodebug);
  },
  blitRLEWithMonoColorAndColorShift: function(RLE, pos, color, colorShift, buf, nodebug) {
    var i, j,
        x, y,
        len = 0,
        width = 0,
        height = 0,
        T,
        dx = PAL_X(pos),
        dy = PAL_Y(pos);
    var byteBuffer = buf || this.byteBuffer;
    // Check for NULL pointer.
    if (!RLE) return false;
    var _RLE = RLE;

    // Skip the 0x00000002 in the file header.
    if (RLE[0] === 0x02 && RLE[1] === 0x00 &&
        RLE[2] === 0x00 && RLE[3] === 0x00) {
      RLE = RLE.subarray(4);
    }

    // Get the width and height of the bitmap.
    width = RLE[0] | (RLE[1] << 8);
    height = RLE[2] | (RLE[3] << 8);
    if (width <= 0 || height <= 0) {
      console.warn('[surface] blitRLE invalid size', width, height);
      return false;
    }
    var maxPixels = this.width * this.height * 4;
    if (width * height > maxPixels) {
      console.warn('[surface] blitRLE oversized bitmap', width, height, 'maxPixels', maxPixels);
      return false;
    }
    //console.log('_blitRLE', dx, dy, width, height);

    // Calculate the total length of the bitmap.
    // The bitmap is 8-bpp, each pixel will use 1 byte.
    len = width * height;

    // Start decoding and blitting the bitmap.
    var palette = this.palette;
    RLE = RLE.subarray(4);
    var over = false, idx = 0;
    for (i = 0; i < len;) {
      if (over) break;
      T = RLE[idx++];
      if ((T & 0x80) && T <= 0x80 + width) {
        i += T - 0x80;
      } else {
        for (j = 0; j < T; j++) {
          // Calculate the destination coordination.
          // FIXME: This could be optimized
          y = ~~((i + j) / width) + dy;
          x = (i + j) % width + dx;

          // Skip the points which are out of the surface.
          if (x < 0) {
            j += -x - 1;
            continue;
          } else if (x >= this.width) {
            j += x - this.width;
            continue;
          }

          if (y < 0) {
            j += -y * width - 1;
            continue;
          } else if (y >= this.height) {
            over = true;
            break; // No more pixels needed, break out
          }

          var pixel = RLE[idx + j];
          var high = pixel & 0xF0;
          var low = pixel & 0x0F;
          if (colorShift !== 0) {
            low += colorShift;
            if (low > 0x0F) {
              low = 0x0F;
            }
            if (low < 0) {
              low = 0;
            }
            pixel = (high | low);
          }
          if (color !== false) {
            pixel = ((color & 0xF0) | low);
          }

          // Put the pixel onto the surface (FIXME: inefficient).
          //var offset = (y * this.width + x) * 4;
          byteBuffer[y * this.width + x] = pixel;
        }
        //RLE = RLE.subarray(T);
        idx += T;
        i += T;
      }
    }
    //this.ctx.putImageData(imgdata, 0, 0);

    if (!nodebug) {
      this.__debugRLE(_RLE, pos);
    }
  },
  /**
   * blit一个Map到当前画布
   * @memberOf   Surface#
   * @param  {Map} map
   * @param  {RECT} rect
   * @param  {int} layer
   */
  blitMap: function(map, rect, layer, buf) {
    this.__debugClear(rect.x, rect.y, rect.w, rect.h);
    //console.time('blitMap');
    // Convert the coordinate
    var sy = ~~(rect.y / 16) - 1;
    var dy = ~~((rect.y + rect.h) / 16) + 2;
    var sx = ~~(rect.x / 32) - 1;
    var dx = ~~((rect.x + rect.w) / 32) + 2;
    // Clamp to map bounds to avoid invalid tile lookups.
    var maxX = 64;
    var maxY = 128;
    if (sy < 0) sy = 0;
    if (sx < 0) sx = 0;
    if (dy > maxY) dy = maxY;
    if (dx > maxX) dx = maxX;

    // Do the drawing.
    var yPos = sy * 16 - 8 - rect.y;
    for (var y = sy; y < dy; y++) {
      for (var h = 0; h < 2; h++, yPos += 8) {
         var xPos = sx * 32 + h * 16 - 16 - rect.x;
         for (var x = sx; x < dx; x++, xPos += 32) {
            //this.__debugStr([x,y,h].join(','),xPos, yPos);
            var bitmap = map.getTileBitmap(x, y, h, layer);
            //console.log(x, y, h, layer, (bitmap ? (bitmap.length + ':' + bitmap.width + ',' + bitmap.height) : 'false'), xPos, yPos);
            if (!bitmap) {
               if (layer) continue;
               bitmap = map.getTileBitmap(0, 0, 0, layer);
            }
            this.blitRLE(bitmap, PAL_XY(xPos, yPos), buf, true);
            if (map.isTileBlocked(x, y, h)) {
              //this.__debugRect(xPos, yPos, bitmap.width, bitmap.height, '#ccc');
              //this.__debugStr([x, y, h].join(','), xPos, yPos, '#0f0', 'top', 'left');
            }
         }
      }
    }
    //console.timeEnd('blitMap');
  },
  /**
   * blit一个全屏的FBP
   * @memberOf   Surface#
   * @param  {FBP} FBP
   */
  blit: function(FBP, buf) {
    var rect = new RECT(0, 0, this.width, this.height);
    const debugBg = typeof globalThis !== 'undefined' && (globalThis as any).PAL_DEBUG_BG === true;
    if (debugBg && FBP && FBP.length === this.width * this.height) {
      const sample = Array.from(FBP.slice(0, 8));
      const signature = `${FBP.length}:${sample.join(',')}`;
      if (this._debugBgLastSig !== signature) {
        this._debugBgLastSig = signature;
        const win = globalThis as any;
        const paletteId = win.services?.environment?.getPaletteIdValue?.() ?? null;
        console.warn('[surface] blit full', {
          len: FBP.length,
          sample,
          paletteId,
          overlay: win.PAL_OVERLAY_ACTIVE ?? null,
          fbpActive: win.PAL_FBP_ACTIVE ?? null
        });
      }
    }
    return this.blitFBP(FBP, rect, rect, buf);
  },
  /**
   * blit一个buffer到另一个buffer
   * @param  {Uint8Array} src     源Buffer
   * @param  {RECT} srcrect 源区域
   * @param  {Uint8Array} dst     目标Buffer
   * @param  {RECT} dstrect 目标区域
   */
  blitSurface: function(src, srcrect, dst, dstrect) {
    srcrect = srcrect || new RECT(0, 0, this.width, this.height);
    dstrect = dstrect || new RECT(0, 0, this.width, this.height);
    for (var i=0; i<srcrect.h; ++i) {
      var y = i + dstrect.y;
      for (var j=0; j<srcrect.w; ++j) {
        var x = j + dstrect.x;
        var pixel = src[(i + srcrect.y) * srcrect.w + j + srcrect.x];

        dst[y * dstrect.w + x] = pixel;
      }
    }
  },
  // idx: 调色板索引
  fadeIn: function*(idx, night, time) {
    log.debug(['[VIDEO] fadeIn', idx, night, time].join(' '));
    const resolvePalette = () => {
      try {
        const entry = (Palette as any).get(idx);
        if (Array.isArray(entry)) {
          return entry as PaletteColor[];
        }
        if (entry && Array.isArray(entry.day)) {
          return night ? (entry.night || entry.day) : entry.day;
        }
      } catch (err) {
        console.warn('[VIDEO] fadeIn palette lookup failed', err);
      }
      return null;
    };
    const palette = resolvePalette();
    if (!palette || palette.length < 256) {
      console.warn('[VIDEO] fadeIn palette missing', { idx, night, len: palette ? palette.length : 0 });
      this.setPalette(this.palette || defaultPalette, true);
      return;
    }
    if (!time || time <= 0) {
      this.setPalette(palette, true);
      return;
    }
    var me = this,
        newPalette = [];
    for (var i=0; i<256; ++i) {
      newPalette[i] = {
        r: 0,
        g: 0,
        b: 0
      };
    }
    time *= 300; // 600
    var me = this;
    // Start fading in...
    var startTime = timestamp();
    while (true) {
      // Set the current palette...
      var now = timestamp();
      var elapsed = now - startTime;
      var rate = 1 - (time - elapsed) / time;
      if (rate > 1) break;
      for (var i=0; i<256; ++i) {
        var p = palette[i],
            np = newPalette[i];
        np.r = p.r * rate;
        np.g = p.g * rate;
        np.b = p.b * rate;
      }

      me.setPalette(newPalette);

      yield sleep(FrameTime);
    }

    me.setPalette(palette, true);
  },
  fadeOut: function*(time) {
    log.debug(['[VIDEO] fadeOut', time].join(' '));
    if (!time || time <= 0) {
      return;
    }
    time *= 300; // 600
    var palette = this.getPalette();
    var newPalette = [];
    // Get the original palette...
    for (var i=0; i<256; ++i) {
      var p = palette[i];
      newPalette[i] = {
        r: p.r,
        g: p.g,
        b: p.b
      };
    }
    var me = this;
    var startTime = timestamp();
    while (true) {
      var now = timestamp(),
          elapsed = now - startTime,
          rate = (time - elapsed) / time;
      if (rate < 0) break;
      for (var i=0; i<256; ++i){
        var p = palette[i],
            np = newPalette[i];
        np.r = p.r * rate;
        np.g = p.g * rate;
        np.b = p.b * rate;
      }

      me.setPalette(newPalette);

      yield sleep(FrameTime);
    }

    me.setPalette(palette, true);
  },

  fadeToRed: function*() {
    log.debug(['[VIDEO] fadeToRed'].join(' '));
    var palette = this.getPalette();
    var newPalette = [];
    // Get the original palette...
    for (var i=0; i<256; ++i) {
      var p = palette[i];
      newPalette[i] = {
        r: p.r,
        g: p.g,
        b: p.b
      };
    }

    for (var i = 0; i < this.len; ++i) {
      if (this.byteBuffer[i] == 0x4F) {
        this.byteBuffer[i] = 0x4E; // HACKHACK
      }
    }
    var me = this;
    var startTime = timestamp();
    for (var i = 0; i < 32; ++i) {
      for (var j = 0; j < 256; ++j){
        if (j == 0x4F) {
          continue; // so that texts will not be affected
        }
        var p = palette[j],
            np = newPalette[j];
        var color = ~~((p.r + p.g + p.b) / 4) + 64;

        if (np.r > color) {
          np.r -= (np.r - color > 8 ? 8 : np.r - color);
        } else if (np.r < color) {
          np.r += (color - np.r > 8 ? 8 : color - np.r);
        }

        if (np.g > 0) {
          np.g -= (np.g > 8 ? 8 : np.g);
        }

        if (np.b > 0) {
          np.b -= (np.b > 8 ? 8 : np.b);
        }
      }

      me.setPalette(newPalette);
      yield sleepByFrame(1);
    }
  },
  paletteFade: function*(idx, night, update) {
    log.debug(['[VIDEO] paletteFade', idx, night, update].join(' '));
    var me = this;

    var newPalette = (Palette as any).getColors(idx, night) as PaletteColor[] | null;
    if (!newPalette) {
      return;
    }

    var palette = [];
    var i, j;
    for (i = 0; i < 256; ++i) {
      var p = this.palette[i];
      palette[i] = {
        r: p.r,
        g: p.g,
        b: p.b
      };
    }

    // Start fading...
    for (i = 0; i < 32; i++) {
      var t = [];
      for (j = 0; j < 256; j++) {
        t[j] = {
          r: ~~((palette[j].r * (31 - i) + newPalette[j].r * i) / 31),
          g: ~~((palette[j].g * (31 - i) + newPalette[j].g * i) / 31),
          b: ~~((palette[j].b * (31 - i) + newPalette[j].b * i) / 31)
        };
      }
      me.setPalette(t);

      if (update) {
        // As in SDLPAL PAL_PaletteFade: clear input, PAL_GameUpdate(FALSE) and
        // PAL_MakeScene on every step. The hook is installed by play.init so this
        // module does not import play/scene.
        if (typeof me.sceneUpdateHook === 'function') {
          yield* me.sceneUpdateHook();
        }
        me.updateScreen(null);
      }

      yield sleep(update ? FrameTime : FrameTime / 4);
    }
  },
  colorFade: function*(delay, color, from) {
    log.debug(['[VIDEO] colorFade', delay, color, from].join(' '));
    var me = this;
    var palette = (Palette as any).getColors(getPaletteIdSnapshot(), isNightPaletteEnabled()) as PaletteColor[] | null;
    if (!palette) {
      return;
    }
    var newPalette = [];
    var i;
    var j;
    delay *= 5; // 10;
    if (delay == 0) {
      delay = 5; // 10;
    }

    var finalPalette;
    if (from) {
      for (i = 0; i < 256; ++i) {
        var p = palette[color];
        newPalette[i] = {
          r: p.r,
          g: p.g,
          b: p.b
        };
      }
      finalPalette = palette;
    } else {
      finalPalette = new Array(256);
      for (i = 0; i < 256; ++i) {
        var p = palette[i];
        newPalette[i] = {
          r: p.r,
          g: p.g,
          b: p.b
        };

        finalPalette[i] = {
          r: palette[color].r,
          g: palette[color].g,
          b: palette[color].b
        }
      }
    }

    for (i = 0; i < 64; i++) {
      for (j = 0; j < 256; j++) {
        var to = (from ? j : color);

        if (newPalette[j].r > palette[to].r) {
          newPalette[j].r -= 4;
        } else if (newPalette[j].r < palette[to].r) {
          newPalette[j].r += 4;
        }
        if (newPalette[j].g > palette[to].g) {
          newPalette[j].g -= 4;
        } else if (newPalette[j].g < palette[to].g) {
          newPalette[j].g += 4;
        }
        if (newPalette[j].b > palette[to].b) {
          newPalette[j].b -= 4;
        } else if (newPalette[j].b < palette[to].b) {
          newPalette[j].b += 4;
        }
      }

      me.setPalette(newPalette);
      yield sleep(delay);
    }



    me.setPalette(finalPalette);
  },
  shakeScreen: function*(shakeTime, shakeLevel){
    log.debug(['[VIDEO] shakeScreen', shakeTime, shakeLevel].join(' '));
    Surface.shakeTime = shakeTime;
    Surface.shakeLevel = shakeLevel;
  },
  switchScreen: function*(speed) {
    log.debug(['[VIDEO] switchScreen', speed].join(' '));

    var indices = [0, 3, 1, 5, 2, 4];

    speed++;
    speed *= 5; // 10;

    var backup = this.backup;
    var buffer = this.getRect(0, 0, 320, 200);
    var screen = this.byteBuffer;

    for (var i = 0; i < 6; i++) {
      for (var j = indices[i]; j < this.pitch * this.height; j += 6) {
        backup[j] = buffer[j];
      }

      // Draw the backup buffer to the screen
      this.blitSurface(backup, null, screen, null);
      this.updateScreen(null);

      yield sleep(speed);
    }
  },

  /**
   * Fade from the backup screen buffer to the current screen buffer.
     NOTE: This will destroy the backup buffer.
   * @param {Number} speed         speed of fading (the larger value, the slower).
   */
  fadeScreen: function*(speed) {
    log.debug(['[VIDEO] fadeScreen', speed].join(' '));
    var indices = [0, 3, 1, 5, 2, 4];

    //var offset = 240 - 200;
    //var screenRealHeight = this.height;
    //var screenRealY = 0;
    //if (!bScaleScreen)
    //{
    //  screenRealHeight -= offset;
    //  screenRealY = offset / 2;
    //}

    speed++;
    speed *= 4; // 10;

    var screen = this.byteBuffer;
    var p = this.getRect(0, 0, 320, 200);
    var backup = this.backup;

    for (var i = 0; i < 12; i++) {
      for (var j = 0; j < 6; j++) {
        this.fadeScreenSubstep(screen, p, backup, i, j);
        yield sleep(speed);
      }
    }

    // Draw the result buffer to the screen as the final step
    this.updateScreen(null);
  },

  /** Shared native atomic prefix; aliases are captured by the caller exactly once. */
  fadeScreenSubstep: function(screen, p, backup, i, j) {
    var indices = [0, 3, 1, 5, 2, 4];
    // Blend the pixels in the 2 buffers, and put the result into the
    // backup buffer
    for (var k = indices[j]; k < this.pitch * this.height; k += 6) {
      var a = p[k];
      var b = backup[k];

      if (i > 0) {
        if ((a & 0x0F) > (b & 0x0F)) {
          b++;
        } else if ((a & 0x0F) < (b & 0x0F)) {
          b--;
        }
      }

      backup[k] = ((a & 0xF0) | (b & 0x0F));
    }

    // Draw the backup buffer to the screen
    if (Surface.shakeTime != 0) {
      var srcrect = new RECT(0, 0, 320, 200);
      var dstrect = new RECT(0, 0, 320, 200);

      // Shake the screen
      srcrect.x = 0;
      srcrect.y = 0;
      srcrect.w = 320;
      srcrect.h = 200 - Surface.shakeLevel;

      dstrect.x = 0;
      dstrect.y = 0; // screenRealY;
      dstrect.w = 320; //320 * ~~(this.width / this.width);
      dstrect.h = 200 - Surface.shakeLevel; // (200 - Surface.shakeLevel) * screenRealHeight / gpScreen->h;

      if (Surface.shakeTime & 1) {
        srcrect.y = Surface.shakeLevel;
      } else {
        dstrect.y = Surface.shakeLevel; //(screenRealY + Surface.shakeLevel) * screenRealHeight / gpScreen->h;
      }

      this.blitSurface(backup, srcrect, screen, dstrect);
      //SDL_SoftStretch(gpScreenBak, &srcrect, gpScreenReal, &dstrect);

      if (Surface.shakeTime & 1) {
         dstrect.y = 200 - Surface.shakeLevel; // (screenRealY + screenRealHeight - Surface.shakeLevel) * screenRealHeight / gpScreen->h;
      } else {
         dstrect.y = 0;// screenRealY;
      }

      dstrect.h = Surface.shakeLevel; // Surface.shakeLevel * screenRealHeight / gpScreen->h;

      this.fillRect(screen, dstrect, 0);
      this.updateScreen(null);
      //SDL_FillRect(gpScreenReal, &dstrect, 0);
      //SDL_UpdateRect(gpScreenReal, 0, 0, gpScreenReal->w, gpScreenReal->h);
      Surface.shakeTime--;
    } else {
      //dstrect.x = 0;
      //dstrect.y = 0; //screenRealY;
      //dstrect.w = 320; //gpScreenReal->w;
      //dstrect.h = 200; //screenRealHeight;

      this.blitSurface(backup, null, screen, null);
      this.updateScreen(null);
      //SDL_SoftStretch(gpScreenBak, NULL, gpScreenReal, &dstrect);
      //SDL_UpdateRect(gpScreenReal, 0, 0, gpScreenReal->w, gpScreenReal->h);
    }
  },

  fillRect: function(buffer, rect, color) {
    var w = rect.width,
        h = rect.height;
    for (var i=0; i<h; ++i) {
      for (var j=0; j<w; ++j) {
        var y = i + rect.y,
            x = j + rect.x,
            pos = y * this.width + x;
        buffer[pos] = color;
      }
    }
  }
} as Record<string, (this: SurfaceInstance, ...args: any[]) => any>);

export default Surface;
