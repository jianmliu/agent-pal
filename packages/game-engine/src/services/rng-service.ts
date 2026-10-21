import {sha256} from 'viem';
import type {RngVideoIdentity,RngFrontBinding} from './script-rng-cursor';
import yj_1 from '../js/pal/yj_1';
import resourceService from './resource-service.js';
import worldService from './world-service.js';
import {
  shouldFadeIn,
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled
} from './environment-adapter.js';

// Helper for sleep
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface Surface {
  byteBuffer: Uint8Array;
  pitch: number;
  width:number;
  height:number;
  updateScreen: () => void;
  fadeIn: (paletteId: number, night: boolean, speed: number) => Promise<void>;
}

class RngService {
  private surface: Surface | null = null;

  public *init(surf: Surface): Generator<Promise<unknown>, void, unknown> {
    this.surface = surf;
    const list = ['RNG'];
    yield resourceService.loadMKF(...list);
  }

  /** Narrow owned binding; native play never asks for hashes or geometry. */
  public matchesOwnedTarget(target:unknown):boolean {
    const s=this.surface;
    return !!s&&s===target&&s.byteBuffer instanceof Uint8Array&&Number.isSafeInteger(s.pitch)&&s.pitch>=320&&Number.isSafeInteger(s.width)&&s.width>=320&&Number.isSafeInteger(s.height)&&s.height>=200&&s.width<=s.pitch&&s.byteBuffer.length>=s.pitch*s.height&&typeof s.updateScreen==='function';
  }
  public hasTarget():boolean {return !!this.surface;}
  public getFrontBinding(target:unknown):RngFrontBinding {
    if(!this.matchesOwnedTarget(target))throw new Error('RNG requires a matching Surface and front geometry');
    const s=this.surface!;return {pitch:s.pitch,width:s.width,height:s.height,byteLength:s.byteBuffer.length,digest:sha256(s.byteBuffer)};
  }
  public updateOwnedScreen(target:unknown):void {
    if(!this.matchesOwnedTarget(target))throw new Error('RNG requires a matching Surface');
    this.surface!.updateScreen();
  }
  /** SAME reader span as readFrame, including the internal frame-offset table. */
  public getVideoContentIdentity(rngNum:number):RngVideoIdentity|null {
    if(!Number.isSafeInteger(rngNum)||rngNum<0)throw new Error('Invalid RNG selection');
    const mkf=resourceService.getMKF('RNG') as any;
    if(!mkf||rngNum>=mkf.chunkCount)return null;
    const offset=mkf.reader.getUint32(4*rngNum),end=mkf.reader.getUint32(4*rngNum+4),length=end-offset;
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(end)||offset<0||end<offset||end>mkf.buf.byteLength)throw new Error('Invalid RNG video reader span');
    if(!length)return null;
    const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=mkf.reader.getUint8(offset+i);
    return {format:'rng-video-sha256-v1',byteLength:length,digest:sha256(bytes)};
  }

  public readFrame(rngNum: number, frameNum: number): Uint8Array | null {
    const rngMKF = resourceService.getMKF('RNG') as any;
    if (!rngMKF) return null;

    // Get the total number of chunks.
    const chunkCount = rngMKF.chunkCount;
    if (rngNum >= chunkCount) {
      return null;
    }

    // Get the offset of the chunk.
    let bufferOffset = 4 * rngNum + 0;
    const offset = rngMKF.reader.getUint32(bufferOffset);
    bufferOffset += 4;
    const nextOffset = rngMKF.reader.getUint32(bufferOffset);
    bufferOffset += 4;

    // Get the length of the chunk.
    let chunkLen = nextOffset - offset;
    if (chunkLen === 0) {
      return null;
    }

    // Get the number of sub chunks.
    bufferOffset = offset + 0;
    let subChunkCount = rngMKF.reader.getUint32(bufferOffset);
    subChunkCount = ~~((subChunkCount - 4) / 4);
    if (frameNum >= subChunkCount) {
      return null;
    }

    // Get the offset of the sub chunk.
    bufferOffset = offset + 4 * frameNum + 0;
    const subOffset = rngMKF.reader.getUint32(bufferOffset);
    bufferOffset += 4;
    const nextSubOffset = rngMKF.reader.getUint32(bufferOffset);

    // Get the length of the sub chunk.
    chunkLen = nextSubOffset - subOffset;

    if (chunkLen !== 0) {
      bufferOffset = offset + subOffset + 0;
      const buffer = new Uint8Array(chunkLen);
      for (let i = 0; i < chunkLen; ++i) {
        buffer[i] = rngMKF.reader.getUint8(bufferOffset);
        bufferOffset++;
      }
      return buffer;
    }

    return null;
  }

  public blitToSurface(rngNum: number, frameNum: number): boolean {
    if (!this.surface) return false;
    
    // Check for invalid parameters.
    if (rngNum < 0 || frameNum < 0) {
      return false;
    }

    // Read the frame.
    const buf = this.readFrame(rngNum, frameNum);
    if (!buf) {
      return false;
    }

    // Decompress the frame.
    const rngFile = (yj_1 as any).decompress(buf);
    if (!rngFile) {
      return false;
    }

    // Draw the frame to the surface.
    let ended = false;
    let ptr = 0;
    let dst_ptr = 0;
    let data = 0;
    let wdata = 0;
    const surface = this.surface;

    while (!ended) {
      data = rngFile[ptr++];
      if (data === undefined) { // Check for end of buffer if 0 is not the only terminator
         ended = true;
         break;
      }
      if (data === 0 && ptr > rngFile.length) { // Safety check
          ended = true;
          break;
      }

      switch (data) {
        case 0x00:
        case 0x13:
          // End
          ended = true;
          break;
        case 0x02:
          dst_ptr += 2;
          break;
        case 0x03:
          data = rngFile[ptr++];
          dst_ptr += (data + 1) * 2;
          break;
        case 0x04:
          wdata = rngFile[ptr] | (rngFile[ptr + 1] << 8);
          ptr += 2;
          dst_ptr += (wdata + 1) * 2;
          break;
        case 0x0a:
          this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
          ptr += 2;
          dst_ptr += 2;
          // Fallthrough intended in original code? 
          // Original code:
          // case 0x0a: ... dst_ptr += 2;
          // case 0x09: ...
          // It seems it falls through 0x0a -> 0x09 -> 0x08 -> 0x07 -> 0x06
          // Let's replicate the fallthrough logic carefully.
        case 0x09:
          this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
          ptr += 2;
          dst_ptr += 2;
        case 0x08:
          this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
          ptr += 2;
          dst_ptr += 2;
        case 0x07:
          this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
          ptr += 2;
          dst_ptr += 2;
        case 0x06:
          this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
          ptr += 2;
          dst_ptr += 2;
          break;
        case 0x0b:
          data = rngFile[ptr++];
          for (let i = 0; i <= data; i++) {
            this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
            ptr += 2;
            dst_ptr += 2;
          }
          break;
        case 0x0c:
          wdata = rngFile[ptr] | (rngFile[ptr + 1] << 8);
          ptr += 2;
          for (let i = 0; i <= wdata; i++) {
            this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
            ptr += 2;
            dst_ptr += 2;
          }
          break;
        case 0x0d:
        case 0x0e:
        case 0x0f:
        case 0x10:
          for (let i = 0; i < data - (0x0d - 2); i++) {
            this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
            dst_ptr += 2;
          }
          ptr += 2;
          break;
        case 0x11:
          data = rngFile[ptr++];
          for (let i = 0; i <= data; i++) {
            this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
            dst_ptr += 2;
          }
          ptr += 2;
          break;
        case 0x12:
          const n = (rngFile[ptr] | (rngFile[ptr + 1] << 8)) + 1;
          ptr += 2;
          for (let i = 0; i < n; i++) {
            this.writePixelPair(surface, dst_ptr, rngFile[ptr], rngFile[ptr+1]);
            dst_ptr += 2;
          }
          ptr += 2;
          break;
      }
    }

    return true;
  }

  private writePixelPair(surface: Surface, dst_ptr: number, val1: number, val2: number) {
    let x = dst_ptr % 320;
    let y = ~~(dst_ptr / 320);
    surface.byteBuffer[y * surface.pitch + x] = val1;
    if (++x >= 320) {
      x = 0;
      ++y;
    }
    surface.byteBuffer[y * surface.pitch + x] = val2;
  }

  public *play(rngNum: number, startFrame: number, endFrame: number, speed: number): Generator<Promise<void>, void, unknown> {
    // console.debug('play rng', rngNum, startFrame, endFrame, speed);
    // SDLPAL PAL_RNGPlay: one frame every 1000/speed ms, scheduled against an
    // absolute deadline; a negative end frame plays until frames run out.
    const delay = 1000 / (speed === 0 ? 16 : speed);
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    let deadline = now();

    for (; endFrame < 0 || startFrame <= endFrame; startFrame++){
      deadline += delay;

      if (!this.blitToSurface(rngNum, startFrame)) {
        // Failed to get the frame, don't go further
        return;
      }

      // Update the screen
      if (this.surface) {
        this.surface.updateScreen();
      }

      // Fade in the screen if needed
      if (shouldFadeIn()) {
        if (this.surface) {
          yield this.surface.fadeIn(
            getPaletteIdSnapshot(),
            !!isNightPaletteEnabled(),
            1
          );
        }
        worldService.setNeedToFadeIn(false);
        deadline = now() + delay / 2;
      }

      // Delay for a while
      yield sleep(Math.max(0, deadline - now()));
    }
  }
}

const rngService = new RngService();
export default rngService;
