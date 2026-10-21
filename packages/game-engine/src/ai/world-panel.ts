/**
 * world-panel — the live-play surface of the new timeline: a PAL-skinned
 * sidebar that makes the LIVING WORLD visible, with a chat mode that fixes
 * everything the floating talk box got wrong.
 *
 *   FEED view (default): the fair heartbeat scrolls in — pitches, street
 *   talk, trades, the rice price ticker — plus the NPCs in the current scene
 *   (one tap to chat). The world breathes on screen, not just in server logs.
 *
 *   CHAT view: the full transcript (you + the NPC, bubbles), an input row,
 *   a typing indicator while the model thinks, and the full HUD — 好感 bar,
 *   灵力 balance, accumulated thinking cost, metabolism tier. NPC replies
 *   render HERE (the canvas dialog stays for canon/cutscenes), so the
 *   space-to-advance vs typing conflict is gone.
 *
 * Wiring (bootstrap-pal-agents):
 *   welcome → setRoster · say → onSay (true = consumed by an open chat)
 *   npcState → onNpcState · feed → addFeed
 * play.ts opens chats via the module-level openWorldChat (search key on an
 * AI NPC); the send path goes through opts.send → sendPerception.
 */
import type { NpcDescriptor, ServerNpcState, FeedLine, ServerProfile } from '@onchainpal/shared';
import { roomById } from '@onchainpal/palkit';
import { getSceneIdValue } from '../services/scene-state-adapter';

export interface WorldPanelOptions {
  /** dispatch a player line to the server; false = not connected */
  send: (npcId: string, text: string) => boolean;
  /** ask the server for an NPC's 人物档案 (answered via onProfile). */
  requestProfile?: (npcId: string) => void;
  playerName?: string;
}

export interface WorldPanelHandle {
  setRoster(npcs: NpcDescriptor[]): void;
  addFeed(lines: FeedLine[]): void;
  openChat(target: { npcId: string; name?: string }): void;
  isChatting(npcId: string): boolean;
  /** an NPC line arrived — returns true when an open chat consumed it. */
  onSay(npcId: string, text: string): boolean;
  onNpcState(s: ServerNpcState): void;
  /** an NPC's 人物档案 arrived — render the standalone profile page. */
  onProfile(p: ServerProfile): void;
  unmount(): void;
}

interface ChatEntry { who: 'player' | 'npc' | 'note'; text: string; ts: number }
interface NpcInfo {
  id: string; name: string; room?: string;
  tier?: string; starving?: boolean; balanceGcc?: number | null;
  affinity?: number; spentGcc?: number;
  transcript: ChatEntry[];
}

const ROOT_ID = 'pal-world-panel';

// PAL palette: lacquer dark, aged gold, vermilion accents
const C = {
  bg: 'rgba(16,13,24,0.96)', edge: '#5a4a30', gold: '#e8d4a0', dim: '#8a7f6c',
  hot: '#ffd47e', red: '#c8553d', green: '#7da87b', bubblePlayer: '#4a3a22', bubbleNpc: '#241f33'
};
// serif stack — matches the playground shell (style.css) so the panel and the
// page chrome read as one 武侠 surface, not a monospace dev console.
const FONT = "13px/1.6 'Songti SC','STSong','Noto Serif SC','SF Pro Display',system-ui,serif";

const KIND_ICON: Record<string, string> = { pitch: '🎭', gossip: '🗣', trade: '🌾', price: '📈', info: 'ℹ️' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}

/** swallow keys so typing never reaches the engine's window listeners. */
function swallowKeys(input: HTMLElement, onEnter: () => void, onEsc: () => void): void {
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    input.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && (e as KeyboardEvent).key === 'Enter') onEnter();
      if (type === 'keydown' && (e as KeyboardEvent).key === 'Escape') onEsc();
    });
  }
}

let active: WorldPanelHandle | null = null;

/** play.ts entry point — search on an AI NPC routes here. */
export function openWorldChat(target: { npcId: string; name?: string }): boolean {
  if (!active) return false;
  active.openChat(target);
  return true;
}

export function mountWorldPanel(opts: WorldPanelOptions): WorldPanelHandle {
  const npcs = new Map<string, NpcInfo>();
  const feed: FeedLine[] = [];
  let view: 'feed' | 'chat' = 'feed';
  let chatNpcId: string | null = null;
  let collapsed = false;
  let lastPrice: number | null = null;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let typing = false;

  const info = (id: string, name?: string): NpcInfo => {
    let e = npcs.get(id);
    if (!e) { e = { id, name: name ?? id, transcript: [] }; npcs.set(id, e); }
    if (name) e.name = name;
    return e;
  };

  // ---- DOM scaffold ---------------------------------------------------------
  document.getElementById(ROOT_ID)?.remove();
  const root = el('div', [
    `position:fixed`, `right:0`, `top:0`, `bottom:0`, `z-index:99990`,
    `width:320px`, `display:flex`, `flex-direction:column`,
    `background:${C.bg}`, `border-left:2px solid ${C.edge}`,
    `font:${FONT}`, `color:${C.gold}`, `transition:transform .15s`
  ].join(';'));
  root.id = ROOT_ID;

  const header = el('div', `display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid ${C.edge};`);
  const backBtn = el('button', `display:none;background:none;border:1px solid ${C.edge};border-radius:4px;color:${C.gold};cursor:pointer;font:inherit;padding:1px 8px;`, '‹');
  const title = el('span', `font-weight:700;color:${C.hot};flex:1;`, '🏮 钱塘大集');
  const ticker = el('span', `color:${C.dim};`, '');
  const collapseBtn = el('button', `background:none;border:1px solid ${C.edge};border-radius:4px;color:${C.gold};cursor:pointer;font:inherit;padding:1px 8px;`, '»');
  header.append(backBtn, title, ticker, collapseBtn);

  const body = el('div', 'flex:1;display:flex;flex-direction:column;min-height:0;');
  const tab = el('button', [
    `position:fixed`, `right:0`, `top:12px`, `z-index:99991`, `display:none`,
    `background:${C.bg}`, `border:1px solid ${C.edge}`, `border-right:none`,
    `border-radius:6px 0 0 6px`, `color:${C.hot}`, `cursor:pointer`, `font:${FONT}`, `padding:6px 8px`
  ].join(';'), '🏮');
  root.append(header, body);
  document.body.append(root, tab);

  const setCollapsed = (c: boolean) => {
    collapsed = c;
    root.style.transform = c ? 'translateX(100%)' : '';
    tab.style.display = c ? 'block' : 'none';
  };
  collapseBtn.onclick = () => setCollapsed(true);
  tab.onclick = () => setCollapsed(false);

  // ---- FEED view ------------------------------------------------------------
  const renderFeed = () => {
    view = 'feed';
    chatNpcId = null;
    backBtn.style.display = 'none';
    title.textContent = '🏮 钱塘大集';
    body.replaceChildren();

    // 附近 — NPCs stationed in the current scene's room
    const sceneId = Number(getSceneIdValue() || 0);
    const here = [...npcs.values()].filter((n) => n.room === `scene:${sceneId}`);
    if (here.length) {
      const roomName = roomById(`scene:${sceneId}`)?.name;
      const near = el('div', `padding:6px 10px;border-bottom:1px solid ${C.edge};`);
      near.append(el('div', `color:${C.dim};margin-bottom:4px;`, roomName ? `附近 · ${roomName}` : '附近'));
      for (const n of here) {
        const row = el('div', 'display:flex;align-items:center;gap:6px;padding:2px 0;');
        row.append(
          el('span', 'flex:1;', `${n.name}${n.starving ? ' 🥵' : ''}`),
          el('span', `color:${C.dim};`, n.tier ?? '')
        );
        if (opts.requestProfile) {
          const dossier = el('button', `background:none;border:1px solid ${C.edge};border-radius:4px;color:${C.dim};cursor:pointer;font:inherit;padding:0 7px;`, '档案');
          dossier.onclick = () => opts.requestProfile!(n.id);
          row.append(dossier);
        }
        const btn = el('button', `background:${C.bubblePlayer};border:1px solid ${C.edge};border-radius:4px;color:${C.hot};cursor:pointer;font:inherit;padding:0 8px;`, '聊天');
        btn.onclick = () => api.openChat({ npcId: n.id, name: n.name });
        row.append(btn);
        near.append(row);
      }
      body.append(near);
    }

    const list = el('div', 'flex:1;overflow-y:auto;padding:6px 10px;display:flex;flex-direction:column;gap:4px;');
    list.dataset.role = 'feed-list';
    for (const l of feed.slice(-120)) {
      list.append(el('div', `color:${l.kind === 'pitch' ? C.hot : l.kind === 'trade' ? C.green : C.gold};`,
        `${KIND_ICON[l.kind] ?? ''} ${l.text}`));
    }
    if (!feed.length) list.append(el('div', `color:${C.dim};`, '大集尚无动静……'));
    body.append(list);
    list.scrollTop = list.scrollHeight;
  };

  // ---- CHAT view ------------------------------------------------------------
  let chatList: HTMLDivElement | null = null;
  let hudBox: HTMLDivElement | null = null;
  let typingRow: HTMLDivElement | null = null;

  const bar = (label: string, frac: number, color: string, text: string) => {
    const wrap = el('div', 'display:flex;align-items:center;gap:6px;');
    wrap.append(el('span', `width:34px;color:${C.dim};`, label));
    const track = el('div', `flex:1;height:8px;background:#0b0912;border:1px solid ${C.edge};border-radius:4px;overflow:hidden;`);
    track.append(el('div', `height:100%;width:${Math.max(0, Math.min(100, frac * 100))}%;background:${color};`));
    wrap.append(track, el('span', `min-width:64px;text-align:right;color:${C.gold};`, text));
    return wrap;
  };

  const renderHud = (n: NpcInfo) => {
    if (!hudBox) return;
    hudBox.replaceChildren();
    const aff = n.affinity ?? 0;
    // 灵力 reflects metabolism health (the thinking budget), keyed off the tier
    // rather than a fixed GCC scale — with the shared 0G pool a raw balance/0.01
    // bar would just sit pinned full. Show the real balance as the value.
    const lingFrac = n.starving ? 0.08 : n.tier === '充盈' ? 1 : n.tier === '清醒' ? 0.55 : n.tier ? 0.4 : 0.5;
    const bal = n.balanceGcc;
    const balText = bal != null ? (bal >= 1 ? bal.toFixed(2) : bal.toFixed(4)) : '—';
    hudBox.append(
      bar('好感', (aff + 100) / 200, aff >= 0 ? C.green : C.red, `${aff >= 0 ? '+' : ''}${aff}`),
      bar('灵力', lingFrac, n.starving ? C.red : '#7ba7c8', balText),
      el('div', `display:flex;justify-content:space-between;color:${C.dim};`,
        '')
    );
    const meta = hudBox.lastChild as HTMLElement;
    meta.append(
      el('span', '', `档位 ${n.tier ?? '—'}${n.starving ? ' 🥵饥饿' : ''}`),
      el('span', '', `累计耗灵 ${(n.spentGcc ?? 0).toFixed(4)}`)
    );
  };

  const appendBubble = (n: NpcInfo, entry: ChatEntry) => {
    if (!chatList || chatNpcId !== n.id) return;
    if (entry.who === 'note') {
      chatList.append(el('div', `align-self:center;color:${C.dim};font-size:11px;`, entry.text));
    } else {
      const mine = entry.who === 'player';
      const b = el('div', [
        `max-width:82%`, `padding:6px 9px`, `border-radius:8px`, `white-space:pre-wrap`,
        `align-self:${mine ? 'flex-end' : 'flex-start'}`,
        `background:${mine ? C.bubblePlayer : C.bubbleNpc}`,
        `border:1px solid ${C.edge}`, `color:${mine ? C.hot : C.gold}`
      ].join(';'));
      if (!mine) b.append(el('div', `color:${C.dim};font-size:10px;margin-bottom:2px;`, n.name));
      b.append(document.createTextNode(entry.text));
      chatList.append(b);
    }
    chatList.scrollTop = chatList.scrollHeight;
  };

  const setTyping = (on: boolean) => {
    typing = on;
    if (typingRow) typingRow.style.display = on ? 'block' : 'none';
    if (typingTimer) clearTimeout(typingTimer);
    if (on) typingTimer = setTimeout(() => setTyping(false), 45000);
  };

  const renderChat = (n: NpcInfo) => {
    view = 'chat';
    chatNpcId = n.id;
    setCollapsed(false);
    backBtn.style.display = 'block';
    title.textContent = n.name;
    body.replaceChildren();

    hudBox = el('div', `display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-bottom:1px solid ${C.edge};`);
    renderHud(n);

    chatList = el('div', 'flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;');
    typingRow = el('div', `display:none;color:${C.dim};padding:0 10px 4px;`, `${n.name} 正在思忖…`);

    const inputRow = el('div', `display:flex;gap:6px;padding:8px 10px;border-top:1px solid ${C.edge};`);
    const input = el('input', `flex:1;padding:7px 9px;background:#0b0912;border:1px solid ${C.edge};border-radius:6px;color:${C.gold};font:${FONT};outline:none;`);
    (input as HTMLInputElement).placeholder = `对${n.name}说…(回车发送,Esc 返回)`;
    const sendBtn = el('button', `padding:7px 14px;background:${C.bubblePlayer};border:1px solid ${C.edge};border-radius:6px;color:${C.hot};cursor:pointer;font:${FONT};`, '说');

    const submit = () => {
      const text = (input as HTMLInputElement).value.trim();
      if (!text) return;
      const ok = opts.send(n.id, text);
      const entry: ChatEntry = { who: 'player', text, ts: Date.now() };
      n.transcript.push(entry);
      appendBubble(n, entry);
      if (!ok) {
        const note: ChatEntry = { who: 'note', text: '(服务器未连,这句话没人听见)', ts: Date.now() };
        n.transcript.push(note);
        appendBubble(n, note);
      } else {
        setTyping(true);
      }
      (input as HTMLInputElement).value = '';
      input.focus();
    };
    sendBtn.onclick = submit;
    swallowKeys(input, submit, () => renderFeed());

    inputRow.append(input, sendBtn);
    body.append(hudBox, chatList, typingRow, inputRow);
    for (const entry of n.transcript) appendBubble(n, entry);
    setTyping(typing && chatNpcId === n.id ? typing : false);
    input.focus();
  };

  backBtn.onclick = () => renderFeed();

  // ---- 人物档案 (standalone profile page) -----------------------------------
  let dossier: HTMLDivElement | null = null;
  const showProfile = (p: ServerProfile) => {
    dossier?.remove();
    const veil = el('div', [
      `position:fixed`, `inset:0`, `z-index:99999`, `display:flex`,
      `align-items:center`, `justify-content:center`, `padding:20px`,
      `background:rgba(6,4,10,0.66)`, `font:${FONT}`, `color:${C.gold}`
    ].join(';'));
    const card = el('div', [
      `width:min(440px,92vw)`, `max-height:88vh`, `overflow-y:auto`,
      `background:${C.bg}`, `border:1px solid ${C.edge}`, `border-radius:14px`,
      `box-shadow:0 24px 60px rgba(0,0,0,0.6)`, `padding:18px 20px`
    ].join(';'));

    // header: portrait disc + name + track record
    const head = el('div', 'display:flex;align-items:center;gap:12px;margin-bottom:12px;');
    const disc = el('div', [
      `width:52px`, `height:52px`, `flex:none`, `border-radius:50%`,
      `border:2px solid ${C.edge}`, `background:radial-gradient(circle at 50% 35%,#2a2238,#0b0912)`,
      `display:flex`, `align-items:center`, `justify-content:center`,
      `font-size:22px`, `color:${C.hot}`
    ].join(';'), (p.name || '?').slice(0, 1));
    const titleCol = el('div', 'flex:1;min-width:0;');
    titleCol.append(
      el('div', `font-weight:700;color:${C.hot};font-size:1.2em;`, p.name),
      el('div', `color:${C.dim};margin-top:2px;`,
        `阅历 ${p.track.episodes} · 心得 ${p.track.beliefs} · 夜记 ${p.track.journals} · 识人 ${p.track.skill}`)
    );
    const close = el('button', `background:none;border:1px solid ${C.edge};border-radius:6px;color:${C.gold};cursor:pointer;font:inherit;padding:2px 9px;flex:none;`, '✕');
    close.onclick = () => { veil.remove(); dossier = null; };
    head.append(disc, titleCol, close);
    card.append(head);

    // 心得 — the beliefs it formed
    if (p.beliefs.length) {
      card.append(el('div', `color:${C.dim};margin:10px 0 4px;border-top:1px solid ${C.edge};padding-top:8px;`, '心得'));
      for (const b of p.beliefs) card.append(el('div', `padding:1px 0;`, `· ${b}`));
    }
    // 夜记 — the diary the Dream wrote
    card.append(el('div', `color:${C.dim};margin:12px 0 4px;border-top:1px solid ${C.edge};padding-top:8px;`, '夜记'));
    if (p.diary.length) {
      for (const d of [...p.diary].reverse()) {
        const entry = el('div', `margin-bottom:8px;padding:8px 10px;background:${C.bubbleNpc};border:1px solid ${C.edge};border-radius:8px;white-space:pre-wrap;line-height:1.6;`);
        if (d.date) entry.append(el('div', `color:${C.dim};font-size:10px;margin-bottom:3px;`, d.date.slice(0, 10)));
        entry.append(document.createTextNode(d.text));
        card.append(entry);
      }
    } else {
      card.append(el('div', `color:${C.dim};`, '尚无夜记 —— 还没在富足档位夜里回想过。'));
    }

    // 系统日志 — third-person debug transcript (say/move/pitch/gossip/dream)
    const LOG_ICON: Record<string, string> = { say: '💬', move: '🚶', pitch: '🎭', gossip: '🗣', dream: '🌙' };
    if (p.log && p.log.length) {
      card.append(el('div', `color:${C.dim};margin:12px 0 4px;border-top:1px solid ${C.edge};padding-top:8px;`, `系统日志(${p.log.length})`));
      const logBox = el('div', `max-height:200px;overflow-y:auto;background:#0b0912;border:1px solid ${C.edge};border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.7;`);
      for (const e of p.log) {
        const t = new Date(e.ts);
        const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        logBox.append(el('div', `color:${C.dim};`, `${hh} ${LOG_ICON[e.kind] ?? '·'} ${e.text}`));
      }
      logBox.scrollTop = logBox.scrollHeight;
      card.append(logBox);
    }

    veil.append(card);
    veil.onclick = (e) => { if (e.target === veil) { veil.remove(); dossier = null; } };
    document.body.append(veil);
    dossier = veil;
  };

  // periodic 附近 refresh while on feed view (scene changes, tiers move)
  const refresh = setInterval(() => { if (view === 'feed' && !collapsed) renderFeed(); }, 4000);

  const api: WorldPanelHandle = {
    setRoster: (list) => {
      for (const n of list) {
        const e = info(n.id, n.name);
        e.room = n.room;
        e.balanceGcc = n.balanceGcc;
        e.tier = n.tier;
        e.starving = n.starving;
      }
      if (view === 'feed') renderFeed();
    },
    addFeed: (lines) => {
      feed.push(...lines);
      if (feed.length > 400) feed.splice(0, feed.length - 400);
      for (const l of lines) if (l.price != null) lastPrice = l.price;
      ticker.textContent = lastPrice != null ? `米价 ${lastPrice.toFixed(4)}` : '';
      if (view === 'feed') renderFeed();
    },
    openChat: (t) => renderChat(info(t.npcId, t.name)),
    isChatting: (npcId) => view === 'chat' && chatNpcId === npcId,
    onSay: (npcId, text) => {
      const n = info(npcId);
      const entry: ChatEntry = { who: 'npc', text, ts: Date.now() };
      n.transcript.push(entry);
      if (view === 'chat' && chatNpcId === npcId) {
        setTyping(false);
        appendBubble(n, entry);
        return true;             // consumed — keep it out of the canvas dialog
      }
      return false;              // canvas dialog renders it (canon flow)
    },
    onProfile: (p) => showProfile(p),
    onNpcState: (s) => {
      const n = info(s.npcId);
      if (s.balanceGcc != null) n.balanceGcc = s.balanceGcc;
      if (s.tier != null) n.tier = s.tier;
      if (s.starving != null) n.starving = s.starving;
      if (s.affinity != null) n.affinity = s.affinity;
      if (s.costGcc) n.spentGcc = (n.spentGcc ?? 0) + s.costGcc;
      if (view === 'chat' && chatNpcId === s.npcId) {
        renderHud(n);
        if (s.dAffinity) {
          const note: ChatEntry = { who: 'note', text: `好感 ${s.dAffinity > 0 ? '+' : ''}${s.dAffinity} · 耗灵 ${s.costGcc?.toFixed(4) ?? '0'}`, ts: Date.now() };
          n.transcript.push(note);
          appendBubble(n, note);
        }
      }
    },
    unmount: () => {
      clearInterval(refresh);
      if (typingTimer) clearTimeout(typingTimer);
      dossier?.remove();
      root.remove();
      tab.remove();
      if (active === api) active = null;
    }
  };

  renderFeed();
  active = api;
  try { (globalThis as { PAL_PANEL?: WorldPanelHandle }).PAL_PANEL = api; } catch { /* SSR */ }
  return api;
}
