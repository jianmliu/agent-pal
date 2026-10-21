/**
 * passkey-wallet — the browser half of the self-custody payment rail. The
 * ONLY place in the whole stack where signing happens: a platform passkey
 * (WebAuthn) creates a P-256 keypair in the device authenticator; the public
 * key (x,y) goes to the server (→ wallet-svc derives the CSW counterfactual
 * address), and each payment challenge is signed on-device via
 * navigator.credentials.get. No key material ever leaves the authenticator.
 *
 * The credential id persists in localStorage('PAL_PASSKEY_ID') so the same
 * wallet is reused across sessions on this device.
 */
import type { PasskeyOwner, WebAuthnAssertionWire } from '@onchainpal/shared';

const STORAGE_KEY = 'PAL_PASSKEY_ID';

const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  '0x' + [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const b64url = {
  encode: (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
};

/** Extract the P-256 (x,y) from a SPKI DER public key (getPublicKey()):
 *  the uncompressed EC point 0x04||x||y is the last 65 bytes. */
function spkiToXy(spki: ArrayBuffer): { x: string; y: string } {
  const point = new Uint8Array(spki).slice(-65);
  if (point[0] !== 0x04) throw new Error('unexpected SPKI: no uncompressed EC point');
  return { x: toHex(point.slice(1, 33)), y: toHex(point.slice(33, 65)) };
}

export function passkeySupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.credentials && typeof PublicKeyCredential !== 'undefined';
}

/**
 * Create (first use) or recall this device's PAL passkey. Returns the owners
 * array for passkeyRegister. Creation requires a user gesture upstream.
 */
export async function ensurePasskeyOwner(): Promise<PasskeyOwner[]> {
  if (!passkeySupported()) throw new Error('此环境不支持 passkey (WebAuthn)');

  const storedPub = localStorage.getItem(`${STORAGE_KEY}_PUB`);
  if (localStorage.getItem(STORAGE_KEY) && storedPub) {
    return [JSON.parse(storedPub) as PasskeyOwner];
  }

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Onchain PAL' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'pal-player',
        displayName: 'PAL 玩家'
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],   // ES256 (P-256)
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      timeout: 60000
    }
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey 创建被取消');

  const resp = cred.response as AuthenticatorAttestationResponse;
  const spki = resp.getPublicKey?.();
  if (!spki) throw new Error('认证器未返回公钥 (getPublicKey)');
  const owner = spkiToXy(spki);

  localStorage.setItem(STORAGE_KEY, b64url.encode(cred.rawId));
  localStorage.setItem(`${STORAGE_KEY}_PUB`, JSON.stringify(owner));
  return [owner];
}

/** Sign a payment challenge with this device's passkey → wire assertion. */
export async function signChallenge(challenge: string): Promise<WebAuthnAssertionWire> {
  const id = localStorage.getItem(STORAGE_KEY);
  if (!id) throw new Error('尚未创建 passkey');
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(challenge) as BufferSource,
      allowCredentials: [{ type: 'public-key', id: b64url.decode(id) as BufferSource }],
      userVerification: 'preferred',
      timeout: 60000
    }
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey 签名被取消');
  const resp = cred.response as AuthenticatorAssertionResponse;
  return {
    authenticatorData: toHex(resp.authenticatorData),
    clientDataJSON: toHex(resp.clientDataJSON),
    signature: toHex(resp.signature)
  };
}
