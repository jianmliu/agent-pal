/**
 * yaml-lite — module.yaml 用到的 YAML 子集(不为一个配置文件引依赖):
 *   缩进表示的嵌套映射、`key: value` 标量(字符串 / 数字 / true / false / null,可加引号)、
 *   行内列表 `[a, b]`、块列表 `- item`、`#` 注释。锚点、多行字符串、流式映射等不支持,遇到就报错。
 */
export function parseYamlLite(text) {
  const lines = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) return;
    if (/\t/.test(line.match(/^\s*/)[0])) throw new Error(`line ${i + 1}: tabs are not allowed for indentation`);
    lines.push({ n: i + 1, indent: line.match(/^ */)[0].length, body: line.trim() });
  });
  let pos = 0;

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    if (lines[pos].body.startsWith('- ') || lines[pos].body === '-') return parseList(indent);
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const { n, body } = lines[pos];
      if (body.startsWith('-')) throw new Error(`line ${n}: list item where a key was expected`);
      const m = body.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
      if (!m) throw new Error(`line ${n}: expected "key: value"`);
      const key = unquote(m[1]);
      pos++;
      if (m[2] != null && m[2] !== '') obj[key] = scalar(m[2], n);
      else if (pos < lines.length && lines[pos].indent > indent) obj[key] = parseBlock(lines[pos].indent);
      else obj[key] = null;
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new Error(`line ${lines[pos].n}: unexpected indentation`);
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].body.startsWith('- ') || lines[pos].body === '-')) {
      const { n, body } = lines[pos];
      pos++;
      const rest = body.slice(1).trim();
      if (rest) arr.push(scalar(rest, n));
      else if (pos < lines.length && lines[pos].indent > indent) arr.push(parseBlock(lines[pos].indent));
      else arr.push(null);
    }
    return arr;
  }

  const out = lines.length ? parseBlock(lines[0].indent) : {};
  if (pos < lines.length) throw new Error(`line ${lines[pos].n}: could not parse`);
  return out ?? {};
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function scalar(raw, n) {
  const s = raw.trim();
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new Error(`line ${n}: unterminated inline list`);
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => scalar(x, n)) : [];
  }
  if (s.startsWith('{') || s.startsWith('|') || s.startsWith('>') || s.startsWith('&') || s.startsWith('*')) {
    throw new Error(`line ${n}: "${s[0]}" is not supported by yaml-lite`);
  }
  if (/^["']/.test(s)) return unquote(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
