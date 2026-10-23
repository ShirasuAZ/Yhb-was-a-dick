import { readFileSync, writeFileSync } from 'node:fs';

const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;
const WIDTH = 96;

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const md = readFileSync(inputPath, 'utf8').split('\r\n').join('\n');
const lines = md.split('\n');

function clean(s) { return s.split(BT).join('').split('**').join(''); }

function dw(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0x303E) || (c >= 0x3041 && c <= 0x33FF)
      || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xA000 && c <= 0xA4CF)
      || (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE30 && c <= 0xFE6F)
      || (c >= 0xFF00 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(s, w) { let out = s; let cur = dw(s); while (cur < w) { out += ' '; cur += 1; } return out; }

function wrap(text, firstIndent, restIndent, width) {
  const words = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === ' ' || ch === '、' || ch === '，' || ch === '。' || ch === '；' || ch === '：' || ch === '/') { words.push(buf); buf = ''; }
  }
  if (buf) words.push(buf);
  const out = [];
  let line = firstIndent;
  let limitReached = false;
  for (const w of words) {
    const piece = w.replace(/\s+$/, '');
    if (dw(line) + dw(piece) > width && dw(line) > dw(line.trim()) + (dw(firstIndent) === 0 ? 0 : 0) && line.trim() !== '') {
      out.push(line.replace(/\s+$/, ''));
      line = restIndent;
      limitReached = true;
    }
    line += piece + (w.endsWith(' ') ? ' ' : '');
  }
  if (line.trim() !== '') out.push(line.replace(/\s+$/, ''));
  if (out.length === 0) out.push(firstIndent);
  return out;
}

function wrapCell(text, width) {
  const breaks = ' 、，；：/（）';
  const chunks = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (breaks.indexOf(ch) !== -1) { chunks.push(buf); buf = ''; }
  }
  if (buf) chunks.push(buf);
  const parts = [];
  let line = '';
  for (const chunk of chunks) {
    if (line !== '' && dw(line) + dw(chunk) > width) { parts.push(line.replace(/\s+$/, '')); line = ''; }
    if (dw(chunk) > width) {
      if (line !== '') { parts.push(line.replace(/\s+$/, '')); line = ''; }
      let piece = '';
      for (const ch of chunk) {
        if (dw(piece + ch) > width && piece !== '') { parts.push(piece); piece = ''; }
        piece += ch;
      }
      line = piece;
    } else {
      line += chunk;
    }
  }
  if (line.trim() !== '') parts.push(line.replace(/\s+$/, ''));
  return parts.length ? parts : [''];
}

function renderTable(rows) {
  const cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  const matrix = rows.map(function (r) {
    const x = [];
    for (let c = 0; c < cols; c += 1) x.push(clean(r[c] || ''));
    return x;
  });
  const natural = [];
  for (let c = 0; c < cols; c += 1) {
    let w = 4;
    for (const r of matrix) w = Math.max(w, dw(r[c]));
    natural.push(w);
  }
  const gap = 3;
  let total = natural.reduce(function (a, b) { return a + b; }, 0) + gap * (cols - 1);
  const widths = natural.slice();
  if (total > WIDTH) {
    const budget = WIDTH - gap * (cols - 1);
    const sum = natural.reduce(function (a, b) { return a + b; }, 0);
    for (let c = 0; c < cols; c += 1) widths[c] = Math.max(8, Math.floor(budget * natural[c] / sum));
  }
  const out = [];
  matrix.forEach(function (r, ri) {
    const cells = r.map(function (cell, c) { return wrapCell(cell, widths[c]); });
    const height = Math.max.apply(null, cells.map(function (x) { return x.length; }));
    for (let k = 0; k < height; k += 1) {
      let line = '';
      for (let c = 0; c < cols; c += 1) {
        const piece = cells[c][k] !== undefined ? cells[c][k] : '';
        line += pad(piece, widths[c]) + (c < cols - 1 ? ' '.repeat(gap) : '');
      }
      out.push(line.replace(/\s+$/, ''));
    }
    if (ri === 0) {
      let sep = '';
      for (let c = 0; c < cols; c += 1) sep += '-'.repeat(widths[c]) + (c < cols - 1 ? ' '.repeat(gap) : '');
      out.push(sep);
    }
  });
  return out;
}

const out = [];
let i = 0;
let firstH1 = true;

while (i < lines.length) {
  const line = lines[i].replace(/\s+$/, '');
  if (!line.trim()) { i += 1; continue; }

  if (line.trim().startsWith(FENCE)) {
    i += 1;
    while (i < lines.length && !lines[i].trim().startsWith(FENCE)) { out.push('    ' + clean(lines[i].replace(/\s+$/, ''))); i += 1; }
    i += 1;
    out.push('');
    continue;
  }

  if (line.trim().startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
    const rows = [];
    rows.push(line.trim().slice(1, -1).split('|').map(function (s) { return s.trim(); }));
    i += 1;
    if (lines[i] && lines[i].trim().startsWith('|')) i += 1;
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      rows.push(lines[i].trim().slice(1, -1).split('|').map(function (s) { return s.trim(); }));
      i += 1;
    }
    const rendered = renderTable(rows);
    for (const l of rendered) out.push(l);
    out.push('');
    continue;
  }

  if (line.startsWith('#')) {
    let level = 0;
    while (level < line.length && line[level] === '#') level += 1;
    const text = clean(line.slice(level).trim());
    if (level === 1 && firstH1) {
      firstH1 = false;
      out.push(text);
      out.push('='.repeat(Math.min(dw(text), WIDTH)));
      out.push('');
    } else if (level === 2) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(text);
      out.push('-'.repeat(Math.min(dw(text), WIDTH)));
      out.push('');
    } else {
      if (out.length && out[out.length - 1] !== '') out.push('');
      for (const l of wrap(text, '', '   ', WIDTH)) out.push(l);
      out.push('');
    }
    i += 1;
    continue;
  }

  if (line.trim() === '---' || line.trim() === '***') { i += 1; continue; }

  if (line.trim().startsWith('>')) {
    const text = clean(line.trim().slice(1).trim());
    for (const l of wrap(text, '    ', '    ', WIDTH)) out.push(l);
    out.push('');
    i += 1;
    continue;
  }

  const t = line.trim();
  if (t.startsWith('- ') || t.startsWith('* ')) {
    const body = clean(t.slice(2).trim());
    const rendered = wrap(body, '  - ', '    ', WIDTH);
    for (const l of rendered) out.push(l);
    i += 1;
    continue;
  }

  const dot = t.indexOf('. ');
  let ordered = false;
  if (dot > 0) {
    let digits = true;
    for (let k = 0; k < dot; k += 1) { const ch = t[k]; if (ch < '0' || ch > '9') { digits = false; break; } }
    ordered = digits;
  }
  if (ordered) {
    const marker = t.slice(0, dot + 2);
    const body = clean(t.slice(dot + 1).trim());
    const rendered = wrap(body, '  ' + marker, '     ', WIDTH);
    for (const l of rendered) out.push(l);
    i += 1;
    continue;
  }

  const rendered = wrap(clean(t), '', '', WIDTH);
  for (const l of rendered) out.push(l);
  out.push('');
  i += 1;
}

const finalLines = [];
for (const l of out) {
  if (l === '' && finalLines.length && finalLines[finalLines.length - 1] === '') continue;
  finalLines.push(l);
}

writeFileSync(outputPath, '\uFEFF' + finalLines.join('\r\n') + '\r\n', 'utf8');
console.log('wrote ' + outputPath + ' lines=' + finalLines.length);
