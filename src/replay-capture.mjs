/**
 * 把回放的观战页录成视频(整个页面:游戏画面 + 小地图 + 解说 / 操作时间线 + 状态栏)。
 *
 * 不是实时录屏:回放停着,一帧一帧往前推(页面的 rpStep,见 host-client.html)——每推一步等页面画好再截图,
 * 截图直接喂给 ffmpeg。机器再慢也不掉帧,同一段素材重录出来一模一样;代价是比实时慢(看页面大小,大约 1–3 倍时长)。
 * 没有新东西的帧不重新截(对白停着的时候很多),直接重复上一张。
 * 只有画面没有声音:声音由调用的一方另外合(scripts/palrec-capture.mjs、commentary-chapters.mjs --page)。
 *
 * 要 playwright(仓库根的开发依赖)、一个 Chromium(playwright 自带的,或本机的 Chrome,或 AGENT_PAL_CHROME 指定)、ffmpeg。
 */
import { spawn } from 'node:child_process';

/** 开一个浏览器页面,反复录。base = 回放服务的地址(startReplay 的 http://127.0.0.1:端口) */
export async function openCapture({ base, width = 1920, height = 1080, ffmpeg = 'ffmpeg', log = () => {} } = {}) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { throw new Error('录回放页要 playwright:在仓库根 pnpm install,然后 npx playwright install chromium'); }
  width -= width % 2; height -= height % 2;                       // x264 要偶数
  // 浏览器:AGENT_PAL_CHROME 指定的 → playwright 自带的 chromium → 本机装的 Chrome(playwright 升级后自带的那份可能还没下载)
  let browser = null, why = '';
  const tries = [...(process.env.AGENT_PAL_CHROME ? [{ executablePath: process.env.AGENT_PAL_CHROME }] : []), {}, { channel: 'chrome' }];
  for (const opt of tries) { try { browser = await chromium.launch(opt); break; } catch (err) { why = why || String(err.message).split('\n')[0]; } }
  if (!browser) throw new Error(`起不了浏览器(${why}):npx playwright install chromium,或用 AGENT_PAL_CHROME 指一个 Chrome / Chromium 的可执行文件`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => log(`[capture] page error: ${err.message}`));

  /**
   * 录第 rec 轮(从 0 数)的 [fromMs, toMs):out = 输出的 mp4(无声)。
   * tail = 录完最后一帧后再塞给页面的一条直播事件(章节小结卡片),多截一帧 —— 后期片尾定格用它。
   * 返回 { frames, shots(实际截了几张), durationMs }
   */
  async function capture({ rec = 0, fromMs = 0, toMs, out, fps = 30, crf = 18, preset = 'veryfast', tail = null, onProgress = null }) {
    await page.goto(`${base}/replay?capture&paused&rec=${rec + 1}&t=${(fromMs / 1000).toFixed(3)}`);
    await page.waitForFunction(() => typeof rp === 'object' && rp && typeof rp.pos === 'number' && window.rpStep, null, { timeout: 15000 });
    const dur = await page.evaluate(() => rp.recs[rp.i].dur);
    toMs = Math.min(toMs ?? dur, dur);
    if (!(toMs > fromMs)) throw new Error(`nothing to capture: ${fromMs}ms → ${toMs}ms`);
    const total = Math.max(1, Math.round((toMs - fromMs) / 1000 * fps));
    const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; ff.stderr.on('data', (d) => { err += d; });
    const exited = new Promise((resolve) => ff.on('close', resolve));
    const write = (buf) => new Promise((resolve, reject) => { if (ff.stdin.destroyed) return reject(new Error(`ffmpeg: ${err.trim() || 'exited'}`)); ff.stdin.write(buf, (e) => (e ? reject(e) : resolve())); });
    let shot = null, shots = 0;
    const snap = async () => { shot = await page.screenshot({ type: 'jpeg', quality: 92 }); shots++; };
    try {
      for (let k = 0; k < total; k++) {
        const changed = await page.evaluate((ms) => window.rpStep(ms), fromMs + k * 1000 / fps);
        if (changed || !shot) await snap();
        await write(shot);
        if (onProgress && k % (fps * 10) === 0) onProgress(k, total);
      }
      if (tail) {
        // 小结卡片:时间线滚到底 —— 片尾定格的这一帧要看得到小结的字
        await page.evaluate((ev) => { onLive(ev); feed.scrollTop = feed.scrollHeight; }, tail);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await snap(); await write(shot);
      }
    } finally { ff.stdin.end(); }
    const code = await exited;
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${err.trim().slice(0, 300)}`);
    return { frames: total + (tail ? 1 : 0), shots, durationMs: toMs - fromMs };
  }
  return { capture, close: () => browser.close() };
}
