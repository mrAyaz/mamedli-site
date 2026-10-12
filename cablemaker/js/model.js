// Document model, selection, clipboard and snapshot-based history.
//
// Every mutation goes through Store.transact() (or the drag trio
// beginDrag/dragUpdate/endDrag). Documents are small, so history is kept as
// whole-document structured clones - simple and impossible to desync.

import { uid } from './geom.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_SHEET = { w: 420, h: 260, bg: '#f0f0f0' };

export const TITLE_ID = '__title__';
export const NOTE_ID = '__note__';

export function createDocument() {
  return {
    version: SCHEMA_VERSION,
    sheet: { ...DEFAULT_SHEET },
    title: { text: 'Cable Assembly', x: 210, y: 30, size: 13, visible: true },
    note: { text: '', x: 210, y: 236, w: 160, h: 14, visible: false },
    view: { wireScale: 10, grid: 5, showGrid: true, snap: true },
    connectors: [],
    wires: [],
    annotations: [],
  };
}

export function createConnector(patch = {}) {
  return {
    id: uid('c'),
    kind: 'connector',
    family: 'jst-gh-1.25',
    pins: 6,
    view: 'top',
    x: 120,
    y: 130,
    rot: 0,
    scale: null, // null = the family's defaultScale, resolved in catalog.js
    reversePins: false,
    label: '',
    labelPos: 'above',
    legend: 'none',
    pinNames: [],
    ...patch,
  };
}

export function createWire(patch = {}) {
  return {
    id: uid('w'),
    kind: 'wire',
    a: { connector: null, pin: 1 },
    b: { connector: null, pin: 1 },
    color: '#1a1a1a',
    colorName: 'Black',
    awg: 30,
    bow: 0.45,
    ...patch,
  };
}

export function createAnnotation(patch = {}) {
  const base = { id: uid('a'), kind: 'text', x: 100, y: 100, ...patch };
  if (base.kind === 'text') return { text: 'Text', size: 7, align: 'middle', weight: 400, color: '#1a1a1a', ...base };
  if (base.kind === 'dimension') {
    return { x2: base.x + 100, y2: base.y, offset: 20, text: '', value: 100, ...base };
  }
  if (base.kind === 'note') return { w: 120, h: 14, text: 'Note', size: 6, ...base };
  return base;
}

const clone = (v) => structuredClone(v);

/** Objects a document exposes to selection/hit-testing, in z-order. */
export function allObjects(doc) {
  return [...doc.annotations, ...doc.wires, ...doc.connectors];
}

export class Store {
  #doc;
  #undo = [];
  #redo = [];
  #selection = new Set();
  #listeners = new Map();
  #tx = 0;
  #txSnapshot = null;
  #txLabel = '';
  #dragSnapshot = null;
  #dragLabel = '';
  #clipboard = null;
  #limit = 200;

  constructor(doc = createDocument()) {
    this.#doc = doc;
  }

  get doc() { return this.#doc; }
  get selection() { return this.#selection; }
  get selectedIds() { return [...this.#selection]; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get hasClipboard() { return !!this.#clipboard; }
  get undoLabel() { return this.#undo.at(-1)?.label ?? ''; }
  get redoLabel() { return this.#redo.at(-1)?.label ?? ''; }

  // --- events ---------------------------------------------------------------
  // 'change'    { label }    document mutated
  // 'selection' { ids }
  // 'history'   {}          undo/redo availability changed

  on(evt, fn) {
    if (!this.#listeners.has(evt)) this.#listeners.set(evt, new Set());
    this.#listeners.get(evt).add(fn);
    return () => this.off(evt, fn);
  }

  off(evt, fn) { this.#listeners.get(evt)?.delete(fn); }

  emit(evt, payload = {}) {
    for (const fn of this.#listeners.get(evt) ?? []) fn(payload, this);
  }

  // --- history --------------------------------------------------------------

  /** Run `fn(doc)` as one undoable step. Nested calls collapse into the outer one. */
  transact(label, fn) {
    if (this.#tx === 0) {
      this.#txSnapshot = clone(this.#doc);
      this.#txLabel = label;
    }
    this.#tx++;
    let result;
    try {
      result = fn(this.#doc);
    } catch (err) {
      this.#tx--;
      if (this.#tx === 0) {
        this.#doc = this.#txSnapshot;
        this.#txSnapshot = null;
        this.emit('change', { label: 'rollback' });
      }
      throw err;
    }
    this.#tx--;
    if (this.#tx === 0) {
      this.#pushHistory(this.#txLabel, this.#txSnapshot);
      this.#txSnapshot = null;
      this.#pruneSelection();
      this.emit('change', { label });
    }
    return result;
  }

  #pushHistory(label, snapshot) {
    this.#undo.push({ label, doc: snapshot });
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo.length = 0;
    this.emit('history', {});
  }

  /**
   * Live drag: mutate freely between beginDrag() and endDrag(), repainting via
   * dragUpdate(); only one history entry lands at the end.
   */
  beginDrag(label) {
    this.#dragSnapshot = clone(this.#doc);
    this.#dragLabel = label;
  }

  dragUpdate() {
    this.emit('change', { label: this.#dragLabel, transient: true });
  }

  endDrag({ commit = true } = {}) {
    if (!this.#dragSnapshot) return;
    const before = this.#dragSnapshot;
    this.#dragSnapshot = null;
    if (!commit) {
      this.#doc = before;
      this.#pruneSelection();
      this.emit('change', { label: 'cancel' });
      return;
    }
    if (JSON.stringify(before) === JSON.stringify(this.#doc)) return;
    this.#pushHistory(this.#dragLabel, before);
    this.#pruneSelection();
    this.emit('change', { label: this.#dragLabel });
  }

  cancelDrag() { this.endDrag({ commit: false }); }

  undo() {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#redo.push({ label: entry.label, doc: clone(this.#doc) });
    this.#doc = entry.doc;
    this.#pruneSelection();
    this.emit('history', {});
    this.emit('change', { label: `undo ${entry.label}` });
    return true;
  }

  redo() {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#undo.push({ label: entry.label, doc: clone(this.#doc) });
    this.#doc = entry.doc;
    this.#pruneSelection();
    this.emit('history', {});
    this.emit('change', { label: `redo ${entry.label}` });
    return true;
  }

  /** Load a document from disk/new: history is not meaningful across documents. */
  replaceDocument(doc) {
    this.#doc = doc;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#selection.clear();
    this.emit('history', {});
    this.emit('selection', { ids: [] });
    this.emit('change', { label: 'load' });
  }

  // --- selection ------------------------------------------------------------

  select(ids, { add = false, toggle = false } = {}) {
    const list = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
    if (!add && !toggle) this.#selection.clear();
    for (const id of list) {
      if (toggle && this.#selection.has(id)) this.#selection.delete(id);
      else this.#selection.add(id);
    }
    this.emit('selection', { ids: this.selectedIds });
  }

  clearSelection() { this.select([]); }

  selectAll() {
    this.select(allObjects(this.#doc).map((o) => o.id));
  }

  isSelected(id) { return this.#selection.has(id); }

  #pruneSelection() {
    const live = new Set(allObjects(this.#doc).map((o) => o.id));
    if (this.#doc.title?.visible) live.add(TITLE_ID);
    if (this.#doc.note?.visible) live.add(NOTE_ID);
    let changed = false;
    for (const id of this.#selection) {
      if (!live.has(id)) { this.#selection.delete(id); changed = true; }
    }
    if (changed) this.emit('selection', { ids: this.selectedIds });
  }

  // --- queries --------------------------------------------------------------

  connector(id) { return this.#doc.connectors.find((c) => c.id === id) ?? null; }
  wire(id) { return this.#doc.wires.find((w) => w.id === id) ?? null; }
  annotation(id) { return this.#doc.annotations.find((a) => a.id === id) ?? null; }

  object(id) {
    if (id === TITLE_ID) return this.#doc.title ?? null;
    if (id === NOTE_ID) return this.#doc.note ?? null;
    return this.connector(id) ?? this.wire(id) ?? this.annotation(id) ?? null;
  }

  selectedObjects() {
    return this.selectedIds.map((id) => this.object(id)).filter(Boolean);
  }

  /** Wires attached to a pin (1-based). Omit `pin` for every wire on a connector. */
  wiresAt(connectorId, pin = null) {
    return this.#doc.wires.filter(
      (w) =>
        (w.a.connector === connectorId && (pin == null || w.a.pin === pin)) ||
        (w.b.connector === connectorId && (pin == null || w.b.pin === pin)),
    );
  }

  isPinUsed(connectorId, pin) { return this.wiresAt(connectorId, pin).length > 0; }

  // --- mutations ------------------------------------------------------------

  addConnector(patch = {}) {
    const c = createConnector(patch);
    this.transact('Add connector', (doc) => { doc.connectors.push(c); });
    return c.id;
  }

  addWire(patch = {}) {
    const w = createWire(patch);
    this.transact('Add wire', (doc) => { doc.wires.push(w); });
    return w.id;
  }

  addAnnotation(patch = {}) {
    const a = createAnnotation(patch);
    this.transact('Add annotation', (doc) => { doc.annotations.push(a); });
    return a.id;
  }

  /** Shallow-merges `patch`; nested plain objects are merged one level deep. */
  updateObject(id, patch, label = 'Edit') {
    this.transact(label, () => {
      const o = this.object(id);
      if (!o) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) {
          Object.assign(o[k], v);
        } else {
          o[k] = v;
        }
      }
    });
  }

  /** Deleting a connector deletes every wire attached to it. */
  removeObjects(ids, label = 'Delete') {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    if (!set.size) return;
    this.transact(label, (doc) => {
      if (set.has(TITLE_ID) && doc.title) doc.title.visible = false;
      if (set.has(NOTE_ID) && doc.note) doc.note.visible = false;
      doc.connectors = doc.connectors.filter((c) => !set.has(c.id));
      const live = new Set(doc.connectors.map((c) => c.id));
      doc.wires = doc.wires.filter(
        (w) => !set.has(w.id) && live.has(w.a.connector) && live.has(w.b.connector),
      );
      doc.annotations = doc.annotations.filter((a) => !set.has(a.id));
    });
  }

  moveObjects(ids, dx, dy, label = 'Move') {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    this.transact(label, (doc) => {
      for (const c of doc.connectors) if (set.has(c.id)) { c.x += dx; c.y += dy; }
      for (const a of doc.annotations) {
        if (!set.has(a.id)) continue;
        a.x += dx; a.y += dy;
        if (a.kind === 'dimension') { a.x2 += dx; a.y2 += dy; }
      }
      // The title and note are document fields, not list entries, but the
      // renderer tags them as draggable objects under these synthetic ids.
      if (set.has(TITLE_ID)) { doc.title.x += dx; doc.title.y += dy; }
      if (set.has(NOTE_ID)) { doc.note.x += dx; doc.note.y += dy; }
    });
  }

  // --- clipboard ------------------------------------------------------------

  /**
   * Copies connectors/annotations plus any wire whose *both* endpoints are in
   * the selection - a dangling wire has nothing to attach to on paste.
   */
  copy(ids = this.selectedIds) {
    const set = new Set(ids);
    const connectors = this.#doc.connectors.filter((c) => set.has(c.id));
    const connIds = new Set(connectors.map((c) => c.id));
    const wires = this.#doc.wires.filter(
      (w) => (set.has(w.id) || (connIds.has(w.a.connector) && connIds.has(w.b.connector)))
        && connIds.has(w.a.connector) && connIds.has(w.b.connector),
    );
    const annotations = this.#doc.annotations.filter((a) => set.has(a.id));
    if (!connectors.length && !wires.length && !annotations.length) return false;
    this.#clipboard = clone({ connectors, wires, annotations });
    return true;
  }

  cut(ids = this.selectedIds) {
    if (!this.copy(ids)) return false;
    this.removeObjects(ids, 'Cut');
    return true;
  }

  /** Returns the ids of the pasted objects (also made the new selection). */
  paste(offset = { x: 8, y: 8 }) {
    if (!this.#clipboard) return [];
    const data = clone(this.#clipboard);
    const idMap = new Map();
    const fresh = [];

    for (const c of data.connectors) {
      const nid = uid('c');
      idMap.set(c.id, nid);
      c.id = nid;
      c.x += offset.x;
      c.y += offset.y;
      fresh.push(nid);
    }
    for (const w of data.wires) {
      w.id = uid('w');
      w.a = { ...w.a, connector: idMap.get(w.a.connector) };
      w.b = { ...w.b, connector: idMap.get(w.b.connector) };
      fresh.push(w.id);
    }
    for (const a of data.annotations) {
      a.id = uid('a');
      a.x += offset.x;
      a.y += offset.y;
      if (a.kind === 'dimension') { a.x2 += offset.x; a.y2 += offset.y; }
      fresh.push(a.id);
    }

    this.transact('Paste', (doc) => {
      doc.connectors.push(...data.connectors);
      doc.wires.push(...data.wires);
      doc.annotations.push(...data.annotations);
    });
    this.select(fresh);
    return fresh;
  }

  duplicate(ids = this.selectedIds) {
    const saved = this.#clipboard;
    if (!this.copy(ids)) return [];
    const out = this.paste({ x: 8, y: 8 });
    this.#clipboard = saved;
    return out;
  }
}
