// Modal dialogs. Every dialog is a real <dialog> appended to #overlay-layer:
// Esc cancels (resolve null), Enter submits, focus lands on the first field.

function layer() {
  let el = document.getElementById('overlay-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-layer';
    document.body.appendChild(el);
  }
  return el;
}

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function button(cls, text, type = 'button') {
  const b = document.createElement('button');
  b.type = type;
  b.className = cls;
  b.textContent = text;
  return b;
}

const FOCUSABLE = 'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button.dlg-focusable';

function focusFirst(root) {
  const el = root.querySelector(FOCUSABLE);
  if (!el) return false;
  el.focus();
  if (el.select && (el.type === 'text' || el.type === 'number' || el.tagName === 'TEXTAREA')) {
    try { el.select(); } catch { /* not selectable */ }
  }
  return true;
}

/**
 * `build(body, api)` fills the body and returns a collector; a collector that
 * returns undefined marks the form invalid and keeps the dialog open.
 */
function runDialog({ title, width = 360, submitLabel = 'OK', cancelLabel = 'Cancel', danger = false, build }) {
  return new Promise((resolve, reject) => {
    const dlg = document.createElement('dialog');
    dlg.className = danger ? 'dlg dlg-is-danger' : 'dlg';
    dlg.style.width = typeof width === 'number' ? `${width}px` : String(width);

    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'dlg-form';
    form.noValidate = true;

    const head = h('div', 'dlg-head');
    head.appendChild(h('h2', 'dlg-title', title ?? ''));

    const body = h('div', 'dlg-body');
    const foot = h('div', 'dlg-foot');
    const cancelBtn = button('dlg-btn', cancelLabel);
    const okBtn = button(danger ? 'dlg-btn dlg-primary dlg-danger' : 'dlg-btn dlg-primary', submitLabel, 'submit');
    foot.append(cancelBtn, okBtn);

    form.append(head, body, foot);
    dlg.appendChild(form);
    layer().appendChild(dlg);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dlg.addEventListener('close', () => dlg.remove(), { once: true });
      if (dlg.open) dlg.close();
      else dlg.remove();
      resolve(value);
    };

    const api = {
      submit: () => form.requestSubmit(),
      cancel: () => finish(null),
      okButton: okBtn,
      cancelButton: cancelBtn,
    };

    let collect = () => ({});
    try {
      const built = build?.(body, api);
      if (typeof built === 'function') collect = built;
    } catch (err) {
      // Without this the dialog is never shown and the promise stays pending.
      settled = true;
      dlg.remove();
      reject(err);
      return;
    }

    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      finish(null);
    });
    cancelBtn.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const value = collect();
      if (value === undefined) return;
      finish(value);
    });
    form.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        form.requestSubmit();
      }
    });

    dlg.showModal();
    // With no field to focus, showModal() would land on Cancel and Enter would
    // then resolve null instead of submitting.
    if (!focusFirst(body)) okBtn.focus();
  });
}

// --- generic fields ---------------------------------------------------------

function normalizeOptions(options = []) {
  return options.map((o) => {
    if (o == null) return { value: '', label: '' };
    if (typeof o === 'string' || typeof o === 'number') return { value: o, label: String(o) };
    const value = o.value ?? o.id ?? o.hex ?? '';
    const label = o.label ?? o.name ?? String(value);
    return { value, label, color: o.hex ?? o.color ?? null };
  });
}

function labelled(field, control, forId) {
  const row = h('div', 'dlg-row');
  if (field.label) {
    const lab = h('label', 'dlg-label', field.label);
    if (forId) lab.htmlFor = forId;
    row.appendChild(lab);
  }
  row.appendChild(control);
  if (field.hint) row.appendChild(h('div', 'dlg-hint', field.hint));
  return row;
}

let fieldSeq = 0;

function buildField(field) {
  const type = field.type ?? 'text';
  const id = `dlg-f-${++fieldSeq}`;

  if (type === 'checkbox') {
    const row = h('div', 'dlg-row dlg-row-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!field.value;
    const lab = h('label', 'dlg-check-label', field.label ?? '');
    lab.htmlFor = id;
    row.append(input, lab);
    if (field.hint) row.appendChild(h('div', 'dlg-hint', field.hint));
    return { row, get: () => input.checked };
  }

  if (type === 'select') {
    const sel = document.createElement('select');
    sel.className = 'dlg-input';
    sel.id = id;
    for (const o of normalizeOptions(field.options)) {
      const opt = document.createElement('option');
      opt.value = String(o.value);
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    if (field.value != null) sel.value = String(field.value);
    return { row: labelled(field, sel, id), get: () => sel.value };
  }

  if (type === 'textarea') {
    const ta = document.createElement('textarea');
    ta.className = 'dlg-input dlg-textarea';
    ta.id = id;
    ta.rows = field.rows ?? 3;
    ta.value = field.value ?? '';
    return { row: labelled(field, ta, id), get: () => ta.value };
  }

  if (type === 'swatch') {
    const opts = normalizeOptions(field.options);
    let current = field.value ?? opts[0]?.value ?? '';
    const grid = h('div', 'dlg-swatches');
    const buttons = [];
    const sync = () => {
      for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.value === String(current) ? 'true' : 'false');
    };
    for (const o of opts) {
      const b = button('dlg-swatch dlg-focusable', '');
      b.dataset.value = String(o.value);
      b.title = o.label;
      b.style.setProperty('--swatch', o.color ?? String(o.value));
      b.addEventListener('click', () => { current = o.value; sync(); });
      buttons.push(b);
      grid.appendChild(b);
    }
    sync();
    return { row: labelled(field, grid, null), get: () => current };
  }

  const input = document.createElement('input');
  input.className = 'dlg-input';
  input.id = id;
  input.type = type === 'number' ? 'number' : type === 'color' ? 'color' : 'text';
  if (type === 'number') {
    if (field.min != null) input.min = String(field.min);
    if (field.max != null) input.max = String(field.max);
    input.step = String(field.step ?? 1);
    input.value = String(field.value ?? 0);
  } else {
    input.value = field.value ?? '';
    if (field.placeholder) input.placeholder = field.placeholder;
  }
  const get = type === 'number'
    ? () => {
      const raw = input.value.trim();
      const v = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(v)) return Number(field.value) || 0;
      const lo = field.min != null ? Number(field.min) : -Infinity;
      const hi = field.max != null ? Number(field.max) : Infinity;
      return Math.min(hi, Math.max(lo, v));
    }
    : () => input.value;
  return { row: labelled(field, input, id), get };
}

export function openDialog({ title = '', fields = [], submitLabel = 'OK', width = 360 } = {}) {
  return runDialog({
    title,
    width,
    submitLabel,
    build(body) {
      const getters = [];
      for (const field of fields) {
        if (!field) continue;
        const { row, get } = buildField(field);
        body.appendChild(row);
        if (field.key) getters.push([field.key, get]);
      }
      return () => {
        const out = {};
        for (const [key, get] of getters) out[key] = get();
        return out;
      };
    },
  });
}

// --- colour helpers ---------------------------------------------------------

function parseHex(hex) {
  let s = String(hex ?? '').trim().replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-f]{6}$/i.test(s)) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

function toHex({ r, g, b }) {
  const p = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** amount > 0 lightens towards white, amount < 0 darkens towards black. */
function shade(hex, amount) {
  const c = parseHex(hex);
  const t = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return toHex({ r: c.r + (t - c.r) * k, g: c.g + (t - c.g) * k, b: c.b + (t - c.b) * k });
}

function sameHex(a, b) {
  return toHex(parseHex(a)) === toHex(parseHex(b));
}

// --- connector dialog -------------------------------------------------------

function previewConnector(conn, catalog) {
  let defs = '';
  try { defs = catalog.connectorDefs ? catalog.connectorDefs() : ''; } catch { defs = ''; }
  let markup = '';
  try { markup = catalog.drawConnector(conn); } catch { markup = ''; }
  return `<defs>${defs}</defs><g class="dlg-preview-content">${markup}</g>`;
}

function fitPreview(svg, conn, catalog) {
  const content = svg.querySelector('.dlg-preview-content');
  let box = null;
  try {
    const b = content?.getBBox();
    if (b && b.width > 0 && b.height > 0) box = { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch { box = null; }
  if (!box) {
    let g = null;
    try { g = catalog.geom(conn); } catch { g = null; }
    const w = g?.bodyW ?? 40;
    const hgt = g?.bodyH ?? 20;
    box = { x: -w / 2, y: -hgt / 2, w, h: hgt };
  }
  const pad = Math.max(2, Math.max(box.w, box.h) * 0.08);
  svg.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${box.w + 2 * pad} ${box.h + 2 * pad}`);
}

export function connectorDialog(defaults = {}, catalog) {
  const families = catalog.familyList();
  const fallbackFamily = families[0]?.id ?? 'jst-gh-1.25';

  const familyInfo = (id) => families.find((f) => f.id === id) ?? families[0] ?? null;

  const state = {
    family: families.some((f) => f.id === defaults.family) ? defaults.family : fallbackFamily,
    pins: Number(defaults.pins) || 6,
    view: defaults.view === 'bottom' ? 'bottom' : 'top',
    scale: 3,
    label: defaults.label ?? '',
  };
  state.pins = catalog.clampPins(state.family, state.pins);
  state.scale = Number(defaults.scale) > 0
    ? Number(defaults.scale)
    : (familyInfo(state.family)?.defaultScale ?? 3);

  const connFor = () => ({
    id: 'dlg-preview',
    kind: 'connector',
    family: state.family,
    pins: state.pins,
    view: state.view,
    x: 0,
    y: 0,
    rot: 0,
    scale: state.scale,
    reversePins: !!defaults.reversePins,
    label: '',
    labelPos: 'none',
    legend: 'none',
    pinNames: [],
  });

  const autoLabel = () => {
    try { return catalog.defaultLabel(connFor()); } catch { /* fall through */ }
    const info = familyInfo(state.family);
    return `${info?.name ?? state.family}\n${state.pins}-Pin Connector`;
  };

  return runDialog({
    title: defaults.id ? 'Connector' : 'Add Connector',
    width: 460,
    submitLabel: defaults.id ? 'Apply' : 'Add',
    build(body) {
      let labelDirty = !!state.label && state.label !== autoLabel();
      let scaleDirty = Number(defaults.scale) > 0;

      // family
      const familySel = document.createElement('select');
      familySel.className = 'dlg-input';
      for (const f of families) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${f.name} — ${f.pitch} mm`;
        familySel.appendChild(opt);
      }
      familySel.value = state.family;

      // pins
      const stepper = h('div', 'dlg-stepper');
      const minus = button('dlg-step-btn', '−');
      const pinsInput = document.createElement('input');
      pinsInput.type = 'number';
      pinsInput.className = 'dlg-input dlg-step-input';
      const plus = button('dlg-step-btn', '+');
      stepper.append(minus, pinsInput, plus);
      const pinsHint = h('div', 'dlg-hint', '');

      // view
      const viewGroup = h('div', 'dlg-segment');
      const viewButtons = [['top', 'Top view'], ['bottom', 'Bottom view']].map(([value, text]) => {
        const b = button('dlg-seg-btn dlg-focusable', text);
        b.dataset.value = value;
        return b;
      });
      viewGroup.append(...viewButtons);

      // scale
      const scaleInput = document.createElement('input');
      scaleInput.type = 'number';
      scaleInput.className = 'dlg-input';
      scaleInput.min = '0.5';
      scaleInput.max = '12';
      scaleInput.step = '0.25';

      // label
      const labelArea = document.createElement('textarea');
      labelArea.className = 'dlg-input dlg-textarea';
      labelArea.rows = 2;

      // preview
      const preview = h('div', 'dlg-preview');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('class', 'dlg-preview-svg');
      preview.appendChild(svg);
      const previewCaption = h('div', 'dlg-preview-caption', '');

      const sync = (opts = {}) => {
        const info = familyInfo(state.family);
        pinsInput.min = String(info?.minPins ?? 1);
        pinsInput.max = String(info?.maxPins ?? 40);
        pinsInput.step = '1';
        if (opts.pins !== false) pinsInput.value = String(state.pins);
        pinsHint.textContent = info ? `${info.minPins}–${info.maxPins} pins, ${info.pitch} mm pitch` : '';
        minus.disabled = state.pins <= (info?.minPins ?? 1);
        plus.disabled = state.pins >= (info?.maxPins ?? 40);
        familySel.value = state.family;
        for (const b of viewButtons) b.setAttribute('aria-pressed', b.dataset.value === state.view ? 'true' : 'false');
        if (opts.scale !== false) scaleInput.value = String(state.scale);
        if (!labelDirty) state.label = autoLabel();
        if (opts.label !== false) labelArea.value = state.label;

        const conn = connFor();
        svg.innerHTML = previewConnector(conn, catalog);
        fitPreview(svg, conn, catalog);
        previewCaption.textContent = `${info?.name ?? state.family} · ${state.pins}-pin · ${state.view} view · ×${state.scale}`;
      };

      const setPins = (n) => {
        state.pins = catalog.clampPins(state.family, Math.round(Number(n) || 0));
        sync();
      };

      familySel.addEventListener('change', () => {
        state.family = familySel.value;
        const info = familyInfo(state.family);
        if (!scaleDirty && info?.defaultScale) state.scale = info.defaultScale;
        state.pins = catalog.clampPins(state.family, state.pins);
        sync();
      });
      minus.addEventListener('click', () => setPins(state.pins - 1));
      plus.addEventListener('click', () => setPins(state.pins + 1));
      pinsInput.addEventListener('input', () => {
        const raw = Math.round(Number(pinsInput.value));
        if (!Number.isFinite(raw)) return;
        state.pins = catalog.clampPins(state.family, raw);
        sync({ pins: false });
      });
      pinsInput.addEventListener('change', () => setPins(pinsInput.value));
      for (const b of viewButtons) {
        b.addEventListener('click', () => { state.view = b.dataset.value; sync(); });
      }
      scaleInput.addEventListener('input', () => {
        const v = Number(scaleInput.value);
        if (!Number.isFinite(v) || v <= 0) return;
        scaleDirty = true;
        state.scale = Math.min(12, Math.max(0.5, v));
        sync({ scale: false });
      });
      labelArea.addEventListener('input', () => {
        labelDirty = true;
        state.label = labelArea.value;
        sync({ label: false });
      });
      labelArea.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
          ev.preventDefault();
          labelArea.form?.requestSubmit();
        }
      });

      const grid = h('div', 'dlg-grid');
      grid.append(
        labelled({ label: 'Family' }, familySel),
        (() => { const r = labelled({ label: 'Pins' }, stepper); r.appendChild(pinsHint); return r; })(),
        labelled({ label: 'Orientation' }, viewGroup),
        labelled({ label: 'Drawing scale', hint: 'Housings are drawn larger than life so they read on the sheet.' }, scaleInput),
        labelled({ label: 'Label', hint: 'Two lines; follows family and pin count until you edit it.' }, labelArea),
      );
      body.append(grid, preview, previewCaption);

      sync();
      requestAnimationFrame(() => fitPreview(svg, connFor(), catalog));

      return () => ({
        family: state.family,
        pins: state.pins,
        view: state.view,
        label: labelArea.value,
        scale: state.scale,
      });
    },
  });
}

// --- wire dialog ------------------------------------------------------------

export function wireDialog(defaults = {}, catalog) {
  const colors = catalog.WIRE_COLORS ?? [];
  const awgs = catalog.awgList();
  const wireScale = Number(defaults.wireScale) > 0 ? Number(defaults.wireScale) : 7;

  const matchName = (hex) => colors.find((c) => sameHex(c.hex, hex))?.name ?? null;

  const state = {
    color: defaults.color ?? colors[0]?.hex ?? '#1a1a1a',
    colorName: defaults.colorName ?? null,
    awg: awgs.includes(Number(defaults.awg)) ? Number(defaults.awg) : (awgs.includes(28) ? 28 : awgs[0]),
  };
  state.colorName = state.colorName ?? matchName(state.color) ?? 'Custom';

  return runDialog({
    title: 'Wire',
    width: 400,
    submitLabel: defaults.submitLabel ?? 'Draw wires',
    build(body) {
      const grid = h('div', 'dlg-swatches');
      const swatches = [];
      for (const c of colors) {
        const b = button('dlg-swatch dlg-focusable', '');
        b.dataset.hex = c.hex;
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.style.setProperty('--swatch', c.hex);
        b.addEventListener('click', () => {
          state.color = c.hex;
          state.colorName = c.name;
          sync();
        });
        swatches.push(b);
        grid.appendChild(b);
      }

      const custom = document.createElement('input');
      custom.type = 'color';
      custom.className = 'dlg-input dlg-color';
      custom.title = 'Custom colour';
      custom.addEventListener('input', () => {
        state.color = custom.value;
        state.colorName = matchName(custom.value) ?? 'Custom';
        sync({ custom: false });
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'dlg-input';
      nameInput.placeholder = 'Colour name';
      nameInput.addEventListener('input', () => {
        state.colorName = nameInput.value;
        sync({ name: false });
      });

      const awgSel = document.createElement('select');
      awgSel.className = 'dlg-input';
      for (const n of awgs) {
        const opt = document.createElement('option');
        opt.value = String(n);
        const od = catalog.AWG?.[n]?.od;
        opt.textContent = od ? `AWG ${n} — ${od} mm` : `AWG ${n}`;
        awgSel.appendChild(opt);
      }
      awgSel.value = String(state.awg);
      awgSel.addEventListener('change', () => { state.awg = Number(awgSel.value); sync(); });

      const preview = h('div', 'dlg-preview dlg-preview-wire');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'dlg-preview-svg');
      svg.setAttribute('viewBox', '0 0 80 18');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      preview.appendChild(svg);
      const caption = h('div', 'dlg-preview-caption', '');

      const sync = (opts = {}) => {
        for (const b of swatches) {
          b.setAttribute('aria-pressed', sameHex(b.dataset.hex, state.color) ? 'true' : 'false');
        }
        if (opts.custom !== false) custom.value = toHex(parseHex(state.color));
        if (opts.name !== false) nameInput.value = state.colorName ?? '';

        let w = 2;
        try { w = catalog.wireWidth(state.awg, wireScale); } catch { w = 2; }
        const y = 9;
        svg.innerHTML = [
          `<path d="M 4 ${y} L 76 ${y}" fill="none" stroke="${shade(state.color, -0.35)}" stroke-width="${w}" stroke-linecap="round"/>`,
          `<path d="M 4 ${y} L 76 ${y}" fill="none" stroke="${toHex(parseHex(state.color))}" stroke-width="${w * 0.82}" stroke-linecap="round"/>`,
          `<path d="M 4 ${(y - w * 0.2).toFixed(2)} L 76 ${(y - w * 0.2).toFixed(2)}" fill="none" stroke="${shade(state.color, 0.45)}" stroke-width="${w * 0.22}" stroke-linecap="round" opacity="0.55"/>`,
        ].join('');
        const od = catalog.AWG?.[state.awg]?.od;
        caption.textContent = `${state.colorName || 'Custom'} · AWG ${state.awg}${od ? ` · ⌀ ${od} mm` : ''} · drawn ${w.toFixed(1)} mm`;
      };

      const colorRow = h('div', 'dlg-row');
      colorRow.appendChild(h('label', 'dlg-label', 'Colour'));
      colorRow.appendChild(grid);
      const customRow = h('div', 'dlg-inline');
      customRow.append(custom, nameInput);
      colorRow.appendChild(customRow);

      body.append(colorRow, labelled({ label: 'Gauge' }, awgSel), preview, caption);
      sync();

      return () => ({
        color: toHex(parseHex(state.color)),
        colorName: state.colorName || 'Custom',
        awg: state.awg,
      });
    },
  });
}

// --- small dialogs ----------------------------------------------------------

export function textDialog(title, label = 'Text', value = '') {
  return runDialog({
    title,
    width: 400,
    submitLabel: 'OK',
    build(body) {
      const ta = document.createElement('textarea');
      ta.className = 'dlg-input dlg-textarea';
      ta.rows = 3;
      ta.value = value ?? '';
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
          ev.preventDefault();
          ta.form?.requestSubmit();
        }
      });
      body.appendChild(labelled({ label, hint: 'Shift+Enter for a new line.' }, ta));
      return () => ta.value;
    },
  });
}

export function confirmDialog(message, { danger = false } = {}) {
  return runDialog({
    title: 'Confirm',
    width: 360,
    submitLabel: danger ? 'Delete' : 'OK',
    danger,
    build(body) {
      body.appendChild(h('p', 'dlg-message', String(message ?? '')));
      return () => true;
    },
  }).then((v) => v === true);
}
