import { childInteger, createChildCursor, validateChildCursor, selectChildFrame, commitChildFrame, pushChildFrame, returnChildFrame, copyChildCursor, type ChildCursor, type ChildFrame, } from './battle-child-script-cursor';
export type EndScriptKind = 'enemy-battle-end';
export interface BattleEndSource {
    version: 1;
    returnPolicy: 'discard';
    kind: EndScriptKind;
    enemyIndex: number;
    objectId: number;
    eventId: number;
    configuredEntry: number;
    resolvedEntry: number;
    invocationIndex: number;
}
export type EndSource = BattleEndSource;
export type BattleEndScriptCursor = ChildCursor<BattleEndSource>;
export function validateEndScriptCursor(c: BattleEndScriptCursor): void {
    validateChildCursor(c);
    const s = c.source;
    if (s.version !== 1 || s.returnPolicy !== 'discard' || s.invocationIndex !== s.enemyIndex || s.kind !== 'enemy-battle-end' || !childInteger(s.objectId) ||
        ![s.enemyIndex, s.eventId, s.configuredEntry, s.resolvedEntry, s.invocationIndex].every(n => childInteger(n))) {
        throw new TypeError('invalid end script source');
    }
}
export function createBattleEndScriptCursor(source: EndSource, entry: number, event: number, registers: BattleEndScriptCursor['registers']): BattleEndScriptCursor {
    const c = createChildCursor(source, entry, event, registers);
    validateEndScriptCursor(c);
    return c;
}
export function selectEndScriptFrame(c: BattleEndScriptCursor): ChildFrame {
    validateEndScriptCursor(c);
    return selectChildFrame(c);
}
export function commitEndScriptFrame(c: BattleEndScriptCursor, f: ChildFrame): void {
    validateEndScriptCursor(c);
    commitChildFrame(c, f);
}
export function pushEndScriptFrame(c: BattleEndScriptCursor, entry: number, event: number): void {
    validateEndScriptCursor(c);
    pushChildFrame(c, entry, event);
}
export function returnEndScriptFrame(c: BattleEndScriptCursor, entry: number): void {
    validateEndScriptCursor(c);
    returnChildFrame(c, entry);
}
export function discardBattleEndScriptReturn(c: BattleEndScriptCursor): void {
    validateEndScriptCursor(c);
    if (c.stage !== 'write-next-entry' || c.nextEntry === null) throw new Error('end return already discarded');
    c.stage = 'returned';
}
export type BattleEndScriptPublicCursor = Omit<BattleEndScriptCursor, 'stage'> & {stage: 'execute-script' | 'discard-result' | 'returned'};
export function copyEndScriptCursor(c: BattleEndScriptCursor): BattleEndScriptPublicCursor {
    validateEndScriptCursor(c);
    const copy = copyChildCursor(c);
    return {...copy, stage: copy.stage === 'write-next-entry' ? 'discard-result' : copy.stage};
}
