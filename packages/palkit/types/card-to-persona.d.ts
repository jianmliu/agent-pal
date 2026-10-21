/**
 * cardToPersona — maps a PAL NPC card (NPCCardData, the "画像" generated for each
 * NPC) into the engine-neutral NpcPersona consumed by @aigg/npc-agent.
 *
 * The card format is PAL-domain, so this translation lives host-side; the agent
 * brain only ever sees the neutral NpcPersona. Use the existing npc-config-loader
 * to load NPCCardData, then run it through here before constructing an LlmAgent.
 */
import type { NpcPersona } from '@aigg/npc-agent';
import type { NPCCardData } from '@onchainpal/shared';
export interface CardToPersonaOptions {
    /** effects this NPC may emit; defaults to dialogue-safe relationship/flag. */
    allowedEffects?: string[];
    /** max |relationship delta| per turn the resolver will allow. */
    relationshipDeltaPerTurn?: number;
}
export declare function cardToPersona(card: NPCCardData, options?: CardToPersonaOptions): NpcPersona;
