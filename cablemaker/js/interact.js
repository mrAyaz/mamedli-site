import { add, clamp, cubicNearest, dist, normRect, round, scale as vec } from './geom.js';
import { pinDirWorld, pinExitWorld, wireWidth } from './catalog.js';

const DRAG_THRESHOLD = 3;
const BOW_MIN = 0.05;
const BOW_MAX = 1.5;
const ZOOM_PER_PIXEL = 0.0015;
const PX_PER_MM = 96 / 25.4;

const HINT = {
  select: 'Click to select, drag to move, Shift+drag to add, middle-drag or Space to pan',
  pan: 'Drag to pan the sheet',
  wire: 'Wire tool: click a pin to start. Esc to disarm',
  wireLive: 'Wire tool: click a free pin on another connector. Esc to cancel',
};

const SELECTABLE =
  '[data-kind="connector"][data-id],[data-kind="wire"][data-id],[data-kind="annotation"][data-id]';

function clientPoint(e) {
  return { x: e.clientX, y: e.clientY };
}

function clientRect(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rectsOverlap(a, b) {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}

function isTypingTarget(node) {
  const el = node && node.nodeType === 1 ? node : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION';
}

function keyboardBlocked(e) {
  if (typeof document === 'undefined') return true;
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return true;
  if (document.querySelector('dialog[open]')) return true;
  return false;
}

function resolveCanvas(renderer) {
  const direct = renderer.svg || renderer.svgEl || renderer.el || renderer.root;
  if (direct && direct.nodeType === 1) return direct;
  if (typeof document === 'undefined') throw new Error('Interaction: no document');
  // The renderer keeps its <svg> private, but it always builds <g id="viewport"> inside it.
  const owner = document.getElementById('viewport')?.ownerSVGElement;
  if (owner) return owner;
  const byId = document.getElementById('canvas');
  if (byId) return byId;
  throw new Error('Interaction: cannot resolve the canvas SVG element');
}

export class Interaction {
  #renderer;
  #store;
  #hooks;
  #svg;
  #host;
  #listeners = [];
  #toolMode = 'select';
  #wireSpec = null;
  #startPin = null;
  #hotPin = null;
  #gesture = null;
  #pointerId = null;
  #spaceHeld = false;
  #destroyed = false;

  constructor(renderer, store, hooks = {}) {
    if (!renderer || !store) throw new Error('Interaction requires a renderer and a store');
    this.#renderer = renderer;
    this.#store = store;
    this.#hooks = hooks || {};
    this.#svg = resolveCanvas(renderer);
    this.#host = this.#svg.closest ? this.#svg.closest('#canvas-host') || this.#svg.parentElement : null;

    this.#on(this.#svg, 'pointerdown', this.#onPointerDown);
    this.#on(this.#svg, 'pointermove', this.#onPointerMove);
    this.#on(this.#svg, 'pointerup', this.#onPointerUp);
    this.#on(this.#svg, 'pointercancel', this.#onPointerCancel);
    this.#on(this.#svg, 'pointerleave', this.#onPointerLeave);
    this.#on(this.#svg, 'wheel', this.#onWheel, { passive: false });
    this.#on(this.#svg, 'contextmenu', this.#onContextMenu);
    this.#on(this.#svg, 'dblclick', this.#onDoubleClick);
    this.#on(this.#svg, 'auxclick', this.#onAuxClick);
    this.#on(window, 'keydown', this.#onKeyDown);
    this.#on(window, 'keyup', this.#onKeyUp);
    this.#on(window, 'blur', this.#onWindowBlur);

    this.#applyCursor();
    this.#emitStatus();
  }

  // An armed tool outranks a transient pan: the toolbar toggle reflects
  // `mode === 'wire'`, and middle-dragging must not report the tool as gone.
  get mode() {
    if (this.#toolMode === 'wire') return 'wire';
    if (this.#gesture && this.#gesture.type === 'pan') return 'pan';
    if (this.#spaceHeld) return 'pan';
    return this.#toolMode;
  }

  armWireTool(spec = {}) {
    if (this.#destroyed) return;
    this.#abortGesture();
    const next = {
      color: spec.color || '#1a1a1a',
      colorName: spec.colorName || 'Black',
      awg: Number.isFinite(spec.awg) ? spec.awg : 30,
    };
    if (Number.isFinite(spec.bow)) next.bow = clamp(spec.bow, BOW_MIN, BOW_MAX);
    this.#wireSpec = next;
    this.#toolMode = 'wire';
    this.#startPin = null;
    this.#setHotPin(null, null);
    this.#overlay()?.clearRubber?.();
    try { this.#renderer.pinsVisible?.(true); } catch { /* renderer not ready */ }
    this.#applyCursor();
    this.#emitStatus();
  }

  cancelTool() {
    if (this.#destroyed) return;
    this.#abortGesture();
    if (this.#toolMode !== 'wire') {
      this.#emitStatus();
      return;
    }
    this.#startPin = null;
    this.#wireSpec = null;
    this.#toolMode = 'select';
    this.#setHotPin(null, null);
    this.#overlay()?.clearRubber?.();
    try { this.#renderer.pinsVisible?.(false); } catch { /* renderer not ready */ }
    this.#applyCursor();
    this.#emitStatus();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#abortGesture();
    if (this.#toolMode === 'wire') {
      this.#setHotPin(null, null);
      this.#overlay()?.clearRubber?.();
      try { this.#renderer.pinsVisible?.(false); } catch { /* renderer already gone */ }
    }
    this.#destroyed = true;
    this.#toolMode = 'select';
    this.#startPin = null;
    this.#wireSpec = null;
    for (const [target, type, fn, opts] of this.#listeners) target.removeEventListener(type, fn, opts);
    this.#listeners.length = 0;
    this.#spaceHeld = false;
    try { this.#svg.classList.remove('mode-pan', 'mode-panning', 'mode-wire'); } catch { /* detached */ }
  }

  // --- plumbing -------------------------------------------------------------

  #on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.#listeners.push([target, type, fn, opts]);
  }

  #overlay() {
    return this.#renderer ? this.#renderer.overlay : null;
  }

  #status(text) {
    this.#hooks.onStatus?.(text);
  }

  #emitStatus() {
    if (this.#toolMode === 'wire') this.#status(this.#startPin ? HINT.wireLive : HINT.wire);
    else if (this.#spaceHeld) this.#status(HINT.pan);
    else this.#status(HINT.select);
  }

  #applyCursor() {
    const cl = this.#svg && this.#svg.classList;
    if (!cl) return;
    const panning = !!(this.#gesture && this.#gesture.type === 'pan');
    cl.toggle('mode-panning', panning);
    cl.toggle('mode-pan', !panning && this.#spaceHeld);
    cl.toggle('mode-wire', !panning && !this.#spaceHeld && this.#toolMode === 'wire');
  }

  #hitAt(e) {
    try {
      return this.#renderer.hitAt(e) || null;
    } catch {
      return null;
    }
  }

  #world(e) {
    return this.#renderer.clientToWorld(clientPoint(e));
  }

  #capture(e) {
    this.#pointerId = e.pointerId;
    try { this.#svg.setPointerCapture(e.pointerId); } catch { /* unsupported pointer */ }
  }

  #release() {
    if (this.#pointerId === null) return;
    try { this.#svg.releasePointerCapture(this.#pointerId); } catch { /* already released */ }
    this.#pointerId = null;
  }

  #focusCanvas() {
    const el = this.#host || this.#svg;
    if (!el || typeof el.focus !== 'function') return;
    const active = document.activeElement;
    if (active === el || (active && el.contains && el.contains(active))) return;
    if (active && active.closest && active.closest('dialog[open]')) return;
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
  }

  // --- pointer --------------------------------------------------------------

  #onPointerDown = (e) => {
    if (this.#destroyed || this.#pointerId !== null) return;

    if (e.button === 2) return; // right button is resolved in #onContextMenu

    this.#focusCanvas();

    if (e.button === 1 || (e.button === 0 && this.#spaceHeld)) {
      e.preventDefault();
      this.#capture(e);
      this.#gesture = {
        type: 'pan',
        started: true,
        startClient: clientPoint(e),
        view: this.#renderer.getView(),
      };
      this.#applyCursor();
      this.#status(HINT.pan);
      return;
    }
    if (e.button !== 0) return;

    const hit = this.#hitAt(e);

    if (this.#toolMode === 'wire') {
      e.preventDefault();
      this.#wireClick(hit, e);
      return;
    }

    e.preventDefault();
    const world = this.#world(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (!hit) {
      this.#capture(e);
      this.#gesture = {
        type: 'marquee',
        started: false,
        additive,
        startClient: clientPoint(e),
        startWorld: world,
      };
      return;
    }

    if (hit.kind === 'title' || hit.kind === 'note') {
      if (!additive) this.#store.clearSelection();
      this.#capture(e);
      this.#gesture = {
        type: 'docmove',
        started: false,
        kind: hit.kind,
        additive,
        startClient: clientPoint(e),
        startWorld: world,
      };
      return;
    }

    const id = hit.id;
    const kind = hit.kind === 'pin' ? 'connector' : hit.kind;
    if (!id || !this.#store.object(id)) return;

    const wasSelected = this.#store.isSelected(id);
    if (additive) this.#store.select([id], { toggle: true });
    else if (!wasSelected) this.#store.select([id]);
    if (!this.#store.isSelected(id)) return;

    this.#capture(e);
    this.#gesture = {
      type: 'object',
      started: false,
      id,
      kind,
      additive,
      wasSelected,
      startClient: clientPoint(e),
      startWorld: world,
    };
  };

  #onPointerMove = (e) => {
    if (this.#destroyed) return;
    if (this.#pointerId !== null && e.pointerId !== this.#pointerId) return;

    const g = this.#gesture;
    if (g) {
      if (g.type === 'pan') { this.#updatePan(g, e); return; }
      if (!g.started) {
        const dx = e.clientX - g.startClient.x;
        const dy = e.clientY - g.startClient.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        this.#beginGesture(g, e);
        if (!this.#gesture || !this.#gesture.started) return;
      }
      const world = this.#world(e);
      if (g.type === 'marquee') this.#updateMarquee(g, world);
      else if (g.type === 'move') this.#updateMove(g, world, e);
      else if (g.type === 'bow') this.#updateBow(g, world);
      return;
    }

    if (this.#toolMode === 'wire') this.#wireHover(e);
  };

  #onPointerUp = (e) => {
    if (this.#destroyed) return;
    if (this.#pointerId !== null && e.pointerId !== this.#pointerId) return;

    const g = this.#gesture;
    this.#gesture = null;
    this.#release();
    this.#applyCursor();
    if (!g) return;

    if (g.type === 'pan') { this.#emitStatus(); return; }

    if (g.type === 'marquee') {
      this.#overlay()?.clearMarquee?.();
      if (g.started) {
        this.#store.select(this.#idsInRect(clientRect(g.startClient, clientPoint(e))), { add: g.additive });
      } else if (!g.additive) {
        this.#store.clearSelection();
      }
      return;
    }

    if (g.type === 'move' || g.type === 'bow') {
      this.#store.endDrag({ commit: true });
      return;
    }

    if (g.type === 'object' && !g.additive && g.id && this.#store.selectedIds.length > 1) {
      this.#store.select([g.id]);
    }
  };

  #onPointerCancel = () => {
    if (this.#destroyed) return;
    this.#abortGesture();
  };

  #onPointerLeave = () => {
    if (this.#destroyed || this.#gesture) return;
    if (this.#toolMode === 'wire') this.#setHotPin(null, null);
  };

  #onAuxClick = (e) => {
    if (e.button === 1) e.preventDefault();
  };

  #onWheel = (e) => {
    if (this.#destroyed) return;
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= 100;
    if (!delta) return;
    this.#renderer.zoomAt(clientPoint(e), clamp(Math.exp(-delta * ZOOM_PER_PIXEL), 0.2, 5));
  };

  #onContextMenu = (e) => {
    if (this.#destroyed) return;
    e.preventDefault();
    if (this.#gesture) { this.#abortGesture(); this.#emitStatus(); return; }
    if (this.#toolMode === 'wire') { this.#cancelWireStep(); return; }
    const hit = this.#hitAt(e);
    if (hit && hit.id && (hit.kind === 'connector' || hit.kind === 'wire' || hit.kind === 'annotation')) {
      if (!this.#store.isSelected(hit.id) && this.#store.object(hit.id)) this.#store.select([hit.id]);
    }
    this.#hooks.onContextMenu?.(this.#world(e), clientPoint(e), hit);
  };

  #onDoubleClick = (e) => {
    if (this.#destroyed) return;
    e.preventDefault();
    this.#hooks.onDoubleClick?.(this.#hitAt(e));
  };

  // --- gestures -------------------------------------------------------------

  #beginGesture(g, e) {
    if (g.type === 'marquee') { g.started = true; return; }

    if (g.type === 'docmove') {
      const doc = this.#store.doc;
      const obj = g.kind === 'title' ? doc.title : doc.note;
      if (!obj) { this.#gesture = null; return; }
      this.#store.beginDrag(g.kind === 'title' ? 'Move title' : 'Move note');
      g.type = 'move';
      g.targets = [{ obj, x: obj.x, y: obj.y }];
      g.started = true;
      return;
    }

    if (g.type === 'object') {
      if (g.kind === 'wire') { this.#beginBow(g); return; }
      const targets = this.#moveTargets();
      if (!targets.length) { this.#gesture = null; return; }
      this.#store.beginDrag('Move');
      g.type = 'move';
      g.targets = targets;
      g.started = true;
      return;
    }

    this.#gesture = null;
  }

  #moveTargets() {
    const out = [];
    for (const o of this.#store.selectedObjects()) {
      if (typeof o.x !== 'number' || typeof o.y !== 'number') continue;
      out.push({ obj: o, x: o.x, y: o.y, x2: o.x2, y2: o.y2 });
    }
    return out;
  }

  #updateMove(g, world, e) {
    let dx = world.x - g.startWorld.x;
    let dy = world.y - g.startWorld.y;
    const view = this.#store.doc.view;
    const grid = view.grid || 1;
    if (view.snap && !e.altKey) {
      // Snap the object actually grabbed, not an arbitrary member of the selection.
      const anchor = g.targets.find((t) => t.obj.id === g.id) || g.targets[0];
      dx = round(anchor.x + dx, grid) - anchor.x;
      dy = round(anchor.y + dy, grid) - anchor.y;
    }
    if (dx === g.lastDx && dy === g.lastDy) return;
    g.lastDx = dx;
    g.lastDy = dy;
    for (const t of g.targets) {
      t.obj.x = t.x + dx;
      t.obj.y = t.y + dy;
      if (typeof t.x2 === 'number') t.obj.x2 = t.x2 + dx;
      if (typeof t.y2 === 'number') t.obj.y2 = t.y2 + dy;
    }
    this.#store.dragUpdate();
  }

  #updateMarquee(g, world) {
    this.#overlay()?.setMarquee?.(normRect(g.startWorld, world));
  }

  #updatePan(g, e) {
    const view = g.view;
    if (!view) return;
    this.#renderer.setView({
      tx: view.tx + (e.clientX - g.startClient.x),
      ty: view.ty + (e.clientY - g.startClient.y),
      zoom: view.zoom,
    });
  }

  #idsInRect(rect) {
    const ids = [];
    const seen = new Set();
    for (const node of this.#svg.querySelectorAll(SELECTABLE)) {
      const id = node.getAttribute('data-id');
      if (!id || seen.has(id)) continue;
      const box = node.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      if (!rectsOverlap(rect, box)) continue;
      if (!this.#store.object(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  // --- wire bow -------------------------------------------------------------

  #wireFrame(wire) {
    const ca = this.#store.connector(wire.a.connector);
    const cb = this.#store.connector(wire.b.connector);
    if (!ca || !cb) return null;
    try {
      const a = pinExitWorld(ca, wire.a.pin);
      const b = pinExitWorld(cb, wire.b.pin);
      return {
        a,
        b,
        da: pinDirWorld(ca, wire.a.pin),
        db: pinDirWorld(cb, wire.b.pin),
        span: dist(a, b) || 1,
      };
    } catch {
      return null;
    }
  }

  /**
   * bow enters the curve linearly, so the exact gradient of the grabbed curve
   * point with respect to bow makes the drag track the cursor. That gradient
   * vanishes at the endpoints, and at t=0.5 for facing connectors, hence the
   * clamp away from both.
   */
  #beginBow(g) {
    const wire = this.#store.wire(g.id);
    const frame = wire ? this.#wireFrame(wire) : null;
    if (!frame) { this.#gesture = null; return; }
    const { a, b, da, db, span } = frame;
    const bow = Number.isFinite(wire.bow) ? wire.bow : 0.45;
    const c1 = add(a, vec(da, bow * span));
    const c2 = add(b, vec(db, bow * span));
    let t = clamp(cubicNearest(a, c1, c2, b, g.startWorld).t, 0.15, 0.85);
    if (Math.abs(t - 0.5) < 0.15) t = t <= 0.5 ? 0.35 : 0.65;
    const u = 1 - t;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const gx = span * (w1 * da.x + w2 * db.x);
    const gy = span * (w1 * da.y + w2 * db.y);
    const gg = gx * gx + gy * gy;
    if (gg < 1e-9) { this.#gesture = null; return; }
    this.#store.beginDrag('Wire bow');
    g.type = 'bow';
    g.started = true;
    g.wire = wire;
    g.bow0 = bow;
    g.gx = gx;
    g.gy = gy;
    g.gg = gg;
  }

  #updateBow(g, world) {
    const dx = world.x - g.startWorld.x;
    const dy = world.y - g.startWorld.y;
    const next = clamp(g.bow0 + (dx * g.gx + dy * g.gy) / g.gg, BOW_MIN, BOW_MAX);
    if (next === g.wire.bow) return;
    g.wire.bow = next;
    this.#store.dragUpdate();
  }

  // --- wire tool ------------------------------------------------------------

  #rubberStyle() {
    const spec = this.#wireSpec || {};
    let width = 2;
    try {
      width = wireWidth(spec.awg, this.#store.doc.view.wireScale);
    } catch { /* catalog refused the gauge */ }
    return { color: spec.color || '#1a1a1a', width };
  }

  #pinBlocked(pin) {
    if (this.#store.isPinUsed(pin.id, pin.pin)) return true;
    return !!this.#startPin && this.#startPin.connector === pin.id;
  }

  #setHotPin(pin, state) {
    const prev = this.#hotPin;
    if (prev && pin && prev.id === pin.id && prev.pin === pin.pin && prev.state === state) return;
    if (prev) {
      this.#overlay()?.setPinHighlight?.(prev.id, prev.pin, null);
      this.#hotPin = null;
    }
    if (!pin || !state) return;
    this.#hotPin = { id: pin.id, pin: pin.pin, state };
    this.#overlay()?.setPinHighlight?.(pin.id, pin.pin, state);
  }

  #pinPoint(pin) {
    const conn = this.#store.connector(pin.id);
    if (!conn) return null;
    try {
      return pinExitWorld(conn, pin.pin);
    } catch {
      return null;
    }
  }

  #wireHover(e) {
    const hit = this.#hitAt(e);
    const pin = hit && hit.kind === 'pin' && hit.id ? hit : null;
    const state = pin ? (this.#pinBlocked(pin) ? 'blocked' : 'hot') : null;
    this.#setHotPin(pin, state);
    if (!this.#startPin) return;
    const snapped = pin && state === 'hot' ? this.#pinPoint(pin) : null;
    this.#overlay()?.setRubber?.(this.#startPin.point, snapped || this.#world(e), this.#rubberStyle());
  }

  #wireClick(hit, e) {
    const pin = hit && hit.kind === 'pin' && hit.id ? hit : null;
    if (!pin) {
      this.#emitStatus();
      return;
    }
    const point = this.#pinPoint(pin);
    if (!point) return;

    if (this.#store.isPinUsed(pin.id, pin.pin)) {
      this.#setHotPin(pin, 'blocked');
      this.#status(`Pin ${pin.pin} already carries a wire`);
      return;
    }

    if (!this.#startPin) {
      this.#startPin = { connector: pin.id, pin: pin.pin, point };
      this.#overlay()?.setRubber?.(point, this.#world(e), this.#rubberStyle());
      this.#setHotPin(pin, 'hot');
      this.#status(HINT.wireLive);
      return;
    }

    if (this.#startPin.connector === pin.id) {
      this.#setHotPin(pin, 'blocked');
      this.#status('Finish the wire on a different connector');
      return;
    }

    const spec = this.#wireSpec || {};
    const patch = {
      a: { connector: this.#startPin.connector, pin: this.#startPin.pin },
      b: { connector: pin.id, pin: pin.pin },
      color: spec.color || '#1a1a1a',
      colorName: spec.colorName || 'Black',
      awg: Number.isFinite(spec.awg) ? spec.awg : 30,
    };
    if (Number.isFinite(spec.bow)) patch.bow = spec.bow;

    const id = this.#store.addWire(patch);
    this.#startPin = null;
    this.#overlay()?.clearRubber?.();
    this.#setHotPin(null, null);
    this.#hooks.onWireFinished?.(id);
    this.#status(HINT.wire);
  }

  #cancelWireStep() {
    if (this.#startPin) {
      this.#startPin = null;
      this.#overlay()?.clearRubber?.();
      this.#setHotPin(null, null);
      this.#emitStatus();
      return;
    }
    this.cancelTool();
  }

  // --- keyboard -------------------------------------------------------------

  #onKeyDown = (e) => {
    if (this.#destroyed || keyboardBlocked(e)) return;
    const key = e.key;
    const mod = e.ctrlKey || e.metaKey;

    if (key === 'Escape') {
      if (this.#gesture) { this.#abortGesture(); this.#emitStatus(); return; }
      if (this.#toolMode === 'wire') { e.preventDefault(); this.#cancelWireStep(); return; }
      this.#store.clearSelection();
      return;
    }

    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      if (!this.#spaceHeld) {
        this.#spaceHeld = true;
        this.#applyCursor();
        this.#status(HINT.pan);
      }
      return;
    }

    if (mod) {
      switch (key.toLowerCase()) {
        case 'a': e.preventDefault(); this.#store.selectAll(); return;
        case 'z': e.preventDefault(); if (e.shiftKey) this.#store.redo(); else this.#store.undo(); return;
        case 'y': e.preventDefault(); this.#store.redo(); return;
        case 'x': e.preventDefault(); this.#store.cut(); return;
        case 'c': e.preventDefault(); this.#store.copy(); return;
        case 'v': e.preventDefault(); this.#store.paste(); return;
        case 'd': e.preventDefault(); this.#store.duplicate(); return;
        case '0': e.preventDefault(); this.#renderer.fitToSheet?.(); return;
        case '1': e.preventDefault(); this.#zoomTo(PX_PER_MM); return;
        default: return;
      }
    }

    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      const ids = this.#store.selectedIds;
      if (ids.length) this.#store.removeObjects(ids, 'Delete');
      return;
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      const ids = this.#store.selectedIds;
      if (!ids.length) return;
      e.preventDefault();
      const step = (this.#store.doc.view.grid || 1) * (e.shiftKey ? 5 : 1);
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      this.#store.moveObjects(ids, dx, dy, 'Nudge');
      return;
    }

    if (key === 'r' || key === 'R') {
      e.preventDefault();
      this.#rotateSelection(e.shiftKey ? -90 : 90);
    }
  };

  #onKeyUp = (e) => {
    if (this.#destroyed) return;
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (!this.#spaceHeld) return;
    this.#spaceHeld = false;
    this.#applyCursor();
    this.#emitStatus();
  };

  #onWindowBlur = () => {
    if (this.#destroyed) return;
    if (this.#spaceHeld) {
      this.#spaceHeld = false;
      this.#applyCursor();
    }
    if (this.#gesture) this.#abortGesture();
  };

  #rotateSelection(delta) {
    const ids = this.#store.selectedIds.filter((id) => this.#store.connector(id));
    if (!ids.length) return;
    const set = new Set(ids);
    this.#store.transact(delta > 0 ? 'Rotate +90' : 'Rotate -90', (doc) => {
      for (const c of doc.connectors) {
        if (!set.has(c.id)) continue;
        c.rot = ((((c.rot || 0) + delta) % 360) + 360) % 360;
      }
    });
  }

  #zoomTo(target) {
    const view = this.#renderer.getView();
    if (!view || !view.zoom) return;
    const box = this.#svg.getBoundingClientRect();
    this.#renderer.zoomAt({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, target / view.zoom);
  }

  #abortGesture() {
    const g = this.#gesture;
    this.#gesture = null;
    this.#release();
    if (g) {
      if (g.type === 'move' || g.type === 'bow') this.#store.cancelDrag();
      else if (g.type === 'marquee') this.#overlay()?.clearMarquee?.();
      else if (g.type === 'pan' && g.view) this.#renderer.setView(g.view);
    }
    this.#applyCursor();
  }
}
