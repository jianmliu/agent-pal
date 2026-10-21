/** every canon scene id (294) — isolated scenes included. */
export declare const ALL_SCENE_IDS: number[];
/** scene id → up to 6 in-scene event-object positions ([x,y]) — overlay spots. */
export declare const SCENE_SPAWNS: Record<string, number[][]>;
/**
 * room id (`scene:N`) → neighbor room ids — the PlanExecutor walk graph over
 * ALL scenes. Isolated scenes appear with an empty neighbor list (still a room).
 */
export declare function sceneRoomGraph(): Record<string, string[]>;
/** all scene room ids (`scene:N`) — every map is a real room. */
export declare function allSceneRoomIds(): string[];
/** decoded standing spots for a room (`scene:N`), or [] if none. */
export declare function sceneSpawns(room: string): Array<{
    x: number;
    y: number;
}>;
