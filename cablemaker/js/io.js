import { clamp, uid } from './geom.js';
import {
  SCHEMA_VERSION,
  createDocument,
  createConnector,
  createWire,
  createAnnotation,
} from './model.js';

export const FILE_EXT = '.cablemaker.json';

const PNG_SCALE = 4;
const MAX_CANVAS_SIDE = 16384;
const COORD = 100000;
const MAX_TEXT = 4000;
const MAX_LABEL = 400;
const MAX_NAME = 120;
const MAX_ID = 64;
const MAX_CONNECTORS = 2000;
const MAX_WIRES = 8000;
const MAX_ANNOTATIONS = 2000;
const MAX_ERRORS = 50;

// render.js and catalog.js are pulled in lazily so that io.js stays importable
// on its own; the exporters only run long after startup.
let renderMod = null;
let catalogMod = null;
let modsPromise = null;

function loadModules() {
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('./render.js').then((m) => { renderMod = m; }, () => {}),
      import('./catalog.js').then((m) => { catalogMod = m; }, () => {}),
    ]);
  }
  return modsPromise;
}

loadModules();

// --- primitive coercion -----------------------------------------------------

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function num(v, fallback, lo = -COORD, hi = COORD) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

function int(v, fallback, lo, hi) {
  const n = num(v, NaN, lo, hi);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function str(v, fallback, max = MAX_TEXT) {
  if (typeof v !== 'string') return fallback;
  return v.length > max ? v.slice(0, max) : v;
}

function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR = /^[a-z]{3,20}$/i;

function color(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return HEX_COLOR.test(s) || NAMED_COLOR.test(s) ? s : fallback;
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function takeId(raw, used, prefix) {
  const s = typeof raw === 'string' ? raw.slice(0, MAX_ID) : '';
  if (ID_RE.test(s) && !used.has(s)) {
    used.add(s);
    return s;
  }
  let id = uid(prefix);
  while (used.has(id)) id = uid(prefix);
  used.add(id);
  return id;
}

// --- optional catalogue cross-checks ----------------------------------------

function knownFamily(id, fallback) {
  const fams = catalogMod && catalogMod.FAMILIES;
  if (!isObj(fams)) return id;
  return Object.prototype.hasOwnProperty.call(fams, id) ? id : fallback;
}

function clampPinCount(familyId, n) {
  const fn = catalogMod && catalogMod.clampPins;
  if (typeof fn === 'function') {
    try {
      const r = Math.round(Number(fn(familyId, n)));
      if (Number.isFinite(r) && r > 0) return r;
    } catch {
      // unknown family: fall through to the generic clamp
    }
  }
  return clamp(Math.round(n), 1, 64);
}

function snapAwg(v, fallback) {
  const n = int(v, NaN, 1, 60);
  if (!Number.isFinite(n)) return fallback;
  const table = catalogMod && catalogMod.AWG;
  if (!isObj(table) || Object.prototype.hasOwnProperty.call(table, String(n))) return n;
  const keys = Object.keys(table).map(Number).filter(Number.isFinite);
  if (!keys.length) return n;
  return keys.reduce((best, k) => (Math.abs(k - n) < Math.abs(best - n) ? k : best), keys[0]);
}

// --- validation -------------------------------------------------------------

function collector() {
  const errors = [];
  let suppressed = 0;
  return {
    push(msg) {
      if (errors.length < MAX_ERRORS) errors.push(msg);
      else suppressed++;
    },
    finish() {
      if (suppressed) errors.push(`...and ${suppressed} more problem(s).`);
      return errors;
    },
  };
}

export function validateDocument(doc) {
  const log = collector();
  const D = createDocument();

  if (!isObj(doc)) {
    log.push('The document is not a JSON object.');
    return { ok: false, errors: log.finish(), doc: D };
  }

  const fileVersion = typeof doc.version === 'number' ? doc.version : Number(doc.version);
  if (Number.isFinite(fileVersion) && fileVersion > SCHEMA_VERSION) {
    log.push(`Unsupported schema version ${fileVersion}; this build reads up to ${SCHEMA_VERSION}.`);
  }

  const sheet = isObj(doc.sheet) ? doc.sheet : {};
  const title = isObj(doc.title) ? doc.title : {};
  const note = isObj(doc.note) ? doc.note : {};
  const view = isObj(doc.view) ? doc.view : {};

  const out = {
    version: SCHEMA_VERSION,
    sheet: {
      w: num(sheet.w, D.sheet.w, 10, 10000),
      h: num(sheet.h, D.sheet.h, 10, 10000),
      bg: color(sheet.bg, D.sheet.bg),
    },
    title: {
      text: str(title.text, D.title.text, MAX_LABEL),
      x: num(title.x, D.title.x),
      y: num(title.y, D.title.y),
      size: num(title.size, D.title.size, 0.5, 400),
      visible: bool(title.visible, D.title.visible),
    },
    note: {
      text: str(note.text, D.note.text),
      x: num(note.x, D.note.x),
      y: num(note.y, D.note.y),
      w: num(note.w, D.note.w, 1, COORD),
      h: num(note.h, D.note.h, 1, COORD),
      visible: bool(note.visible, D.note.visible),
    },
    view: {
      wireScale: num(view.wireScale, D.view.wireScale, 0.1, 60),
      grid: num(view.grid, D.view.grid, 0.1, 500),
      showGrid: bool(view.showGrid, D.view.showGrid),
      snap: bool(view.snap, D.view.snap),
    },
    connectors: [],
    wires: [],
    annotations: [],
  };

  const ids = new Set();
  const remap = new Map();
  const pinCount = new Map();

  const CB = createConnector();
  for (const raw of listOf(doc.connectors, 'connectors', MAX_CONNECTORS, log)) {
    if (!isObj(raw)) {
      log.push('Skipped a connector entry that is not an object.');
      continue;
    }
    const family = knownFamily(str(raw.family, CB.family, MAX_ID), CB.family);
    if (typeof raw.family === 'string' && raw.family !== family) {
      log.push(`Unknown connector family "${raw.family.slice(0, 40)}"; using ${family}.`);
    }
    const pins = clampPinCount(family, int(raw.pins, CB.pins, 1, 256));
    const id = takeId(raw.id, ids, 'c');
    if (typeof raw.id === 'string' && raw.id && !remap.has(raw.id)) remap.set(raw.id, id);
    pinCount.set(id, pins);
    out.connectors.push({
      id,
      kind: 'connector',
      family,
      pins,
      view: pick(raw.view, ['top', 'bottom'], CB.view),
      x: num(raw.x, CB.x),
      y: num(raw.y, CB.y),
      rot: ((num(raw.rot, CB.rot) % 360) + 360) % 360,
      scale: num(raw.scale, CB.scale, 0.1, 50),
      reversePins: bool(raw.reversePins, CB.reversePins),
      label: str(raw.label, CB.label, MAX_LABEL),
      labelPos: pick(raw.labelPos, ['above', 'below', 'none'], CB.labelPos),
      legend: pick(raw.legend, ['left', 'right', 'none'], CB.legend),
      pinNames: Array.isArray(raw.pinNames)
        ? raw.pinNames.slice(0, pins).map((n) => str(n, '', 120))
        : [],
    });
  }

  const WB = createWire();
  for (const raw of listOf(doc.wires, 'wires', MAX_WIRES, log)) {
    if (!isObj(raw)) {
      log.push('Skipped a wire entry that is not an object.');
      continue;
    }
    const a = endpoint(raw.a, remap, pinCount);
    const b = endpoint(raw.b, remap, pinCount);
    if (!a || !b) {
      log.push('Dropped a wire whose endpoint references a missing connector.');
      continue;
    }
    out.wires.push({
      id: takeId(raw.id, ids, 'w'),
      kind: 'wire',
      a,
      b,
      color: color(raw.color, WB.color),
      colorName: str(raw.colorName, WB.colorName, 60),
      awg: snapAwg(raw.awg, WB.awg),
      bow: num(raw.bow, WB.bow, 0.05, 1.5),
    });
  }

  for (const raw of listOf(doc.annotations, 'annotations', MAX_ANNOTATIONS, log)) {
    if (!isObj(raw)) {
      log.push('Skipped an annotation entry that is not an object.');
      continue;
    }
    const ann = sanitizeAnnotation(raw, log);
    if (!ann) continue;
    ann.id = takeId(raw.id, ids, 'a');
    out.annotations.push(ann);
  }

  const errors = log.finish();
  return { ok: errors.length === 0, errors, doc: out };
}

function listOf(value, name, max, log) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    log.push(`"${name}" is not a list; it was ignored.`);
    return [];
  }
  if (value.length > max) {
    log.push(`"${name}" holds ${value.length} entries; only the first ${max} were kept.`);
    return value.slice(0, max);
  }
  return value;
}

function endpoint(raw, remap, pinCount) {
  if (!isObj(raw)) return null;
  const rawId = typeof raw.connector === 'string' ? raw.connector : null;
  if (!rawId) return null;
  const id = remap.get(rawId) ?? (pinCount.has(rawId) ? rawId : null);
  if (!id || !pinCount.has(id)) return null;
  return { connector: id, pin: int(raw.pin, 1, 1, pinCount.get(id)) };
}

function sanitizeAnnotation(raw, log) {
  const kind = pick(raw.kind, ['text', 'dimension', 'note'], null);
  if (!kind) {
    log.push(`Dropped an annotation of unknown kind "${String(raw.kind).slice(0, 40)}".`);
    return null;
  }
  const base = createAnnotation({ kind });
  const out = { id: '', kind, x: num(raw.x, base.x), y: num(raw.y, base.y) };
  if (kind === 'text') {
    out.text = str(raw.text, base.text, MAX_LABEL);
    out.size = num(raw.size, base.size, 0.5, 400);
    out.align = pick(raw.align, ['start', 'middle', 'end'], base.align);
    out.weight = int(raw.weight, base.weight, 100, 900);
    out.color = color(raw.color, base.color);
  } else if (kind === 'dimension') {
    out.x2 = num(raw.x2, out.x + 100);
    out.y2 = num(raw.y2, out.y);
    out.offset = num(raw.offset, base.offset);
    out.text = str(raw.text, base.text, MAX_LABEL);
    out.value = num(raw.value, base.value);
  } else {
    out.w = num(raw.w, base.w, 1, COORD);
    out.h = num(raw.h, base.h, 1, COORD);
    out.text = str(raw.text, base.text);
    out.size = num(raw.size, base.size, 0.5, 400);
  }
  return out;
}

// --- serialisation ----------------------------------------------------------

export function serialize(doc) {
  if (!isObj(doc)) throw new TypeError('serialize() expects a document object.');
  return `${JSON.stringify({ ...doc, version: SCHEMA_VERSION }, null, 2)}\n`;
}

export function deserialize(text) {
  if (typeof text !== 'string') {
    throw new Error('Nothing to read: the file contents were not text.');
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`This file is not valid JSON: ${err.message}`);
  }
  if (!isObj(data)) {
    throw new Error('This file does not contain a CableMaker document.');
  }
  const fileVersion = typeof data.version === 'number' ? data.version : Number(data.version);
  if (Number.isFinite(fileVersion) && fileVersion > SCHEMA_VERSION) {
    throw new Error(
      `This drawing was saved by a newer version of CableMaker (file schema ${fileVersion}, this build reads ${SCHEMA_VERSION}).`,
    );
  }
  return validateDocument(data).doc;
}

// --- file names -------------------------------------------------------------

function sanitizeName(name) {
  return String(name ?? '')
    .replace(/[\\/]/g, ' ')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME)
    .trim();
}

function defaultName(doc) {
  return sanitizeName(doc?.title?.text || '').replace(/ /g, '-') || 'cable-assembly';
}

function withExt(name, ext) {
  const base = sanitizeName(name) || 'cable-assembly';
  if (base.toLowerCase().endsWith(ext.toLowerCase())) return base;
  return `${base.replace(/\.(json|svg|png)$/i, '')}${ext}`;
}

// --- browser I/O ------------------------------------------------------------

function requireDom() {
  if (typeof document === 'undefined') {
    throw new Error('File I/O is only available in a browser.');
  }
}

export function downloadBlob(blob, filename) {
  requireDom();
  if (!(blob instanceof Blob)) throw new TypeError('downloadBlob() expects a Blob.');
  const name = sanitizeName(filename) || 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Firefox and Safari abort the transfer if the object URL dies immediately.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

export function saveFile(doc, filename) {
  const name = withExt(filename || defaultName(doc), FILE_EXT);
  const blob = new Blob([serialize(doc)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, name);
  return name;
}

export async function openFile() {
  requireDom();
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    let file = null;
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'CableMaker drawing', accept: { 'application/json': ['.json'] } }],
      });
      file = handle ? await handle.getFile() : null;
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      file = null;
    }
    // Only an unusable picker falls through to the <input>; a file the user did
    // choose must surface its own parse error instead of silently reprompting.
    if (file) return { doc: deserialize(await file.text()), name: file.name };
  }
  return openWithInput();
}

function openWithInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXT},.json,application/json`;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      fn(arg);
    };
    // Browsers without the 'cancel' event give no other hint that the dialog
    // was dismissed than the window regaining focus with nothing chosen.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(resolve, null);
      }, 600);
    };

    input.addEventListener('cancel', () => finish(resolve, null));
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        finish(resolve, null);
        return;
      }
      file.text().then(
        (text) => {
          try {
            finish(resolve, { doc: deserialize(text), name: file.name });
          } catch (err) {
            finish(reject, err);
          }
        },
        (err) => finish(reject, err),
      );
    });

    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

// --- export -----------------------------------------------------------------

function svgMarkupFor(store, renderer) {
  const fn = renderer && typeof renderer.svgMarkup === 'function'
    ? (s, opts) => renderer.svgMarkup(s, opts)
    : renderMod && typeof renderMod.svgMarkup === 'function'
      ? renderMod.svgMarkup
      : null;
  if (!fn) throw new Error('Export needs svgMarkup() from render.js, which is not available.');
  const markup = fn(store, { standalone: true });
  if (typeof markup !== 'string' || !markup.includes('<svg')) {
    throw new Error('The renderer did not return SVG markup.');
  }
  // render.js already prepends an XML declaration in standalone mode; strip it
  // so the callers below stay in charge of emitting exactly one.
  return markup.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
}

function patchSvgRoot(markup, attrs) {
  const m = /<svg\b[^>]*>/i.exec(markup);
  if (!m) throw new Error('The exported markup has no <svg> root.');
  let tag = m[0];
  for (const [key, value] of Object.entries(attrs)) {
    const re = new RegExp(`\\s${key}\\s*=\\s*"[^"]*"`, 'i');
    // Function replacements: a literal one would reinterpret `$` in `value`.
    const attr = ` ${key}="${value}"`;
    tag = re.test(tag) ? tag.replace(re, () => attr) : tag.replace(/<svg\b/i, () => `<svg${attr}`);
  }
  return markup.slice(0, m.index) + tag + markup.slice(m.index + m[0].length);
}

export function exportSVG(store, renderer, filename) {
  requireDom();
  const markup = patchSvgRoot(svgMarkupFor(store, renderer), {
    xmlns: 'http://www.w3.org/2000/svg',
  });
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', markup], {
    type: 'image/svg+xml;charset=utf-8',
  });
  downloadBlob(blob, withExt(filename || defaultName(store?.doc), '.svg'));
  return blob;
}

export async function exportPNG(store, renderer, filename, { scale = PNG_SCALE, background } = {}) {
  requireDom();
  await loadModules();

  const doc = store?.doc ?? createDocument();
  const sheetW = num(doc.sheet?.w, 420, 1, 10000);
  const sheetH = num(doc.sheet?.h, 260, 1, 10000);
  const px = Math.min(
    num(scale, PNG_SCALE, 0.1, 200),
    MAX_CANVAS_SIDE / sheetW,
    MAX_CANVAS_SIDE / sheetH,
  );
  const w = Math.max(1, Math.round(sheetW * px));
  const h = Math.max(1, Math.round(sheetH * px));

  const markup = patchSvgRoot(svgMarkupFor(store, renderer), {
    xmlns: 'http://www.w3.org/2000/svg',
    width: String(w),
    height: String(h),
  });

  // Blob + object URL rather than btoa(): a title with non-Latin text breaks btoa.
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  let blob;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
    const bg = background === undefined ? color(doc.sheet?.bg, '#ffffff') : background;
    if (bg && bg !== 'none' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    blob = await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }

  if (filename !== null) downloadBlob(blob, withExt(filename || defaultName(doc), '.png'));
  return blob;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The drawing could not be rasterised.'));
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The PNG could not be encoded.'));
    }, 'image/png');
  });
}
