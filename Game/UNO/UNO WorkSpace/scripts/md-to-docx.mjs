import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';

const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) { console.error('usage: node md-to-docx.mjs <in.md> <out.docx>'); process.exit(2); }

const md = readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

function esc(s) {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

function rpr(o) {
  o = o || {};
  let x = '<w:rPr>';
  if (o.code) x += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas" w:cs="Consolas"/>';
  if (o.bold) x += '<w:b/>';
  if (o.italic) x += '<w:i/>';
  if (o.color) x += '<w:color w:val="' + o.color + '"/>';
  if (o.sz) x += '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>';
  if (o.fill) x += '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>';
  return x + '</w:rPr>';
}

function run(text, o) {
  if (text === '') return '';
  return '<w:r>' + rpr(o) + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
}

function inline(text, base) {
  base = base || {};
  let out = '';
  const codeParts = text.split(BT);
  for (let i = 0; i < codeParts.length; i += 1) {
    const part = codeParts[i];
    if (!part) continue;
    if (i % 2 === 1) {
      out += run(part, Object.assign({}, base, { code: true, fill: 'F1F3F5', color: '1F2937', sz: base.sz || 19 }));
    } else {
      const boldParts = part.split('**');
      for (let j = 0; j < boldParts.length; j += 1) {
        if (!boldParts[j]) continue;
        out += run(boldParts[j], Object.assign({}, base, { bold: j % 2 === 1 || base.bold }));
      }
    }
  }
  return out;
}

function p(text, o) {
  o = o || {};
  let ppr = '<w:pPr>';
  if (o.style) ppr += '<w:pStyle w:val="' + o.style + '"/>';
  if (o.num) ppr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + o.num + '"/></w:numPr>';
  if (o.align) ppr += '<w:jc w:val="' + o.align + '"/>';
  if (o.ind) ppr += '<w:ind w:left="' + o.ind + '"/>';
  if (o.before !== undefined || o.after !== undefined || o.line !== undefined) {
    ppr += '<w:spacing';
    if (o.before !== undefined) ppr += ' w:before="' + o.before + '"';
    if (o.after !== undefined) ppr += ' w:after="' + o.after + '"';
    if (o.line !== undefined) ppr += ' w:line="' + o.line + '" w:lineRule="auto"';
    ppr += '/>';
  }
  if (o.fill) ppr += '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>';
  if (o.border) ppr += '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="' + o.border + '"/></w:pBdr>';
  if (o.bottom) ppr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="C9CDD4"/></w:pBdr>';
  if (o.keep) ppr += '<w:keepNext/>';
  ppr += '</w:pPr>';
  const body = o.runs !== undefined ? o.runs : inline(text, o.base);
  return '<w:p>' + ppr + body + '</w:p>';
}

const HEAD = [0, 'Heading1', 'Heading2', 'Heading3', 'Heading4'];
const H_SIZE = [0, 40, 32, 26, 23];

function table(rows) {
  const cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  const weights = [];
  for (let c = 0; c < cols; c += 1) {
    let w = 0;
    for (const r of rows) { const cell = (r[c] || '').split(BT).join(''); w = Math.max(w, Math.min(cell.length, 40)); }
    weights.push(Math.max(w, 6));
  }
  const total = 9600;
  const sum = weights.reduce(function (a, b) { return a + b; }, 0);
  const widths = weights.map(function (w) { return Math.max(900, Math.round(total * w / sum)); });
  let xml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>';
  xml += '<w:tblBorders>';
  for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    xml += '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="BFC4CC"/>';
  }
  xml += '</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>';
  xml += '<w:tblGrid>' + widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
  rows.forEach(function (r, ri) {
    const header = ri === 0;
    xml += '<w:tr>' + (header ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
    for (let c = 0; c < cols; c += 1) {
      const cell = r[c] || '';
      const ppr = '<w:pPr><w:spacing w:before="20" w:after="20" w:line="260" w:lineRule="auto"/></w:pPr>';
      const body = header ? run(cell.split(BT).join(''), { bold: true, sz: 19 }) : inline(cell, { sz: 19 });
      xml += '<w:tc><w:tcPr><w:tcW w:w="' + widths[c] + '" w:type="dxa"/>' + (header ? '<w:shd w:val="clear" w:color="auto" w:fill="DEE5F2"/>' : '') + '<w:vAlign w:val="center"/></w:tcPr>' + '<w:p>' + ppr + body + '</w:p></w:tc>';
    }
    xml += '</w:tr>';
  });
  return xml + '</w:tbl>' + p('<w:r><w:t xml:space="preserve"> </w:t></w:r>', { after: 60, line: 240 });
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  const out = []; let cur = ''; let inCode = false;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === BT) { inCode = !inCode; cur += ch; continue; }
    if (ch === '|' && !inCode) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function isSep(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  for (const ch of t) { if ('|-: '.indexOf(ch) === -1) return false; }
  return true;
}

const bodyParts = [];
let i = 0;
let h1count = 0;
let orderedCount = 0;

while (i < lines.length) {
  const raw = lines[i];
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) { i += 1; continue; }

  if (line.trim().startsWith(FENCE)) {
    i += 1;
    const buf = [];
    while (i < lines.length && !lines[i].trim().startsWith(FENCE)) { buf.push(lines[i]); i += 1; }
    i += 1;
    for (const codeLine of buf) {
      bodyParts.push('<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>' + (codeLine ? run(codeLine.split(BT).join(''), { code: true, sz: 17, color: '24303F' }) : '') + '</w:p>');
    }
    bodyParts.push(p('', { after: 80, line: 240 }));
    continue;
  }

  if (line.trim().startsWith('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
    const rows = [splitRow(line)];
    i += 2;
    while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i += 1; }
    bodyParts.push(table(rows));
    continue;
  }

  if (line.startsWith('#')) {
    let level = 0;
    while (level < line.length && line[level] === '#') level += 1;
    const text = line.slice(level).trim();
    level = Math.min(level, 4);
    if (level === 1 && h1count === 0) {
      h1count += 1;
      bodyParts.push('<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>' + inline(text, { sz: 52, bold: true, color: '152238' }) + '</w:p>');
      bodyParts.push(p('', { bottom: true, after: 200, line: 240 }));
      continue;
    }
    i += 1;
    const size = H_SIZE[level] || 23;
    bodyParts.push('<w:p><w:pPr><w:pStyle w:val="' + HEAD[level] + '"/><w:keepNext/></w:pPr>' + inline(text, { sz: size, bold: true, color: '152238' }) + '</w:p>');
    continue;
  }

  if (line.trim() === '---' || line.trim() === '***') {
    bodyParts.push(p('', { bottom: true, after: 200, before: 80, line: 240 }));
    i += 1;
    continue;
  }

  if (line.trim().startsWith('>')) {
    let text = line.trim().slice(1).trim();
    bodyParts.push(p(text, { border: 'B8C0CC', ind: 220, before: 40, after: 40, base: { italic: true, color: '4A5568', sz: 20 } }));
    i += 1;
    continue;
  }

  const t = line.trim();
  if (t.startsWith('- ') || t.startsWith('* ')) {
    bodyParts.push(p(t.slice(2).trim(), { num: 1, after: 80, line: 300 }));
    i += 1;
    continue;
  }

  let ordered = false;
  const dot = t.indexOf('. ');
  if (dot > 0) {
    let digits = true;
    for (let k = 0; k < dot; k += 1) { const ch = t[k]; if (ch < '0' || ch > '9') { digits = false; break; } }
    ordered = digits;
  }
  if (ordered) {
    bodyParts.push(p(t.slice(dot + 2).trim(), { num: 2, after: 80, line: 300 }));
    i += 1;
    continue;
  }

  bodyParts.push(p(t, { after: 120, line: 320 }));
  i += 1;
}

const sectPr = '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="425"/><w:docGrid w:linePitch="312"/></w:sectPr>';

const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>'
  + bodyParts.join('')
  + sectPr
  + '</w:body></w:document>';

const FOOT = '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>'
  + run('第 ', { sz: 18, color: '6B7280' })
  + '<w:r><w:rPr><w:sz w:val="18"/><w:color w:val="6B7280"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>'
  + '<w:r><w:rPr><w:sz w:val="18"/><w:color w:val="6B7280"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
  + '<w:r><w:rPr><w:sz w:val="18"/><w:color w:val="6B7280"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>'
  + run(' 页', { sz: 18, color: '6B7280' })
  + '</w:p></w:ftr>';

const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/>'
  + '<w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="1F2430"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:spacing w:before="0" w:after="120"/><w:jc w:val="left"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160" w:line="280" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140" w:line="280" w:lineRule="auto"/><w:outlineLvl w:val="1"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120" w:line="280" w:lineRule="auto"/><w:outlineLvl w:val="2"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100" w:line="280" w:lineRule="auto"/><w:outlineLvl w:val="3"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F6F8"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="140"/><w:contextualSpacing/></w:pPr>'
  + '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:sz w:val="17"/></w:rPr></w:style>'
  + '</w:styles>';

const numberingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>'
  + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="420" w:hanging="300"/></w:pPr><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:hint="default"/></w:rPr></w:lvl>'
  + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="840" w:hanging="300"/></w:pPr><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:hint="default"/></w:rPr></w:lvl>'
  + '</w:abstractNum>'
  + '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>'
  + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="420" w:hanging="360"/></w:pPr></w:lvl>'
  + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="840" w:hanging="360"/></w:pPr></w:lvl>'
  + '</w:abstractNum>'
  + '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>'
  + '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>'
  + '</w:numbering>';

const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
  + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '</Types>';

const relsRoot = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '</Relationships>';

const relsDoc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
  + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
  + '</Relationships>';

const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
  + '<dc:title>UNO / LayUDown 开发日志（1.0.0 → 1.2.4）</dc:title>'
  + '<dc:creator>DeepSeek Harness</dc:creator>'
  + '<cp:lastModifiedBy>DeepSeek Harness</cp:lastModifiedBy>'
  + '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>'
  + '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>'
  + '</cp:coreProperties>';

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let idx = 0; idx < buf.length; idx += 1) { crc = (crc >>> 8) ^ crcTable[(crc ^ buf[idx]) & 0xFF]; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(entries) {
  const d = new Date();
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF;
  const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), centralBuf, end]);
}

const entries = [
  { name: '[Content_Types].xml', data: contentTypes },
  { name: '_rels/.rels', data: relsRoot },
  { name: 'docProps/core.xml', data: coreXml },
  { name: 'word/document.xml', data: documentXml },
  { name: 'word/styles.xml', data: stylesXml },
  { name: 'word/numbering.xml', data: numberingXml },
  { name: 'word/footer1.xml', data: FOOT },
  { name: 'word/_rels/document.xml.rels', data: relsDoc }
];

const dir = path.dirname(outputPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(outputPath, buildZip(entries));
console.log('wrote ' + outputPath + ' (' + documentXml.length + ' chars of document.xml, ' + bodyParts.length + ' blocks)');
