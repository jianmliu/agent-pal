import { childInteger, createChildCursor, validateChildCursor, selectChildFrame, commitChildFrame, pushChildFrame, returnChildFrame, writeChildReturn, copyChildCursor, type ChildCursor, type ChildFrame, } from './battle-child-script-cursor';
export type PreBattleScriptKind = 'enemy-prebattle';
export interface PreBattleSource {
    kind: PreBattleScriptKind;
    enemyIndex: number;
    objectId: number;
    eventId: number;
    configuredEntry: number;
    resolvedEntry: number;
    invocationIndex: number;
}
export type BattlePreBattleScriptCursor = ChildCursor<PreBattleSource>;
export function validatePreBattleScriptCursor(c: BattlePreBattleScriptCursor): void {
    validateChildCursor(c);
    const s = c.source;
    if (s.kind !== 'enemy-prebattle' || !childInteger(s.objectId) ||
        ![s.enemyIndex, s.eventId, s.configuredEntry, s.resolvedEntry, s.invocationIndex].every(n => childInteger(n))) {
        throw new TypeError('invalid prebattle script source');
    }
}
export function createBattlePreBattleScriptCursor(source: PreBattleSource, entry: number, event: number, registers: BattlePreBattleScriptCursor['registers']): BattlePreBattleScriptCursor {
    const c = createChildCursor(source, entry, event, registers);
    validatePreBattleScriptCursor(c);
    return c;
}
export function selectPreBattleScriptFrame(c: BattlePreBattleScriptCursor): ChildFrame {
    validatePreBattleScriptCursor(c);
    return selectChildFrame(c);
}
export function commitPreBattleScriptFrame(c: BattlePreBattleScriptCursor, f: ChildFrame): void {
    validatePreBattleScriptCursor(c);
    commitChildFrame(c, f);
}
export function pushPreBattleScriptFrame(c: BattlePreBattleScriptCursor, entry: number, event: number): void {
    validatePreBattleScriptCursor(c);
    pushChildFrame(c, entry, event);
}
export function returnPreBattleScriptFrame(c: BattlePreBattleScriptCursor, entry: number): void {
    validatePreBattleScriptCursor(c);
    returnChildFrame(c, entry);
}
export function writePreBattleScriptReturn(c: BattlePreBattleScriptCursor, writer: (entry: number) => void): void {
    validatePreBattleScriptCursor(c);
    writeChildReturn(c, writer);
}
export function copyPreBattleScriptCursor(c: BattlePreBattleScriptCursor): BattlePreBattleScriptCursor {
    validatePreBattleScriptCursor(c);
    return copyChildCursor(c);
}
