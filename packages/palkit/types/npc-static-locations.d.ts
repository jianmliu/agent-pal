/**
 * Static NPC location mappings
 *
 * This is a fallback/simplified mapping for prototype NPCs.
 * For full dynamic NPC discovery, use npc-map-export tool interactively.
 *
 * Data source: Manual inspection and pal_npc_index.csv
 */
export interface NPCLocationData {
    sceneId: number;
    eventId: number;
    location?: string;
    /** decoded canon stand position + sprite — the all-overlay render anchor
     *  (timeline mode hides the canon event object and draws this instead,
     *  so the SAME pipeline renders stay-at-homes and wanderers alike). */
    x?: number;
    y?: number;
    spriteNum?: number;
}
/**
 * Static mappings for prototype NPCs
 */
export declare const NPC_STATIC_LOCATIONS: Record<string, NPCLocationData>;
/**
 * Get static NPC location
 */
export declare function getStaticNPCLocation(npcName: string): NPCLocationData | null;
