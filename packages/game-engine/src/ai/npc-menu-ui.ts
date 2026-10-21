/**
 * mountMenuUi — the 仙灵驿站 (scene:aigg) interaction surface: a DOM overlay
 * for the platform menu NPCs (碧玄子 pricing / 秦薇 merchant), which live in a
 * virtual room the PAL engine has no scene for.
 *
 * Flow: a floating 🏮 entry button appears once the welcome roster contains
 * scene:aigg NPCs → NPC list → tapping an NPC sends a dialog perception (the
 * server opens its menu, zero LLM) → `menu` frames render title/body/actions,
 * `menuResult` frames append output lines; action taps and free-text input go
 * back up as dialog perceptions; '0' exits. Browser-only; no PAL engine
 * coupling — same overlay pattern as npc-hud, but interactive.
 */
import type { NpcDescriptor, ServerMenu, ServerMenuResult } from '@onchainpal/shared';
import type { PalServerClient } from './pal-server-client';

export interface MenuUiHandle {
  /** feed the welcome roster — shows the entry button when 驿站 NPCs exist. */
  onWelcome: (npcs: NpcDescriptor[], aiggRoomId: string) => void;
  onMenu: (msg: ServerMenu) => void;
  onMenuResult: (msg: ServerMenuResult) => void;
  /** enable the 供奉 (passkey self-custody donate) section in the lobby. */
  setPasskeyEnabled: (enabled: boolean) => void;
  /** show a one-line status under the lobby (payment progress/results). */
  notice: (text: string) => void;
  unmount: () => void;
}

const S = {
  base: 'font:13px/1.5 -apple-system,"PingFang SC",sans-serif;color:#e8e8f0;',
  panel: [
    'position:fixed', 'right:8px', 'bottom:56px', 'z-index:99998', 'width:340px',
    'max-height:70vh', 'display:flex', 'flex-direction:column',
    'background:rgba(14,12,24,0.94)', 'border:1px solid #6b5b3e', 'border-radius:10px',
    'box-shadow:0 6px 24px rgba(0,0,0,0.5)', 'overflow:hidden'
  ].join(';'),
  button: [
    'position:fixed', 'right:8px', 'bottom:8px', 'z-index:99998',
    'padding:8px 14px', 'background:rgba(34,28,18,0.92)', 'color:#f0d9a0',
    'border:1px solid #6b5b3e', 'border-radius:20px', 'cursor:pointer',
    'font:14px/1 -apple-system,"PingFang SC",sans-serif'
  ].join(';'),
  header: 'padding:10px 12px;background:rgba(60,48,28,0.6);color:#f0d9a0;font-weight:600;display:flex;justify-content:space-between;align-items:center;',
  body: 'padding:10px 12px;overflow-y:auto;flex:1;white-space:pre-wrap;',
  actions: 'padding:8px 12px 12px;display:flex;flex-direction:column;gap:6px;',
  actionBtn: 'text-align:left;padding:7px 10px;background:rgba(70,58,36,0.55);color:#e8e8f0;border:1px solid #5a4a30;border-radius:6px;cursor:pointer;font:13px/1.3 inherit;',
  inputRow: 'display:flex;gap:6px;padding:0 12px 12px;',
  input: 'flex:1;padding:7px 10px;background:rgba(20,18,30,0.9);color:#e8e8f0;border:1px solid #5a4a30;border-radius:6px;font:13px/1.3 inherit;',
  dim: 'color:#9a8f7a;'
};

export interface MenuUiOptions {
  title?: string;
  /** invoked when the player taps 供奉 on an NPC (passkey donate, fixed amount). */
  onPasskeyDonate?: (npcId: string, gcc: number) => void;
  /** the fixed 供奉 amount (default 0.005 GCC). */
  donateGcc?: number;
}

export function mountMenuUi(client: PalServerClient, opts: MenuUiOptions = {}): MenuUiHandle {
  if (typeof document === 'undefined') {
    return { onWelcome: () => {}, onMenu: () => {}, onMenuResult: () => {}, setPasskeyEnabled: () => {}, notice: () => {}, unmount: () => {} };
  }
  const title = opts.title ?? '🏮 仙灵驿站';
  const donateGcc = opts.donateGcc ?? 0.005;

  let npcs: NpcDescriptor[] = [];
  let palNpcs: NpcDescriptor[] = [];
  let activeNpcId: string | null = null;
  let currentMenu: ServerMenu | null = null;
  let log: string[] = [];
  let open = false;
  let passkeyEnabled = false;
  let noticeText = '';

  const button = document.createElement('button');
  button.style.cssText = S.button;
  button.textContent = title;
  button.style.display = 'none';
  button.dataset.testid = 'aigg-menu-button';
  button.onclick = () => { open = !open; render(); };
  document.body.appendChild(button);

  const panel = document.createElement('div');
  panel.style.cssText = S.panel + ';' + S.base;
  panel.style.display = 'none';
  panel.dataset.testid = 'aigg-menu-panel';
  document.body.appendChild(panel);

  const talkTo = (npcId: string, text: string) => client.sendPerception({ kind: 'dialog', npcId, text });

  const el = (tag: string, css: string, text?: string) => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e as HTMLElement;
  };

  function render() {
    panel.style.display = open ? 'flex' : 'none';
    if (!open) return;
    panel.replaceChildren();

    const inMenu = activeNpcId != null;
    const header = el('div', S.header);
    const npcName = inMenu ? (npcs.find((n) => n.id === activeNpcId)?.name ?? activeNpcId) : null;
    header.appendChild(el('span', '', inMenu ? `${npcName}` : title));
    const headBtns = el('span', 'display:flex;gap:8px;');
    if (inMenu) {
      const back = el('button', S.actionBtn + ';padding:3px 9px;', '⟵ 驿站');
      back.onclick = () => { if (activeNpcId) talkTo(activeNpcId, '0'); activeNpcId = null; currentMenu = null; log = []; render(); };
      headBtns.appendChild(back);
    }
    const close = el('button', S.actionBtn + ';padding:3px 9px;', '✕');
    close.onclick = () => { open = false; render(); };
    headBtns.appendChild(close);
    header.appendChild(headBtns);
    panel.appendChild(header);

    if (!inMenu) {
      // --- lobby: 掌柜 list + optional 供奉 section --------------------------
      const body = el('div', S.body);
      body.appendChild(el('div', S.dim + 'margin-bottom:8px;', '驿站中的掌柜们（菜单对话，不耗灵力）：'));
      for (const n of npcs) {
        const b = el('button', S.actionBtn + ';width:100%;margin-bottom:6px;', `${n.name}${n.tier ? `  〔${n.tier}〕` : ''}`);
        b.dataset.npcId = n.id;
        b.onclick = () => { activeNpcId = n.id; currentMenu = null; log = ['（上前见礼……）']; talkTo(n.id, '你好'); render(); };
        body.appendChild(b);
      }
      if (passkeyEnabled && palNpcs.length && opts.onPasskeyDonate) {
        body.appendChild(el('div', S.dim + 'margin:10px 0 6px;border-top:1px solid #3a3322;padding-top:8px;', `💝 供奉（passkey 自持钱包，每次 ${donateGcc} GCC）：`));
        for (const n of palNpcs) {
          const b = el('button', S.actionBtn + ';width:100%;margin-bottom:6px;', `供奉 ${n.name}${n.starving ? '（灵力枯竭！）' : ''}`);
          b.dataset.donateNpcId = n.id;
          b.onclick = () => opts.onPasskeyDonate!(n.id, donateGcc);
          body.appendChild(b);
        }
      }
      if (noticeText) body.appendChild(el('div', 'margin-top:8px;color:#f0d9a0;', noticeText));
      panel.appendChild(body);
      return;
    }

    // --- conversation: log + current menu node ------------------------------
    const body = el('div', S.body);
    for (const line of log) body.appendChild(el('div', 'margin-bottom:4px;', line));
    if (currentMenu) {
      body.appendChild(el('div', 'margin:8px 0 4px;color:#f0d9a0;font-weight:600;', currentMenu.title));
      for (const line of currentMenu.body ?? []) body.appendChild(el('div', S.dim, line));
    }
    panel.appendChild(body);
    body.scrollTop = body.scrollHeight;

    if (currentMenu?.prompt) {
      // free-text input mode (e.g. cost calculator)
      body.appendChild(el('div', S.dim + 'margin-top:6px;', currentMenu.prompt));
      const row = el('div', S.inputRow);
      const input = el('input', S.input) as HTMLInputElement;
      input.placeholder = '输入后回车…';
      const submit = () => { const v = input.value.trim(); if (v && activeNpcId) { log.push(`你：${v}`); talkTo(activeNpcId, v); input.value = ''; render(); } };
      input.onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') submit(); };
      const send = el('button', S.actionBtn, '发送');
      send.onclick = submit;
      row.appendChild(input); row.appendChild(send);
      panel.appendChild(row);
    } else if (currentMenu) {
      const actions = el('div', S.actions);
      for (const a of currentMenu.actions) {
        const b = el('button', S.actionBtn, `[${a.key}] ${a.label}`);
        b.dataset.menuKey = a.key;
        b.onclick = () => { if (activeNpcId) talkTo(activeNpcId, a.key); };
        actions.appendChild(b);
      }
      panel.appendChild(actions);
    }
  }

  return {
    onWelcome: (roster, aiggRoomId) => {
      npcs = roster.filter((n) => n.room === aiggRoomId);
      palNpcs = roster.filter((n) => n.room !== aiggRoomId);
      button.style.display = npcs.length || (passkeyEnabled && palNpcs.length) ? '' : 'none';
      if (!npcs.length && !palNpcs.length) { open = false; activeNpcId = null; }
      render();
    },
    setPasskeyEnabled: (enabled) => { passkeyEnabled = enabled; render(); },
    notice: (text) => { noticeText = text; render(); },
    onMenu: (m) => {
      if (m.npcId !== activeNpcId) return;
      currentMenu = m;
      open = true;
      render();
    },
    onMenuResult: (m) => {
      if (m.npcId !== activeNpcId) return;
      log.push(...m.output);
      if (m.exit) { currentMenu = null; activeNpcId = null; }
      render();
    },
    unmount: () => { button.remove(); panel.remove(); }
  };
}
