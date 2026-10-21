import traceModuleLoad from './util-trace';
import type { PalConfig, PartialPalConfig } from '../../types/pal';

traceModuleLoad('config module load');

/**
 * Normalize a base URL so it always ends with a single '/'.
 */
function normalizeBase(url: string | null | undefined): string {
  if (!url) return '';
  return url.replace(/\/+$/, '') + '/';
}

const globalConfig: PartialPalConfig = (typeof window !== 'undefined' && (window as any).PAL_CONFIG) || {};

const defaults: PartialPalConfig = {
  assetBaseUrl: './pal-assets/',
  audioBaseUrl: null,
  enableTouch: true,
  enableAudio: false,
  enableModAssets: true,
  modAssetBaseUrl: './pal-assets/exported-assets/',
  modSpriteBaseUrl: './pal-assets/exported-sprites/',
  enableOverviewMode: false,
  enablePanorama: true,
  mapOverlayMode: 'off',
  showEventObjectLabels: false,
  enableAIControl: false,
  enableMud: false,
  embeddingSource: 'storygraph-embeddings.json',
  embeddingModel: 'nomic-embed-text',
  llmModel: null,
  // Script source: 'native' = SSS.MKF (original), 'storygraph' = pre-generated JSON
  scriptSource: 'storygraph',
  // Storygraph format: 'dialogs' = dialogs only (1MB), 'full' = all operations (11MB)
  storyGraphFormat: 'full',
  storyGraphPath: './pal-assets/generated/storygraph.json',
  storyGraphFullPath: './pal-assets/generated/storygraph-full.json'
};

const baseConfig: any = {};
for (const key in defaults) {
  if (Object.prototype.hasOwnProperty.call(defaults, key)) {
    baseConfig[key] = (defaults as any)[key];
  }
}
for (const cfgKey in globalConfig) {
  if (Object.prototype.hasOwnProperty.call(globalConfig, cfgKey)) {
    baseConfig[cfgKey] = (globalConfig as any)[cfgKey];
  }
}

baseConfig.assetBaseUrl = normalizeBase(baseConfig.assetBaseUrl || defaults.assetBaseUrl);
baseConfig.modAssetBaseUrl = normalizeBase(baseConfig.modAssetBaseUrl || defaults.modAssetBaseUrl);
baseConfig.modSpriteBaseUrl = normalizeBase(baseConfig.modSpriteBaseUrl || defaults.modSpriteBaseUrl);
baseConfig.enableModAssets = baseConfig.enableModAssets !== false;
baseConfig.enableOverviewMode = baseConfig.enableOverviewMode === true;
baseConfig.enablePanorama = baseConfig.enablePanorama === true;
const normalizedOverlayMode = (baseConfig.mapOverlayMode || (baseConfig.enableOverviewMode ? 'gps' : 'off'));
const overlayMode = typeof normalizedOverlayMode === 'string'
  ? normalizedOverlayMode.toLowerCase()
  : (normalizedOverlayMode ? 'gps' : 'off');
if (overlayMode === 'panorama') {
  baseConfig.enablePanorama = true;
}
if (overlayMode === 'gps') {
  baseConfig.enableOverviewMode = true;
}
baseConfig.enableAIControl = baseConfig.enableAIControl === true;
baseConfig.enableMud = baseConfig.enableMud === true;
baseConfig.embeddingSource = baseConfig.embeddingSource || defaults.embeddingSource;
baseConfig.embeddingModel = baseConfig.embeddingModel || defaults.embeddingModel;
baseConfig.llmModel = baseConfig.llmModel || defaults.llmModel;
baseConfig.scriptSource = baseConfig.scriptSource === 'storygraph' ? 'storygraph' : 'native';
baseConfig.storyGraphFormat = baseConfig.storyGraphFormat === 'full' ? 'full' : 'dialogs';
baseConfig.storyGraphPath = baseConfig.storyGraphPath || defaults.storyGraphPath;
baseConfig.storyGraphFullPath = baseConfig.storyGraphFullPath || defaults.storyGraphFullPath;

const audioConfigured = typeof baseConfig.audioBaseUrl === 'string' && baseConfig.audioBaseUrl.length > 0;
const hasExplicitEnableAudio = Object.prototype.hasOwnProperty.call(globalConfig, 'enableAudio');
if (hasExplicitEnableAudio && globalConfig.enableAudio === false) {
  baseConfig.enableAudio = false;
  baseConfig.audioBaseUrl = audioConfigured ? normalizeBase(baseConfig.audioBaseUrl) : null;
} else if (audioConfigured || baseConfig.enableAudio) {
  baseConfig.enableAudio = true;
  baseConfig.audioBaseUrl = normalizeBase(baseConfig.audioBaseUrl || (baseConfig.assetBaseUrl + 'MP3/'));
} else {
  baseConfig.enableAudio = false;
  baseConfig.audioBaseUrl = null;
}

function shouldUseModOverride(path: string | null | undefined): boolean {
  const lowered = (path || '').toLowerCase();
  if (
    lowered.endsWith('.mkf') ||
    lowered.endsWith('.asc') ||
    lowered.endsWith('.fon') ||
    lowered.endsWith('.dat') ||
    lowered.endsWith('.msg') ||
    lowered.endsWith('.rpg')
  ) {
    return false;
  }
  return true;
}

function resolveAssetPath(path: string | null | undefined): string {
  path = path || '';
  if (path.charAt(0) === '/') {
    path = path.substring(1);
  }
  return (baseConfig.assetBaseUrl as string) + path;
}

function resolveAudioPath(path: string | null | undefined): string | null {
  path = path || '';
  if (!baseConfig.audioBaseUrl) return null;
  if (path.charAt(0) === '/') {
    path = path.substring(1);
  }
  return (baseConfig.audioBaseUrl as string) + path;
}

function resolveModAssetPath(path: string | null | undefined): string | null {
  path = path || '';
  if (!baseConfig.enableModAssets || !baseConfig.modAssetBaseUrl) return null;
  if (path.charAt(0) === '/') {
    path = path.substring(1);
  }
  return baseConfig.modAssetBaseUrl + path;
}

function resolveModSpritePath(path: string | null | undefined): string | null {
  path = path || '';
  if (!baseConfig.enableModAssets || !baseConfig.modSpriteBaseUrl) return null;
  if (path.charAt(0) === '/') {
    path = path.substring(1);
  }
  return baseConfig.modSpriteBaseUrl + path;
}

function normalizeRelativePath(path: string | null | undefined): string {
  path = path || '';
  if (path.charAt(0) === '/') {
    return path.substring(1);
  }
  return path;
}

function resolveAssetPathCandidates(path: string | null | undefined): string[] {
  const normalized = normalizeRelativePath(path);
  const list: string[] = [];
  if (baseConfig.enableModAssets && baseConfig.modAssetBaseUrl && shouldUseModOverride(normalized)) {
    list.push(baseConfig.modAssetBaseUrl + normalized);
  }
  list.push((baseConfig.assetBaseUrl as string) + normalized);
  return list;
}

function resolveAudioPathCandidates(path: string | null | undefined): string[] {
  const normalized = normalizeRelativePath(path);
  const list: string[] = [];
  if (baseConfig.enableModAssets && baseConfig.modAssetBaseUrl && shouldUseModOverride(normalized)) {
    list.push(baseConfig.modAssetBaseUrl + normalized);
  }
  if (baseConfig.audioBaseUrl) {
    list.push(baseConfig.audioBaseUrl + normalized);
  }
  return list;
}

baseConfig.resolveAssetPath = resolveAssetPath;
baseConfig.resolveAudioPath = resolveAudioPath;
baseConfig.resolveModAssetPath = resolveModAssetPath;
baseConfig.resolveModSpritePath = resolveModSpritePath;
baseConfig.resolveAssetPathCandidates = resolveAssetPathCandidates;
baseConfig.resolveAudioPathCandidates = resolveAudioPathCandidates;

const config = baseConfig as PalConfig;

export default config;
