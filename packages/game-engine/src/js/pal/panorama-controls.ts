const SCALE_MIN = 0.75;
const SCALE_MAX = 2.0;
const SCALE_STEP = 0.05;

type PanoramaMode = 'off' | 'panorama';

type PanoramaApi = {
  getScale?: () => number;
  setScale?: (value: number) => void;
};

function resolvePalPanorama(): PanoramaApi | null {
  if (typeof window !== 'undefined' && (window as any).PAL_PANORAMA) {
    return (window as any).PAL_PANORAMA as PanoramaApi;
  }
  return null;
}

class PanoramaControls {
  private initialized = false;
  private mode: PanoramaMode = 'off';
  private scale = 1;

  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.syncFromRenderer();
  }

  syncFromRenderer(): void {
    const api = resolvePalPanorama();
    const current = api && typeof api.getScale === 'function'
      ? api.getScale()
      : 1;
    if (Number.isFinite(current) && current > 0) {
      this.scale = current;
    }
  }

  setScale(value: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return this.scale;
    }
    const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, numeric));
    this.scale = clamped;
    const api = resolvePalPanorama();
    if (api && typeof api.setScale === 'function') {
      api.setScale(clamped);
    }
    return this.scale;
  }

  getScale(): number {
    return this.scale;
  }

  getScaleLimits(): { min: number; max: number; step: number } {
    return {
      min: SCALE_MIN,
      max: SCALE_MAX,
      step: SCALE_STEP
    };
  }

  setMode(mode: string): void {
    this.mode = mode === 'panorama' ? 'panorama' : 'off';
  }
}

const instance = new PanoramaControls();

if (typeof window !== 'undefined') {
  (window as any).PAL_PANORAMA_UI = {
    setMode: (mode: string) => instance.setMode(mode),
    refresh: () => instance.syncFromRenderer(),
    setScale: (value: number) => instance.setScale(value),
    getScale: () => instance.getScale(),
    getScaleLimits: () => instance.getScaleLimits()
  };
}

export default instance;
