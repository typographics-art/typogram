// Excel (.xlsx) as a TGD workbook model, without a spreadsheet library: an .xlsx file is a ZIP of XML parts, read here
// with src/structured-zip.js and src/structured-xml.js (docs/structured-data.md §Excel).
//
// Kept: sheets (names, hidden state, order), cell values with their types (text, number as its exact decimal
// literal, boolean, date/time as ISO text, error), formulas with their cached values, merged ranges, cell comments,
// defined names, the 1900/1904 date system. Dropped and declared in every envelope: styles and formats (except
// recognising dates), widths and heights, validation, conditional formatting, drawings, charts, macros.
import { TgdError } from './structured-json.js';
import { openZip, writeZip } from './structured-zip.js';
import { parseXml, xmlTag, xmlKids, xmlElems, xmlText, xmlAttr } from './structured-xml.js';
import { numCell, layoutGrid, gridOf, parseAddr, addr, MAX_ROWS, MAX_COLS } from './structured-model.js';

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_TIME_ONLY = new Set([18, 19, 20, 21, 45, 46, 47]);

/** ST_Xstring: Excel writes characters XML cannot hold as _xHHHH_ (and a literal "_x" as _x005F_x). */
const unx = (s) => (s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16))) : s);
const enx = (s) => String(s).replace(/_x(?=[0-9A-Fa-f]{4}_)/g, '_x005F_x').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);

/** 'date' | 'datetime' | 'time' | null for a number format code (builtin id or custom code). */
export function dateKind(fmtId, code) {
  if (code == null) return BUILTIN_DATE.has(fmtId) ? (fmtId === 14 || fmtId === 15 || fmtId === 16 || (fmtId >= 27 && fmtId <= 36) || (fmtId >= 50 && fmtId <= 58) ? 'date' : fmtId === 22 ? 'datetime' : 'time') : null;
  const t = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h|m|s)[^\]]*\]/gi, '').replace(/_./g, '').replace(/\*./g, '').toLowerCase();
  if (/general/.test(t) && !/[ymdhs]/.test(t.replace(/general/g, ''))) return null;
  const yd = /[yd]/.test(t), hs = /[hs]|am\/pm|a\/p/.test(t), m = /m/.test(t);
  if (yd) return hs ? 'datetime' : 'date';
  if (hs) return 'time';
  return m ? 'date' : null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Excel serial -> ISO text, or null when no date can stand for it (before 1900-03-01 in the 1900 system, negatives). */
export function serialToIso(serial, kind, date1904 = false) {
  if (!Number.isFinite(serial)) return null;
  if (kind === 'time') {
    if (serial < 0 || serial >= 1) return null;
    const ms = Math.round(serial * 86400000);
    if (ms >= 86400000) return null;
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${ms % 1000 ? '.' + pad(ms % 1000, 3) : ''}`;
  }
  if (serial < (date1904 ? 0 : 61) || serial >= 2958466) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86400000));
  const day = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const ms = d.getUTCHours() * 3600000 + d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds();
  if (kind === 'date' && ms === 0) return day;
  return `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${d.getUTCMilliseconds() ? '.' + pad(d.getUTCMilliseconds(), 3) : ''}`;
}
export function isoToSerial(iso, date1904 = false) {
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?)?$/.exec(iso);
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7] ? +m[7].padEnd(3, '0') : 0);
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    return (ms - epoch) / 86400000;
  }
  m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(iso);
  if (m) return (+m[1] * 3600000 + +m[2] * 60000 + +m[3] * 1000 + (m[4] ? +m[4].padEnd(3, '0') : 0)) / 86400000;
  return null;
}

const resolveTarget = (base, target) => {
  const parts = (target.startsWith('/') ? target.slice(1) : base.replace(/[^/]*$/, '') + target).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') { if (!out.length) throw new TgdError('zip-slip', 'A relationship points outside the archive'); out.pop(); } else if (p && p !== '.') out.push(p); }
  return out.join('/');
};
const relsOf = (xml) => new Map(xmlElems(xml.root, 'Relationship').map((r) => [xmlAttr(r, 'Id'), { target: xmlAttr(r, 'Target'), type: xmlAttr(r, 'Type') || '' }]));

function readSharedStrings(root) {
  return xmlElems(root, 'si').map((si) => {
    // <si><t>…</t></si> or runs <r><t>…</t></r>; phonetic hints (<rPh>) are not part of the text
    let s = '';
    for (const k of xmlKids(si)) { if (xmlTag(k) === 't') s += xmlText(k); else if (xmlTag(k) === 'r') for (const t of xmlElems(k, 't')) s += xmlText(t); }
    return unx(s);
  });
}

function readStyles(root) {
  const fmts = new Map(xmlElems(xmlElems(root, 'numFmts')[0] || ['x'], 'numFmt').map((n) => [Number(xmlAttr(n, 'numFmtId')), xmlAttr(n, 'formatCode')]));
  const xfs = xmlElems(xmlElems(root, 'cellXfs')[0] || ['x'], 'xf');
  return xfs.map((xf) => { const id = Number(xmlAttr(xf, 'numFmtId') || 0); return dateKind(id, fmts.get(id) ?? null); });
}

export async function readXlsx(bytes, { limits } = {}) {
  const zip = openZip(bytes, limits?.zip);
  const xml = async (name) => { if (!zip.has(name)) return null; return parseXml(new TextDecoder().decode(await zip.read(name)), limits?.xml); };
  const wbXml = await xml('xl/workbook.xml');
  if (!wbXml) throw new TgdError('format', 'This ZIP archive is not an Excel workbook (xl/workbook.xml is missing)');
  const rels = relsOf(await xml('xl/_rels/workbook.xml.rels') || { root: ['Relationships'] });
  const date1904 = ['1', 'true'].includes(xmlAttr(xmlElems(wbXml.root, 'workbookPr')[0] || ['x'], 'date1904'));
  const sst = zip.has('xl/sharedStrings.xml') ? readSharedStrings((await xml('xl/sharedStrings.xml')).root) : [];
  const dateKinds = zip.has('xl/styles.xml') ? readStyles((await xml('xl/styles.xml')).root) : [];
  const names = {};
  for (const n of xmlElems(xmlElems(wbXml.root, 'definedNames')[0] || ['x'], 'definedName')) {
    if (xmlAttr(n, 'hidden') === '1' || xmlAttr(n, 'localSheetId') != null || /^_xlnm\./.test(xmlAttr(n, 'name'))) continue;
    names[xmlAttr(n, 'name')] = xmlText(n);
  }
  const notes = { sharedFormulaValues: 0, early: 0, arrayFormulas: 0, sheets: 0, hiddenRows: false };
  const sheets = [];
  let cellCount = 0;
  const maxCells = limits?.maxCells ?? 5_000_000;
  for (const sh of xmlElems(xmlElems(wbXml.root, 'sheets')[0] || ['x'], 'sheet')) {
    const rid = xmlAttr(sh, 'r:id') ?? xmlAttr(sh, 'id');
    const rel = rels.get(rid);
    if (!rel) throw new TgdError('format', `Sheet ${JSON.stringify(xmlAttr(sh, 'name'))} has no relationship`);
    if (!/\/worksheet$/.test(rel.type)) continue; // chartsheets, dialog sheets: no cells
    const path = resolveTarget('xl/workbook.xml', rel.target);
    const sx = await xml(path);
    if (!sx) throw new TgdError('format', `The sheet part ${path} is missing`);
    const grid = [];
    const merges = [];
    for (const m of xmlElems(sx.root, 'mergeCells').flatMap((mc) => xmlElems(mc, 'mergeCell'))) merges.push(xmlAttr(m, 'ref'));
    const sheetData = xmlElems(sx.root, 'sheetData')[0] || ['sheetData'];
    let rowNo = -1;
    for (const row of xmlElems(sheetData, 'row')) {
      rowNo = xmlAttr(row, 'r') ? Number(xmlAttr(row, 'r')) - 1 : rowNo + 1;
      if (xmlAttr(row, 'hidden') === '1') notes.hiddenRows = true;
      if (!(rowNo >= 0 && rowNo < MAX_ROWS)) throw new TgdError('shape', `Bad row number ${rowNo + 1}`);
      let colNo = -1;
      for (const c of xmlElems(row, 'c')) {
        const ref = xmlAttr(c, 'r');
        if (ref) { const p = parseAddr(ref); colNo = p.c; if (p.r !== rowNo) throw new TgdError('shape', `Cell ${ref} is in row ${rowNo + 1}`); } else colNo++;
        if (colNo >= MAX_COLS) throw new TgdError('shape', 'A cell is beyond column XFD');
        const t = xmlAttr(c, 't') || 'n';
        const vEl = xmlElems(c, 'v')[0], fEl = xmlElems(c, 'f')[0], isEl = xmlElems(c, 'is')[0];
        const vText = vEl ? xmlText(vEl) : null;
        let val = null;
        if (t === 's') { if (vText !== null) { const s = sst[Number(vText)]; if (s === undefined) throw new TgdError('shape', `Shared string ${vText} does not exist`); val = s; } }
        else if (t === 'inlineStr') val = isEl ? unx(xmlElems(isEl, 't').map(xmlText).join('') + xmlElems(isEl, 'r').flatMap((r) => xmlElems(r, 't')).map(xmlText).join('')) : null;
        else if (t === 'str') val = vText === null ? null : unx(vText);
        else if (t === 'b') val = vText === null ? null : vText.trim() === '1';
        else if (t === 'e') val = vText === null ? null : { $: 'e', v: vText };
        else if (t === 'd') val = vText === null ? null : { $: 'dt', v: vText.replace(/Z$/, '') };
        else if (t === 'n' && vText !== null && vText.trim() !== '') {
          const lit = vText.trim();
          if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(lit)) throw new TgdError('shape', `Cell ${ref}: not a number: ${JSON.stringify(lit.slice(0, 30))}`);
          const norm = lit.replace(/^(-?)\./, '$10.').replace(/\.(?=[eE]|$)/, '').replace(/^(-?)0+(?=\d)/, '$1');
          const kind = dateKinds[Number(xmlAttr(c, 's') || 0)] || null;
          const iso = kind ? serialToIso(Number(norm), kind, date1904) : null;
          if (iso) val = { $: kind === 'time' ? 't' : /T/.test(iso) ? 'dt' : 'd', v: iso };
          else { if (kind && !iso) notes.early++; val = numCell(norm); }
        }
        if (fEl) {
          const ft = xmlText(fEl);
          if (ft !== '') {
            if (xmlAttr(fEl, 't') === 'array') notes.arrayFormulas++;
            val = val === null ? { $: 'f', f: ft } : { $: 'f', f: ft, v: val };
          } else if (xmlAttr(fEl, 't') === 'shared') notes.sharedFormulaValues++;
        }
        if (val === null) continue;
        if (++cellCount > maxCells) throw new TgdError('limit', `More than ${maxCells} cells; split the workbook`);
        ((grid[rowNo] ||= [])[colNo] = val);
      }
    }
    for (let r = 0; r < grid.length; r++) grid[r] = grid[r] ? Array.from(grid[r], (v) => (v === undefined ? null : v)) : [];
    const comments = {};
    const sheetRels = zip.has(path.replace(/([^/]*)$/, '_rels/$1.rels')) ? relsOf(await xml(path.replace(/([^/]*)$/, '_rels/$1.rels'))) : new Map();
    for (const rel2 of sheetRels.values()) {
      if (!/\/comments$/.test(rel2.type)) continue;
      const cx = await xml(resolveTarget(path, rel2.target));
      for (const cm of xmlElems(xmlElems(cx.root, 'commentList')[0] || ['x'], 'comment')) comments[xmlAttr(cm, 'ref')] = unx(xmlElems(xmlElems(cm, 'text')[0] || ['x'], 't').map(xmlText).join('') + xmlElems(xmlElems(cm, 'text')[0] || ['x'], 'r').flatMap((r) => xmlElems(r, 't')).map(xmlText).join(''));
    }
    const state = xmlAttr(sh, 'state');
    const hdr = looksLikeHeader(grid);
    sheets.push({
      name: xmlAttr(sh, 'name'), ...(state === 'hidden' || state === 'veryHidden' ? { state } : {}), ...(hdr ? { header: true } : {}),
      ...layoutGrid(grid), ...(merges.length ? { merges } : {}), ...(Object.keys(comments).length ? { comments } : {}),
    });
    notes.sheets++;
  }
  if (!sheets.length) throw new TgdError('format', 'The workbook has no worksheets');
  const lossy = ['styles, fonts, colours, borders and number formats (dates and times are recognised and kept)', 'column widths, row heights, hidden rows and columns, frozen panes',
    'data validation, conditional formatting, filters, tables, pivot tables', 'charts, images, drawings, macros'];
  if (notes.sharedFormulaValues) lossy.push(`shared formulas: ${notes.sharedFormulaValues} cells keep their value only (the first cell of each group keeps the formula)`);
  if (notes.arrayFormulas) lossy.push(`array formulas: ${notes.arrayFormulas} are kept as single-cell formulas`);
  if (notes.early) lossy.push(`${notes.early} date-formatted cells hold numbers a date cannot stand for (before 1900-03-01, negative, or a duration over 24 hours); they stay numbers`);
  lossy.push('date and time values are rounded to the millisecond and carry no time zone (Excel stores none)');
  return { data: { kind: 'workbook', ...(date1904 ? { date1904: true } : {}), ...(Object.keys(names).length ? { names } : {}), sheets }, lossy };
}

/** A hint for people and models: the first row is all distinct non-empty text and more rows follow. */
function looksLikeHeader(grid) {
  const first = grid[0];
  if (!first || first.length < 2 || grid.length < 2) return false;
  return first.every((v) => typeof v === 'string' && v !== '') && new Set(first).size === first.length;
}

// ---- writer -------------------------------------------------------------------------------------------------------
const esc = (s) => enx(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

function safeSheetName(name, used, i) {
  let n = String(name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31) || `Sheet${i + 1}`;
  const base = n;
  for (let k = 2; used.has(n.toLowerCase()); k++) n = base.slice(0, 31 - String(k).length - 1) + '_' + k;
  used.add(n.toLowerCase());
  return n;
}

export async function writeXlsx(block, { formulas = false } = {}) {
  const wb = block.model;
  const date1904 = wb.date1904 === true;
  const used = new Set();
  const sst = [], sstIndex = new Map();
  const sstId = (s) => { let i = sstIndex.get(s); if (i === undefined) { i = sst.length; sst.push(s); sstIndex.set(s, i); } return i; };
  const parts = [];
  const sheetsInfo = [];
  const notes = [];
  let anyComments = 0;
  const STYLE = { d: 1, dt: 2, t: 3 };
  const sheetXmls = [];
  const sheetList = wb.sheets || [];
  if (!sheetList.length) throw new TgdError('shape', 'The workbook has no sheets');
  sheetList.forEach((sheet, si) => {
    const name = safeSheetName(sheet.name, used, si);
    if (name !== sheet.name) notes.push(`Sheet name ${JSON.stringify(sheet.name)} became ${JSON.stringify(name)} (Excel allows 31 characters and no [ ] : * ? / \\).`);
    const grid = gridOf(sheet);
    const rowsXml = [];
    grid.forEach((row, r) => {
      const cells = [];
      row.forEach((v, c) => {
        if (v === null || v === undefined) return;
        const ref = addr(r, c);
        cells.push(cellXml(ref, v));
      });
      if (cells.length) rowsXml.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    });
    function cellXml(ref, v) {
      let f = null, val = v;
      if (v && typeof v === 'object' && v.$ === 'f') { f = formulas ? v.f : null; val = v.v ?? null; }
      const fx = f ? `<f>${esc(f)}</f>` : '';
      if (val === null || val === undefined) return fx ? `<c r="${ref}">${fx}</c>` : '';
      if (typeof val === 'string') return f ? `<c r="${ref}" t="str">${fx}<v>${esc(val)}</v></c>` : `<c r="${ref}" t="s"><v>${sstId(val)}</v></c>`;
      if (typeof val === 'boolean') return `<c r="${ref}" t="b">${fx}<v>${val ? 1 : 0}</v></c>`;
      if (typeof val === 'number') return `<c r="${ref}">${fx}<v>${val}</v></c>`;
      if (val.$ === 'n') return `<c r="${ref}">${fx}<v>${esc(val.v)}</v></c>`;
      if (val.$ === 'e') return `<c r="${ref}" t="e">${fx}<v>${esc(val.v)}</v></c>`;
      if (val.$ === 'd' || val.$ === 'dt' || val.$ === 't') {
        const serial = isoToSerial(val.v, date1904);
        if (serial === null) throw new TgdError('shape', `Cell ${ref}: not an ISO date or time: ${JSON.stringify(String(val.v).slice(0, 30))}`);
        return `<c r="${ref}" s="${STYLE[val.$]}">${fx}<v>${Number(serial.toPrecision(15))}</v></c>`;
      }
      throw new TgdError('shape', `Cell ${ref} has an unknown type`);
    }
    const merges = (sheet.merges || []).map((m) => `<mergeCell ref="${attr(m)}"/>`).join('');
    const commentList = Object.entries(sheet.comments || {});
    anyComments += commentList.length;
    sheetXmls.push({ name, state: sheet.state, rowsXml: rowsXml.join(''), merges, comments: commentList });
  });

  const wbSheets = [], wbRels = [], ctypes = [];
  const files = [];
  sheetXmls.forEach((s, i) => {
    const n = i + 1;
    const hasC = s.comments.length > 0;
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><sheetData>${s.rowsXml}</sheetData>${s.merges ? `<mergeCells count="${(s.merges.match(/<mergeCell /g) || []).length}">${s.merges}</mergeCells>` : ''}${hasC ? '<legacyDrawing r:id="rId1"/>' : ''}</worksheet>`;
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml });
    wbSheets.push(`<sheet name="${attr(s.name)}" sheetId="${n}"${s.state ? ` state="${attr(s.state)}"` : ''} r:id="rId${n}"/>`);
    wbRels.push(`<Relationship Id="rId${n}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    ctypes.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (hasC) {
      files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/vmlDrawing" Target="../drawings/vmlDrawing${n}.vml"/><Relationship Id="rId2" Type="${NS_REL}/comments" Target="../comments${n}.xml"/></Relationships>` });
      files.push({ name: `xl/comments${n}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>tg-data</author></authors><commentList>${s.comments.map(([ref, text]) => `<comment ref="${attr(ref)}" authorId="0"><text><t xml:space="preserve">${esc(text)}</t></text></comment>`).join('')}</commentList></comments>` });
      files.push({ name: `xl/drawings/vmlDrawing${n}.vml`, data: `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${n}"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${s.comments.map(([ref], k) => { const p = parseAddr(ref); return `<v:shape id="_x0000_s${n * 1024 + k + 1}" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:5pt;width:120pt;height:60pt;z-index:${k + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${p.c + 1}, 15, ${p.r}, 2, ${p.c + 3}, 15, ${p.r + 3}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${p.r}</x:Row><x:Column>${p.c}</x:Column></x:ClientData></v:shape>`; }).join('')}</xml>` });
      ctypes.push(`<Override PartName="/xl/comments${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
    }
  });
  const nSheets = sheetXmls.length;
  const names = Object.entries(wb.names || {});
  files.unshift({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">${date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets>${wbSheets.join('')}</sheets>${names.length ? `<definedNames>${names.map(([n, ref]) => `<definedName name="${attr(n)}">${esc(ref)}</definedName>`).join('')}</definedNames>` : ''}</workbook>` });
  files.unshift({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join('')}<Relationship Id="rId${nSheets + 1}" Type="${NS_REL}/styles" Target="styles.xml"/><Relationship Id="rId${nSheets + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/><numFmt numFmtId="166" formatCode="hh:mm:ss"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>` });
  files.push({ name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>` });
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${ctypes.join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  const order = ['[Content_Types].xml', '_rels/.rels'];
  files.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99) || a.name.localeCompare(b.name));
  const enc = new TextEncoder();
  const bytes = await writeZip(files.map((f) => ({ name: f.name, data: enc.encode(f.data) })));
  if (!formulas && JSON.stringify(wb).includes('"$":"f"')) notes.push('Formulas were written as their last calculated values. Use formulas:true to write the formulas themselves (only for data you trust).');
  return { bytes, name: String(block.name || 'data').replace(/\.[^.]*$/, '') + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', notes };
}
