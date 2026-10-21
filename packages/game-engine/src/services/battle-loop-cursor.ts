/** Execution progress only; gameplay action queues remain native battle data. */
export type BattleLoopStage = 'frame' | 'dispatch-command' | 'note-frame' | 'present-frame' | 'frame-wait' | 'result';
export interface BattleLoopCursor { version: 1; frame: number; completedRounds: number; nextStage: BattleLoopStage }
const stages: BattleLoopStage[] = ['frame','dispatch-command','note-frame','present-frame','frame-wait','result'];
export function createBattleLoopCursor(): BattleLoopCursor { return {version:1,frame:0,completedRounds:0,nextStage:'frame'}; }
export function validateBattleLoopCursor(value: any): asserts value is BattleLoopCursor {
  if (value?.version !== 1 || !Number.isSafeInteger(value.frame) || value.frame < 0 ||
      !Number.isSafeInteger(value.completedRounds) || value.completedRounds < 0 || value.completedRounds > value.frame + (value.nextStage === 'frame' ? 0 : 1) || !stages.includes(value.nextStage)) throw new TypeError('invalid battle loop cursor');
}
export function advanceBattleLoopCursor(cursor: BattleLoopCursor, returnedStage: BattleLoopStage): void {
  validateBattleLoopCursor(cursor);
  if (cursor.nextStage !== returnedStage || returnedStage === 'result') throw new Error('battle loop stage mismatch');
  if (returnedStage === 'frame-wait') {
    if (cursor.frame === Number.MAX_SAFE_INTEGER) throw new RangeError('battle frame overflow');
    cursor.frame++; cursor.nextStage='frame';
  } else cursor.nextStage=stages[stages.indexOf(returnedStage)+1];
}
export function noteCompletedBattleRound(cursor: BattleLoopCursor): void {
  validateBattleLoopCursor(cursor);
  if (cursor.nextStage !== 'dispatch-command') throw new Error('round completion stage mismatch');
  if (cursor.completedRounds === Number.MAX_SAFE_INTEGER) throw new RangeError('battle round overflow');
  cursor.completedRounds++;
  validateBattleLoopCursor(cursor);
}
export function finishBattleLoopCursor(cursor: BattleLoopCursor): void { validateBattleLoopCursor(cursor); cursor.nextStage='result'; }
