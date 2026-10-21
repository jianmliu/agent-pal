import { samePrompt, type CommandChoice, type PromptIdentity } from '../ecs/components/battle-commands';
import { ExecutionScheduler, detachedData, requireSynchronous, type DispatchResult, type ExecutionOwner } from './execution-scheduler';

export type BattleExecutionKind = 'battle.command' | 'battle.auto-mode';
export type BattleExecutionOwner = ExecutionOwner<BattleExecutionKind>;
export type BattleExecutionResponse = { prompt: PromptIdentity; choice: CommandChoice } | { prompt: PromptIdentity; on: boolean };
export interface BattleCommandData {
  getOpenPrompt(): Readonly<PromptIdentity> | null;
  submitCommand(id: PromptIdentity, choice: CommandChoice): DispatchResult;
  requestAutoBattle(id: PromptIdentity, on: boolean): DispatchResult;
  acceptPendingCommand(id: PromptIdentity): CommandChoice | null;
  acceptAutoRequest(id: PromptIdentity): { on: boolean } | null;
  closePrompt(): unknown;
}
export interface BattleExecutionBinding {
  prompt: PromptIdentity;
  /** Caller proves its captured native parent continuation, current battle/context,
   * member and live party role are ready. UI state alone is insufficient proof.
   * This foundation supplies no battle.main hook or production boundary proof. */
  ready(): boolean;
}
export interface CommandContinuation<C> {
  context: C;
  /** Captured parent continuation: never invoked by external submission. Repeat
   * expansion can use commitCommand, but whole-round repeat policy lives outside. */
  commitCommand(member: number, choice: CommandChoice, context: C): unknown;
}
export interface AutoModeContinuation { setAutoBattle(on: boolean): unknown }

const keys = (value: object, expected: string[]) => {
  const actual = Object.keys(value); return actual.length === expected.length && actual.every(k => expected.includes(k));
};
const validPrompt = (p: any): p is PromptIdentity => !!p && typeof p === 'object' && typeof p.context === 'string' &&
  ['battle', 'revision', 'member', 'role'].every(k => Number.isSafeInteger(p[k]) && p[k] >= 0) &&
  (p.promptEvent === undefined || (Number.isSafeInteger(p.promptEvent) && p.promptEvent >= 0)) &&
  keys(p, p.promptEvent === undefined ? ['context', 'battle', 'revision', 'member', 'role'] : ['context', 'battle', 'revision', 'member', 'role', 'promptEvent']);
const validChoice = (c: any): c is CommandChoice => !!c && typeof c === 'object' &&
  ((keys(c, ['repeat']) && c.repeat === true) || (keys(c, ['actionType', 'actionID', 'target']) &&
    ['actionType', 'actionID', 'target'].every(k => typeof c[k] === 'number' && Number.isFinite(c[k]))));

/** Typed C2 consumer foundation. No default instance, production activation, UI
 * rules, key injection, prompt opening, or cold-restoration authorization. C2 is
 * the sole pending-choice authority; this adapter stores only its identity. */
export class BattleCommandExecution {
  private readonly scheduler = new ExecutionScheduler<BattleExecutionKind, { prompt: PromptIdentity }, BattleExecutionResponse, CommandChoice | { on: boolean }>();
  constructor(private readonly data: BattleCommandData) {
    requireSynchronous([data.getOpenPrompt, data.submitCommand, data.requestAutoBattle, data.acceptPendingCommand, data.acceptAutoRequest, data.closePrompt]);
  }
  get inTransition(): boolean { return this.scheduler.inTransition; }
  peek() { return this.scheduler.peek(); }
  snapshot() { return this.scheduler.snapshot(); }
  clearError() { this.scheduler.clearError(); }
  publishCommand<C>(binding: BattleExecutionBinding, continuation: CommandContinuation<C>): BattleExecutionOwner {
    const commit = continuation.commitCommand;
    requireSynchronous([commit]);
    const context = detachedData(continuation.context), member = binding.prompt.member;
    return this.publish('battle.command', binding, accepted => commit.call(continuation, member, accepted as CommandChoice, context));
  }
  /** A manual parent can accept exactly one native command or mode request.
   * C2 determines the accepted kind; no pending response is shadowed here. */
  publishDecision<C>(binding: BattleExecutionBinding, continuation: CommandContinuation<C> & AutoModeContinuation): BattleExecutionOwner {
    const command = continuation.commitCommand, mode = continuation.setAutoBattle;
    requireSynchronous([command, mode]);
    const context = detachedData(continuation.context), member = binding.prompt.member;
    return this.publish('battle.command', binding, accepted => 'on' in accepted
      ? mode.call(continuation, accepted.on)
      : command.call(continuation, member, accepted, context), true);
  }
  publishAutoMode(binding: BattleExecutionBinding, continuation: AutoModeContinuation): BattleExecutionOwner {
    const commit = continuation.setAutoBattle;
    requireSynchronous([commit]);
    return this.publish('battle.auto-mode', binding, accepted => commit.call(continuation, (accepted as { on: boolean }).on));
  }
  private publish(kind: BattleExecutionKind, binding: BattleExecutionBinding, commit: (accepted: CommandChoice | { on: boolean }) => unknown, decision = false): BattleExecutionOwner {
    const prompt = detachedData(binding.prompt), ready = binding.ready;
    requireSynchronous([ready]);
    if (!validPrompt(prompt)) throw new TypeError('invalid prompt identity');
    if (!samePrompt(prompt, this.data.getOpenPrompt())) throw new Error('stale battle prompt');
    const owned = () => samePrompt(prompt, this.data.getOpenPrompt());
    return this.scheduler.publish(kind, { prompt }, {
      ready: () => owned() && ready.call(binding),
      stage: response => {
        if (!response || typeof response !== 'object' || Array.isArray(response)) return { ok: false, reason: 'invalid' };
        if (!owned() || !validPrompt(response.prompt) || !samePrompt(response.prompt, prompt)) return { ok: false, reason: 'stale' };
        if (kind === 'battle.command' && !(decision && keys(response, ['prompt', 'on']))) {
          if (!keys(response, ['prompt', 'choice']) || !('choice' in response) || !validChoice(response.choice)) return { ok: false, reason: 'invalid' };
          return this.data.submitCommand(prompt, response.choice);
        }
        if (!keys(response, ['prompt', 'on']) || !('on' in response) || typeof response.on !== 'boolean') return { ok: false, reason: 'invalid' };
        return this.data.requestAutoBattle(prompt, response.on);
      },
      accept: () => decision ? (this.data.acceptAutoRequest(prompt) ?? this.data.acceptPendingCommand(prompt))
        : kind === 'battle.command' ? this.data.acceptPendingCommand(prompt) : this.data.acceptAutoRequest(prompt),
      commit,
      cancel: () => { if (owned()) return this.data.closePrompt(); }
    });
  }
  submit(owner: BattleExecutionOwner, response: BattleExecutionResponse): DispatchResult {
    return this.scheduler.stage(owner, owner?.kind, response);
  }
  resume(owner: BattleExecutionOwner): DispatchResult {
    // Retire a binding lost to another prompt without closing that foreign prompt.
    const observation = this.scheduler.peek();
    if (observation && owner && owner.revision === observation.revision && owner.kind === observation.kind &&
      !samePrompt(observation.payload.prompt, this.data.getOpenPrompt())) {
      this.scheduler.cancel(owner, owner.kind);
      return { ok: false, reason: 'stale' };
    }
    return this.scheduler.resume(owner, owner?.kind);
  }
  cancel(owner: BattleExecutionOwner): DispatchResult { return this.scheduler.cancel(owner, owner?.kind); }
  dispose(): void { this.scheduler.dispose(); }
}
