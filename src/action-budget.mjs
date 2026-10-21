import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { sleep, waitUntil } from './engine.mjs';

// Real monotonic time: the game may replace Date with its deterministic clock.
const budgets = new AsyncLocalStorage();
export class BudgetExpired extends Error {
  constructor() { super('action time budget exhausted'); this.name = 'BudgetExpired'; }
}
const remaining = () => (budgets.getStore() ?? Infinity) - performance.now();
export function checkBudget() { if (remaining() <= 0) throw new BudgetExpired(); }
export function runWithDeadline(ms, action) {
  return budgets.run(Math.min(budgets.getStore() ?? Infinity, performance.now() + ms), async () => {
    checkBudget();
    return await action();
  });
}
export async function budgetSleep(ms) {
  checkBudget();
  const left = remaining();
  await sleep(Math.min(ms, Math.max(0, left)));
  if (ms >= left) throw new BudgetExpired(); // timers may round fractional milliseconds down
  checkBudget();
}
export async function budgetWaitUntil(pred, timeoutMs = 10000, everyMs = 30) {
  checkBudget();
  // Resolve the underlying poller on expiry, then unwind. No detached race or
  // background macro continues sending commands after the caller returns.
  const left = remaining();
  const result = await waitUntil(() => remaining() <= 0 || pred(), Math.min(timeoutMs, left), Math.min(everyMs, Math.max(1, left)));
  if (!result && timeoutMs >= left) throw new BudgetExpired();
  checkBudget();
  return result;
}
