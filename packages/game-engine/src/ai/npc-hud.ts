/**
 * mountNpcHud — a tiny dev HUD overlay showing each NPC's "cognitive
 * metabolism" as reported by the PAL server: model tier, starving state,
 * GCC balance, affinity, and the GCC spent on conversations this session.
 * Data source is a snapshot object the server-mode bootstrap keeps fed from
 * `welcome` / `npcState` frames. Browser-only; safe no-op outside a DOM.
 */

export interface NpcHudEntry {
  name: string;
  balanceGcc?: number | null;
  tier?: string;
  starving?: boolean;
  affinity?: number;
  /** GCC burned on talks observed this session (client-side accumulation). */
  spentGcc?: number;
  calls?: number;
}

export interface NpcHudState {
  npcs: Map<string, NpcHudEntry>;
  connected: boolean;
}

export interface NpcHudOptions {
  intervalMs?: number;
  title?: string;
  /** when provided, a donate hint line is shown (donations ride the socket). */
  onDonate?: (npcId: string, gcc: number) => void;
}

export function mountNpcHud(state: NpcHudState, opts: NpcHudOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  const interval = opts.intervalMs ?? 1500;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed', 'right:8px', 'top:8px', 'z-index:99999',
    'font:12px/1.4 monospace', 'background:rgba(10,10,20,0.82)', 'color:#e8e8f0',
    'padding:8px 10px', 'border:1px solid #3a3a55', 'border-radius:6px',
    'max-width:320px', 'pointer-events:none', 'white-space:pre'
  ].join(';');
  document.body.appendChild(box);

  const fmt = (n: number) => (n < 0.001 ? n.toExponential(2) : n.toFixed(4));

  function render() {
    const lines: string[] = [
      `${opts.title ?? '🧠 NPC 认知代谢 (GCC)'}  ${state.connected ? '🟢' : '🔴未连接'}`
    ];
    for (const [, e] of state.npcs) {
      const tier = e.starving ? '🥵饥饿' : (e.tier ?? '—');
      const bal = e.balanceGcc == null ? '?' : fmt(e.balanceGcc);
      lines.push(`${e.name}  [${tier}]${e.affinity != null ? `  好感${e.affinity}` : ''}`);
      lines.push(`  余额 ${bal}  花费 ${fmt(e.spentGcc ?? 0)}  调用 ${e.calls ?? 0}`);
    }
    if (state.npcs.size === 0) lines.push('（等待 welcome…）');
    box.textContent = lines.join('\n');
  }

  render();
  const timer = setInterval(render, interval);
  return () => {
    clearInterval(timer);
    box.remove();
  };
}
