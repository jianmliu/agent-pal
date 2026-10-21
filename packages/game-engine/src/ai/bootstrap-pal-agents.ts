/**
 * bootstrapPalAgents — connect the running PAL game to the PAL server
 * (apps/pal-server), where the NPC brains live (SharedWorld + deterministic
 * STF). The browser keeps only the seam: dialog perceptions go up the
 * WebSocket, `say` frames render through the PAL dialog buffer, `npcState`
 * frames feed the metabolism HUD.
 *
 * Offline = graceful silence: PAL's native scripted dialog is untouched, the
 * client auto-reconnects with backoff, and no fake AI lines are injected.
 *
 * The playground invokes this behind `?server=1` (or ?server=ws://host/pal).
 * Must run AFTER the engine has started (dialog adapter + scene data ready).
 */
import type { ServerNpcState, ServerWelcome } from '@onchainpal/shared';
import { PalAgentAdapter } from './pal-agent-adapter';
import type { DialogLineValue } from './dialog-perception';
import { ensureAdaptersLoaded } from './ai-gateway';
import { PalServerClient } from './pal-server-client';
import { mountNpcHud, type NpcHudState, type NpcHudEntry } from './npc-hud';
import { mountMenuUi } from './npc-menu-ui';
import { mountWorldPanel, type WorldPanelHandle } from './world-panel';
import { updateOverlayFromRoster, suppressedEventIds } from './npc-overlay';
import worldService from '../services/world-service';
import { timelineActive } from './timeline';
import { ensurePasskeyOwner, signChallenge, passkeySupported } from './passkey-wallet';
import { AIGG_ROOM_ID } from '@onchainpal/palkit';

export interface BootstrapPalAgentsOptions {
  /** PAL server WebSocket URL (default ws://localhost:4010/pal). */
  serverUrl?: string;
  /** ai.gg SECRET for the hello frame (read from localStorage, never the URL). */
  serverSecret?: string;
  playerId?: string;
  /** mount the cognitive-metabolism HUD overlay (?hud=1). */
  hud?: boolean;
}

export interface PalServerMode {
  client: PalServerClient;
  stop: () => void;
}

export async function bootstrapPalServerMode(options: BootstrapPalAgentsOptions = {}): Promise<PalServerMode> {
  await ensureAdaptersLoaded(['dialog']);

  // welcome roster → PAL dialog attribution, by EVENT OBJECT ONLY. Script
  // dialog lines carry the eventObjectId of the event that ran them
  // (script-runner sets it as line metadata), so a line attributes to an AI
  // NPC iff it came from THAT NPC's own event — i.e. the player interacted
  // with it. Speaker-name matching is deliberately gone: cutscene lines also
  // name their speakers (e.g. 李大娘 in the opening cinematic) and were being
  // mis-attributed, summoning AI replies over scripted story dialog.
  const byEvent = new Map<number, string>();
  const resolveNpcId = (value: DialogLineValue): string | undefined => {
    if (value.eventObjectId != null && byEvent.has(value.eventObjectId)) return byEvent.get(value.eventObjectId);
    return undefined;
  };

  // HUD state — fed by welcome (roster) and npcState (per-turn TalkResult mirror)
  const hudState: NpcHudState = { npcs: new Map<string, NpcHudEntry>(), connected: false };
  // roster application — shared by welcome and the live `roster` push (moves):
  // dialog attribution rebuilds, the panel's 附近 list refreshes, and
  // npc-overlay re-anchors wanderers (updateOverlayFromRoster runs inside the
  // client on welcome only, so the push re-runs it here).
  const applyRoster = (npcs: ServerWelcome['npcs']) => {
    byEvent.clear();
    for (const n of npcs) {
      if (n.pal?.eventId != null) byEvent.set(n.pal.eventId, n.id);
    }
    updateOverlayFromRoster(npcs);   // wanderers re-anchor (the client only does this on welcome)
    // all-overlay (timeline): the canon event objects of overlay-rendered NPCs
    // go Hidden — render, search and collision all see ONE body, the overlay.
    for (const id of suppressedEventIds()) {
      try {
        worldService.mutateEventObjectById(id, (evt: Record<string, unknown>) => {
          if (evt && evt.state !== 0) evt.state = 0;
          return evt;
        });
      } catch { /* eo table not ready yet — the next roster push retries */ }
    }
    panel?.setRoster(npcs);
  };

  const applyWelcome = (w: ServerWelcome) => {
    for (const n of w.npcs) {
      hudState.npcs.set(n.id, {
        ...hudState.npcs.get(n.id),
        name: n.name, balanceGcc: n.balanceGcc, tier: n.tier, starving: n.starving
      });
    }
  };
  const applyState = (s: ServerNpcState) => {
    const e = hudState.npcs.get(s.npcId) ?? { name: s.npcId };
    if (s.balanceGcc != null) e.balanceGcc = s.balanceGcc;
    if (s.tier != null) e.tier = s.tier;
    if (s.starving != null) e.starving = s.starving;
    if (s.affinity != null) e.affinity = s.affinity;
    if (s.costGcc) { e.spentGcc = (e.spentGcc ?? 0) + s.costGcc; e.calls = (e.calls ?? 0) + 1; }
    hudState.npcs.set(s.npcId, e);
  };

  const adapter = new PalAgentAdapter({ playerId: options.playerId, resolveNpcId });
  // the live-play surface (new timeline): world feed sidebar + chat mode.
  // Chat-open say frames render in the panel; everything else keeps the
  // canvas dialog (canon flow untouched).
  let panel: WorldPanelHandle | undefined;
  let menuUi: ReturnType<typeof mountMenuUi> | undefined;
  // passkey rail state — registration resolves when the server answers passkeyWallet
  let passkeyRegistered: Promise<string> | undefined;
  let resolveRegistered: ((address: string) => void) | undefined;
  const client = new PalServerClient({
    url: options.serverUrl ?? 'ws://localhost:4010/pal',
    playerId: options.playerId ?? 'player:local',
    secret: options.serverSecret,
    onWelcome: (w) => {
      applyRoster(w.npcs);
      applyWelcome(w);
      passkeyRegistered = undefined;   // server session state resets on (re)connect
      menuUi?.setPasskeyEnabled(!!w.passkey && passkeySupported());
      menuUi?.onWelcome(w.npcs, AIGG_ROOM_ID);
      console.log(`[pal-agents/server] welcome — ${w.npcs.length} 个 NPC`, w.npcs.map((n) => n.name).join('、'));
    },
    onSay: (m) => {
      console.debug(`[pal-agents/server] say ${m.npcId}: ${m.text}`);
      if (panel?.onSay(m.npcId, m.text)) return;   // an open chat consumed it
      void adapter.say(m.npcId, m.text, { emotion: m.emotion, awaitInput: m.awaitInput });
    },
    onNpcState: (s) => { applyState(s); panel?.onNpcState(s); },
    onFeed: (m) => panel?.addFeed(m.lines),
    onRoster: (m) => { applyRoster(m.npcs); applyWelcome({ npcs: m.npcs } as ServerWelcome); },
    onProfile: (m) => panel?.onProfile(m),
    onMenu: (m) => menuUi?.onMenu(m),
    onMenuResult: (m) => menuUi?.onMenuResult(m),
    onPasskeyWallet: (m) => {
      console.log(`[pal-agents/server] passkey 钱包 ${m.address}`);
      resolveRegistered?.(m.address);
    },
    onPaymentChallenge: (m) => {
      // the only signing in the stack: the device passkey signs the challenge
      menuUi?.notice('🔏 请用 passkey 确认签名…');
      signChallenge(m.challenge)
        .then((assertion) => client.sendPaymentSign(m.payId, assertion))
        .catch((e) => menuUi?.notice(`签名取消/失败：${e instanceof Error ? e.message : e}`));
    },
    onPaymentResult: (m) => {
      console.log(`[pal-agents/server] paymentResult ok=${m.ok}${m.receiptId ? ` receipt=${m.receiptId}` : ''}${m.message ? ` ${m.message}` : ''}`);
      menuUi?.notice(m.ok ? `✅ 供奉成功${m.receiptId ? `（${m.receiptId.slice(0, 18)}…）` : ''}` : `❌ 供奉失败：${m.message ?? ''}`);
    },
    onError: (e) => console.warn(`[pal-agents/server] server error ${e.code}: ${e.message}`),
    onStatus: (s) => {
      hudState.connected = s === 'open';
      if (s === 'open') console.log('[pal-agents/server] AI 服务器已连接');
      if (s === 'closed') console.warn('[pal-agents/server] AI 服务器未连接 — NPC 静默,自动重连中(原生剧情不受影响)');
    }
  });

  const unsubscribe = adapter.subscribe((p) => {
    if (p.kind !== 'interaction' || !p.npcId || !p.text) return;
    const data = (p.data ?? {}) as { eventObjectId?: number | null };
    client.sendPerception({
      kind: 'dialog', npcId: p.npcId, text: p.text,
      eventObjectId: data.eventObjectId ?? undefined
    });
  });
  // 供奉 flow: ensure the device passkey → register the CSW with the server
  // (per connection) → fire the donate intent; the challenge/sign round-trip
  // is handled by the global onPaymentChallenge above.
  const donateViaPasskey = async (npcId: string, gcc: number) => {
    try {
      menuUi?.notice('🔑 准备 passkey 钱包…');
      const owners = await ensurePasskeyOwner();
      if (!passkeyRegistered) {
        passkeyRegistered = new Promise<string>((resolve, reject) => {
          resolveRegistered = resolve;
          setTimeout(() => reject(new Error('注册超时')), 30000);
          client.sendPasskeyRegister(owners);
        });
      }
      const address = await passkeyRegistered;
      menuUi?.notice(`💝 供奉中（钱包 ${address.slice(0, 10)}…）`);
      client.sendDonateIntent(npcId, gcc);
    } catch (e) {
      passkeyRegistered = undefined;
      menuUi?.notice(`❌ ${e instanceof Error ? e.message : e}`);
    }
  };

  // 仙灵驿站 — appears when the roster has scene:aigg NPCs (or passkey 供奉 is on)
  menuUi = mountMenuUi(client, { onPasskeyDonate: (npcId, gcc) => void donateViaPasskey(npcId, gcc) });
  if (timelineActive()) {
    panel = mountWorldPanel({
      send: (npcId, text) => client.sendPerception({ kind: 'dialog', npcId, text }),
      requestProfile: (npcId) => client.requestProfile(npcId),
      playerName: options.playerId
    });
  }
  client.connect();

  let unmountHud: (() => void) | undefined;
  if (options.hud) unmountHud = mountNpcHud(hudState, { onDonate: (npcId, gcc) => client.sendDonate(npcId, gcc) });

  const handle: PalServerMode = {
    client,
    stop: () => { unsubscribe(); menuUi?.unmount(); panel?.unmount(); unmountHud?.(); client.close(); }
  };
  if (typeof window !== 'undefined') (window as any).PAL_SERVER = handle;
  return handle;
}
