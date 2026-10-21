/**
 * PalServerClient — the graphical client's connection to the PAL server
 * (apps/pal-server, SharedWorld/STF NPC brains). Speaks the @onchainpal/shared
 * wire protocol over the platform WebSocket (browser / Capacitor / Node ≥22).
 *
 * - hello (version + optional secret) rides the FIRST frame, never the URL
 * - typed dispatch via the shared codec — malformed frames are dropped
 * - automatic reconnect with exponential backoff (1s → 30s); a fatal server
 *   error (auth/version) stops reconnecting — honest failure, no retry storm
 * - offline behaviour is graceful silence: callers simply stop receiving
 *   `say` frames; PAL's native scripted dialog is unaffected
 */
import { updateOverlayFromRoster } from './npc-overlay';
import {
  PAL_PROTOCOL_VERSION, parseServerMsg, serialize,
  type ClientMsg, type ClientPerception, type PasskeyOwner, type WebAuthnAssertionWire,
  type ServerWelcome, type ServerSay, type ServerNpcState, type ServerError,
  type ServerMenu, type ServerMenuResult,
  type ServerPasskeyWallet, type ServerPaymentChallenge, type ServerPaymentResult
} from '@onchainpal/shared';

export type PalServerStatus = 'connecting' | 'open' | 'closed' | 'stopped';

export interface PalServerClientOptions {
  /** ws://host:4010/pal */
  url: string;
  playerId: string;
  /** ai.gg SECRET — sent in the hello frame only. */
  secret?: string;
  platform?: 'web' | 'ios' | 'android';
  appVersion?: string;
  onWelcome?: (msg: ServerWelcome) => void;
  onSay?: (msg: ServerSay) => void;
  onNpcState?: (msg: ServerNpcState) => void;
  onFeed?: (msg: import('@onchainpal/shared').ServerFeed) => void;
  onRoster?: (msg: import('@onchainpal/shared').ServerRoster) => void;
  /** an NPC's 人物档案 (track record + 心得 + 夜记) answer. */
  onProfile?: (msg: import('@onchainpal/shared').ServerProfile) => void;
  /** menu-NPC interaction surface (platform NPCs — zero LLM). */
  onMenu?: (msg: ServerMenu) => void;
  onMenuResult?: (msg: ServerMenuResult) => void;
  /** passkey self-custody payment rail. */
  onPasskeyWallet?: (msg: ServerPasskeyWallet) => void;
  onPaymentChallenge?: (msg: ServerPaymentChallenge) => void;
  onPaymentResult?: (msg: ServerPaymentResult) => void;
  onError?: (msg: ServerError) => void;
  onStatus?: (status: PalServerStatus) => void;
  /** reconnect backoff bounds (ms); exposed for tests. */
  backoffMinMs?: number;
  backoffMaxMs?: number;
}

export class PalServerClient {
  private ws?: WebSocket;
  private stopped = false;
  private fatal = false;
  private backoffMs: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly minMs: number;
  private readonly maxMs: number;

  constructor(private readonly opts: PalServerClientOptions) {
    this.minMs = opts.backoffMinMs ?? 1000;
    this.maxMs = opts.backoffMaxMs ?? 30000;
    this.backoffMs = this.minMs;
  }

  connect(): void {
    if (this.stopped || this.fatal) return;
    this.opts.onStatus?.('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (e) {
      console.warn('[pal-server-client] connect failed', e);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = this.minMs;
      this.send({
        type: 'hello', v: PAL_PROTOCOL_VERSION,
        playerId: this.opts.playerId,
        secret: this.opts.secret,
        client: { app: 'pal-playground', platform: this.opts.platform ?? 'web', version: this.opts.appVersion }
      });
      this.opts.onStatus?.('open');
    };
    ws.onmessage = (ev) => {
      const msg = parseServerMsg(String(ev.data));
      if (!msg) return; // malformed server frame — drop
      switch (msg.type) {
        case 'welcome':
          // map projection (npc-overlay): visitors with {sceneId,x,y,spriteNum}
          // anchors spawn as overlay sprites on the real maps
          updateOverlayFromRoster(msg.npcs);
          return this.opts.onWelcome?.(msg);
        case 'say': return this.opts.onSay?.(msg);
        case 'npcState': return this.opts.onNpcState?.(msg);
        case 'feed': return this.opts.onFeed?.(msg);
        case 'roster': return this.opts.onRoster?.(msg);
        case 'profile': return this.opts.onProfile?.(msg);
        case 'menu': return this.opts.onMenu?.(msg);
        case 'menuResult': return this.opts.onMenuResult?.(msg);
        case 'passkeyWallet': return this.opts.onPasskeyWallet?.(msg);
        case 'paymentChallenge': return this.opts.onPaymentChallenge?.(msg);
        case 'paymentResult': return this.opts.onPaymentResult?.(msg);
        case 'error':
          if (msg.fatal) this.fatal = true; // auth/version — reconnecting won't help
          return this.opts.onError?.(msg);
        case 'effect':
        case 'pong':
          return;
      }
    };
    ws.onclose = () => {
      this.opts.onStatus?.(this.stopped || this.fatal ? 'stopped' : 'closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows and owns the reconnect */ };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.fatal) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxMs);
  }

  get isOpen(): boolean { return this.ws?.readyState === 1; }

  send(msg: ClientMsg): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(serialize(msg));
    return true;
  }

  sendPerception(p: Omit<ClientPerception, 'type' | 'ts'>): boolean {
    return this.send({ type: 'perception', ts: Date.now(), ...p });
  }

  sendDonate(npcId: string, gcc: number): boolean {
    return this.send({ type: 'donate', npcId, gcc });
  }

  sendPasskeyRegister(owners: PasskeyOwner[]): boolean {
    return this.send({ type: 'passkeyRegister', owners });
  }

  sendDonateIntent(npcId: string, gcc: number): boolean {
    return this.send({ type: 'donateIntent', npcId, gcc });
  }

  sendPaymentSign(payId: string, assertion: WebAuthnAssertionWire): boolean {
    return this.send({ type: 'paymentSign', payId, assertion });
  }

  ping(): boolean { return this.send({ type: 'ping', ts: Date.now() }); }

  /** ask for an NPC's 人物档案 — answered via onProfile. */
  requestProfile(npcId: string): boolean { return this.send({ type: 'profile', npcId }); }

  close(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.opts.onStatus?.('stopped');
  }
}
