/**
 * Type definitions for NPC configuration system
 * Matches structure from pal_npc_cards_autogen.json
 */
/**
 * NPC personality configuration
 */
export interface NPCPersonality {
    tones: string[];
    traits: string[];
    motivations: string[];
    boundaries: string[];
}
/**
 * NPC speech style configuration
 */
export interface NPCSpeechStyle {
    register: string;
    addressing_rules: Record<string, string>;
    response_length: string;
    taboos: string[];
}
/**
 * NPC knowledge configuration
 */
export interface NPCKnowledge {
    home: string;
    known_locations: string[];
    scope_rule?: string;
    spoiler_rule?: string;
}
/**
 * NPC interaction policy for different interaction modes
 */
export interface NPCInteractionPolicy {
    ask_for_directions?: string;
    lore_questions?: string;
    trade?: string;
    help_request?: string;
    provocation?: string;
    party_questions?: string;
    ambient?: string;
    [key: string]: string | undefined;
}
/**
 * Line statistics from NPC card generation
 */
export interface NPCLineStats {
    line_count: number;
    unique_line_count: number;
    sources?: string[];
    top_sections?: Record<string, number>;
}
/**
 * NPC card data structure (loaded from JSON)
 */
export interface NPCCardData {
    id: string;
    name: string;
    aliases?: string[];
    role: string;
    personality: NPCPersonality;
    speech_style: NPCSpeechStyle;
    knowledge: NPCKnowledge;
    interaction_policy: NPCInteractionPolicy;
    runtime_inputs_expected: string[];
    response_format?: string;
    line_stats: NPCLineStats;
}
/**
 * Trigger configuration for NPC behaviors
 */
export interface NPCTriggers {
    proximity?: boolean;
    interaction?: boolean;
    ambient?: boolean;
}
/**
 * Threshold configuration for NPC behaviors
 */
export interface NPCThresholds {
    interceptRadius?: number;
    ambientRadius?: number;
    cooldownMs?: number;
}
/**
 * Runtime configuration combining NPC card data with game engine fields
 */
export interface NPCRuntimeConfig extends NPCCardData {
    sceneId: number;
    eventId: number;
    triggers: NPCTriggers;
    thresholds: NPCThresholds;
}
/**
 * Prototype NPC selection configuration
 */
export interface PrototypeNPCConfig {
    enabledNPCs: string[];
    llmSettings: {
        enabled: boolean;
        model?: string;
        temperature?: number;
        cooldownMs?: number;
        maxContextLines?: number;
    };
}
