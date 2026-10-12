// Main toolbar: inline 16px SVG icons, no external assets.

const PX_PER_MM = 96 / 25.4;

const ICONS = {
  new: '<path d="M9.1 1.6H4.2A1.2 1.2 0 0 0 3 2.8v10.4a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.5z"/><path d="M9.1 1.6v3.9H13"/>',
  open: '<path d="M1.8 12.6V3.9c0-.5.4-.9.9-.9h3.1l1.4 1.7h6.1c.5 0 .9.4.9.9v7c0 .5-.4.9-.9.9H2.7a.9.9 0 0 1-.9-.9z"/>',
  save: '<path d="M2.6 3.3c0-.4.3-.8.8-.8h8L13.4 4.9v7.8c0 .4-.4.8-.8.8H3.4a.8.8 0 0 1-.8-.8z"/><path d="M5.2 2.5v3.9h5.6V2.5"/><path d="M4.6 13.5V9.3h6.8v4.2"/>',
  undo: '<path d="M3.1 7.6h6.6a3.6 3.6 0 1 1 0 7.2"/><path d="M5.8 4.6 2.6 7.6l3.2 3"/>',
  redo: '<path d="M12.9 7.6H6.3a3.6 3.6 0 1 0 0 7.2"/><path d="M10.2 4.6l3.2 3-3.2 3"/>',
  cut: '<path d="M4.3 2.4 11.4 12.1"/><path d="M11.7 2.4 4.6 12.1"/><circle cx="3.5" cy="12.3" r="1.9"/><circle cx="12.5" cy="12.3" r="1.9"/>',
  copy: '<rect x="5.6" y="5.6" width="8.1" height="8.1" rx="1.2"/><path d="M10.6 3.4V2.8c0-.7-.5-1.2-1.2-1.2H3.5c-.7 0-1.2.5-1.2 1.2v5.9c0 .7.5 1.2 1.2 1.2h.6"/>',
  paste: '<path d="M5.7 2.6H4.2c-.7 0-1.2.5-1.2 1.2v9.1c0 .7.5 1.2 1.2 1.2h7.6c.7 0 1.2-.5 1.2-1.2V3.8c0-.7-.5-1.2-1.2-1.2h-1.5"/><rect x="5.7" y="1.3" width="4.6" height="2.6" rx="0.8"/>',
  delete: '<path d="M2.6 4.2h10.8"/><path d="M6.3 4.2V2.9c0-.4.3-.7.7-.7h2c.4 0 .7.3.7.7v1.3"/><path d="M4 4.2l.6 8.7c0 .6.5 1 1 1h4.8c.6 0 1-.4 1-1l.6-8.7"/><path d="M6.5 6.5v5.2M9.5 6.5v5.2"/>',
  addConnector: '<rect x="1.8" y="3.6" width="6.2" height="8.8" rx="1.1"/><path d="M8 5.6h6M8 8h6M8 10.4h6"/>',
  addWire: '<path d="M1.6 12.4c0-4 3.2-4 6.4-4s6.4 0 6.4-4"/><circle cx="1.8" cy="12.4" r="1.2"/><circle cx="14.2" cy="4.4" r="1.2"/>',
  addText: '<path d="M3 4.3V2.6h10v1.7"/><path d="M8 2.6v10.8"/><path d="M5.6 13.4h4.8"/>',
  addDimension: '<path d="M2.6 8h10.8"/><path d="M4.8 6 2.6 8l2.2 2"/><path d="M11.2 6l2.2 2-2.2 2"/><path d="M2.6 3.6v8.8M13.4 3.6v8.8"/>',
  zoomOut: '<circle cx="6.9" cy="6.9" r="4.7"/><path d="M10.3 10.3 14 14"/><path d="M4.8 6.9h4.2"/>',
  zoomIn: '<circle cx="6.9" cy="6.9" r="4.7"/><path d="M10.3 10.3 14 14"/><path d="M4.8 6.9h4.2M6.9 4.8v4.2"/>',
  zoomFit: '<path d="M2.2 6V3.4c0-.7.5-1.2 1.2-1.2H6"/><path d="M13.8 6V3.4c0-.7-.5-1.2-1.2-1.2H10"/><path d="M2.2 10v2.6c0 .7.5 1.2 1.2 1.2H6"/><path d="M13.8 10v2.6c0 .7-.5 1.2-1.2 1.2H10"/><rect x="5.4" y="5.4" width="5.2" height="5.2" rx="0.8"/>',
  toggleGrid: '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.1"/><path d="M6.1 2.2v11.6M9.9 2.2v11.6M2.2 6.1h11.6M2.2 9.9h11.6"/>',
  toggleSnap: '<path d="M4 13.4V7.2a4 4 0 0 1 8 0v6.2"/><path d="M4 10.1h3.1M8.9 10.1H12"/><path d="M4 13.4h3.1M8.9 13.4H12"/>',
  exportSvg: '<path d="M8 1.8v7.6"/><path d="M5.1 6.6 8 9.5l2.9-2.9"/><path d="M2.4 11.1v1.6c0 .7.5 1.2 1.2 1.2h8.8c.7 0 1.2-.5 1.2-1.2v-1.6"/>',
  exportPng: '<path d="M8 1.8v7.6"/><path d="M5.1 6.6 8 9.5l2.9-2.9"/><path d="M2.4 11.1v1.6c0 .7.5 1.2 1.2 1.2h8.8c.7 0 1.2-.5 1.2-1.2v-1.6"/>',
};

const SPEC = [
  { name: 'new', title: 'New document', accel: 'Ctrl+N' },
  { name: 'open', title: 'Open document', accel: 'Ctrl+O' },
  { name: 'save', title: 'Save document', accel: 'Ctrl+S' },
  '|',
  { name: 'undo', title: 'Undo', accel: 'Ctrl+Z' },
  { name: 'redo', title: 'Redo', accel: 'Ctrl+Shift+Z' },
  '|',
  { name: 'cut', title: 'Cut', accel: 'Ctrl+X' },
  { name: 'copy', title: 'Copy', accel: 'Ctrl+C' },
  { name: 'paste', title: 'Paste', accel: 'Ctrl+V' },
  { name: 'delete', title: 'Delete', accel: 'Del' },
  '|',
  { name: 'addConnector', label: 'Connector', title: 'Add a connector' },
  { name: 'addWire', label: 'Wire', title: 'Draw wires between pins', toggle: true },
  { name: 'addText', title: 'Add a text label' },
  { name: 'addDimension', title: 'Add a dimension' },
  '|',
  { name: 'zoomOut', title: 'Zoom out' },
  { name: 'zoomFit', title: 'Fit the sheet', accel: 'Ctrl+0' },
  { name: 'zoomIn', title: 'Zoom in' },
  { name: 'zoom-readout' },
  { name: 'toggleGrid', title: 'Show grid', toggle: true },
  { name: 'toggleSnap', title: 'Snap to grid', toggle: true },
  '>',
  { name: 'exportSvg', label: 'SVG', title: 'Export as SVG' },
  { name: 'exportPng', label: 'PNG', title: 'Export as PNG' },
];

let mounted = null;

function svgIcon(name) {
  const inner = ICONS[name];
  if (!inner) return '';
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function makeButton(spec, actions) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tb-btn';
  btn.dataset.action = spec.name;
  const tip = spec.accel ? `${spec.title} (${spec.accel})` : spec.title;
  btn.title = tip ?? spec.label ?? spec.name;
  btn.setAttribute('aria-label', spec.title ?? spec.label ?? spec.name);
  btn.innerHTML = svgIcon(spec.name);
  if (spec.label) {
    const span = document.createElement('span');
    span.className = 'tb-label';
    span.textContent = spec.label;
    btn.appendChild(span);
  }
  if (spec.toggle) btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    btn.blur();
    // No argument: an action's first parameter is a world point in mm (the
    // context menu passes one), so handing it a MouseEvent places objects at
    // client pixel coordinates.
    actions?.[spec.name]?.();
  });
  return btn;
}

export function buildToolbar(container, actions = {}) {
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (!host) throw new Error('buildToolbar: container not found');

  host.classList.add('toolbar');
  host.textContent = '';

  const buttons = new Map();
  let zoomEl = null;

  for (const spec of SPEC) {
    if (spec === '|') {
      const sep = document.createElement('div');
      sep.className = 'tb-sep';
      host.appendChild(sep);
      continue;
    }
    if (spec === '>') {
      const spacer = document.createElement('div');
      spacer.className = 'tb-spacer';
      host.appendChild(spacer);
      continue;
    }
    if (spec.name === 'zoom-readout') {
      zoomEl = document.createElement('span');
      zoomEl.className = 'tb-zoom';
      zoomEl.textContent = '100%';
      zoomEl.title = 'Current zoom';
      host.appendChild(zoomEl);
      continue;
    }
    const btn = makeButton(spec, actions);
    buttons.set(spec.name, btn);
    host.appendChild(btn);
  }

  mounted = { host, buttons, zoomEl };
  updateToolbar({});
  return buttons;
}

function setDisabled(name, disabled) {
  const btn = mounted.buttons.get(name);
  if (btn) btn.disabled = !!disabled;
}

function setPressed(name, pressed) {
  const btn = mounted.buttons.get(name);
  if (btn) btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

export function updateToolbar(state = {}) {
  if (!mounted) return;
  const { canUndo, canRedo, hasSelection, hasClipboard, mode, zoom } = state;

  setDisabled('undo', !canUndo);
  setDisabled('redo', !canRedo);
  setDisabled('cut', !hasSelection);
  setDisabled('copy', !hasSelection);
  setDisabled('delete', !hasSelection);
  setDisabled('paste', !hasClipboard);

  setPressed('addWire', mode === 'wire');
  if (state.showGrid !== undefined) setPressed('toggleGrid', state.showGrid);
  if (state.snap !== undefined) setPressed('toggleSnap', state.snap);

  const undoBtn = mounted.buttons.get('undo');
  if (undoBtn) undoBtn.title = canUndo && state.undoLabel ? `Undo ${state.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  const redoBtn = mounted.buttons.get('redo');
  if (redoBtn) redoBtn.title = canRedo && state.redoLabel ? `Redo ${state.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';

  if (mounted.zoomEl) {
    const pct = state.zoomPercent ?? (Number.isFinite(zoom) ? (zoom / PX_PER_MM) * 100 : null);
    if (pct != null) mounted.zoomEl.textContent = `${Math.round(pct)}%`;
  }
}
