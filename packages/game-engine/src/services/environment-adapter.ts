import { viewportSignals } from '../state/slices/viewport.js';
import { audioResourceSignals } from '../state/slices/audio-resources.js';
import { timeFlagSignals } from '../state/slices/time-flags.js';
import { createAdapterObservable } from './adapter-helpers.js';

const viewportSlice = viewportSignals();
const audioSlice = audioResourceSignals();
const timeSlice = timeFlagSignals();

function getViewportValue() {
  const value = viewportSlice.viewport.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function getPartyOffsetValue() {
  const value = viewportSlice.partyOffset.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function getPartyDirectionValue() {
  const value = viewportSlice.partyDirection.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function getCurrentSaveSlotValue() {
  const value = viewportSlice.currentSaveSlot.value;
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 1;
}

function getPaletteIdValue() {
  const value = audioSlice.paletteId.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function getScreenWaveValue() {
  const value = audioSlice.screenWave.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function getLayerValue() {
  const value = audioSlice.layer.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function isNightPaletteEnabled() {
  const value = audioSlice.nightPalette.value;
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

function shouldFadeIn() {
  const value = timeSlice.needToFadeIn.value;
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

function getWaveProgressionValue() {
  const value = timeSlice.waveProgression.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

export const partyOffset$ = createAdapterObservable<number>({
  name: 'environment.partyOffset',
  signal: viewportSlice.partyOffset,
  getValue: getPartyOffsetValue
});

export const viewport$ = createAdapterObservable<number>({
  name: 'environment.viewport',
  signal: viewportSlice.viewport,
  getValue: getViewportValue
});

export const partyDirection$ = createAdapterObservable<number>({
  name: 'environment.partyDirection',
  signal: viewportSlice.partyDirection,
  getValue: getPartyDirectionValue
});

export const currentSaveSlot$ = createAdapterObservable<number>({
  name: 'environment.currentSaveSlot',
  signal: viewportSlice.currentSaveSlot,
  getValue: getCurrentSaveSlotValue
});

export const paletteId$ = createAdapterObservable<number>({
  name: 'environment.paletteId',
  signal: audioSlice.paletteId,
  getValue: getPaletteIdValue
});

export const screenWave$ = createAdapterObservable<number>({
  name: 'environment.screenWave',
  signal: audioSlice.screenWave,
  getValue: getScreenWaveValue
});

export const layer$ = createAdapterObservable<number>({
  name: 'environment.layer',
  signal: audioSlice.layer,
  getValue: getLayerValue
});

export const nightPalette$ = createAdapterObservable<boolean>({
  name: 'environment.nightPalette',
  signal: audioSlice.nightPalette,
  getValue: isNightPaletteEnabled,
  projector: (value) => !!value
});

export const fadeIn$ = createAdapterObservable<boolean>({
  name: 'environment.needToFadeIn',
  signal: timeSlice.needToFadeIn,
  getValue: shouldFadeIn,
  projector: (value) => !!value
});

export const waveProgression$ = createAdapterObservable<number>({
  name: 'environment.waveProgression',
  signal: timeSlice.waveProgression,
  getValue: getWaveProgressionValue
});

export {
  getViewportValue,
  getPartyOffsetValue,
  getPartyDirectionValue,
  getCurrentSaveSlotValue,
  getPaletteIdValue,
  getScreenWaveValue,
  getLayerValue,
  isNightPaletteEnabled,
  shouldFadeIn,
  getWaveProgressionValue
};

export default {
  getViewportValue,
  getPartyOffsetValue,
  getPartyDirectionValue,
  getCurrentSaveSlotValue,
  getPaletteIdValue,
  getScreenWaveValue,
  getLayerValue,
  isNightPaletteEnabled,
  shouldFadeIn,
  getWaveProgressionValue,
  viewport$,
  partyOffset$,
  partyDirection$,
  currentSaveSlot$,
  paletteId$,
  screenWave$,
  layer$,
  nightPalette$,
  fadeIn$,
  waveProgression$
};
