/**
 * guide — 攻略本 / 剧本(agent-wow 里「读原始数据」那一层的仙剑版)。
 *
 * 资料是第三方文本,不进仓库:AGENT_PAL_GUIDE 指向本地文件,多个用 ':' 分隔
 * (第一个为默认来源)。支持:
 *  - .txt:GBK/GB18030 或 UTF-8 自动识别
 *  - .docx:内置最小 zip 读取,取 word/document.xml 的段落文本(不引依赖)
 * 章节标题识别「〔N〕标题」(攻略)和「第X章 标题」(剧情对话本);没有章节的文件整体算一章,
 * 主要靠 query 搜。长章节分页。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PAGE_CHARS = 6000;
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const toInt = (s) => {
  s = s.replace(/[０-９]/g, (c) => String('０１２３４５６７８９'.indexOf(c)));
  if (/^\d+$/.test(s)) return Number(s);
  // 一..九十九:十一 / 二十 / 二十三
  if (s.includes('十')) { const [a, b] = s.split('十'); return (a ? CN_NUM[a] : 1) * 10 + (b ? CN_NUM[b] : 0); }
  return CN_NUM[s] || NaN;
};

function decodeText(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('gb18030').decode(buf); } catch { return utf8; }
}

/** 最小 zip 读取:从中央目录找到某个条目,解压(stored / deflate)。 */
function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`${name} not found in zip`);
}

function docxLines(buf) {
  const xml = readZipEntry(buf, 'word/document.xml').toString('utf8');
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) => unescape(p.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')));
}

const HEADINGS = [
  /^[\s　]*〔?([0-9０-９]+)〕[。.\s　]*(.+?)\s*$/,            // 攻略:〔２〕。仙灵岛 / １〕。渔港
  /^[\s　]*第([一二三四五六七八九十0-9０-９]+)章[\s　]*(.+?)\s*$/   // 剧本:第一章 仙灵求药
];

function parseSource(file) {
  const buf = fs.readFileSync(file);
  const raw = file.toLowerCase().endsWith('.docx') ? docxLines(buf) : decodeText(buf).replace(/\r/g, '').split('\n');
  const chapters = [];
  let cur = null;
  const preface = [];
  for (const r of raw) {
    const line = r.replace(/^[\s　]+/, '').trimEnd();
    let m = null;
    for (const re of HEADINGS) { m = r.match(re); if (m) break; }
    if (m && line.length <= 40) {
      cur = { n: toInt(m[1]), title: m[2].trim(), lines: [] };
      chapters.push(cur);
    } else if (line) {
      (cur ? cur.lines : preface).push(line);
    }
  }
  if (!chapters.length) chapters.push({ n: 1, title: '(whole text)', lines: preface });
  return { name: path.basename(file).replace(/\.(txt|docx)$/i, ''), file, chapters };
}

export function loadGuide(spec = process.env.AGENT_PAL_GUIDE) {
  if (!spec) return null;
  const sources = [];
  for (const f of spec.split(':').map((s) => s.trim()).filter(Boolean)) {
    try { if (fs.existsSync(f)) sources.push(parseSource(f)); }
    catch (err) { process.stderr.write(`[agent-pal] guide: skip ${f}: ${err.message}\n`); }
  }
  return sources.length ? { sources } : null;
}

function pickSource(guide, which) {
  if (which == null || which === '') return guide.sources[0];
  if (Number.isInteger(which)) return guide.sources[which - 1] || null;
  // 纯数字字符串在序号范围内也当序号(有的 provider 的 schema 不支持 string|integer,只能传字符串);超出范围再按名字找
  if (typeof which === 'string' && /^\d+$/.test(which.trim()) && guide.sources[Number(which) - 1]) return guide.sources[Number(which) - 1];
  return guide.sources.find((s) => s.name.includes(String(which))) || null;
}

function listing(guide) {
  return guide.sources.map((s, i) => {
    const chs = s.chapters.length === 1 && s.chapters[0].title === '(whole text)'
      ? '  (no chapters — use query to search it)'
      : s.chapters.map((c) => `  ${c.n}. ${c.title}`).join('\n');
    return `[source ${i + 1}] ${s.name}\n${chs}`;
  }).join('\n\n');
}

/**
 * guide 工具的文本结果。
 * - 无参数:各来源及章节
 * - chapter=N(+source,+page):读一章(默认第一个来源,即攻略)
 * - query:在所有来源里搜,带上下文行
 */
export function guideText(guide, { source, chapter, page, query } = {}) {
  if (!guide) return 'No walkthrough available (set AGENT_PAL_GUIDE to local walkthrough/script files, ":"-separated).';
  if (query) {
    const hits = [];
    for (const s of guide.sources) {
      for (const c of s.chapters) {
        c.lines.forEach((l, i) => {
          if (!l.includes(query)) return;
          // 攻略段落很长:命中行以命中处为中心开窗,邻行截短
          const at = l.indexOf(query);
          const hit = l.length > 360 ? (at > 150 ? '…' : '') + l.slice(Math.max(0, at - 150), at + 210) + (at + 210 < l.length ? '…' : '') : l;
          const clip = (x) => (x.length > 120 ? x.slice(0, 120) + '…' : x);
          const ctx = c.lines.slice(Math.max(0, i - 2), i + 3).map((x, k) => (Math.max(0, i - 2) + k === i ? '> ' + hit : '  ' + clip(x))).join('\n');
          hits.push(`[${s.name} · ${c.n}. ${c.title}]\n${ctx}`);
        });
      }
    }
    if (!hits.length) return `No match for "${query}".\n\n${listing(guide)}`;
    return hits.slice(0, 8).join('\n\n') + (hits.length > 8 ? `\n\n(${hits.length - 8} more matches; use a more specific query)` : '');
  }
  if (Number.isInteger(chapter)) {
    const s = pickSource(guide, source);
    if (!s) return `No such source "${source}".\n\n${listing(guide)}`;
    const c = s.chapters.find((x) => x.n === chapter);
    if (!c) return `No chapter ${chapter} in ${s.name}.\n\n${listing(guide)}`;
    const body = c.lines.join('\n');
    const pages = Math.max(1, Math.ceil(body.length / PAGE_CHARS));
    const pg = Math.min(Math.max(1, page || 1), pages);
    const text = body.slice((pg - 1) * PAGE_CHARS, pg * PAGE_CHARS);
    return `[${s.name}] ${c.n}. ${c.title}${pages > 1 ? `  (page ${pg}/${pages}; pass page=N for more)` : ''}\n${text}`;
  }
  return `Sources (source 1 is the default for chapter=N). Use chapter=N [source=name or number] [page=N] to read, or query="keyword" to search all sources.\n\n${listing(guide)}`;
}
