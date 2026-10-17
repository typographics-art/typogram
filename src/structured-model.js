// Shared pieces of the TGD data models: cells, addresses, sheets (docs/structured-data.md §Models).
import { TgdError, Dec } from './structured-json.js';

export const textOf = (bytes, encoding) => {
  if (typeof bytes === 'string') return bytes;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const skip = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  try { return new TextDecoder(encoding || 'utf-8', { fatal: true }).decode(b.subarray(skip)); } catch {
    throw new TgdError('encoding', encoding
      ? `The file is not valid ${encoding}`
      : 'The file is not valid UTF-8. Save it as UTF-8 first, or name its encoding (for example windows-1252)');
  }
};
export const hasBom = (bytes) => typeof bytes !== 'string' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

/** A number cell from its decimal literal: a plain number if that prints back exactly, else a typed {"$":"n"} value. */
export const numCell = (lit) => {
  const n = Number(lit);
  return Number.isFinite(n) && String(n) === lit && !Object.is(n, -0) ? n : { $: 'n', v: lit };
};

// ---- A1 addresses -----------------------------------------------------------------------------------------------
export const colName = (c) => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
export const colIndex = (name) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const addr = (r, c) => colName(c) + (r + 1);
export function parseAddr(a) {
  const m = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(a);
  if (!m) throw new TgdError('shape', `Not a cell address: ${JSON.stringify(String(a).slice(0, 20))}`);
  return { r: Number(m[2]) - 1, c: colIndex(m[1]) };
}
export const MAX_ROWS = 1048576, MAX_COLS = 16384;

// ---- sheets: dense rows or sparse cells ------------------------------------------------------------------------
const isEmpty = (v) => v === null || v === undefined;
const cellJsonSize = (v) => (v && typeof v === 'object' ? JSON.stringify(v).length : isEmpty(v) ? 4 : JSON.stringify(v).length);

/**
 * Builds the sheet members for a grid (array of rows of cell values; null = empty). Picks the smaller of the dense
 * layout ("rows") and the sparse layout ("cells": {"B2": value}). `trim`: drop trailing empty cells in every row.
 */
export function layoutGrid(grid, { trim = true } = {}) {
  const rows = grid.map((row) => {
    let n = row.length;
    if (trim) while (n > 0 && isEmpty(row[n - 1])) n--;
    return row.slice(0, n).map((v) => (v === undefined ? null : v));
  });
  let dense = 2, sparse = 2, used = 0;
  rows.forEach((row, r) => {
    dense += row.length ? 2 : 4;
    row.forEach((v, c) => { dense += cellJsonSize(v) + 1; if (!isEmpty(v)) { used++; sparse += addr(r, c).length + 4 + cellJsonSize(v); } });
  });
  if (!used) return { rows: [] };
  if (sparse < dense * 0.8) {
    const cells = {};
    rows.forEach((row, r) => row.forEach((v, c) => { if (!isEmpty(v)) cells[addr(r, c)] = v; }));
    return { cells };
  }
  while (rows.length && !rows.at(-1).length) rows.pop();
  return { rows };
}

/** The grid (array of rows) of a decoded sheet (plain object), whichever layout it uses. */
export function gridOf(sheet, limits = {}) {
  const maxCells = limits.maxCells ?? 20_000_000, maxDense = limits.maxDense ?? 20_000_000;
  if (Array.isArray(sheet.rows)) {
    if (sheet.cells) throw new TgdError('shape', `Sheet ${JSON.stringify(sheet.name)} has both "rows" and "cells"`);
    return sheet.rows.map((r) => { if (!Array.isArray(r)) throw new TgdError('shape', 'A row is not an array'); return r; });
  }
  const grid = [];
  let n = 0;
  for (const [a, v] of Object.entries(sheet.cells || {})) {
    const { r, c } = parseAddr(a);
    if (r >= MAX_ROWS || c >= MAX_COLS) throw new TgdError('limit', `Cell ${a} is outside the sheet limits`);
    if (++n > maxCells) throw new TgdError('limit', 'Too many cells');
    (grid[r] ||= [])[c] = v;
  }
  let dense = 0;
  grid.forEach((row) => { dense += row.length; });
  if (dense > maxDense) throw new TgdError('limit', `The sheet would need ${dense} cells as a table; writing it as a file is limited to ${maxDense}`);
  for (let r = 0; r < grid.length; r++) if (grid[r]) grid[r] = Array.from(grid[r], (v) => (v === undefined ? null : v));
  return grid;
}

/** A cell as plain text, for formats that have no types (CSV, Markdown tables). */
export function cellText(v) {
  if (isEmpty(v)) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v instanceof Dec) return v.lit;
  if (typeof v === 'object' && typeof v.$ === 'string') {
    if (v.$ === 'f') return cellText(v.v ?? null);
    return String(v.v);
  }
  throw new TgdError('shape', 'A cell has an unknown shape');
}

// ---- JSON documents: the model is the document itself; $-keys and big numbers are the only things that need care ----
/** JSON AST -> model: a key made only of "$" gets one more "$" (the typed values {"$":…} own the plain "$"). */
export function jsonToModel(v) {
  if (Array.isArray(v)) return v.map(jsonToModel);
  if (v instanceof Map) { const m = new Map(); for (const [k, x] of v) m.set(/^\$+$/.test(k) ? k + '$' : k, jsonToModel(x)); return m; }
  return v;
}
/** model -> JSON AST: typed numbers become numbers again, "$$…" keys lose one "$". */
export function modelToJson(v) {
  if (Array.isArray(v)) return v.map(modelToJson);
  if (v instanceof Map) {
    if (v.has('$')) {
      if (v.get('$') === 'n' && v.size === 2 && typeof v.get('v') === 'string') return new Dec(v.get('v'));
      throw new TgdError('shape', `A typed value {"$":${JSON.stringify(String(v.get('$')))}} cannot be written as JSON`);
    }
    const m = new Map();
    for (const [k, x] of v) m.set(/^\$\$+$/.test(k) ? k.slice(1) : k, modelToJson(x));
    return m;
  }
  return v;
}

