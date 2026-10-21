/**
 * PAL scene → SharedWorld room registry.
 *
 * SharedWorld rooms are plain string ids; the PAL convention is
 * `scene:<sceneId>` so a room maps 1:1 onto a PAL scene the graphical client
 * can render. `scene:aigg` is a virtual room (仙灵驿站) hosting the AIGG
 * platform NPCs — it has no PAL sceneId and the client renders it as a menu
 * surface instead of a scene.
 */
export interface PalRoom {
    /** SharedWorld room id, e.g. "scene:4" */
    id: string;
    /** PAL scene id; absent for virtual rooms (scene:aigg) */
    sceneId?: number;
    name: string;
}
export declare const AIGG_ROOM_ID = "scene:aigg";
/** 余杭集市 — PAL scene 5 (菜市场): the aigg-mud-pal market sandbox anchors here. */
export declare const YUHANG_MARKET_ROOM_ID = "scene:5";
export declare const PAL_ROOMS: PalRoom[];
export declare function roomIdForScene(sceneId: number): string;
export declare function roomById(id: string): PalRoom | undefined;
/**
 * All room ids — the curated named rooms (scene:aigg + the 余杭/苏州/蜀山
 * landmarks) UNIONED with every canon scene (scene:N) from the decoded graph,
 * so the world accepts a move into ANY map. Curated ids lead (stable order).
 */
export declare function allRoomIds(): string[];
