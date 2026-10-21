import rngService from '../../services/rng-service';

// Bridge for legacy global access if needed
const rng = {
  init: function*(surf: any) {
    yield* rngService.init(surf);
    // Maintain legacy global access
    (globalThis as any).rng = rngService;
  },
  readFrame: (rngNum: number, frameNum: number) => rngService.readFrame(rngNum, frameNum),
  blitToSurface: (rngNum: number, frameNum: number) => rngService.blitToSurface(rngNum, frameNum),
  play: function*(rngNum: number, startFrame: number, endFrame: number, speed: number) {
    yield* rngService.play(rngNum, startFrame, endFrame, speed);
  }
};

export default rng;
