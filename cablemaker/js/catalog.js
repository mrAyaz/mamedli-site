// Connector catalogue and wire specifications.
//
// Everything here is authored in real millimetres and multiplied by conn.scale
// on the way out, so one set of numbers describes both the real part and the
// deliberately out-of-scale drawing.

import { bboxOfPoints, clamp, fmt, localToWorld, pathD, rotateVec } from './geom.js';

const FONT = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const DEFAULT_FAMILY = 'jst-gh-1.25';

const n = (v) => fmt(v, 3);

// The reference photographs are nearly flat white: across the whole back of a
// 6-pin GH the luminance moves by about two levels, and the only line darker
// than the background is the seam under the front face. Gradients and relief
// here are kept inside that budget on purpose - a stronger shade split turns
// the moulding into a stack of outlined boxes.
const LIGHT = {
  shellTop: [[0, '#fbfaf7'], [0.12, '#ffffff'], [0.6, '#fcfbf9'], [0.92, '#f9f7f3'], [1, '#f3f0ea']],
  shellBottom: [[0, '#faf9f6'], [0.12, '#fdfcfa'], [0.6, '#faf9f5'], [0.92, '#f6f4ef'], [1, '#f0ede7']],
  face: [[0, '#f5f2ed'], [0.16, '#ffffff'], [0.62, '#fdfcfa'], [0.94, '#f9f7f3'], [1, '#f2efe9']],
  recess: [[0, '#f2efea'], [0.08, '#f8f6f2'], [0.85, '#faf9f5'], [1, '#f3f1eb']],
  outline: '#a3a8ad',
  seam: '#cac6bf',
  boss: '#fdfcfa',
  recessFill: '#f7f5f1',
  recessLine: '#e1ddd6',
  rib: '#e3dfd8',
  number: '#1b1e23',
  bodyFallback: '#f3f1ed',
  faceFallback: '#fbfaf8',
};

const DARK = {
  shellTop: [[0, '#4e535b'], [0.1, '#575c64'], [0.6, '#3f444a'], [0.92, '#34383e'], [1, '#2c3035']],
  shellBottom: [[0, '#464b52'], [0.1, '#4e535b'], [0.6, '#383c42'], [0.92, '#2e3237'], [1, '#272a2f']],
  face: [[0, '#2b2e33'], [0.14, '#565b63'], [0.56, '#484d54'], [0.86, '#3a3e44'], [1, '#262a2e']],
  recess: [[0, '#1d2025'], [0.12, '#2b2f35'], [0.76, '#32363d'], [1, '#212428']],
  outline: '#121417',
  seam: '#15181c',
  boss: '#454a51',
  recessFill: '#2a2d32',
  recessLine: '#16181c',
  rib: '#4a4f56',
  number: '#f3f5f7',
  bodyFallback: '#34383e',
  faceFallback: '#3d4147',
};

const METAL = [[0, '#f4f6f8'], [0.16, '#dde2e6'], [0.46, '#a9b0b6'], [0.7, '#cbd1d6'], [1, '#848b92']];
const WINDOW = [[0, '#14171a'], [0.3, '#2b3034'], [0.78, '#1d2124'], [1, '#0e1012']];
const CLIP = [[0, '#fbfcfd'], [0.26, '#dfe4e8'], [0.6, '#aeb5bc'], [0.84, '#cdd3d8'], [1, '#8d949b']];

function def(f) {
  return {
    minPins: 2,
    maxPins: 16,
    defaultScale: 3,
    corner: 0.4,
    ears: true,
    lock: false,
    ramp: false,
    dark: false,
    square: false,
    ...f,
  };
}

// The drawing is schematic, so defaultScale is set from the samples' PROPORTIONS
// rather than from any real dimension: a 6-pin housing there occupies about a
// third of the sheet height, which works out to an ~11 mm drawn pin pitch on the
// default 420x260 sheet. A fixed scale cannot do that across a 1.0 mm SH and a
// 2.54 mm DuPont. High pin counts overflow at these values, so callers clamp the
// scale to the sheet when placing a connector.
export const FAMILIES = {
  'jst-sh-1.0': def({
    id: 'jst-sh-1.0',
    slug: 'jstsh',
    name: 'JST SH',
    pitch: 1.0,
    minPins: 2,
    maxPins: 20,
    defaultScale: 11,
    bodyWidth: 4.25,
    endPad: 1.9,
    faceDepth: 1.35,
    corner: 0.2,
    ears: true,
    lock: true,
  }),
  'jst-gh-1.25': def({
    id: 'jst-gh-1.25',
    slug: 'jstgh',
    name: 'JST GH',
    pitch: 1.25,
    minPins: 2,
    maxPins: 15,
    defaultScale: 9,
    bodyWidth: 4.6,
    endPad: 2.2,
    faceDepth: 1.6,
    corner: 0.24,
    ears: true,
    lock: true,
  }),
  'jst-ph-2.0': def({
    id: 'jst-ph-2.0',
    slug: 'jstph',
    name: 'JST PH',
    pitch: 2.0,
    minPins: 2,
    maxPins: 16,
    defaultScale: 5.5,
    bodyWidth: 5.75,
    endPad: 2.4,
    faceDepth: 2.05,
    corner: 0.32,
    ears: true,
    lock: false,
  }),
  'molex-picoblade-1.25': def({
    id: 'molex-picoblade-1.25',
    slug: 'picoblade',
    name: 'Molex PicoBlade',
    pitch: 1.25,
    minPins: 2,
    maxPins: 15,
    defaultScale: 9,
    bodyWidth: 4.4,
    endPad: 2.4,
    faceDepth: 1.5,
    corner: 0.16,
    ears: false,
    lock: false,
    ramp: true,
  }),
  'dupont-2.54': def({
    id: 'dupont-2.54',
    slug: 'dupont',
    name: 'DuPont / IDC',
    labelName: 'DuPont',
    pitch: 2.54,
    minPins: 1,
    maxPins: 40,
    defaultScale: 4.5,
    bodyWidth: 5.0,
    endPad: 0.5,
    faceDepth: 2.1,
    corner: 0.18,
    ears: false,
    lock: false,
    dark: true,
    square: true,
  }),
};

export function familyList() {
  return Object.values(FAMILIES).map((f) => ({
    id: f.id,
    name: f.name,
    pitch: f.pitch,
    minPins: f.minPins,
    maxPins: f.maxPins,
    defaultScale: f.defaultScale,
  }));
}

export function family(id) {
  const f = FAMILIES[id];
  if (!f) throw new Error(`Unknown connector family: ${id}`);
  return f;
}

export function clampPins(familyId, pins) {
  const f = FAMILIES[familyId] || FAMILIES[DEFAULT_FAMILY];
  const v = Math.round(Number(pins));
  if (!Number.isFinite(v)) return f.minPins;
  return clamp(v, f.minPins, f.maxPins);
}

// Drawing must never throw on a half-edited document, so family resolution is
// lenient here even though family() is strict.
function resolve(conn) {
  return FAMILIES[conn?.family] || FAMILIES[DEFAULT_FAMILY];
}

function scaleOf(conn, f) {
  const s = Number(conn?.scale);
  return Number.isFinite(s) && s > 0.05 ? s : f.defaultScale;
}

function metrics(conn) {
  const f = resolve(conn);
  const s = scaleOf(conn, f);
  const pins = clampPins(f.id, conn?.pins);
  const view = conn?.view === 'bottom' ? 'bottom' : 'top';
  const pal = f.dark ? DARK : LIGHT;

  const pitch = f.pitch * s;
  const bodyW = f.bodyWidth * s;
  const bodyH = (f.pitch * pins + f.endPad) * s;
  const xF = bodyW / 2;
  const xB = -bodyW / 2;
  const faceD = f.faceDepth * s;
  const faceX0 = xF - faceD;
  const firstPinY = -((pins - 1) / 2) * pitch;
  const endRoom = (f.endPad / 2) * s;
  const bottom = view === 'bottom';
  const lw = 0.06 * s;

  // endH is the height of one moulded end zone: the latch bar plus the latch
  // arm on an eared family, a plain margin otherwise. Capped so a 15-pin shell
  // does not grow comically tall ends.
  // Measured off the reference photo of a 6-pin GH: the moulded end zone is
  // about 0.17 of the housing length there, and it is a fixed physical size, so
  // the cap rather than the fraction governs once past six ways.
  const endH = f.ears
    ? clamp(bodyH * (bottom ? 0.15 : 0.18), (bottom ? 0.7 : 0.95) * s, (bottom ? 1.35 : 1.62) * s)
    : Math.min(0.5 * s, bodyH * 0.11);

  const roundness = f.square ? 0.04 : f.ramp ? 0.055 : 0.09;

  return {
    conn, f, s, pins, view, pal,
    pitch, bodyW, bodyH, xF, xB, faceD, faceX0, firstPinY, endRoom,
    pinX: xF - faceD / 2,
    corner: f.corner * s,
    outerR: Math.min(Math.max(f.corner * s, bodyW * roundness), bodyH / 6, bodyW / 4),
    lw,
    endH,
    barH: f.ears ? Math.max(endH * 0.38, lw * 1.6) : 0,
    earOut: f.ears ? 0.2 * s : 0,
    earW: Math.min(f.bodyWidth * (bottom ? 0.62 : 0.74), f.bodyWidth - f.faceDepth - 0.12) * s,
    rampOut: f.ramp ? 0.42 * s : 0,
    wall: Math.min(0.3 * s, (bodyW - faceD) * 0.18),
    font: Math.min(f.pitch * 0.42, f.faceDepth * 0.54) * s,
    paint: {
      body: `url(#cx-grad-${f.slug}-${view}) ${pal.bodyFallback}`,
      face: `url(#cx-grad-${f.slug}-face) ${pal.faceFallback}`,
      recess: `url(#cx-grad-${f.slug}-recess) ${pal.recessFill}`,
      metal: 'url(#cx-grad-metal) #b7bdc3',
      window: 'url(#cx-grad-window) #1d2124',
      clip: 'url(#cx-grad-clip) #7d848b',
    },
  };
}

function extentLocal(m) {
  const out = Math.max(m.earOut, m.rampOut) + m.lw;
  return {
    x0: m.xB - out,
    x1: m.xF + m.lw,
    y0: -(m.bodyH / 2 + m.lw),
    y1: m.bodyH / 2 + m.lw,
  };
}

export function geom(conn) {
  const m = metrics(conn);
  return {
    bodyW: m.bodyW,
    bodyH: m.bodyH,
    exitX: m.xF,
    pitch: m.pitch,
    pinX: m.pinX,
    firstPinY: m.firstPinY,
  };
}

export function pinLocal(conn, pin) {
  const m = metrics(conn);
  const raw = Math.round(Number(pin));
  const i = clamp(Number.isFinite(raw) ? raw - 1 : 0, 0, m.pins - 1);
  const idx = conn?.reversePins ? m.pins - 1 - i : i;
  return { x: m.pinX, y: m.firstPinY + idx * m.pitch };
}

function placement(conn) {
  return { x: Number(conn?.x) || 0, y: Number(conn?.y) || 0, rot: Number(conn?.rot) || 0 };
}

export function pinWorld(conn, pin) {
  return localToWorld(placement(conn), pinLocal(conn, pin));
}

export function pinExitWorld(conn, pin) {
  const m = metrics(conn);
  return localToWorld(placement(conn), { x: m.xF, y: pinLocal(conn, pin).y });
}

export function pinDirWorld(conn, pin) {
  return rotateVec({ x: 1, y: 0 }, Number(conn?.rot) || 0);
}

export function connectorBox(conn) {
  const m = metrics(conn);
  const e = extentLocal(m);
  const t = placement(conn);
  const corners = [
    { x: e.x0, y: e.y0 }, { x: e.x1, y: e.y0 },
    { x: e.x1, y: e.y1 }, { x: e.x0, y: e.y1 },
  ].map((p) => localToWorld(t, p));
  return bboxOfPoints(corners);
}

export function defaultLabel(conn) {
  const f = resolve(conn);
  const pins = clampPins(f.id, conn?.pins);
  const pitch = f.pitch.toFixed(2).replace(/0$/, '');
  return `${f.labelName || f.name} ${pitch}mm\n${pins}-Pin Connector`;
}

// --- SVG defs ---------------------------------------------------------------

function gradient(id, stops, horizontal = false) {
  const axis = horizontal ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"';
  const body = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  return `<linearGradient id="${id}" ${axis}>${body}</linearGradient>`;
}

export function connectorDefs() {
  const seen = new Set();
  const out = [];
  const add = (id, stops, horizontal) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(gradient(id, stops, horizontal));
  };
  for (const f of Object.values(FAMILIES)) {
    const pal = f.dark ? DARK : LIGHT;
    add(`cx-grad-${f.slug}-top`, pal.shellTop);
    add(`cx-grad-${f.slug}-bottom`, pal.shellBottom);
    // The face is a narrow upright strip, so its shading runs across it: that
    // reads as the rounded front ridge instead of repeating the shell's banding.
    add(`cx-grad-${f.slug}-face`, pal.face, true);
    add(`cx-grad-${f.slug}-recess`, pal.recess);
  }
  add('cx-grad-metal', METAL);
  add('cx-grad-window', WINDOW);
  // The latch spring is a thin horizontal blade, so its shading runs across it.
  add('cx-grad-clip', CLIP);
  return out.join('');
}

// --- artwork ----------------------------------------------------------------

function rect(x, y, w, h, attrs) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}" ${attrs}/>`;
}

function line(x1, y1, x2, y2, attrs) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${attrs}/>`;
}

// Moulded relief is painted as plain white/black veils rather than extra
// gradients: an objectBoundingBox gradient restarts inside every shape, so a
// small boss filled with the shell gradient would band against the shell.
const HI = (o) => `fill="#ffffff" opacity="${o}"`;
const SH = (o) => `fill="#000000" opacity="${o}"`;

function rrPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) {
    return pathD([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]);
  }
  return pathD([
    ['M', x + rr, y],
    ['L', x + w - rr, y], ['A', rr, rr, 0, 0, 1, x + w, y + rr],
    ['L', x + w, y + h - rr], ['A', rr, rr, 0, 0, 1, x + w - rr, y + h],
    ['L', x + rr, y + h], ['A', rr, rr, 0, 0, 1, x, y + h - rr],
    ['L', x, y + rr], ['A', rr, rr, 0, 0, 1, x + rr, y],
    ['Z'],
  ]);
}

// Front face plate: only the outboard corners are rounded, because the inboard
// edge butts against the housing back and must not open a gap in the silhouette.
function capPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  if (rr <= 0) {
    return pathD([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]);
  }
  return pathD([
    ['M', x, y],
    ['L', x + w - rr, y], ['A', rr, rr, 0, 0, 1, x + w, y + rr],
    ['L', x + w, y + h - rr], ['A', rr, rr, 0, 0, 1, x + w - rr, y + h],
    ['L', x, y + h],
    ['Z'],
  ]);
}

function rampOutline(m, r) {
  const { xB, xF, bodyH, rampOut, s } = m;
  const y0 = -bodyH / 2;
  const y1 = bodyH / 2;
  const h = Math.min(bodyH * 0.4, 3.0 * s);
  const t = Math.min(rampOut * 0.9, (y1 - r - h / 2) * 0.8);
  return pathD([
    ['M', xB + r, y0],
    ['L', xF - r, y0], ['A', r, r, 0, 0, 1, xF, y0 + r],
    ['L', xF, y1 - r], ['A', r, r, 0, 0, 1, xF - r, y1],
    ['L', xB + r, y1], ['A', r, r, 0, 0, 1, xB, y1 - r],
    ['L', xB, h / 2 + t],
    ['L', xB - rampOut, h / 2],
    ['L', xB - rampOut, -h / 2],
    ['L', xB, -h / 2 - t],
    ['L', xB, y0 + r], ['A', r, r, 0, 0, 1, xB + r, y0],
    ['Z'],
  ]);
}

// One closed outline for the whole moulding: housing back, latch bars and front
// face. Everything else is relief drawn inside it, so the part never reads as a
// stack of separate rectangles.
function shellOutline(m) {
  const { xB, xF, bodyH, earOut, barH, outerR } = m;
  const y0 = -bodyH / 2;
  const y1 = bodyH / 2;
  const r = Math.min(outerR, bodyH / 5, (xF - xB) / 4);
  if (m.f.ramp) return rampOutline(m, r);
  if (!m.f.ears || earOut <= 0 || barH * 2 >= bodyH) {
    return rrPath(xB, y0, xF - xB, bodyH, r);
  }
  const x0 = xB - earOut;
  const rr = Math.min(r, barH / 2, earOut);
  // The moulded step where the latch bar overhangs the body is filleted on the
  // real part, not a sharp inside corner.
  const fr = Math.min(earOut * 0.6, barH * 0.4, (bodyH / 2 - barH) * 0.3);
  return pathD([
    ['M', x0 + rr, y0],
    ['L', xF - r, y0], ['A', r, r, 0, 0, 1, xF, y0 + r],
    ['L', xF, y1 - r], ['A', r, r, 0, 0, 1, xF - r, y1],
    ['L', x0 + rr, y1], ['A', rr, rr, 0, 0, 1, x0, y1 - rr],
    ['L', x0, y1 - barH],
    ['L', xB - fr, y1 - barH], ['A', fr, fr, 0, 0, 0, xB, y1 - barH - fr],
    ['L', xB, y0 + barH + fr], ['A', fr, fr, 0, 0, 0, xB - fr, y0 + barH],
    ['L', x0, y0 + barH],
    ['L', x0, y0 + rr], ['A', rr, rr, 0, 0, 1, x0 + rr, y0],
    ['Z'],
  ]);
}

function sideWall(m) {
  const { xB, bodyH, wall, lw, pal, endH, pitch, s } = m;
  if (wall <= lw * 1.4) return '';
  const y0 = -bodyH / 2 + (m.f.ears ? endH : endH * 0.4);
  const y1 = bodyH / 2 - (m.f.ears ? endH : endH * 0.4);
  if (y1 - y0 <= lw * 3) return '';
  const out = [
    line(xB + wall, y0, xB + wall, y1, `stroke="${pal.seam}" stroke-width="${n(lw * 0.8)}"`),
    rect(xB + lw * 0.8, y0, lw, y1 - y0, HI(0.45)),
  ];
  const step = Math.max(pitch, 0.9 * s);
  for (let y = y0 + step * 0.6; y < y1 - step * 0.2; y += step) {
    out.push(line(xB + lw * 1.9, y, xB + wall - lw * 0.7, y,
      `stroke="${pal.rib}" stroke-width="${n(lw * 0.75)}"`));
  }
  return out.join('');
}

// Everything between the side wall and the front face is one plate. The GH and
// SH photographs show no second column there, so the back is drawn as a single
// moulded panel whose edge is carried by a shadow rather than a stroke.
function backX0(m) {
  return m.xB + m.wall + 0.04 * m.s;
}

function recessWindow(m) {
  const { faceX0, bodyH, lw, s, pal, paint, endH, outerR, pitch, firstPinY, pins } = m;
  const x0 = backX0(m);
  const x1 = faceX0 - 0.06 * s;
  const y0 = -bodyH / 2 + endH + lw;
  const y1 = bodyH / 2 - endH - lw;
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= lw * 3 || h <= lw * 3) return '';
  const r = Math.min(outerR * 0.6, w / 6, h / 8);
  const i = Math.min(lw * 2, w * 0.13, h * 0.07);
  const out = [
    `<path d="${rrPath(x0, y0, w, h, r)}" fill="${paint.recess}" ` +
    `stroke="${pal.recessLine}" stroke-width="${n(lw * 0.5)}"/>`,
    rect(x0 + lw * 0.6, y0 + lw * 0.5, w - lw * 1.2, lw, SH(0.05)),
    rect(x0 + lw * 0.6, y1 - lw * 1.6, w - lw * 1.2, lw, HI(0.4)),
  ];
  if (!m.f.lock) {
    // Families without a lock bar carry the stepped moulding ribs of their real
    // shells. One rib per pin, as short ticks, so the recess never reads as a
    // table at high pin counts.
    const rx = x0 + i + lw;
    const rw = Math.min((w - 2 * i - 2 * lw) * (m.f.ramp ? 0.3 : 0.44), 2.4 * s);
    const every = Math.ceil(pins / 7);
    for (let k = 0; k < pins; k += every) {
      const y = firstPinY + k * pitch;
      if (y <= y0 + i + lw * 2 || y >= y1 - i - lw * 2) continue;
      out.push(line(rx, y, rx + rw, y, `stroke="${pal.rib}" stroke-width="${n(lw * 0.8)}"`));
      out.push(rect(rx, y + lw * 0.5, rw, lw * 0.5, HI(0.45)));
    }
    if (m.f.ramp) {
      const cx = x0 + w * 0.62;
      out.push(line(cx, y0 + i + lw, cx, y1 - i - lw, `stroke="${pal.seam}" stroke-width="${n(lw * 0.8)}"`));
      out.push(rect(cx + lw * 0.6, y0 + i + lw, lw * 0.9, h - 2 * (i + lw), HI(0.5)));
    }
  }
  return out.join('');
}

function contactMetal(m, x0, x1, cy, h) {
  const { lw, paint } = m;
  const waist = h * 0.32;
  const xm = (x0 + x1) / 2;
  const d = pathD([
    ['M', x0, cy - h / 2],
    ['L', xm, cy - waist / 2],
    ['L', x1, cy - h / 2],
    ['L', x1, cy + h / 2],
    ['L', xm, cy + waist / 2],
    ['L', x0, cy + h / 2],
    ['Z'],
  ]);
  const tip = Math.max(lw * 1.1, (x1 - x0) * 0.12);
  return (
    `<path d="${d}" fill="${paint.metal}" stroke="#7b828a" stroke-width="${n(lw * 0.4)}" ` +
    'stroke-linejoin="round"/>' +
    rect(x0, cy - h / 2, tip, h, 'fill="#23272b"') +
    rect(x1 - tip, cy - h / 2, tip, h, 'fill="#23272b"') +
    rect(x0 + tip * 1.3, cy - h * 0.34, (x1 - x0) * 0.26, lw * 0.7, HI(0.5))
  );
}

function contactWindows(m) {
  const { faceX0, s, lw, pal, paint, pitch, firstPinY, pins, bodyH, endH } = m;
  const metal = m.view === 'bottom';
  const x0 = backX0(m);
  const x1 = faceX0 - 0.14 * s;
  const avail = x1 - x0;
  if (avail <= 0.3 * s) return '';
  const limit = bodyH / 2 - endH * 0.25;
  const h = Math.min(pitch * 0.78, m.f.square ? avail : avail * 0.9);
  const w = m.f.square ? Math.min(h * 1.1, avail) : avail;
  const wx = m.f.square ? x0 + (avail - w) / 2 : x0;
  const r = m.f.square ? Math.min(lw * 1.2, h * 0.14) : Math.min(h * 0.26, lw * 3);
  const inset = Math.min(0.16 * s, h * 0.16, w * 0.16);

  const out = [];
  for (let k = 0; k < pins; k++) {
    const cy = firstPinY + k * pitch;
    if (cy - h / 2 < -limit || cy + h / 2 > limit) continue;
    out.push(`<path d="${rrPath(wx, cy - h / 2, w, h, r)}" ` +
      `fill="${paint.recess}" stroke="${pal.seam}" stroke-width="${n(lw * 0.55)}"/>`);
    if (!metal) {
      out.push(`<path d="${rrPath(wx + inset, cy - h / 2 + inset, w - 2 * inset, h - 2 * inset, Math.max(0, r - inset * 0.5))}" ` +
        `fill="none" stroke="${pal.rib}" stroke-width="${n(lw * 0.7)}" opacity="0.85"/>`);
      out.push(rect(wx + inset, cy - h / 2 + inset, w - 2 * inset, lw, SH(0.14)));
      out.push(rect(wx + inset, cy + h / 2 - inset - lw, w - 2 * inset, lw, HI(0.22)));
      continue;
    }
    // In the photograph the crimp sits on the white moulding as a slim chrome
    // bow-tie with a dark pocket at each end; there is no dark field behind it,
    // and it covers roughly a third of the pitch rather than the whole cell.
    const ch = Math.min((h - 2 * inset) * 0.54, pitch * 0.36);
    const cw = w - 2 * inset;
    out.push(contactMetal(m, wx + inset + cw * 0.28, wx + inset + cw * 0.74, cy, ch));
  }
  return out.join('');
}

function latchEnds(m) {
  if (!m.f.ears) return '';
  const { xB, faceX0, bodyH, barH, endH, earOut, earW, wall, lw, s, pal, paint } = m;
  if (endH * 2 >= bodyH) return '';
  const armX0 = xB + wall + 0.2 * s;
  const armX1 = faceX0 - 0.06 * s;
  const zoneH = endH - barH;
  const out = [];

  for (const top of [true, false]) {
    const edge = top ? -bodyH / 2 : bodyH / 2;
    const barIn = top ? edge + barH : edge - barH;
    const barTop = top ? edge : edge - barH;

    out.push(line(xB - earOut + lw, barIn, xB + earW, barIn,
      `stroke="${pal.seam}" stroke-width="${n(lw * 0.6)}"`));
    out.push(line(xB + earW, top ? edge + lw : edge - lw, xB + earW, barIn,
      `stroke="${pal.seam}" stroke-width="${n(lw * 0.6)}"`));
    const bw = earW + earOut - 2 * lw;
    out.push(rect(xB - earOut + lw, top ? edge + lw * 0.6 : barTop + lw * 0.5, bw, lw, HI(0.65)));
    out.push(rect(xB - earOut + lw, top ? barIn - lw * 1.5 : edge - lw * 1.5, bw, lw * 0.9, SH(0.07)));

    if (zoneH <= lw * 2.2 || armX1 - armX0 <= lw * 3) continue;
    const cy = top ? barIn + zoneH * 0.42 : barIn - zoneH * 0.42;

    // The photographed latch is a slim lozenge sitting just inboard of the bar,
    // with the crimp spring running under it and chamfered where it meets the
    // side wall - not a box filling the whole end zone.
    const ah = Math.max(Math.min(zoneH * 0.6, 0.9 * s), lw * 2);
    const mh = Math.max(ah * 0.36, lw);
    const mx0 = xB + wall + 0.08 * s;
    const mx1 = armX0 + (armX1 - armX0) * 0.4;
    if (mx1 - mx0 > lw * 2) {
      const taper = Math.min((mx1 - mx0) * 0.2, mh * 0.8);
      out.push(`<path d="${pathD([
        ['M', mx0, cy - mh * 0.22],
        ['L', mx0 + taper, cy - mh / 2],
        ['L', mx1, cy - mh / 2],
        ['L', mx1, cy + mh / 2],
        ['L', mx0 + taper, cy + mh / 2],
        ['L', mx0, cy + mh * 0.22],
        ['Z'],
      ])}" fill="${paint.clip}" stroke="#8d949b" stroke-width="${n(lw * 0.35)}" ` +
        'stroke-linejoin="round"/>');
      out.push(rect(mx0 + taper, cy - mh / 2 + lw * 0.3, (mx1 - mx0 - taper) * 0.8, lw * 0.5, HI(0.65)));
    }

    const ax = mx0 + (mx1 - mx0) * 0.5;
    const aw = armX1 - ax;
    if (aw <= lw * 2) continue;
    out.push(`<path d="${rrPath(ax, cy - ah / 2, aw, ah, ah / 2)}" ` +
      `fill="${pal.boss}" stroke="${pal.seam}" stroke-width="${n(lw * 0.5)}"/>`);
    out.push(rect(ax + ah * 0.55, cy - ah / 2 + lw * 0.5, aw - ah * 1.1, lw * 0.8, HI(0.7)));
    out.push(rect(ax + ah * 0.55, cy + ah / 2 - lw * 1.3, aw - ah * 1.1, lw * 0.7, SH(0.06)));
  }
  return out.join('');
}

function rampRelief(m) {
  if (!m.f.ramp) return '';
  const { xB, bodyH, rampOut, s, lw, pal } = m;
  const h = Math.min(bodyH * 0.4, 3.0 * s);
  return (
    line(xB, -h / 2 - rampOut * 0.9, xB, h / 2 + rampOut * 0.9,
      `stroke="${pal.seam}" stroke-width="${n(lw * 0.8)}"`) +
    rect(xB - rampOut + lw, -h / 2 + lw, lw, h - 2 * lw, HI(0.55))
  );
}

function facePlate(m) {
  const { faceX0, faceD, bodyH, lw, pal, paint, outerR, xF } = m;
  const r = Math.min(outerR, bodyH / 5, (xF - m.xB) / 4);
  return (
    `<path d="${capPath(faceX0, -bodyH / 2, faceD, bodyH, r)}" fill="${paint.face}"/>` +
    line(faceX0, -bodyH / 2 + lw * 0.5, faceX0, bodyH / 2 - lw * 0.5,
      `stroke="${pal.seam}" stroke-width="${n(lw * 0.85)}"`) +
    rect(faceX0 + lw * 0.8, -bodyH / 2 + r * 0.5, lw * 0.9, bodyH - r, HI(0.6)) +
    rect(faceX0 + lw, -bodyH / 2 + lw * 0.6, faceD - lw * 2.2, lw * 0.9, HI(0.5)) +
    rect(faceX0 + lw, bodyH / 2 - lw * 1.6, faceD - lw * 2.2, lw * 0.9, SH(0.07))
  );
}

function pinNumbers(m) {
  const { conn, pinX, faceD, font, pal, pins } = m;
  // Counter-rotate so numbers read upright on a connector placed at rot 180.
  const rot = -(Number(conn?.rot) || 0);
  const x = pinX + faceD * 0.06;
  const out = [];
  for (let p = 1; p <= pins; p++) {
    const y = pinLocal(conn, p).y;
    const tr = rot % 360 === 0 ? '' : ` transform="rotate(${n(rot)} ${n(x)} ${n(y)})"`;
    out.push(
      `<text class="cx-pin-num" x="${n(x)}" y="${n(y)}"${tr} text-anchor="middle" ` +
      `dominant-baseline="central" font-family="${FONT}" font-size="${n(font)}" ` +
      `font-weight="600" fill="${pal.number}">${p}</text>`,
    );
  }
  return out.join('');
}

export function drawConnector(conn) {
  const m = metrics(conn);
  const d = shellOutline(m);
  const back = m.f.square || m.view === 'bottom' ? contactWindows(m) : recessWindow(m);

  // The outline is stroked again over the relief so the whole part keeps one
  // unbroken silhouette whatever is drawn inside it.
  return (
    `<g class="cx-conn cx-conn-${m.f.slug} cx-view-${m.view}">` +
    `<path d="${d}" fill="${m.paint.body}"/>` +
    sideWall(m) +
    back +
    latchEnds(m) +
    rampRelief(m) +
    facePlate(m) +
    `<path d="${d}" fill="none" stroke="${m.pal.outline}" stroke-width="${n(m.lw)}" ` +
    'stroke-linejoin="round"/>' +
    pinNumbers(m) +
    '</g>'
  );
}

// --- wire specifications ----------------------------------------------------

export const WIRE_COLORS = [
  { name: 'Black', hex: '#1a1a1a' },
  { name: 'White', hex: '#f2f2f2' },
  { name: 'Red', hex: '#e03128' },
  { name: 'Green', hex: '#1f9e52' },
  { name: 'Blue', hex: '#1f6fe0' },
  { name: 'Yellow', hex: '#f2c014' },
  { name: 'Orange', hex: '#f08a1e' },
  { name: 'Brown', hex: '#7a4a2a' },
  { name: 'Purple', hex: '#8b3fd0' },
  { name: 'Grey', hex: '#9aa0a6' },
  { name: 'Pink', hex: '#ef7fa8' },
];

export const AWG = {
  32: { od: 0.55, strands: 7 },
  30: { od: 0.65, strands: 7 },
  28: { od: 0.80, strands: 7 },
  26: { od: 0.95, strands: 7 },
  24: { od: 1.20, strands: 11 },
  22: { od: 1.50, strands: 19 },
  20: { od: 1.85, strands: 26 },
  18: { od: 2.30, strands: 34 },
};

export function awgList() {
  return Object.keys(AWG).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

export function wireWidth(awg, wireScale = 7) {
  const od = AWG[awg]?.od ?? AWG[28].od;
  const k = Number(wireScale);
  return clamp(od * (Number.isFinite(k) && k > 0 ? k : 7), 1.2, 20);
}
