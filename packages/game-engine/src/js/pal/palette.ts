import utils from './utils';
import traceModuleLoad from './util-trace';

traceModuleLoad('palette module load');

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

let patMKF: any = null;
const cache: Record<number, Palette> = {};

export default class Palette {
  buf: Uint8Array;
  day: PaletteColor[];
  night: PaletteColor[];

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.day = new Array(256);
    this.night = new Array(256);
    // As in SDLPAL PAL_GetPalette: a chunk without night data (<= 256 * 3 bytes)
    // falls back to the day palette instead of reading past the chunk.
    var nightBase = buf.length > 256 * 3 ? 256 * 3 : 0;
    for (var i = 0; i < 256; i++) {
      this.day[i] = {
        r: buf[i * 3] << 2,
        g: buf[i * 3 + 1] << 2,
        b: buf[i * 3 + 2] << 2
      };
      this.night[i] = {
        r: buf[nightBase + i * 3] << 2,
        g: buf[nightBase + i * 3 + 1] << 2,
        b: buf[nightBase + i * 3 + 2] << 2
      };
    }
  }

  /**
   * Colors of the specified palette (PAL_GetPalette), or null if unavailable.
   */
  static getColors(index: number, night: boolean): PaletteColor[] | null {
    try {
      const palette = Palette.get(index);
      return palette ? (night ? palette.night : palette.day) : null;
    } catch (err) {
      return null;
    }
  }

  static init(mkf: any) {
    patMKF = mkf;
  }

  static get(index: number): Palette {
    if (cache[index]) {
      return cache[index];
    }
    if (!patMKF) {
      throw new Error('Palette not initialized');
    }
    const buf = patMKF.readChunk(index);
    const palette = new Palette(buf);
    cache[index] = palette;
    return palette;
  }
}
