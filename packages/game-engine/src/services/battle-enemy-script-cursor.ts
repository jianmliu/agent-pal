import { childInteger, createChildCursor, validateChildCursor, selectChildFrame, commitChildFrame, pushChildFrame, returnChildFrame, writeChildReturn, copyChildCursor, type ChildCursor, type ChildFrame, } from './battle-child-script-cursor';
export type EnemyScriptKind = 'enemy-turn-start' | 'enemy-ready';
export interface EnemyScriptSource {
    kind: EnemyScriptKind;
    enemyIndex: number;
    objectId: number;
    eventId: number;
    configuredEntry: number;
    resolvedEntry: number;
    invocationIndex: number;
}
export type BattleEnemyScriptCursor = ChildCursor<EnemyScriptSource>;
export function validateEnemyScriptCursor(c: BattleEnemyScriptCursor): void {
    validateChildCursor(c);
    const s = c.source;
    if (!['enemy-turn-start', 'enemy-ready'].includes(s.kind) || !childInteger(s.objectId, 1) ||
        ![s.enemyIndex, s.eventId, s.configuredEntry, s.resolvedEntry, s.invocationIndex].every(n => childInteger(n))) {
        throw new TypeError('invalid enemy script source');
    }
}
export function createBattleEnemyScriptCursor(source: EnemyScriptSource, entry: number, event: number, registers: BattleEnemyScriptCursor['registers']): BattleEnemyScriptCursor {
    const c = createChildCursor(source, entry, event, registers);
    validateEnemyScriptCursor(c);
    return c;
}
export function selectEnemyScriptFrame(c: BattleEnemyScriptCursor): ChildFrame {
    validateEnemyScriptCursor(c);
    return selectChildFrame(c);
}
export function commitEnemyScriptFrame(c: BattleEnemyScriptCursor, f: ChildFrame): void {
    validateEnemyScriptCursor(c);
    commitChildFrame(c, f);
}
export function pushEnemyScriptFrame(c: BattleEnemyScriptCursor, entry: number, event: number): void {
    validateEnemyScriptCursor(c);
    pushChildFrame(c, entry, event);
}
export function returnEnemyScriptFrame(c: BattleEnemyScriptCursor, entry: number): void {
    validateEnemyScriptCursor(c);
    returnChildFrame(c, entry);
}
export function writeEnemyScriptReturn(c: BattleEnemyScriptCursor, writer: (entry: number) => void): void {
    validateEnemyScriptCursor(c);
    writeChildReturn(c, writer);
}
export function copyEnemyScriptCursor(c: BattleEnemyScriptCursor): BattleEnemyScriptCursor {
    validateEnemyScriptCursor(c);
    return copyChildCursor(c);
}
