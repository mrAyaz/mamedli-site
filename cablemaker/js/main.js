// Application wiring: store + renderer + interaction + UI chrome.

import { Store, createDocument, createConnector, createWire, createAnnotation } from './model.js';
import * as catalog from './catalog.js';
import { Renderer } from './render.js';
import { Interaction } from './interact.js';
import { buildToolbar, updateToolbar } from './ui/toolbar.js';
import { showContextMenu, hideContextMenu } from './ui/contextmenu.js';
import { connectorDialog, wireDialog, textDialog, confirmDialog, openDialog } from './ui/dialogs.js';
import { Inspector } from './ui/inspector.js';
import * as io from './io.js';

const AUTOSAVE_KEY = 'cablemaker.autosave.v1';
const PX_PER_MM = 96 / 25.4;

const el = {
  canvas: document.getElementById('canvas'),
  host: document.getElementById('canvas-host'),
  toolbar: document.getElementById('toolbar'),
  inspector: document.getElementById('inspector'),
  hint: document.getElementById('status-hint'),
  coords: document.getElementById('status-coords'),
  zoom: document.getElementById('status-zoom'),
};

const store = new Store(loadInitialDocument());
const renderer = new Renderer(el.canvas, store);
const inspector = new Inspector(el.inspector, store, catalog);

let lastWireSpec = { color: '#1a1a1a', colorName: 'Black', awg: 30 };

const interaction = new Interaction(renderer, store, {
  onContextMenu: handleContextMenu,
  onStatus: (text) => { el.hint.textContent = text; },
  onDoubleClick: handleDoubleClick,
  onWireFinished: () => syncToolbar(),
});

// --- actions ----------------------------------------------------------------

const actions = {
  async new() {
    if (store.canUndo && !(await confirmDialog('Discard the current drawing?', { danger: true }))) return;
    store.replaceDocument(createDocument());
    renderer.fitToSheet();
  },

  async open() {
    try {
      const picked = await io.openFile();
      if (!picked) return;
      store.replaceDocument(picked.doc);
      renderer.fitToSheet();
      el.hint.textContent = `Opened ${picked.name}`;
    } catch (err) {
      el.hint.textContent = `Open failed: ${err.message}`;
    }
  },

  save() {
    const base = (store.doc.title?.text || 'cable').trim().replace(/[^\w.-]+/g, '-').toLowerCase();
    io.saveFile(store.doc, base || 'cable');
  },

  undo: () => store.undo(),
  redo: () => store.redo(),
  cut: () => store.cut(),
  copy: () => store.copy(),
  paste: () => store.paste(),
  delete: () => store.removeObjects(store.selectedIds),

  async addConnector(at) {
    const last = store.doc.connectors.at(-1);
    const spec = await connectorDialog(
      {
        family: last?.family ?? 'jst-gh-1.25',
        pins: last?.pins ?? 6,
        view: 'top',
        scale: last?.scale ?? null,
      },
      catalog,
    );
    if (!spec) return;
    const pos = at ?? centreOfView();
    const id = store.addConnector(
      createConnector({ ...spec, scale: fitScale(spec), x: snap(pos.x), y: snap(pos.y), label: spec.label }),
    );
    store.select([id]);
  },

  async addWire() {
    if (interaction.mode === 'wire') {
      interaction.cancelTool();
      syncToolbar();
      return;
    }
    if (store.doc.connectors.length < 2) {
      el.hint.textContent = 'Add two connectors before drawing a cable';
      return;
    }
    const spec = await wireDialog(lastWireSpec, catalog);
    if (!spec) return;
    lastWireSpec = spec;
    interaction.armWireTool(spec);
    syncToolbar();
  },

  async addText(at) {
    const text = await textDialog('Add text', 'Text', 'Label');
    if (text == null) return;
    const pos = at ?? centreOfView();
    store.select([store.addAnnotation(createAnnotation({ kind: 'text', x: snap(pos.x), y: snap(pos.y), text }))]);
  },

  addDimension(at) {
    const pos = at ?? centreOfView();
    const span = Math.max(60, store.doc.sheet.w * 0.4);
    const x = snap(pos.x - span / 2);
    const y = snap(pos.y);
    store.select([
      store.addAnnotation(
        createAnnotation({ kind: 'dimension', x, y, x2: x + span, y2: y, value: 150, text: 'Cable Length: 150mm' }),
      ),
    ]);
  },

  zoomIn: () => renderer.zoomAt(hostCentre(), 1.25),
  zoomOut: () => renderer.zoomAt(hostCentre(), 1 / 1.25),
  zoomFit: () => renderer.fitToSheet(),

  toggleGrid() {
    store.transact('Toggle grid', (doc) => { doc.view.showGrid = !doc.view.showGrid; });
  },

  toggleSnap() {
    store.transact('Toggle snap', (doc) => { doc.view.snap = !doc.view.snap; });
  },

  exportSvg() {
    io.exportSVG(store, renderer, fileBase());
  },

  async exportPng() {
    const opts = await openDialog({
      title: 'Export PNG',
      submitLabel: 'Export',
      fields: [
        { key: 'scale', label: 'Resolution', type: 'select', value: 4, options: [
          { value: 2, label: '2 px/mm (~50 dpi)' },
          { value: 4, label: '4 px/mm (~100 dpi)' },
          { value: 8, label: '8 px/mm (~200 dpi)' },
          { value: 12, label: '12 px/mm (~300 dpi)' },
        ] },
        { key: 'transparent', label: 'Transparent background', type: 'checkbox', value: false },
      ],
    });
    if (!opts) return;
    try {
      await io.exportPNG(store, renderer, fileBase(), {
        scale: Number(opts.scale),
        background: opts.transparent ? null : store.doc.sheet.bg,
      });
    } catch (err) {
      el.hint.textContent = `PNG export failed: ${err.message}`;
    }
  },
};

buildToolbar(el.toolbar, actions);

// --- context menu -----------------------------------------------------------

function handleContextMenu(worldPt, clientPt, hit) {
  const sel = store.selectedIds;
  const onObject = hit && hit.kind !== 'pin';
  const items = [];

  if (onObject && !store.isSelected(hit.id)) store.select([hit.id]);

  items.push(
    { label: 'Add cable…', accel: 'W', action: () => actions.addWire() },
    { label: 'Add connector…', accel: 'K', action: () => actions.addConnector(worldPt) },
    {
      label: 'Add annotation',
      items: [
        { label: 'Text…', action: () => actions.addText(worldPt) },
        { label: 'Dimension line', action: () => actions.addDimension(worldPt) },
      ],
    },
    '-',
  );

  const wire = hit?.kind === 'wire' ? store.wire(hit.id) : null;
  if (wire) {
    items.push(
      {
        label: 'Edit cable…',
        action: async () => {
          const spec = await wireDialog({ color: wire.color, colorName: wire.colorName, awg: wire.awg }, catalog);
          if (spec) store.updateObject(wire.id, spec, 'Edit cable');
        },
      },
      {
        label: 'Swap ends',
        action: () => store.updateObject(wire.id, { a: { ...wire.b }, b: { ...wire.a } }, 'Swap ends'),
      },
      '-',
    );
  }

  const conn = hit?.kind === 'connector' ? store.connector(hit.id) : null;
  if (conn) {
    items.push(
      { label: 'Rotate 90°', accel: 'R', action: () => rotate(conn.id, 90) },
      { label: 'Rotate -90°', accel: 'Shift+R', action: () => rotate(conn.id, -90) },
      {
        label: conn.view === 'top' ? 'Show bottom view' : 'Show top view',
        action: () => store.updateObject(conn.id, { view: conn.view === 'top' ? 'bottom' : 'top' }, 'Flip view'),
      },
      {
        label: 'Reverse pin order',
        action: () => store.updateObject(conn.id, { reversePins: !conn.reversePins }, 'Reverse pins'),
      },
      '-',
    );
  }

  items.push(
    { label: 'Cut', accel: 'Ctrl+X', disabled: !sel.length, action: actions.cut },
    { label: 'Copy', accel: 'Ctrl+C', disabled: !sel.length, action: actions.copy },
    { label: 'Paste', accel: 'Ctrl+V', disabled: !store.hasClipboard, action: actions.paste },
    { label: 'Duplicate', accel: 'Ctrl+D', disabled: !sel.length, action: () => store.duplicate() },
    '-',
    { label: 'Select all', accel: 'Ctrl+A', action: () => store.selectAll() },
    { label: 'Delete', accel: 'Del', disabled: !sel.length, danger: true, action: actions.delete },
    '-',
    { label: 'Fit to sheet', accel: 'Ctrl+0', action: actions.zoomFit },
  );

  showContextMenu(clientPt, items);
}

function rotate(id, delta) {
  const c = store.connector(id);
  if (c) store.updateObject(id, { rot: (((c.rot + delta) % 360) + 360) % 360 }, 'Rotate');
}

async function handleDoubleClick(hit) {
  if (!hit) return;
  if (hit.kind === 'title' || hit.kind === 'note') {
    const field = hit.kind === 'title' ? store.doc.title : store.doc.note;
    const text = await textDialog(hit.kind === 'title' ? 'Title' : 'Note', 'Text', field.text);
    if (text == null) return;
    store.transact('Edit text', (doc) => {
      const target = hit.kind === 'title' ? doc.title : doc.note;
      target.text = text;
      target.visible = text.trim().length > 0;
    });
    return;
  }
  const obj = store.object(hit.id);
  if (!obj) return;
  if (obj.kind === 'wire') {
    const spec = await wireDialog({ color: obj.color, colorName: obj.colorName, awg: obj.awg }, catalog);
    if (spec) store.updateObject(obj.id, spec, 'Edit cable');
  } else if (obj.kind === 'text' || obj.kind === 'note' || obj.kind === 'dimension') {
    const text = await textDialog('Edit', 'Text', obj.text ?? '');
    if (text != null) store.updateObject(obj.id, { text }, 'Edit text');
  }
}

// --- glue -------------------------------------------------------------------

/**
 * A family's default scale targets a readable pin pitch, which a high pin count
 * turns into a housing taller than the sheet. Shrink it just enough to fit.
 */
function fitScale(spec) {
  const probe = createConnector({ ...spec, scale: spec.scale ?? null, x: 0, y: 0, rot: 0 });
  try {
    const { bodyH } = catalog.geom(probe);
    const limit = store.doc.sheet.h * 0.78;
    if (!Number.isFinite(bodyH) || bodyH <= limit) return probe.scale;
    const effective = catalog.geom(probe).pitch / catalog.family(probe.family).pitch;
    return Math.max(0.5, Math.round((effective * limit / bodyH) * 20) / 20);
  } catch {
    return probe.scale;
  }
}

function snap(v) {
  const { grid, snap: on } = store.doc.view;
  return on && grid ? Math.round(v / grid) * grid : v;
}

function hostCentre() {
  const r = el.host.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function centreOfView() {
  return renderer.clientToWorld(hostCentre());
}

function fileBase() {
  const base = (store.doc.title?.text || 'cable').trim().replace(/[^\w.-]+/g, '-').toLowerCase();
  return base || 'cable';
}

function syncToolbar() {
  const view = renderer.getView();
  updateToolbar({
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    hasSelection: store.selection.size > 0,
    hasClipboard: store.hasClipboard,
    mode: interaction.mode,
    showGrid: store.doc.view.showGrid,
    snap: store.doc.view.snap,
    zoom: view.zoom,
  });
  el.zoom.textContent = `${Math.round((view.zoom / PX_PER_MM) * 100)}%`;
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, io.serialize(store.doc));
    } catch { /* quota or private mode - autosave is a convenience, not a contract */ }
  }, 600);
}

store.on('change', ({ transient }) => {
  renderer.render();
  if (!transient) {
    inspector.refresh();
    syncToolbar();
    scheduleAutosave();
  }
});
store.on('selection', () => { renderer.renderOverlay(); inspector.refresh(); syncToolbar(); });
store.on('history', syncToolbar);

el.host.addEventListener('pointermove', (e) => {
  const p = renderer.clientToWorld(e);
  el.coords.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)} mm`;
});

window.addEventListener('resize', () => renderer.render());
window.addEventListener('blur', hideContextMenu);

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLElement && (t.closest('input, textarea, select') || t.closest('dialog[open]'))) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); actions.save(); }
  else if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); actions.open(); }
  else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); actions.exportPng(); }
  else if (!ctrl && e.key.toLowerCase() === 'w') { e.preventDefault(); actions.addWire(); }
  else if (!ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); actions.addConnector(); }
});

// --- first run --------------------------------------------------------------

function loadInitialDocument() {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    try {
      return io.deserialize(saved);
    } catch { /* fall through to the demo */ }
  }
  return demoDocument();
}

/** The GNSS cable from samples/1.png, so the editor opens on something real. */
function demoDocument() {
  const doc = createDocument();
  doc.title = { text: 'GNSS Cable', x: 210, y: 32, size: 13, visible: true };
  doc.note = {
    text: 'Connector: JST GH 1.25mm, 6-Pin (Both Ends)',
    x: 210, y: 236, w: 170, h: 14, visible: true,
  };

  const left = createConnector({
    family: 'jst-gh-1.25', pins: 6, view: 'top',
    x: 100, y: 126, rot: 0,
    label: 'JST GH 1.25mm\n6-Pin Connector', labelPos: 'above', legend: 'left',
  });
  const right = createConnector({
    family: 'jst-gh-1.25', pins: 6, view: 'top',
    x: 320, y: 126, rot: 180, reversePins: true,
    label: 'JST GH 1.25mm\n6-Pin Connector', labelPos: 'above', legend: 'right',
  });
  doc.connectors.push(left, right);

  const strands = [
    ['Black', '#1a1a1a'],
    ['White', '#f2f2f2'],
    ['Blue', '#1f6fe0'],
    ['Green', '#1f9e52'],
    ['Yellow', '#f2c014'],
    ['Black', '#1a1a1a'],
  ];
  strands.forEach(([colorName, color], i) => {
    doc.wires.push(
      createWire({
        a: { connector: left.id, pin: i + 1 },
        b: { connector: right.id, pin: i + 1 },
        color, colorName, awg: 30, bow: 0.4,
      }),
    );
  });

  doc.annotations.push(
    createAnnotation({
      kind: 'dimension',
      x: 76, y: 200, x2: 344, y2: 200, offset: 0,
      value: 150, text: 'Cable Length: 150mm',
    }),
  );
  return doc;
}

renderer.render();
renderer.fitToSheet();
inspector.refresh();
syncToolbar();
el.host.focus();

window.cableMaker = { store, renderer, interaction, inspector, catalog, io, actions };
