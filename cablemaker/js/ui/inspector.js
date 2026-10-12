// Property panel for the current selection. Object edits go through
// store.updateObject(); document-level fields (sheet/title/note/view) have no
// object id, so they use store.transact() directly.

const ALIGNS = [['start', 'Left'], ['middle', 'Centre'], ['end', 'Right']];
const WEIGHTS = [['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold']];

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function button(cls, text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}

function row(label, control, hint) {
  const r = h('div', 'insp-row');
  r.appendChild(h('span', 'insp-label', label));
  r.appendChild(control);
  if (hint) r.appendChild(h('span', 'insp-hint', hint));
  return r;
}

function section(title) {
  const el = h('section', 'insp-section');
  if (title) el.appendChild(h('h3', 'insp-title', title));
  return el;
}

function num(value) {
  const v = Number(value);
  return Number.isFinite(v) ? v : 0;
}

function firstLine(text) {
  return String(text ?? '').split('\n')[0].trim();
}

export class Inspector {
  #el;
  #store;
  #catalog;
  #unsubs = [];
  #frame = 0;
  #destroyed = false;

  constructor(container, store, catalog) {
    this.#el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.#el) throw new Error('Inspector: container not found');
    this.#store = store;
    this.#catalog = catalog;

    this.#unsubs.push(store.on('change', (p) => { if (!p?.transient) this.#schedule(); }));
    this.#unsubs.push(store.on('selection', () => this.#schedule()));
    this.refresh();
  }

  destroy() {
    this.#destroyed = true;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    for (const off of this.#unsubs) off?.();
    this.#unsubs.length = 0;
    this.#el.textContent = '';
  }

  #schedule() {
    if (this.#destroyed || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (!this.#destroyed) this.refresh();
    });
  }

  refresh() {
    if (this.#destroyed) return;
    const host = this.#el;
    const scroll = host.scrollTop;
    const active = document.activeElement;
    const focusKey = active && host.contains(active) ? active.dataset?.ikey ?? null : null;
    const caret = focusKey && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd]
      : null;

    host.textContent = '';
    const objects = this.#store.selectedObjects();

    if (objects.length === 0) this.#renderDocument(host);
    else if (objects.length === 1) this.#renderSingle(host, objects[0]);
    else this.#renderMultiple(host, objects);

    host.scrollTop = scroll;
    if (focusKey) {
      const next = host.querySelector(`[data-ikey="${CSS.escape(focusKey)}"]`);
      if (next) {
        next.focus();
        if (caret && typeof next.setSelectionRange === 'function') {
          try { next.setSelectionRange(caret[0], caret[1]); } catch { /* unsupported input type */ }
        }
      }
    }
  }

  // --- edit plumbing --------------------------------------------------------

  #set(id, patch, label) {
    this.#store.updateObject(id, patch, label);
  }

  #setDoc(label, fn) {
    this.#store.transact(label, fn);
  }

  #tag(el, key) {
    if (key) el.dataset.ikey = key;
    return el;
  }

  #text(key, value, commit, { placeholder = '', multiline = false, rows = 2 } = {}) {
    const el = document.createElement(multiline ? 'textarea' : 'input');
    el.className = multiline ? 'insp-input insp-area' : 'insp-input';
    if (multiline) el.rows = rows;
    else el.type = 'text';
    el.value = value ?? '';
    if (placeholder) el.placeholder = placeholder;
    el.addEventListener('change', () => commit(el.value));
    if (!multiline) {
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') el.blur(); });
    }
    return this.#tag(el, key);
  }

  #number(key, value, commit, { min, max, step = 1, suffix } = {}) {
    const el = document.createElement('input');
    el.type = 'number';
    el.className = 'insp-input insp-num';
    if (min != null) el.min = String(min);
    if (max != null) el.max = String(max);
    el.step = String(step);
    el.value = String(num(value));
    if (suffix) el.title = suffix;
    const apply = () => {
      const raw = el.value.trim();
      let v = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(v)) { el.value = String(num(value)); return; }
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      el.value = String(v);
      commit(v);
    };
    el.addEventListener('change', apply);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') el.blur(); });
    return this.#tag(el, key);
  }

  #select(key, value, options, commit) {
    const el = document.createElement('select');
    el.className = 'insp-input';
    for (const [v, label] of options) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = label;
      el.appendChild(opt);
    }
    el.value = String(value);
    el.addEventListener('change', () => commit(el.value));
    return this.#tag(el, key);
  }

  #check(key, value, commit) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'insp-check';
    el.checked = !!value;
    el.addEventListener('change', () => commit(el.checked));
    return this.#tag(el, key);
  }

  #color(key, value, commit) {
    const el = document.createElement('input');
    el.type = 'color';
    el.className = 'insp-input insp-color';
    el.value = value ?? '#000000';
    el.addEventListener('change', () => commit(el.value));
    return this.#tag(el, key);
  }

  /** Range plus live readout; the model is only touched on `change`. */
  #range(key, value, commit, { min = 0, max = 1, step = 0.01, digits = 2 } = {}) {
    const wrap = h('div', 'insp-range');
    const el = document.createElement('input');
    el.type = 'range';
    el.min = String(min);
    el.max = String(max);
    el.step = String(step);
    el.value = String(num(value));
    const readout = h('span', 'insp-readout', num(value).toFixed(digits));
    el.addEventListener('input', () => { readout.textContent = Number(el.value).toFixed(digits); });
    el.addEventListener('change', () => commit(Number(el.value)));
    wrap.append(this.#tag(el, key), readout);
    return wrap;
  }

  #xy(obj, keys = ['x', 'y'], label = 'Edit position') {
    const pair = h('div', 'insp-pair');
    for (const k of keys) {
      const cell = h('div', 'insp-cell');
      cell.appendChild(h('span', 'insp-sub', k.toUpperCase()));
      cell.appendChild(this.#number(`${obj.id}.${k}`, obj[k], (v) => this.#set(obj.id, { [k]: v }, label), { step: 1 }));
      pair.appendChild(cell);
    }
    return pair;
  }

  #actions(ids) {
    const bar = h('div', 'insp-actions');
    const dup = button('insp-btn', 'Duplicate');
    dup.addEventListener('click', () => this.#store.duplicate(ids));
    const del = button('insp-btn insp-btn-danger', 'Delete');
    del.addEventListener('click', () => this.#store.removeObjects(ids, 'Delete'));
    bar.append(dup, del);
    return bar;
  }

  // --- document -------------------------------------------------------------

  #renderDocument(host) {
    const doc = this.#store.doc;

    host.appendChild(h('div', 'insp-empty', 'Nothing selected — document properties'));

    const title = section('Title');
    title.append(
      row('Visible', this.#check('doc.title.visible', doc.title.visible, (v) => this.#setDoc('Title visibility', (d) => { d.title.visible = v; }))),
      row('Text', this.#text('doc.title.text', doc.title.text, (v) => this.#setDoc('Edit title', (d) => { d.title.text = v; }))),
      row('Size', this.#number('doc.title.size', doc.title.size, (v) => this.#setDoc('Title size', (d) => { d.title.size = v; }), { min: 2, max: 60, step: 0.5 }), 'mm'),
      row('Position', this.#docXY('title')),
    );

    const note = section('Note box');
    note.append(
      row('Visible', this.#check('doc.note.visible', doc.note.visible, (v) => this.#setDoc('Note visibility', (d) => { d.note.visible = v; }))),
      row('Text', this.#text('doc.note.text', doc.note.text, (v) => this.#setDoc('Edit note', (d) => { d.note.text = v; }), { multiline: true, placeholder: 'Connector: JST GH 1.25mm, 6-Pin (Both Ends)' })),
      row('Position', this.#docXY('note')),
      row('Size', this.#docWH('note')),
    );

    const sheet = section('Sheet');
    sheet.append(
      row('Width', this.#number('doc.sheet.w', doc.sheet.w, (v) => this.#setDoc('Sheet size', (d) => { d.sheet.w = v; }), { min: 20, max: 2000, step: 10 }), 'mm'),
      row('Height', this.#number('doc.sheet.h', doc.sheet.h, (v) => this.#setDoc('Sheet size', (d) => { d.sheet.h = v; }), { min: 20, max: 2000, step: 10 }), 'mm'),
      row('Background', this.#color('doc.sheet.bg', doc.sheet.bg, (v) => this.#setDoc('Sheet background', (d) => { d.sheet.bg = v; }))),
    );

    const view = section('Drawing');
    view.append(
      row('Wire scale', this.#number('doc.view.wireScale', doc.view.wireScale, (v) => this.#setDoc('Wire scale', (d) => { d.view.wireScale = v; }), { min: 1, max: 30, step: 0.5 }), '× AWG ⌀'),
      row('Grid', this.#number('doc.view.grid', doc.view.grid, (v) => this.#setDoc('Grid step', (d) => { d.view.grid = v; }), { min: 0.5, max: 50, step: 0.5 }), 'mm'),
      row('Show grid', this.#check('doc.view.showGrid', doc.view.showGrid, (v) => this.#setDoc('Show grid', (d) => { d.view.showGrid = v; }))),
      row('Snap', this.#check('doc.view.snap', doc.view.snap, (v) => this.#setDoc('Snap to grid', (d) => { d.view.snap = v; }))),
    );

    host.append(title, note, sheet, view);
  }

  #docXY(part) {
    const doc = this.#store.doc;
    const pair = h('div', 'insp-pair');
    for (const k of ['x', 'y']) {
      const cell = h('div', 'insp-cell');
      cell.appendChild(h('span', 'insp-sub', k.toUpperCase()));
      cell.appendChild(this.#number(`doc.${part}.${k}`, doc[part][k], (v) => this.#setDoc('Move', (d) => { d[part][k] = v; }), { step: 1 }));
      pair.appendChild(cell);
    }
    return pair;
  }

  #docWH(part) {
    const doc = this.#store.doc;
    const pair = h('div', 'insp-pair');
    for (const k of ['w', 'h']) {
      const cell = h('div', 'insp-cell');
      cell.appendChild(h('span', 'insp-sub', k.toUpperCase()));
      cell.appendChild(this.#number(`doc.${part}.${k}`, doc[part][k], (v) => this.#setDoc('Resize', (d) => { d[part][k] = v; }), { min: 1, step: 1 }));
      pair.appendChild(cell);
    }
    return pair;
  }

  // --- single object --------------------------------------------------------

  #renderSingle(host, obj) {
    if (obj.kind === 'connector') this.#renderConnector(host, obj);
    else if (obj.kind === 'wire') this.#renderWire(host, obj);
    else this.#renderAnnotation(host, obj);
    host.appendChild(this.#actions([obj.id]));
  }

  #families() {
    try { return this.#catalog.familyList(); } catch { return []; }
  }

  #familyInfo(id) {
    return this.#families().find((f) => f.id === id) ?? null;
  }

  #connectorTitle(c, index) {
    const first = firstLine(c.label);
    if (first) return first;
    const info = this.#familyInfo(c.family);
    return `${info?.name ?? c.family} ${c.pins}P #${index + 1}`;
  }

  #renderConnector(host, c) {
    const info = this.#familyInfo(c.family);
    const families = this.#families();

    const head = section('Connector');
    head.append(
      row('Family', this.#select(`${c.id}.family`, c.family, families.map((f) => [f.id, `${f.name} — ${f.pitch} mm`]), (v) => {
        let pins = c.pins;
        try { pins = this.#catalog.clampPins(v, c.pins); } catch { /* keep */ }
        this.#set(c.id, { family: v, pins }, 'Change family');
      })),
      row('Pins', this.#number(`${c.id}.pins`, c.pins, (v) => {
        let pins = Math.round(v);
        try { pins = this.#catalog.clampPins(c.family, pins); } catch { /* keep */ }
        const pinNames = (c.pinNames ?? []).slice(0, pins);
        this.#set(c.id, { pins, pinNames }, 'Pin count');
      }, { min: info?.minPins ?? 1, max: info?.maxPins ?? 40, step: 1 }), info ? `${info.minPins}–${info.maxPins}` : ''),
      row('View', this.#select(`${c.id}.view`, c.view, [['top', 'Top'], ['bottom', 'Bottom']], (v) => this.#set(c.id, { view: v }, 'Connector view'))),
      row('Reverse pins', this.#check(`${c.id}.reversePins`, c.reversePins, (v) => this.#set(c.id, { reversePins: v }, 'Reverse pins'))),
    );

    const place = section('Placement');
    const rotRow = h('div', 'insp-inline');
    rotRow.appendChild(this.#number(`${c.id}.rot`, c.rot, (v) => this.#set(c.id, { rot: v }, 'Rotate'), { step: 15 }));
    for (const [delta, text] of [[-90, '↺'], [90, '↻']]) {
      const b = button('insp-icon-btn', text);
      b.title = `Rotate ${delta > 0 ? '+' : ''}${delta}°`;
      b.addEventListener('click', () => this.#set(c.id, { rot: (((c.rot + delta) % 360) + 360) % 360 }, 'Rotate'));
      rotRow.appendChild(b);
    }
    place.append(
      row('Position', this.#xy(c, ['x', 'y'], 'Move connector')),
      row('Rotation', rotRow, '°'),
      row('Scale', this.#number(`${c.id}.scale`, c.scale, (v) => this.#set(c.id, { scale: v }, 'Connector scale'), { min: 0.5, max: 12, step: 0.25 }), '×'),
    );

    const annot = section('Annotation');
    annot.append(
      row('Label', this.#text(`${c.id}.label`, c.label, (v) => this.#set(c.id, { label: v }, 'Connector label'), { multiline: true, rows: 2, placeholder: 'JST GH 1.25mm\n6-Pin Connector' })),
      row('Label pos', this.#select(`${c.id}.labelPos`, c.labelPos, [['above', 'Above'], ['below', 'Below'], ['none', 'Hidden']], (v) => this.#set(c.id, { labelPos: v }, 'Label position'))),
      row('Legend', this.#select(`${c.id}.legend`, c.legend, [['none', 'None'], ['left', 'Left'], ['right', 'Right']], (v) => this.#set(c.id, { legend: v }, 'Legend side'))),
    );

    const pins = section('Pin names');
    const list = h('div', 'insp-pins');
    for (let i = 0; i < c.pins; i++) {
      const line = h('div', 'insp-pin-row');
      line.appendChild(h('span', 'insp-pin-no', String(i + 1)));
      const auto = this.#store.wiresAt(c.id, i + 1)[0]?.colorName ?? '';
      line.appendChild(this.#text(`${c.id}.pinNames.${i}`, c.pinNames?.[i] ?? '', (v) => {
        const next = (c.pinNames ?? []).slice();
        while (next.length < c.pins) next.push('');
        next[i] = v;
        this.#set(c.id, { pinNames: next }, 'Pin name');
      }, { placeholder: auto || `Pin ${i + 1}` }));
      list.appendChild(line);
    }
    pins.appendChild(list);
    pins.appendChild(h('div', 'insp-hint', 'Empty names fall back to the wire colour.'));

    host.append(head, place, annot, pins);
  }

  #renderWire(host, w) {
    const colors = this.#catalog?.WIRE_COLORS ?? [];
    let awgs = [];
    try { awgs = this.#catalog.awgList(); } catch { awgs = []; }

    const look = section('Wire');
    const swatches = h('div', 'insp-swatches');
    for (const c of colors) {
      const b = button('insp-swatch', '');
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.style.setProperty('--swatch', c.hex);
      b.setAttribute('aria-pressed', String(c.hex).toLowerCase() === String(w.color).toLowerCase() ? 'true' : 'false');
      b.addEventListener('click', () => this.#set(w.id, { color: c.hex, colorName: c.name }, 'Wire colour'));
      swatches.appendChild(b);
    }
    look.append(
      row('Colour', swatches),
      row('Custom', this.#color(`${w.id}.color`, w.color, (v) => this.#set(w.id, { color: v }, 'Wire colour'))),
      row('Name', this.#text(`${w.id}.colorName`, w.colorName, (v) => this.#set(w.id, { colorName: v }, 'Wire colour name'))),
      row('Gauge', this.#select(`${w.id}.awg`, w.awg, awgs.map((n) => [n, this.#catalog.AWG?.[n]?.od ? `AWG ${n} — ${this.#catalog.AWG[n].od} mm` : `AWG ${n}`]), (v) => this.#set(w.id, { awg: Number(v) }, 'Wire gauge'))),
      row('Bow', this.#range(`${w.id}.bow`, w.bow, (v) => this.#set(w.id, { bow: v }, 'Wire bow'), { min: 0.05, max: 1.5, step: 0.05 })),
    );

    const ends = section('Endpoints');
    const connectors = this.#store.doc.connectors;
    const options = connectors.map((c, i) => [c.id, this.#connectorTitle(c, i)]);
    for (const side of ['a', 'b']) {
      const ep = w[side];
      const target = this.#store.connector(ep.connector);
      const line = h('div', 'insp-inline');
      line.appendChild(this.#select(`${w.id}.${side}.connector`, ep.connector ?? '', options, (v) => {
        const next = this.#store.connector(v);
        const pin = next ? Math.min(ep.pin, next.pins) : ep.pin;
        this.#set(w.id, { [side]: { connector: v, pin } }, 'Wire endpoint');
      }));
      line.appendChild(this.#number(`${w.id}.${side}.pin`, ep.pin, (v) => {
        const pin = Math.round(v);
        this.#set(w.id, { [side]: { pin } }, 'Wire endpoint');
      }, { min: 1, max: target?.pins ?? 64, step: 1 }));
      ends.appendChild(row(side === 'a' ? 'From' : 'To', line));
    }
    const swapBar = h('div', 'insp-actions');
    const swap = button('insp-btn', 'Swap ends');
    swap.addEventListener('click', () => this.#set(w.id, { a: { ...w.b }, b: { ...w.a } }, 'Swap wire ends'));
    swapBar.appendChild(swap);
    ends.appendChild(swapBar);

    host.append(look, ends);
  }

  #renderAnnotation(host, a) {
    if (a.kind === 'dimension') {
      const s = section('Dimension');
      s.append(
        row('Text', this.#text(`${a.id}.text`, a.text, (v) => this.#set(a.id, { text: v }, 'Dimension text'), { placeholder: 'Cable Length: 150mm' })),
        row('Value', this.#number(`${a.id}.value`, a.value, (v) => this.#set(a.id, { value: v }, 'Dimension value'), { min: 0, step: 1 }), 'mm'),
        row('Offset', this.#number(`${a.id}.offset`, a.offset, (v) => this.#set(a.id, { offset: v }, 'Dimension offset'), { step: 1 }), 'mm'),
        row('Start', this.#xy(a, ['x', 'y'], 'Move dimension')),
        row('End', this.#xy(a, ['x2', 'y2'], 'Move dimension')),
      );
      host.appendChild(s);
      return;
    }

    if (a.kind === 'note') {
      const s = section('Note');
      s.append(
        row('Text', this.#text(`${a.id}.text`, a.text, (v) => this.#set(a.id, { text: v }, 'Note text'), { multiline: true, rows: 3 })),
        row('Size', this.#number(`${a.id}.size`, a.size, (v) => this.#set(a.id, { size: v }, 'Note size'), { min: 1, max: 40, step: 0.5 }), 'mm'),
        row('Position', this.#xy(a, ['x', 'y'], 'Move note')),
        row('Box', this.#whOf(a)),
      );
      host.appendChild(s);
      return;
    }

    const s = section('Text');
    s.append(
      row('Text', this.#text(`${a.id}.text`, a.text, (v) => this.#set(a.id, { text: v }, 'Edit text'), { multiline: true, rows: 3 })),
      row('Size', this.#number(`${a.id}.size`, a.size, (v) => this.#set(a.id, { size: v }, 'Text size'), { min: 1, max: 60, step: 0.5 }), 'mm'),
      row('Align', this.#select(`${a.id}.align`, a.align, ALIGNS, (v) => this.#set(a.id, { align: v }, 'Text align'))),
      row('Weight', this.#select(`${a.id}.weight`, String(a.weight), WEIGHTS, (v) => this.#set(a.id, { weight: Number(v) }, 'Text weight'))),
      row('Colour', this.#color(`${a.id}.color`, a.color, (v) => this.#set(a.id, { color: v }, 'Text colour'))),
      row('Position', this.#xy(a, ['x', 'y'], 'Move text')),
    );
    host.appendChild(s);
  }

  #whOf(obj) {
    const pair = h('div', 'insp-pair');
    for (const k of ['w', 'h']) {
      const cell = h('div', 'insp-cell');
      cell.appendChild(h('span', 'insp-sub', k.toUpperCase()));
      cell.appendChild(this.#number(`${obj.id}.${k}`, obj[k], (v) => this.#set(obj.id, { [k]: v }, 'Resize'), { min: 1, step: 1 }));
      pair.appendChild(cell);
    }
    return pair;
  }

  // --- multiple -------------------------------------------------------------

  #renderMultiple(host, objects) {
    const counts = new Map();
    for (const o of objects) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);

    const s = section(`${objects.length} objects selected`);
    const list = h('div', 'insp-counts');
    for (const [kind, n] of counts) {
      const line = h('div', 'insp-count-row');
      line.appendChild(h('span', 'insp-label', `${kind}${n > 1 ? 's' : ''}`));
      line.appendChild(h('span', 'insp-readout', String(n)));
      list.appendChild(line);
    }
    s.appendChild(list);

    const ids = objects.map((o) => o.id);
    const connectors = objects.filter((o) => o.kind === 'connector');
    const wires = objects.filter((o) => o.kind === 'wire');

    if (connectors.length) {
      const bar = h('div', 'insp-inline');
      for (const [delta, text] of [[-90, 'Rotate −90°'], [90, 'Rotate +90°']]) {
        const b = button('insp-btn', text);
        b.addEventListener('click', () => {
          for (const c of connectors) this.#set(c.id, { rot: (((c.rot + delta) % 360) + 360) % 360 }, 'Rotate');
        });
        bar.appendChild(b);
      }
      s.appendChild(row('Connectors', bar));
    }

    if (wires.length) {
      const colors = this.#catalog?.WIRE_COLORS ?? [];
      const swatches = h('div', 'insp-swatches');
      for (const c of colors) {
        const b = button('insp-swatch', '');
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.style.setProperty('--swatch', c.hex);
        b.addEventListener('click', () => {
          for (const w of wires) this.#set(w.id, { color: c.hex, colorName: c.name }, 'Wire colour');
        });
        swatches.appendChild(b);
      }
      s.appendChild(row('Wire colour', swatches));
    }

    host.append(s, this.#actions(ids));
  }
}
