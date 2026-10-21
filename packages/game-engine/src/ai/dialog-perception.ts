/**
 * dialog-perception — pure mapping from a PAL dialog-stream line to a neutral
 * agent Perception. Kept free of PAL-runtime imports so it's headless-testable.
 *
 * Live-wiring rules (P0 live-browser): an NPC agent should fire on a genuine
 * player interaction with THAT NPC, and must never react to its own injected
 * lines (that would loop). So we: drop empty/injected lines, require the line be
 * attributable to an enabled NPC (resolveNpcId), and dedupe so the same line
 * doesn't re-trigger.
 */
import type { Perception } from '@aigg/npc-agent';

export interface DialogLineValue {
  text?: string;
  msgId?: number | null;
  source?: string | null;
  eventObjectId?: number | null;
  injected?: boolean;
  metadata?: ({ injected?: boolean } & Record<string, unknown>) | null;
  timestamp?: number;
  /** if the host already knows which NPC this line belongs to. */
  npcId?: string;
}

export interface DialogPerceptionContext {
  playerId: string;
  /** map a dialog line to an enabled NPC's id (e.g. eventObjectId/source → card id). */
  resolveNpcId?: (value: DialogLineValue) => string | undefined;
  now?: () => number;
}

export class DialogPerceptionMapper {
  private readonly lastByNpc = new Map<string, string>();

  constructor(private readonly ctx: DialogPerceptionContext) {}

  /** returns an `interaction` Perception, or null if this line shouldn't trigger an agent. */
  toPerception(value: DialogLineValue): Perception | null {
    if (!value || typeof value.text !== 'string' || !value.text.trim()) return null;

    // never react to an NPC's own injected line — prevents feedback loops
    if (value.injected === true || value.metadata?.injected === true) return null;

    const npcId = value.npcId ?? this.ctx.resolveNpcId?.(value);
    if (!npcId) return null; // only lines attributable to an enabled NPC trigger an agent

    const dedupKey =
      value.msgId != null ? `m:${value.msgId}` : `t:${value.text.slice(0, 24)}:${value.timestamp ?? ''}`;
    if (this.lastByNpc.get(npcId) === dedupKey) return null; // same line — don't re-fire
    this.lastByNpc.set(npcId, dedupKey);

    return {
      kind: 'interaction',
      npcId,
      playerId: this.ctx.playerId,
      text: value.text,
      data: {
        msgId: value.msgId ?? null,
        source: value.source ?? null,
        eventObjectId: value.eventObjectId ?? null
      },
      timestamp: value.timestamp || (this.ctx.now ? this.ctx.now() : Date.now())
    };
  }
}
