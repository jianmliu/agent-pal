// Pure decoders for PAL sound effects: Creative Voice (VOC.MKF, DOS) and
// RIFF WAVE (SOUNDS.MKF, Win95). No DOM / Web Audio dependencies so they can
// be unit-tested under node.

export type PcmSound = {
  sampleRate: number;
  channels: number;
  // Interleaved samples in [-1, 1].
  samples: Float32Array;
};

const VOC_SIGNATURE = 'Creative Voice File\x1A';

function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function isVoc(input: ArrayBuffer | ArrayBufferView): boolean {
  return matchesAscii(toBytes(input), 0, VOC_SIGNATURE);
}

export function isWav(input: ArrayBuffer | ArrayBufferView): boolean {
  const bytes = toBytes(input);
  return matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WAVE');
}

/**
 * Decode a Creative Voice file. Supports block type 1 (sound data, 8-bit
 * unsigned PCM only), 2 (continuation) and 9 (extended PCM, 8/16-bit mono);
 * every other block is skipped by its length. Returns null when nothing playable.
 */
export function parseVoc(input: ArrayBuffer | ArrayBufferView): PcmSound | null {
  const bytes = toBytes(input);
  if (!isVoc(bytes) || bytes.length < 26) return null;
  const dataOffset = bytes[20] | (bytes[21] << 8);
  const parts: Float32Array[] = [];
  let total = 0;
  let sampleRate = 0;
  // Whether the last type-1/9 block was decodable; continuation blocks inherit it.
  let current: { bits: 8 | 16 } | null = null;

  const pushPcm = (start: number, end: number, bits: 8 | 16) => {
    end = Math.min(end, bytes.length);
    if (end <= start) return;
    let out: Float32Array;
    if (bits === 8) {
      out = new Float32Array(end - start);
      for (let i = 0; i < out.length; i++) out[i] = (bytes[start + i] - 128) / 128;
    } else {
      out = new Float32Array((end - start) >> 1);
      for (let i = 0; i < out.length; i++) {
        const v = bytes[start + i * 2] | (bytes[start + i * 2 + 1] << 8);
        out[i] = ((v << 16) >> 16) / 32768;
      }
    }
    parts.push(out);
    total += out.length;
  };

  let pos = dataOffset;
  while (pos < bytes.length) {
    const type = bytes[pos];
    if (type === 0) break;
    if (pos + 4 > bytes.length) break;
    const size = bytes[pos + 1] | (bytes[pos + 2] << 8) | (bytes[pos + 3] << 16);
    const body = pos + 4;
    const next = body + size;
    if (type === 1 && size >= 2) {
      const tc = bytes[body];
      const codec = bytes[body + 1];
      current = null;
      if (codec === 0) {
        if (!sampleRate) sampleRate = Math.round(1000000 / (256 - tc));
        current = { bits: 8 };
        pushPcm(body + 2, next, 8);
      }
    } else if (type === 2) {
      if (current) pushPcm(body, next, current.bits);
    } else if (type === 9 && size >= 12) {
      const rate = (bytes[body] | (bytes[body + 1] << 8) | (bytes[body + 2] << 16)) + bytes[body + 3] * 0x1000000;
      const bits = bytes[body + 4];
      const channels = bytes[body + 5];
      const codec = bytes[body + 6] | (bytes[body + 7] << 8);
      current = null;
      // codec 0 = 8-bit unsigned, 4 = 16-bit signed; mono only.
      if (channels === 1 && ((codec === 0 && bits === 8) || (codec === 4 && bits === 16))) {
        if (!sampleRate) sampleRate = rate;
        current = { bits: bits as 8 | 16 };
        pushPcm(body + 12, next, current.bits);
      }
    }
    pos = next;
  }

  if (!total || !sampleRate) return null;
  const samples = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    samples.set(p, off);
    off += p.length;
  }
  return { sampleRate, channels: 1, samples };
}

/**
 * Decode a PCM RIFF WAVE (8-bit unsigned or 16-bit signed). Other encodings
 * return null so the caller can fall back to the platform decoder.
 */
export function parseWav(input: ArrayBuffer | ArrayBufferView): PcmSound | null {
  const bytes = toBytes(input);
  if (!isWav(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (pos + 8 <= bytes.length) {
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (matchesAscii(bytes, pos, 'fmt ') && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (matchesAscii(bytes, pos, 'data')) {
      if (format !== 1 || !channels || !sampleRate || (bits !== 8 && bits !== 16)) return null;
      const end = Math.min(body + size, bytes.length);
      const count = bits === 8 ? end - body : (end - body) >> 1;
      if (count <= 0) return null;
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = bits === 8 ? (bytes[body + i] - 128) / 128 : view.getInt16(body + i * 2, true) / 32768;
      }
      return { sampleRate, channels, samples };
    }
    // RIFF chunks are word-aligned.
    pos = body + size + (size & 1);
  }
  return null;
}

export function decodeSoundChunk(input: ArrayBuffer | ArrayBufferView): PcmSound | null {
  const bytes = toBytes(input);
  if (isVoc(bytes)) return parseVoc(bytes);
  if (isWav(bytes)) return parseWav(bytes);
  return null;
}
