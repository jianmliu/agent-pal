/** Per-runner execution bookkeeping. World state and native promises stay with their owners. */
export type ScriptExecutionKind = 'trigger' | 'auto' | 'equipment' | 'fade';
export type ScriptExecutionStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface ScriptExecutionFrame {
  id: number;
  parentId: number | null;
  kind: ScriptExecutionKind;
  currentPC: number;
  continuationPC: number;
  eventId: number;
  ended: boolean;
  loopSafetyCounter: number;
  status: ScriptExecutionStatus;
}

export interface ScriptExecutionSnapshot {
  scriptSuccess: boolean;
  curEquipPart: number;
  activeFrames: ScriptExecutionFrame[];
  lastCompletedFrame: ScriptExecutionFrame | null;
}

export interface BattleScriptFrameObservation {
  runtime: string; frame: number; parentId: number | null;
  origin: 'battle'; nativeParent: string; status: ScriptExecutionStatus;
}
// Authority-free origin tombstones follow real frames across receiving runtimes.
// Metadata retirement cannot downgrade a still-live battle frame to generic.
const battleFrameMarkers = new WeakSet<ScriptExecutionFrame>();
let runtimeSequence = 0;
export class ScriptExecutionRuntime {
  public readonly identity = `script-runtime:${++runtimeSequence}`;
  private frameOwners = new WeakMap<ScriptExecutionFrame, object>();
  private battleOrigins = new Map<ScriptExecutionFrame, string>();
  private battleHistory = new Map<string, BattleScriptFrameObservation[]>();
  public owns(frame: ScriptExecutionFrame, owner?: object): boolean { return this.activeFrames.includes(frame) && (owner === undefined || this.frameOwners.get(frame) === owner); }
  public hasBattleOrigin(frame: ScriptExecutionFrame): boolean { return battleFrameMarkers.has(frame); }
  public attachBattleOrigin(frame: ScriptExecutionFrame, nativeParent: string): void {
    if (!this.owns(frame)) throw new Error('battle child frame is not owned');
    this.battleOrigins.set(frame, nativeParent);
    battleFrameMarkers.add(frame);
  }
  public inheritBattleOrigin(frame: ScriptExecutionFrame, parent?: ScriptExecutionFrame): void {
    const origin = parent && this.owns(parent) ? this.battleOrigins.get(parent) : undefined;
    if (origin) this.attachBattleOrigin(frame, origin);
  }
  public battleFrames(nativeParent: string): BattleScriptFrameObservation[] {
    return [...(this.battleHistory.get(nativeParent) || []).map(row => ({...row})),
      ...this.activeFrames.filter(frame => this.battleOrigins.get(frame) === nativeParent).map(frame => this.battleFrame(frame, nativeParent))];
  }
  private battleFrame(frame: ScriptExecutionFrame, nativeParent: string): BattleScriptFrameObservation {
    return {runtime: this.identity, frame: frame.id, parentId: frame.parentId, origin: 'battle', nativeParent, status: frame.status};
  }
  public retireBattleOrigin(nativeParent: string): void {
    for (const [frame, origin] of this.battleOrigins) if (origin === nativeParent) this.battleOrigins.delete(frame);
    this.battleHistory.delete(nativeParent);
  }
  public scriptSuccess = true;
  public curEquipPart = -1;
  private nextId = 1;
  private activeFrames: ScriptExecutionFrame[] = [];
  private lastCompletedFrame: ScriptExecutionFrame | null = null;

  public begin(kind: ScriptExecutionKind, currentPC: number, eventId: number, parentId: number | null = null, owner?: object): ScriptExecutionFrame {
    const frame: ScriptExecutionFrame = {
      id: this.nextId++, parentId, kind, currentPC, continuationPC: currentPC,
      eventId, ended: false, loopSafetyCounter: 0, status: 'running'
    };
    if (owner) this.frameOwners.set(frame, owner);
    this.activeFrames.push(frame);
    return frame;
  }

  /** Synchronous: wrapping an existing await must not introduce another promise turn. */
  public resume<T>(frame: ScriptExecutionFrame | undefined, value: T): T {
    if (frame) frame.status = 'running';
    return value;
  }

  public finish(frame: ScriptExecutionFrame, completed: boolean): void {
    if (this.owns(frame)) battleFrameMarkers.delete(frame);
    frame.status = completed ? 'completed' : 'failed';
    const nativeParent = this.battleOrigins.get(frame);
    if (nativeParent) {
      const history = this.battleHistory.get(nativeParent) || [];
      history.push(this.battleFrame(frame, nativeParent));
      this.battleHistory.set(nativeParent, history);
      this.battleOrigins.delete(frame);
    }
    this.activeFrames = this.activeFrames.filter(active => active !== frame);
    this.frameOwners.delete(frame);
    this.lastCompletedFrame = { ...frame };
  }

  public snapshot(): ScriptExecutionSnapshot {
    return {
      scriptSuccess: this.scriptSuccess,
      curEquipPart: this.curEquipPart,
      activeFrames: this.activeFrames.map(frame => ({ ...frame })),
      lastCompletedFrame: this.lastCompletedFrame ? { ...this.lastCompletedFrame } : null
    };
  }
}
