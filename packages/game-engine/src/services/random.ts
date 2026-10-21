/**
 * 引擎唯一的随机数来源(mulberry32,可设种子)。
 *
 * 不设种子时用 Math.random 播一次种,行为与旧版一致;设了种子,同样的输入序列得到同样的
 * 随机序列 —— 无头确定性运行(agent-pal 虚拟时钟)与黄金轨迹回放靠它。
 * 不 import 任何模块:js/pal/* 之间有循环依赖,这里必须是叶子。
 */
let state = (Math.random() * 0x100000000) >>> 0;
let seeded = false;
let draws = 0;

export function setRandomSeed(seed: number) {
  state = seed >>> 0;
  seeded = true;
  draws = 0;
}

/** [0, 1) 均匀分布,同 Math.random。 */
export function random(): number {
  draws++;
  state = (state + 0x6D2B79F5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 当前状态(含已抽取次数),用于轨迹比对时定位随机序列在哪里分叉。 */
export function getRandomState() {
  return { seeded, state, draws };
}

/**
 * 恢复 getRandomState() 取到的状态(含已抽取次数):之后的随机序列与取状态那一刻接着抽完全一样。
 * 配对存档包 / 检查点恢复用(docs/specs/agent-pal-m5.md B2);setRandomSeed 会把 draws 归零,不能用来恢复。
 */
export function setRandomState(next: { seeded?: boolean; state: number; draws?: number }) {
  if (!next || !Number.isInteger(next.state) || next.state < 0 || next.state > 0xFFFFFFFF) {
    throw new Error('setRandomState: state must be a uint32');
  }
  const count = next.draws ?? 0;
  if (!Number.isInteger(count) || count < 0) throw new Error('setRandomState: draws must be a non-negative integer');
  state = next.state >>> 0;
  seeded = next.seeded !== false;
  draws = count;
}

const randomService = { setSeed: setRandomSeed, random, getState: getRandomState, setState: setRandomState };
export default randomService;
