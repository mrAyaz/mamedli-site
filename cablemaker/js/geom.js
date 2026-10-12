// Pure geometry helpers. Document units are millimetres throughout.

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const deg2rad = (d) => (d * Math.PI) / 180;
export const round = (v, step) => Math.round(v / step) * step;

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a, k) { return { x: a.x * k, y: a.y * k }; }

export function normalize(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

/**
 * Object placement transform: origin (x, y) plus clockwise rotation in degrees.
 * No mirroring here - pin order reversal is a model-level flag, which keeps all
 * text upright and avoids counter-transforms in the renderer.
 */
export function localToWorld(t, p) {
  const r = deg2rad(t.rot || 0);
  const c = Math.cos(r), s = Math.sin(r);
  return { x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c };
}

export function worldToLocal(t, p) {
  const r = deg2rad(t.rot || 0);
  const c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - t.x, dy = p.y - t.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

export function rotateVec(v, degrees) {
  const r = deg2rad(degrees);
  const c = Math.cos(r), s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function bboxOfPoints(points) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function expandBox(b, m) {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

export function boxContains(b, p) {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

export function boxesIntersect(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function normRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

// --- cubic bezier -----------------------------------------------------------

export function cubicPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export function cubicBox(p0, p1, p2, p3, samples = 24) {
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(cubicPoint(p0, p1, p2, p3, i / samples));
  return bboxOfPoints(pts);
}

/** Coarse-to-fine search for the curve point closest to `pt`. */
export function cubicNearest(p0, p1, p2, p3, pt, samples = 32) {
  let bestT = 0, bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d = dist(cubicPoint(p0, p1, p2, p3, t), pt);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  let step = 1 / samples;
  for (let pass = 0; pass < 4; pass++) {
    step /= 4;
    for (const t of [bestT - step, bestT + step]) {
      if (t < 0 || t > 1) continue;
      const d = dist(cubicPoint(p0, p1, p2, p3, t), pt);
      if (d < bestD) { bestD = d; bestT = t; }
    }
  }
  return { t: bestT, dist: bestD, point: cubicPoint(p0, p1, p2, p3, bestT) };
}

export function fmt(n, digits = 3) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

export function pathD(segments) {
  return segments.map((s) => s.map((v) => (typeof v === 'number' ? fmt(v) : v)).join(' ')).join(' ');
}
