/**
 * loop — 内置 tool-calling 循环(spec §7.1):正式成绩走这里。所有模型同一份提示、同一套工具、同一条上下文规则。
 *
 * 上下文规则(统一,不让各家记忆技巧混进成绩):只保留最近 KEEP_OBS 条工具结果的全文,更早的替换成一句占位
 * (标 elided —— 占位之后不再变,provider 可以把缓存断点放在最后一条占位上;A 像素档的画面随结果一起省略);
 * 模型自己的文字与调用记录全部保留。
 */
import { systemPrompt, firstMessage } from './prompt.mjs';
import { costOf } from './providers.mjs';

export const KEEP_OBS = 6;
const MAX_TEXT_ONLY = 4;      // 连续这么多轮只回文字、不调工具 → 判 agent 自行停止

export function compact(history) {
  let fromEnd = history.filter((h) => h.role === 'tool').length;
  return history.map((h) => {
    if (h.role !== 'tool') return h;
    if (--fromEnd < KEEP_OBS) return h;
    const { image, ...rest } = h;                          // 省略的结果连画面一起丢(A 像素档的截图、C 档的全图)
    const text = h.name === 'guide' ? '[earlier walkthrough text elided — call guide again if you need it]'
      : h.name === 'atlas' ? '[earlier map elided — call atlas again if you need it]'
      : image ? '[earlier screenshot elided — call screenshot for the current frame]' : '[earlier observation elided — call observe for the current state]';
    return { ...rest, text, elided: true };
  });
}

export async function runLoop({ episode, provider, model }) {
  const system = systemPrompt(episode.tier);
  const history = [{ role: 'user', text: firstMessage(episode.task, episode.intro), ...(episode.introImage ? { image: episode.introImage } : {}) }];
  let textOnly = 0;
  let turns = 0;
  while (!episode.done) {
    let resp;
    try {
      // 自己管上下文的 provider(服务端按同一条规则清理旧工具结果)拿原样历史;其余在这里按规则截断
      resp = await provider.turn({ system, history: provider.ownsContext ? history : compact(history), tools: episode.tools, keep: KEEP_OBS });
    } catch (err) {
      episode.result.error = String(err?.message || err).slice(0, 500);
      return episode.finish('provider-error');
    }
    turns++;
    episode.logTurn(resp);
    const cost = costOf(model, resp.usage);
    episode.addUsage({ ...resp.usage, cost: cost ?? 0 });
    if (cost == null) episode.result.cost = null;          // 未知价:整局 cost 记 null,不当 0
    if (episode.done) break;                                 // token 预算在 addUsage 里判
    history.push({ role: 'assistant', text: resp.text, calls: resp.calls, ...(resp.raw ? { raw: resp.raw } : {}) });   // raw:provider 要原样回传的内容块(思考块等)
    if (!resp.calls.length) {
      if (++textOnly >= MAX_TEXT_ONLY) return episode.finish('agent-stopped');
      history.push({ role: 'user', text: '继续:请调用工具推进游戏(任务完成时工具结果会明确告诉你)。' });
      continue;
    }
    textOnly = 0;
    for (const c of resp.calls) {
      const r = c.args?.__unparsable !== undefined
        ? await episode.call('__unparsable_arguments__', {})
        : await episode.call(c.name, c.args);
      history.push({ role: 'tool', id: c.id, name: c.name, text: r.text, ...(r.image ? { image: r.image } : {}) });   // image:A 像素档的画面
      if (r.done) break;
    }
  }
  episode.result.turns = turns;
  return episode.finish();
}
