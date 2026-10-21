import { detachedData } from './execution-scheduler';
export interface ChildFrame {
    entry: number;
    currentPC: number;
    continuationPC: number;
    eventId: number;
    ended: boolean;
    loopSafetyCounter: number;
    parentReturn: null | {
        opcodePC: number;
        nextPC: number;
        returnPolicy: 'discard';
    };
    effect: 'explicit' | 'opaque';
    frameWait?: {
        frame: number;
        remainingFrames: number;
        stage: 'update' | 'present' | 'sleep';
        remainingMs: number;
    };
}
export interface ChildCursor<S> {
    version: 1;
    source: S;
    frames: ChildFrame[];
    registers: {
        scriptSuccess: boolean;
        curEquipPart: number;
    };
    stage: 'execute-script' | 'write-next-entry' | 'returned';
    nextEntry: number | null;
}
export const childInteger = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
export function validateChildCursor<S>(c: ChildCursor<S>): void {
    if (c.version !== 1 || !['execute-script', 'write-next-entry', 'returned'].includes(c.stage) ||
        c.frames.length > 256 || (c.stage === 'execute-script' ? c.frames.length === 0 : c.frames.length !== 0) ||
        (c.nextEntry !== null && !childInteger(c.nextEntry)) || typeof c.registers.scriptSuccess !== 'boolean' ||
        !childInteger(c.registers.curEquipPart, -1))
        throw new TypeError('invalid child cursor');
    for (const f of c.frames) {
        if (![f.entry, f.currentPC, f.continuationPC, f.eventId, f.loopSafetyCounter].every(n => childInteger(n)) ||
            typeof f.ended !== 'boolean' || !['explicit', 'opaque'].includes(f.effect) ||
            (f.parentReturn && (!childInteger(f.parentReturn.opcodePC) || !childInteger(f.parentReturn.nextPC) || f.parentReturn.returnPolicy !== 'discard')) ||
            (f.frameWait && (!childInteger(f.frameWait.frame) || !childInteger(f.frameWait.remainingFrames, 1) ||
                !['update', 'present', 'sleep'].includes(f.frameWait.stage) || !Number.isFinite(f.frameWait.remainingMs) || f.frameWait.remainingMs < 0))) {
            throw new TypeError('invalid child frame');
        }
    }
}
function frame(entry: number, eventId: number, parentReturn: ChildFrame['parentReturn']): ChildFrame {
    return { entry, currentPC: entry, continuationPC: entry, eventId, ended: false, loopSafetyCounter: 0, parentReturn, effect: 'explicit' };
}
export function createChildCursor<S>(source: S, entry: number, eventId: number, registers: ChildCursor<S>['registers']): ChildCursor<S> {
    const c: ChildCursor<S> = { version: 1, source: detachedData(source), frames: [frame(entry, eventId, null)], registers: { ...registers }, stage: 'execute-script', nextEntry: null };
    validateChildCursor(c);
    return c;
}
export function selectChildFrame<S>(c: ChildCursor<S>): ChildFrame {
    validateChildCursor(c);
    if (c.stage !== 'execute-script')
        throw new Error('child returned');
    return c.frames[c.frames.length - 1];
}
export function commitChildFrame<S>(c: ChildCursor<S>, f: ChildFrame): void {
    selectChildFrame(c);
    validateChildCursor({ ...c, frames: [...c.frames.slice(0, -1), f] });
    c.frames[c.frames.length - 1] = { ...f, ...(f.frameWait ? { frameWait: { ...f.frameWait } } : {}) };
}
export function pushChildFrame<S>(c: ChildCursor<S>, entry: number, eventId: number): void {
    const p = selectChildFrame(c);
    const f = frame(entry, eventId, { opcodePC: p.currentPC, nextPC: p.currentPC + 1, returnPolicy: 'discard' });
    validateChildCursor({ ...c, frames: [...c.frames, f] });
    c.frames.push(f);
}
export function returnChildFrame<S>(c: ChildCursor<S>, nextEntry: number): void {
    const f = selectChildFrame(c);
    if (!childInteger(nextEntry))
        throw new TypeError('invalid child return');
    c.frames.pop();
    if (f.parentReturn) {
        const p = selectChildFrame(c);
        p.currentPC = f.parentReturn.nextPC;
        p.effect = 'explicit';
    }
    else {
        c.nextEntry = nextEntry;
        c.stage = 'write-next-entry';
    }
}
export function writeChildReturn<S>(c: ChildCursor<S>, writer: (entry: number) => void): void {
    validateChildCursor(c);
    if (c.stage !== 'write-next-entry' || c.nextEntry === null)
        throw new Error('child return already written');
    writer(c.nextEntry);
    c.stage = 'returned';
}
export function copyChildCursor<S>(c: ChildCursor<S>): ChildCursor<S> {
    validateChildCursor(c);
    return detachedData(c);
}
