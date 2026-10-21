import { resourceService } from '../../services/index';
// @ts-ignore - opencc-js doesn't have TypeScript definitions
import * as OpenCC from 'opencc-js';

/**
 * Big5 text encoding helpers, extracted verbatim from npc-behaviours so both the
 * legacy NPC behaviours and the new PalAgentAdapter can render utterances through
 * PAL's dialog buffer. Behaviour is unchanged from the original inline version.
 */

let big5MapPromise: Promise<Map<string, number>> | null = null;

export async function buildBig5Map() {
  if (big5MapPromise) {
    return big5MapPromise;
  }
  big5MapPromise = (async () => {
    try {
      const ascBuffer = await resourceService.loadFiles('wor16.asc');
      const entry = Array.isArray(ascBuffer) ? ascBuffer[0] : ascBuffer;
      if (!entry) {
        return new Map();
      }
      const view = entry instanceof Uint8Array
        ? entry
        : (entry instanceof ArrayBuffer ? new Uint8Array(entry) : null);
      if (!view) {
        return new Map();
      }
      const byteLength = Math.floor(view.byteLength / 2) * 2;
      const codes = new Uint16Array(view.buffer, view.byteOffset, byteLength / 2);
      const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('big5') : null;
      const map = new Map<string, number>();
      if (!decoder) {
        return map;
      }
      const tmp = new Uint8Array(2);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (!code) {
          continue;
        }
        tmp[0] = code & 0xFF;
        tmp[1] = (code >> 8) & 0xFF;
        const char = decoder.decode(tmp);
        if (char && !map.has(char)) {
          map.set(char, code);
        }
      }
      return map;
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[big5] failed to build Big5 map', err);
      }
      return new Map();
    }
  })();
  return big5MapPromise;
}

// Initialize OpenCC converter for Simplified to Traditional Chinese (cn -> tw)
const s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });

export async function encodeBig5Buffer(text: string) {
  // Convert simplified Chinese to traditional Chinese first
  const traditionalText = s2tConverter(text);

  const map = await buildBig5Map();
  const bytes: number[] = [];
  let unmappedChars = 0;
  let unmappedSample: string[] = [];

  for (const ch of traditionalText) {
    const code = map.get(ch);
    if (code) {
      bytes.push(code & 0xFF, (code >> 8) & 0xFF);
    } else {
      const cp = ch.charCodeAt(0);
      if (cp < 0x80) {
        bytes.push(cp);
      } else {
        // Character not in Big5 map even after conversion
        unmappedChars++;
        if (unmappedSample.length < 5) {
          unmappedSample.push(ch);
        }
        // Use '?' as fallback
        bytes.push(0x3F);
      }
    }
  }
  bytes.push(0);

  if (unmappedChars > 0 && typeof console !== 'undefined') {
    console.warn(`[encodeBig5] ${unmappedChars} unmapped characters after s2t conversion`, {
      original: text,
      traditional: traditionalText,
      unmappedSample: unmappedSample.join(''),
      totalChars: traditionalText.length
    });
  }

  return new Uint8Array(bytes);
}
