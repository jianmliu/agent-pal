/**
 * PalAgentAdapter — the ONLY PAL-aware layer of the NPC agent system.
 *
 * It implements the engine-neutral ports from @aigg/npc-agent against the
 * legacy PAL engine: it renders utterances through PAL's dialog buffer (Big5 +
 * NpcDialogController), enacts validated StateDeltas against PAL state, and turns
 * PAL's internal streams into neutral Perceptions.
 *
 * P0 step ② = SEAM ONLY. This module compiles and is callable, but nothing in
 * the live runtime constructs it yet, so engine behaviour is unchanged. The
 * agent runtime that drives it lands in step ③; effect application and the
 * Store-backed relationship writes are wired there/④ (marked TODO below).
 */
import type {
  Actuator,
  PerceptionSource,
  Perception,
  SayOptions,
  Unsubscribe,
  StateDelta,
  Effect
} from '@aigg/npc-agent';

import NpcDialogController from '../js/pal/npc-dialog-controller';
import { DialogPosition } from '../js/pal/pal-global';
import { encodeBig5Buffer } from '../js/pal/big5';
import aiGateway from './ai-gateway';
import { DialogPerceptionMapper, type DialogLineValue } from './dialog-perception';

/** Subscribe to a raw dialog-line stream; returns an unsubscribe. Injectable for tests. */
export type DialogStreamSubscribe = (handler: (value: DialogLineValue) => void) => Unsubscribe;

export interface PalAgentAdapterOptions {
  /** how long an injected line holds on screen before auto-advancing. */
  holdMs?: number;
  /** player identity used to scope memory/relationship until onchain identity exists. */
  playerId?: string;
  /** map a dialog line to an enabled NPC's id (eventObjectId/source → card id). */
  resolveNpcId?: (value: DialogLineValue) => string | undefined;
  /** override the dialog stream source (defaults to aiGateway 'dialog.currentLine'). */
  streamSubscribe?: DialogStreamSubscribe;
}

export class PalAgentAdapter implements Actuator, PerceptionSource {
  private readonly holdMs: number;
  private readonly playerId: string;
  private readonly resolveNpcId?: (value: DialogLineValue) => string | undefined;
  private readonly streamSubscribe: DialogStreamSubscribe;

  constructor(options: PalAgentAdapterOptions = {}) {
    this.holdMs = Number.isFinite(options.holdMs as number) ? (options.holdMs as number) : 1600;
    this.playerId = options.playerId || 'local';
    this.resolveNpcId = options.resolveNpcId;
    this.streamSubscribe =
      options.streamSubscribe ??
      ((handler) => aiGateway.subscribe({ adapter: 'dialog', stream: 'dialog.currentLine', handler }));
  }

  // --- Actuator ---------------------------------------------------------------

  async say(npcId: string, line: string, opts: SayOptions = {}): Promise<void> {
    const text = typeof line === 'string' ? line.trim() : '';
    if (!text) {
      return;
    }
    const buffer = await encodeBig5Buffer(text);
    await NpcDialogController.enqueue(buffer, {
      npcId,
      position: typeof DialogPosition !== 'undefined' ? DialogPosition.Upper : undefined,
      // awaitInput !== false → pause for the player (default). true auto-advance only when explicitly opted out.
      autoAdvance: opts.awaitInput === false,
      holdMs: this.holdMs,
      metadata: {
        source: npcId,
        npcId,
        speaker: npcId,
        injected: true,
        emotion: opts.emotion ?? null
      }
    });
  }

  async apply(delta: StateDelta): Promise<void> {
    for (const effect of delta.effects) {
      try {
        await this.applyEffect(effect, delta);
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[pal-agent-adapter] effect failed', effect, err);
        }
      }
    }
    // delta.memoryWrites + relationship persistence are handled by the Store in
    // P0 step ④ (IndexedDbStore), not by the engine adapter.
  }

  private async applyEffect(effect: Effect, _delta: StateDelta): Promise<void> {
    switch (effect.kind) {
      // goto: movement intent — the server-side PlanExecutor walks the NPC one hop/tick
      // and the move surfaces via the roster; the PAL client only reflects that, so it's
      // a no-op here (the kernel never teleports on `goto`).
      case 'goto':
      // TODO(step③): route to PAL game flags via state-service / game-flags-adapter.
      case 'setFlag':
      // TODO(step③): grant/remove through the inventory service.
      case 'giveItem':
      case 'takeItem':
      // TODO(step④): adjustRelationship needs the Store-backed RelationshipState.
      case 'adjustRelationship':
      // TODO(step③): quest milestones map to PAL script/scene flags.
      case 'startQuest':
      case 'advanceQuest':
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(`[pal-agent-adapter] effect "${effect.kind}" not yet wired (seam stage)`, effect);
        }
        return;
      default: {
        const exhaustive: never = effect;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[pal-agent-adapter] unknown effect', exhaustive);
        }
      }
    }
  }

  // --- PerceptionSource -------------------------------------------------------

  /**
   * Wraps PAL's dialog stream into neutral Perceptions. The caller is expected to
   * have loaded the 'dialog' adapter (ensureAdaptersLoaded) before subscribing;
   * the agent runtime (step ③) owns that lifecycle.
   */
  subscribe(handler: (perception: Perception) => void): Unsubscribe {
    const mapper = new DialogPerceptionMapper({ playerId: this.playerId, resolveNpcId: this.resolveNpcId });
    return this.streamSubscribe((value) => {
      const perception = mapper.toPerception(value);
      if (perception) handler(perception);
    });
  }
}

export default PalAgentAdapter;
