// Model -> SVG. The scene is built as markup strings so that the live canvas and
// the standalone export share one code path.

import { clamp, fmt, dist, cubicBox } from './geom.js';
import * as catalog from './catalog.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const INK = '#1a1a1a';
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 60;

// Measured off the samples against the pin pitch: the dimension text is the
// largest of the three reading sizes, the connector label sits just under it and
// the legend names a further step down. Only the title breaks out of the range.
const LABEL_SIZE = 5.9;
const LABEL_LEAD = LABEL_SIZE * 1.16;
const LABEL_GAP = 8.5;
const LEGEND_SIZE = 5.4;
const LEGEND_R = 4;
const LEGEND_GAP = 7;
const DIM_SIZE = 6.3;
const NOTE_SIZE = 6.2;
const TITLE_SIZE = 16.5;
const TITLE_WEIGHT = 800;
const TITLE_LEAD = 1.2;
// The sheet heading carries the drawing: in the samples it runs ~2.6x the label,
// while the stored size stays the user's handle on it.
const TITLE_GAIN = 1.25;

const DIM_PEN = 0.45;
const DIM_EXT_PEN = 0.35;
const DIM_EXT_GAP = DIM_SIZE * 0.3;
const DIM_EXT_OVER = DIM_SIZE * 0.85;
const DIM_EXT_MIN = DIM_SIZE * 3.55;
const ARROW_LEN = DIM_SIZE * 0.72;
const ARROW_W = DIM_SIZE * 0.5;
const ARROW_ID = 'cm-arrow';

// Cross-section of the insulation from the upper edge (0) to the lower one (1):
// a dark rim, a specular band a third of the way down, then a long fall into
// shadow underneath. +1 is full highlight, -1 full shade.
const WIRE_SHADE_STOPS = [
  [0.0, -0.52],
  [0.1, -0.3],
  [0.18, -0.1],
  [0.26, 0.45],
  [0.33, 0.72],
  [0.42, 0.2],
  [0.5, -0.3],
  [0.62, -0.63],
  [0.75, -0.82],
  [0.88, -0.98],
  [1.0, -1.05],
];
const WIRE_BANDS = 16;
// Soft shadow cast on the sheet. Nested translucent passes read as a gradient
// without a blur filter, which keeps the exported SVG self-contained; the
// deepest reaches 0.41 of the stroke width below the tube and the five together
// darken the sheet by the ~13% of the samples.
const WIRE_SHADOW_BANDS = 5;
const WIRE_SHADOW_REACH = 0.41;
const WIRE_SHADOW_ALPHA = 0.028;
const WIRE_SHADOW_TOP = 0.2;

// --- small helpers ----------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function lines(text) {
  return String(text ?? '').split(/\r?\n/);
}

function textWidth(text, size, weight = 400) {
  const k = weight >= 600 ? 0.6 : 0.54;
  return String(text ?? '').length * size * k;
}

function toRgb(color) {
  let s = String(color ?? '').trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return { r: 26, g: 26, b: 26 };
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function darken(color, k) {
  const c = toRgb(color);
  return toHex({ r: c.r * (1 - k), g: c.g * (1 - k), b: c.b * (1 - k) });
}

function lighten(color, k) {
  const c = toRgb(color);
  return toHex({
    r: c.r + (255 - c.r) * k,
    g: c.g + (255 - c.g) * k,
    b: c.b + (255 - c.b) * k,
  });
}

function relLuma(color) {
  const c = toRgb(color);
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function hitAttrs(kind, id, extra = '') {
  return ` data-kind="${kind}" data-id="${esc(id)}"${extra}`;
}

function clientXY(pt) {
  if (!pt) return null;
  if (typeof pt.clientX === 'number') return { x: pt.clientX, y: pt.clientY };
  if (typeof pt.x === 'number') return { x: pt.x, y: pt.y };
  return null;
}

function cssEscape(value) {
  const s = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\]/g, '\\$&');
}

/** Multi-line <text> with the first baseline at (x, y). */
function textBlock(blockLines, x, y, opts = {}) {
  const {
    size = 5,
    anchor = 'middle',
    weight = 400,
    color = INK,
    lead = size * 1.28,
    cls = '',
  } = opts;
  const spans = blockLines
    .map((ln, i) => `<tspan x="${fmt(x)}"${i ? ` dy="${fmt(lead)}"` : ''}>${esc(ln)}</tspan>`)
    .join('');
  return (
    `<text${cls ? ` class="${cls}"` : ''} x="${fmt(x)}" y="${fmt(y)}" ` +
    `font-family='${FONT}' font-size="${fmt(size)}" font-weight="${weight}" ` +
    `fill="${esc(color)}" text-anchor="${anchor}" dominant-baseline="alphabetic" ` +
    `style="white-space:pre">${spans}</text>`
  );
}

function blockBox(blockLines, x, y, size, anchor, weight, lead) {
  const w = Math.max(...blockLines.map((l) => textWidth(l, size, weight)), size);
  const h = (blockLines.length - 1) * lead + size;
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { x: left, y: y - size * 0.8, w, h };
}

// --- wires ------------------------------------------------------------------

export function wirePath(store, wire) {
  if (!wire) return null;
  const ca = store.connector(wire.a?.connector);
  const cb = store.connector(wire.b?.connector);
  if (!ca || !cb) return null;
  let a;
  let b;
  let da;
  let db;
  try {
    a = catalog.pinExitWorld(ca, wire.a.pin);
    b = catalog.pinExitWorld(cb, wire.b.pin);
    da = catalog.pinDirWorld(ca, wire.a.pin);
    db = catalog.pinDirWorld(cb, wire.b.pin);
  } catch {
    return null;
  }
  if (!a || !b || !da || !db) return null;
  if (![a.x, a.y, b.x, b.y, da.x, da.y, db.x, db.y].every(Number.isFinite)) return null;
  const span = Math.max(dist(a, b), 1);
  const bow = Number(wire.bow);
  const h = clamp(Number.isFinite(bow) ? bow : 0.45, 0.05, 1.5) * span;
  const c1 = { x: a.x + da.x * h, y: a.y + da.y * h };
  const c2 = { x: b.x + db.x * h, y: b.y + db.y * h };
  const d =
    `M ${fmt(a.x)} ${fmt(a.y)} C ${fmt(c1.x)} ${fmt(c1.y)} ` +
    `${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`;
  return { d, a, b, c1, c2 };
}

function wireStrokeWidth(store, wire) {
  const scale = store.doc.view?.wireScale ?? 7;
  const w = catalog.wireWidth?.(wire.awg, scale);
  return Number.isFinite(w) && w > 0 ? w : 3;
}

function wireShadeAt(t) {
  for (let i = 1; i < WIRE_SHADE_STOPS.length; i++) {
    const [t1, v1] = WIRE_SHADE_STOPS[i];
    if (t > t1) continue;
    const [t0, v0] = WIRE_SHADE_STOPS[i - 1];
    return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
  }
  return WIRE_SHADE_STOPS[WIRE_SHADE_STOPS.length - 1][1];
}

// A pale wire has almost no room left towards white and turns to mud if it is
// darkened as hard as a black one, so the shade extent tracks luminance - and
// the highlight runs the other way, since a black tube can only be modelled by
// the light it catches.
function wireShadeDepth(color) {
  return 0.82 - 0.5 * relLuma(color);
}

function wireHighlightDepth(color) {
  const d = 1 - relLuma(color);
  return 0.1 + 0.22 * d * d;
}

function wireMarkup(store, wire, hit) {
  const path = wirePath(store, wire);
  if (!path) return '';
  const w = wireStrokeWidth(store, wire);
  const color = wire.color || '#1a1a1a';
  const shade = wireShadeDepth(color);
  const hilight = wireHighlightDepth(color);
  const base = `d="${path.d}" fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"`;
  let body = '';
  for (let i = 1; i <= WIRE_SHADOW_BANDS; i++) {
    const bottom = 0.5 + (WIRE_SHADOW_REACH * i) / WIRE_SHADOW_BANDS;
    body +=
      `<path class="wire-shadow" ${base} stroke="#000000" ` +
      `stroke-width="${fmt(w * (bottom - WIRE_SHADOW_TOP))}" opacity="${WIRE_SHADOW_ALPHA}" ` +
      `transform="translate(0 ${fmt((w * (bottom + WIRE_SHADOW_TOP)) / 2)})"/>`;
  }
  // Each band runs from its own upper edge down to the bottom of the tube, so
  // the band drawn after it leaves exactly one slice of it showing. Stacking
  // them opaque gives a continuous cross-section on a stroked curve, which a
  // linearGradient cannot: its axis follows the bounding box, not the normal.
  for (let i = 0; i < WIRE_BANDS; i++) {
    const t = i / WIRE_BANDS;
    const s = wireShadeAt((i + 0.5) / WIRE_BANDS);
    const stroke = s >= 0 ? lighten(color, s * hilight) : darken(color, -s * shade);
    body +=
      `<path class="wire-band" ${base} stroke="${stroke}" stroke-width="${fmt(w * (1 - t))}" ` +
      `transform="translate(0 ${fmt((w * t) / 2)})"/>`;
  }
  if (!hit) return `<g class="wire">${body}</g>`;
  const hitW = Math.max(2, w * 1.8);
  return (
    `<g class="wire"${hitAttrs('wire', wire.id)}>${body}` +
    `<path class="wire-hit" d="${path.d}" fill="none" stroke="transparent" ` +
    `stroke-width="${fmt(hitW)}" stroke-linecap="round" pointer-events="stroke"/></g>`
  );
}

// --- connectors -------------------------------------------------------------

function safeBox(conn) {
  try {
    const b = catalog.connectorBox(conn);
    if (b && Number.isFinite(b.x)) return b;
  } catch {
    /* fall through to a plausible default */
  }
  const s = conn.scale || 3;
  return { x: conn.x - 3 * s, y: conn.y - 5 * s, w: 6 * s, h: 10 * s };
}

function labelMarkup(conn, box) {
  const pos = conn.labelPos || 'above';
  if (pos === 'none') return '';
  let text = conn.label;
  if (!text) {
    try {
      text = catalog.defaultLabel(conn);
    } catch {
      text = '';
    }
  }
  if (!text) return '';
  const ls = lines(text);
  const cx = box.x + box.w / 2;
  const y =
    pos === 'below'
      ? box.y + box.h + LABEL_GAP + LABEL_SIZE
      : box.y - LABEL_GAP - (ls.length - 1) * LABEL_LEAD;
  return `<g class="conn-label">${textBlock(ls, cx, y, {
    size: LABEL_SIZE,
    anchor: 'middle',
    weight: 400,
    lead: LABEL_LEAD,
  })}</g>`;
}

function legendRows(conn) {
  const n = catalog.clampPins(conn.family, conn.pins);
  const rows = [];
  for (let p = 1; p <= n; p++) {
    let pt = null;
    try {
      pt = catalog.pinWorld(conn, p);
    } catch {
      pt = null;
    }
    rows.push({ pin: p, x: pt ? pt.x : 0, y: pt ? pt.y : 0 });
  }
  rows.sort((a, b) => a.y - b.y || a.x - b.x);
  return rows;
}

function legendMarkup(store, conn, box) {
  const side = conn.legend || 'none';
  if (side !== 'left' && side !== 'right') return '';
  const rows = legendRows(conn);
  if (!rows.length) return '';

  let pitch = LEGEND_SIZE * 1.6;
  try {
    pitch = catalog.geom(conn).pitch || pitch;
  } catch {
    /* keep the fallback pitch */
  }
  // Rows sit on the pin pitch, so the circle and the type must shrink with it -
  // fixed metrics overlap as soon as the pitch drops below the glyph height.
  const size = clamp(pitch * 0.48, 1.6, LEGEND_SIZE);
  const r = clamp(pitch * 0.36, 1, LEGEND_R);
  // The circled number belongs to the circle, not to the name beside it: in the
  // samples it fills the disc while the name reads a step smaller than the
  // connector label.
  const gap = r * 0.95;
  const numSize = r * 1.63;
  const col = r * 2 + gap + size * 4.2;

  const spread = rows.length > 1 ? rows[rows.length - 1].y - rows[0].y : 0;
  const aligned = spread > 1;
  const cy = box.y + box.h / 2;
  const total = (rows.length - 1) * pitch;

  const circleCx =
    side === 'left' ? box.x - LEGEND_GAP - col + r : box.x + box.w + LEGEND_GAP + r;
  const textX = circleCx + r + gap;

  const parts = [];
  rows.forEach((row, i) => {
    const y = aligned ? row.y : cy - total / 2 + i * pitch;
    const name =
      conn.pinNames?.[row.pin - 1] || store.wiresAt(conn.id, row.pin)[0]?.colorName || '';
    parts.push(
      `<circle cx="${fmt(circleCx)}" cy="${fmt(y)}" r="${fmt(r)}" fill="none" ` +
        `stroke="${INK}" stroke-width="${fmt(Math.max(0.2, r * 0.115))}"/>` +
        `<text x="${fmt(circleCx)}" y="${fmt(y + numSize * 0.345)}" font-family='${FONT}' ` +
        `font-size="${fmt(numSize)}" fill="${INK}" text-anchor="middle">${esc(row.pin)}</text>` +
        `<text x="${fmt(textX)}" y="${fmt(y + size * 0.36)}" font-family='${FONT}' ` +
        `font-size="${fmt(size)}" fill="${INK}" text-anchor="start">${esc(name)}</text>`,
    );
  });
  return `<g class="conn-legend">${parts.join('')}</g>`;
}

function connectorMarkup(store, conn, hit) {
  let inner = '';
  try {
    inner = catalog.drawConnector(conn) || '';
  } catch {
    inner = '';
  }
  const box = safeBox(conn);
  const rot = Number(conn.rot) || 0;
  const transform = `translate(${fmt(conn.x)} ${fmt(conn.y)})${rot ? ` rotate(${fmt(rot)})` : ''}`;
  const attrs = hit ? hitAttrs('connector', conn.id) : '';
  return (
    `<g class="connector"${attrs}>` +
    `<g class="conn-body" transform="${transform}">${inner}</g>` +
    labelMarkup(conn, box) +
    legendMarkup(store, conn, box) +
    `</g>`
  );
}

function pinsMarkup(store) {
  const parts = [];
  for (const conn of store.doc.connectors) {
    let pitch = 2;
    try {
      pitch = catalog.geom(conn).pitch || 2;
    } catch {
      pitch = 2;
    }
    const r = clamp(pitch * 0.42, 1.4, 6);
    const n = catalog.clampPins(conn.family, conn.pins);
    for (let p = 1; p <= n; p++) {
      let pt = null;
      try {
        pt = catalog.pinWorld(conn, p);
      } catch {
        pt = null;
      }
      if (!pt) continue;
      parts.push(
        `<g class="pin-slot" data-id="${esc(conn.id)}" data-pin="${p}">` +
          `<circle class="pin-ring" cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="${fmt(r)}"/>` +
          `<circle class="pin-hit" data-kind="pin" data-id="${esc(conn.id)}" data-pin="${p}" ` +
          `cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="${fmt(r * 1.2)}"/></g>`,
      );
    }
  }
  return parts.join('');
}

// --- annotations ------------------------------------------------------------

function dimensionMarkup(a, hit) {
  const p1 = { x: a.x, y: a.y };
  const p2 = { x: a.x2 ?? a.x, y: a.y2 ?? a.y };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const off = Number(a.offset) || 0;
  const sgn = off >= 0 ? 1 : -1;
  const d1 = { x: p1.x + nx * off, y: p1.y + ny * off };
  const d2 = { x: p2.x + nx * off, y: p2.y + ny * off };
  const stroke = `stroke="${INK}" stroke-width="${DIM_PEN}" fill="none"`;

  // Normally the extension line leaves the measured feature and runs a little
  // past the dimension line. At offset 0 the two coincide, so it would collapse:
  // fall back to a fixed length that reaches back towards the feature.
  const along = (q, k) => ({ x: q.x + nx * k * sgn, y: q.y + ny * k * sgn });
  const ext = (p, d) => {
    const to = along(d, DIM_EXT_OVER);
    const reach = Math.abs(off) - DIM_EXT_GAP + DIM_EXT_OVER;
    const from = reach >= DIM_EXT_MIN ? along(p, DIM_EXT_GAP) : along(to, -DIM_EXT_MIN);
    return (
      `<path d="M ${fmt(from.x)} ${fmt(from.y)} L ${fmt(to.x)} ${fmt(to.y)}" stroke="${INK}" ` +
      `stroke-width="${DIM_EXT_PEN}" fill="none" stroke-dasharray="1.7 1.1" opacity="0.42"/>`
    );
  };

  const label = a.text && String(a.text).length ? String(a.text) : `${fmt(a.value ?? 0)}mm`;
  const half = textWidth(label, DIM_SIZE) / 2 + DIM_SIZE * 0.5;
  const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };

  let line;
  let textDy;
  if (len / 2 > half + 5) {
    line =
      `<path d="M ${fmt(d1.x)} ${fmt(d1.y)} L ${fmt(mid.x - ux * half)} ${fmt(mid.y - uy * half)}" ` +
      `${stroke} marker-start="url(#${ARROW_ID})"/>` +
      `<path d="M ${fmt(mid.x + ux * half)} ${fmt(mid.y + uy * half)} L ${fmt(d2.x)} ${fmt(d2.y)}" ` +
      `${stroke} marker-end="url(#${ARROW_ID})"/>`;
    textDy = DIM_SIZE * 0.3;
  } else {
    line =
      `<path d="M ${fmt(d1.x)} ${fmt(d1.y)} L ${fmt(d2.x)} ${fmt(d2.y)}" ${stroke} ` +
      `marker-start="url(#${ARROW_ID})" marker-end="url(#${ARROW_ID})"/>`;
    textDy = -(DIM_SIZE * 0.45 + 1.6);
  }

  let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (ang > 90 || ang < -90) ang += 180;
  const text =
    `<g transform="translate(${fmt(mid.x)} ${fmt(mid.y)}) rotate(${fmt(ang)})">` +
    `<text x="0" y="${fmt(textDy)}" font-family='${FONT}' font-size="${fmt(DIM_SIZE)}" ` +
    `fill="${INK}" text-anchor="middle">${esc(label)}</text></g>`;

  const attrs = hit ? hitAttrs('annotation', a.id) : '';
  return `<g class="dimension"${attrs}>${ext(p1, d1)}${ext(p2, d2)}${line}${text}</g>`;
}

function noteBoxMarkup(n, hit, kind, id) {
  const w = Math.max(Number(n.w) || 0, 10);
  const h = Math.max(Number(n.h) || 0, 6);
  const x = n.x - w / 2;
  const y = n.y - h / 2;
  const size = Number(n.size) || NOTE_SIZE;
  const ls = lines(n.text);
  const lead = size * 1.3;
  const first = n.y + size * 0.36 - ((ls.length - 1) * lead) / 2;
  const attrs = hit ? hitAttrs(kind, id) : '';
  return (
    `<g class="note-block"${attrs}>` +
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="none" ` +
    `stroke="${INK}" stroke-width="0.4"/>` +
    textBlock(ls, n.x, first, { size, anchor: 'middle', lead }) +
    `</g>`
  );
}

function textMarkup(a, hit) {
  const size = Number(a.size) || 7;
  const ls = lines(a.text);
  const lead = size * 1.3;
  const attrs = hit ? hitAttrs('annotation', a.id) : '';
  return (
    `<g class="text-annotation"${attrs}>` +
    textBlock(ls, a.x, a.y, {
      size,
      anchor: a.align || 'middle',
      weight: a.weight || 400,
      color: a.color || INK,
      lead,
    }) +
    `</g>`
  );
}

function annotationMarkup(a, hit) {
  if (a.kind === 'dimension') return dimensionMarkup(a, hit);
  if (a.kind === 'note') return noteBoxMarkup(a, hit, 'annotation', a.id);
  return textMarkup(a, hit);
}

function titleMarkup(doc, hit) {
  const t = doc.title;
  if (!t || t.visible === false || !String(t.text ?? '').length) return '';
  const size = (Number(t.size) || TITLE_SIZE) * TITLE_GAIN;
  const attrs = hit ? hitAttrs('title', '__title__') : '';
  return (
    `<g class="doc-title"${attrs}>` +
    textBlock(lines(t.text), t.x, t.y, {
      size,
      anchor: 'middle',
      weight: TITLE_WEIGHT,
      lead: size * TITLE_LEAD,
    }) +
    `</g>`
  );
}

function docNoteMarkup(doc, hit) {
  const n = doc.note;
  if (!n || n.visible === false || !String(n.text ?? '').length) return '';
  return noteBoxMarkup({ ...n, size: n.size || NOTE_SIZE }, hit, 'note', '__note__');
}

// --- scene ------------------------------------------------------------------

function buildScene(store, { hit = false } = {}) {
  const doc = store.doc;
  const annotations =
    titleMarkup(doc, hit) +
    docNoteMarkup(doc, hit) +
    doc.annotations.map((a) => annotationMarkup(a, hit)).join('');
  const wires = doc.wires.map((w) => wireMarkup(store, w, hit)).join('');
  const connectors = doc.connectors.map((c) => connectorMarkup(store, c, hit)).join('');
  return { annotations, wires, connectors };
}

function arrowMarker() {
  return (
    `<marker id="${ARROW_ID}" markerUnits="userSpaceOnUse" ` +
    `markerWidth="${fmt(ARROW_LEN)}" markerHeight="${fmt(ARROW_W)}" ` +
    `refX="${fmt(ARROW_LEN)}" refY="${fmt(ARROW_W / 2)}" orient="auto-start-reverse">` +
    `<path d="M 0 0 L ${fmt(ARROW_LEN)} ${fmt(ARROW_W / 2)} L 0 ${fmt(ARROW_W)} z" fill="${INK}"/></marker>`
  );
}

function defsMarkup() {
  let extra = '';
  try {
    extra = catalog.connectorDefs?.() || '';
  } catch {
    extra = '';
  }
  return arrowMarker() + extra;
}

// --- world boxes (selection outlines) ---------------------------------------

function wireBox(store, wire) {
  const p = wirePath(store, wire);
  if (!p) return null;
  const w = wireStrokeWidth(store, wire);
  const b = cubicBox(p.a, p.c1, p.c2, p.b);
  return { x: b.x - w / 2, y: b.y - w / 2, w: b.w + w, h: b.h + w };
}

function annotationBox(a) {
  if (a.kind === 'dimension') {
    const dx = (a.x2 ?? a.x) - a.x;
    const dy = (a.y2 ?? a.y) - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (Number(a.offset) || 0);
    const ny = (dx / len) * (Number(a.offset) || 0);
    const pts = [
      { x: a.x, y: a.y },
      { x: a.x2 ?? a.x, y: a.y2 ?? a.y },
      { x: a.x + nx, y: a.y + ny },
      { x: (a.x2 ?? a.x) + nx, y: (a.y2 ?? a.y) + ny },
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys) - DIM_SIZE,
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys) + DIM_SIZE * 2,
    };
  }
  if (a.kind === 'note') {
    const w = Math.max(Number(a.w) || 0, 10);
    const h = Math.max(Number(a.h) || 0, 6);
    return { x: a.x - w / 2, y: a.y - h / 2, w, h };
  }
  const size = Number(a.size) || 7;
  return blockBox(lines(a.text), a.x, a.y, size, a.align || 'middle', a.weight || 400, size * 1.3);
}

function objectBox(store, id) {
  const doc = store.doc;
  if (id === '__title__') {
    const t = doc.title;
    if (!t) return null;
    const size = (Number(t.size) || TITLE_SIZE) * TITLE_GAIN;
    return blockBox(lines(t.text), t.x, t.y, size, 'middle', TITLE_WEIGHT, size * TITLE_LEAD);
  }
  if (id === '__note__') {
    const n = doc.note;
    if (!n) return null;
    const w = Math.max(Number(n.w) || 0, 10);
    const h = Math.max(Number(n.h) || 0, 6);
    return { x: n.x - w / 2, y: n.y - h / 2, w, h };
  }
  const conn = store.connector(id);
  if (conn) return safeBox(conn);
  const wire = store.wire(id);
  if (wire) return wireBox(store, wire);
  const anno = store.annotation(id);
  if (anno) return annotationBox(anno);
  return null;
}

// --- export -----------------------------------------------------------------

export function svgMarkup(store, { standalone = true } = {}) {
  const doc = store.doc;
  const sheet = doc.sheet;
  const scene = buildScene(store, { hit: false });
  const head =
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
    `width="${fmt(sheet.w)}mm" height="${fmt(sheet.h)}mm" ` +
    `viewBox="0 0 ${fmt(sheet.w)} ${fmt(sheet.h)}">`;
  const body =
    `<defs>${defsMarkup()}</defs>` +
    `<rect x="0" y="0" width="${fmt(sheet.w)}" height="${fmt(sheet.h)}" fill="${esc(sheet.bg || '#ffffff')}"/>` +
    `<g class="layer-annotations">${scene.annotations}</g>` +
    `<g class="layer-wires">${scene.wires}</g>` +
    `<g class="layer-connectors">${scene.connectors}</g>`;
  const svg = `${head}${body}</svg>`;
  return standalone ? `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${svg}` : svg;
}

// --- renderer ---------------------------------------------------------------

export class Renderer {
  #svg;
  #store;
  #defs;
  #viewport;
  #paper;
  #layers = {};
  #view = { tx: 0, ty: 0, zoom: 2 };
  #viewReady = false;
  #raf = 0;
  #unsubs = [];
  #ro = null;
  #gridStep = 0;
  #pinsVisible = false;
  #ov = { selection: [], pin: null, rubber: null, marquee: null };

  constructor(svgEl, store) {
    this.#svg = svgEl;
    this.#store = store;
    this.#build();

    this.overlay = {
      setSelection: (ids) => {
        this.#ov.selection = Array.isArray(ids) ? [...ids] : ids == null ? [] : [ids];
        this.renderOverlay();
      },
      setPinHighlight: (connId, pin, state) => {
        this.#ov.pin = state ? { connId, pin: Number(pin), state } : null;
        this.#applyPinHighlight();
      },
      setRubber: (fromPt, toPt, style = {}) => {
        this.#ov.rubber = fromPt && toPt ? { from: fromPt, to: toPt, style } : null;
        this.renderOverlay();
      },
      clearRubber: () => {
        this.#ov.rubber = null;
        this.renderOverlay();
      },
      setMarquee: (rect) => {
        this.#ov.marquee = rect || null;
        this.renderOverlay();
      },
      clearMarquee: () => {
        this.#ov.marquee = null;
        this.renderOverlay();
      },
    };

    this.#unsubs.push(store.on('change', () => this.#schedule()));
    this.#unsubs.push(
      store.on('selection', ({ ids }) => {
        this.#ov.selection = [...(ids || [])];
        this.renderOverlay();
      }),
    );

    if (typeof ResizeObserver === 'function') {
      this.#ro = new ResizeObserver(() => {
        if (!this.#viewReady) this.#initView();
      });
      this.#ro.observe(this.#svg);
    }

    this.#ov.selection = store.selectedIds;
    this.render();
  }

  #build() {
    const mk = (tag, attrs = {}) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    while (this.#svg.firstChild) this.#svg.removeChild(this.#svg.firstChild);

    this.#defs = mk('defs');
    this.#viewport = mk('g', { id: 'viewport' });
    this.#paper = mk('rect', { class: 'sheet-paper', x: 0, y: 0, width: 0, height: 0 });

    this.#layers.grid = mk('g', { id: 'layer-grid' });
    this.#layers.annotations = mk('g', { id: 'layer-annotations' });
    this.#layers.wires = mk('g', { id: 'layer-wires' });
    this.#layers.connectors = mk('g', { id: 'layer-connectors' });
    this.#layers.pins = mk('g', { id: 'layer-pins', 'pointer-events': 'none' });
    this.#layers.overlay = mk('g', { id: 'layer-overlay', 'pointer-events': 'none' });

    this.#viewport.append(
      this.#paper,
      this.#layers.grid,
      this.#layers.annotations,
      this.#layers.wires,
      this.#layers.connectors,
      this.#layers.pins,
      this.#layers.overlay,
    );
    this.#svg.append(this.#defs, this.#viewport);
    this.#layers.grid.setAttribute('pointer-events', 'none');
  }

  #schedule() {
    if (this.#raf) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    this.#raf = raf(() => {
      this.#raf = 0;
      this.render();
    });
  }

  #size() {
    const r = this.#svg.getBoundingClientRect?.();
    const w = r?.width || this.#svg.clientWidth || 0;
    const h = r?.height || this.#svg.clientHeight || 0;
    return { w, h, left: r?.left || 0, top: r?.top || 0 };
  }

  #initView() {
    const { w, h } = this.#size();
    if (w < 2 || h < 2) return;
    this.#viewReady = true;
    this.fitToSheet();
  }

  #applyTransform() {
    const v = this.#view;
    this.#viewport.setAttribute('transform', `translate(${fmt(v.tx)} ${fmt(v.ty)}) scale(${fmt(v.zoom, 6)})`);
    if (this.#stepFor() !== this.#gridStep) this.#renderGrid();
  }

  #stepFor() {
    const base = Math.max(0.5, Number(this.#store.doc.view?.grid) || 5);
    let step = base;
    const zoom = this.#view.zoom || 1;
    let guard = 0;
    while (step * zoom < 4 && guard++ < 12) step *= 2;
    return step;
  }

  #renderGrid() {
    const doc = this.#store.doc;
    if (!doc.view?.showGrid) {
      if (this.#gridStep !== 0) this.#layers.grid.innerHTML = '';
      this.#gridStep = 0;
      return;
    }
    const step = this.#stepFor();
    this.#gridStep = step;
    const { w, h } = doc.sheet;
    const minor = [];
    const major = [];
    for (let i = 0, x = 0; x <= w + 1e-6; i++, x = i * step) {
      (i % 5 === 0 ? major : minor).push(`M ${fmt(x)} 0 V ${fmt(h)}`);
    }
    for (let i = 0, y = 0; y <= h + 1e-6; i++, y = i * step) {
      (i % 5 === 0 ? major : minor).push(`M 0 ${fmt(y)} H ${fmt(w)}`);
    }
    // The grid is only rebuilt when the step changes, so a zoom-dependent stroke
    // width would go stale on every zoom that keeps the same step.
    const pen = 'fill="none" vector-effect="non-scaling-stroke"';
    this.#layers.grid.innerHTML =
      `<path class="grid-line" d="${minor.join(' ')}" ${pen} stroke-width="1"/>` +
      `<path class="grid-line major" d="${major.join(' ')}" ${pen} stroke-width="1.2"/>`;
  }

  render() {
    if (this.#raf) {
      const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
      cancel(this.#raf);
      this.#raf = 0;
    }
    if (!this.#viewReady) this.#initView();

    const doc = this.#store.doc;
    const sheet = doc.sheet;
    this.#paper.setAttribute('width', fmt(sheet.w));
    this.#paper.setAttribute('height', fmt(sheet.h));
    this.#paper.setAttribute('fill', sheet.bg || '#ffffff');

    this.#defs.innerHTML = defsMarkup();
    this.#renderGrid();

    const scene = buildScene(this.#store, { hit: true });
    this.#layers.annotations.innerHTML = scene.annotations;
    this.#layers.wires.innerHTML = scene.wires;
    this.#layers.connectors.innerHTML = scene.connectors;
    this.#layers.pins.innerHTML = pinsMarkup(this.#store);

    this.#applyTransform();
    this.renderOverlay();
  }

  renderOverlay() {
    const parts = [];
    for (const id of this.#ov.selection) {
      const b = objectBox(this.#store, id);
      if (!b) continue;
      parts.push(
        `<rect class="sel-outline" x="${fmt(b.x - 1.5)}" y="${fmt(b.y - 1.5)}" ` +
          `width="${fmt(b.w + 3)}" height="${fmt(b.h + 3)}" rx="1"/>`,
      );
    }
    const m = this.#ov.marquee;
    if (m && m.w >= 0 && m.h >= 0) {
      parts.push(
        `<rect class="marquee" x="${fmt(m.x)}" y="${fmt(m.y)}" width="${fmt(m.w)}" height="${fmt(m.h)}"/>`,
      );
    }
    const rub = this.#ov.rubber;
    if (rub) {
      const { from, to, style } = rub;
      const dx = (to.x - from.x) * 0.4;
      const d =
        `M ${fmt(from.x)} ${fmt(from.y)} C ${fmt(from.x + dx)} ${fmt(from.y)} ` +
        `${fmt(to.x - dx)} ${fmt(to.y)} ${fmt(to.x)} ${fmt(to.y)}`;
      parts.push(
        `<path class="rubber-wire" d="${d}" stroke="${esc(style?.color || '#4a9eff')}" ` +
          `stroke-width="${fmt(style?.width || 2)}"/>`,
      );
    }
    this.#layers.overlay.innerHTML = parts.join('');
    this.#applyPinHighlight();
  }

  #applyPinHighlight() {
    const layer = this.#layers.pins;
    if (!layer) return;
    for (const el of layer.querySelectorAll('.pin-ring.hot, .pin-ring.blocked')) {
      el.classList.remove('hot', 'blocked');
    }
    const h = this.#ov.pin;
    if (!h || !h.state) return;
    const slot = layer.querySelector(
      `g.pin-slot[data-id="${cssEscape(h.connId)}"][data-pin="${cssEscape(h.pin)}"]`,
    );
    slot?.querySelector('.pin-ring')?.classList.add(h.state);
  }

  // --- view -----------------------------------------------------------------

  get svg() {
    return this.#svg;
  }

  getView() {
    return { ...this.#view };
  }

  setView(v = {}) {
    if (Number.isFinite(v.tx)) this.#view.tx = v.tx;
    if (Number.isFinite(v.ty)) this.#view.ty = v.ty;
    if (Number.isFinite(v.zoom)) this.#view.zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
    this.#applyTransform();
    return this.getView();
  }

  zoomAt(clientPt, factor) {
    const p = clientXY(clientPt);
    const target = clamp(this.#view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (!p) return this.setView({ zoom: target });
    const world = this.clientToWorld(p);
    const { left, top } = this.#size();
    const cx = p.x - left;
    const cy = p.y - top;
    return this.setView({ zoom: target, tx: cx - world.x * target, ty: cy - world.y * target });
  }

  fitToSheet(padding = 12) {
    const { w, h } = this.#size();
    const sheet = this.#store.doc.sheet;
    const vw = w || 800;
    const vh = h || 600;
    const zoom = clamp(
      Math.min((vw - 2 * padding) / sheet.w, (vh - 2 * padding) / sheet.h),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    return this.setView({
      zoom,
      tx: (vw - sheet.w * zoom) / 2,
      ty: (vh - sheet.h * zoom) / 2,
    });
  }

  clientToWorld(clientPt) {
    const p = clientXY(clientPt) || { x: 0, y: 0 };
    const { left, top } = this.#size();
    const v = this.#view;
    return { x: (p.x - left - v.tx) / v.zoom, y: (p.y - top - v.ty) / v.zoom };
  }

  worldToClient(worldPt) {
    const { left, top } = this.#size();
    const v = this.#view;
    return { x: worldPt.x * v.zoom + v.tx + left, y: worldPt.y * v.zoom + v.ty + top };
  }

  // --- hit testing ----------------------------------------------------------

  hitAt(clientPtOrEvent) {
    const p = clientXY(clientPtOrEvent);
    if (!p) return null;
    const stack =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(p.x, p.y)
        : [document.elementFromPoint(p.x, p.y)].filter(Boolean);

    let fallback = null;
    for (const el of stack) {
      const node = el?.closest?.('[data-kind]');
      if (!node || !this.#svg.contains(node)) continue;
      const kind = node.getAttribute('data-kind');
      if (kind === 'pin') {
        return {
          kind: 'pin',
          id: node.getAttribute('data-id'),
          pin: Number(node.getAttribute('data-pin')),
        };
      }
      if (!fallback) fallback = { kind, id: node.getAttribute('data-id') };
    }
    return fallback;
  }

  pinsVisible(flag) {
    this.#pinsVisible = !!flag;
    this.#svg.classList.toggle('pins-visible', this.#pinsVisible);
    this.#layers.pins.setAttribute('pointer-events', this.#pinsVisible ? 'all' : 'none');
    if (!this.#pinsVisible) {
      this.#ov.pin = null;
      this.#applyPinHighlight();
    }
  }

  // Accepts (opts) or the module-level (store, opts) shape, since callers use both.
  svgMarkup(a, b) {
    const asStore = a && typeof a === 'object' && typeof a.doc === 'object';
    return svgMarkup(asStore ? a : this.#store, (asStore ? b : a) || undefined);
  }

  destroy() {
    if (this.#raf) {
      const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
      cancel(this.#raf);
      this.#raf = 0;
    }
    for (const un of this.#unsubs) {
      try {
        un();
      } catch {
        /* listener already gone */
      }
    }
    this.#unsubs = [];
    this.#ro?.disconnect();
    this.#ro = null;
    this.#svg.classList.remove('pins-visible');
    while (this.#svg.firstChild) this.#svg.removeChild(this.#svg.firstChild);
  }
}
