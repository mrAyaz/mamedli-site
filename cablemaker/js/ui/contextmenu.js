// Floating context menu with nested submenus, built on demand in #overlay-layer.

const EDGE = 6;

let session = null;

function layer() {
  let el = document.getElementById('overlay-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-layer';
    document.body.appendChild(el);
  }
  return el;
}

function isSeparator(item) {
  // Anything that is not an item descriptor is a separator, so a conditionally
  // built list can hold '-', null or false without rendering an empty row.
  return typeof item !== 'object' || item === null || item.separator === true;
}

function iconNode(icon) {
  const span = document.createElement('span');
  span.className = 'ctx-icon';
  span.setAttribute('aria-hidden', 'true');
  if (icon instanceof Node) span.appendChild(icon);
  else if (typeof icon === 'string' && icon.trim().startsWith('<')) span.innerHTML = icon;
  else if (typeof icon === 'string') span.textContent = icon;
  return span;
}

function itemsOf(item) {
  return Array.isArray(item.items) && item.items.length ? item.items : null;
}

function buildItem(item, depth) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctx-item';
  btn.setAttribute('role', 'menuitem');
  btn.tabIndex = -1;
  if (item.danger) btn.classList.add('ctx-danger');
  if (item.disabled) {
    btn.classList.add('ctx-disabled');
    btn.setAttribute('aria-disabled', 'true');
  }
  if (item.checked) btn.classList.add('ctx-checked');

  btn.appendChild(iconNode(item.icon));

  const label = document.createElement('span');
  label.className = 'ctx-label';
  label.textContent = item.label ?? '';
  btn.appendChild(label);

  const sub = itemsOf(item);
  const tail = document.createElement('span');
  if (sub) {
    tail.className = 'ctx-arrow';
    tail.textContent = '›';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
  } else {
    tail.className = 'ctx-accel';
    tail.textContent = item.accel ?? '';
  }
  btn.appendChild(tail);

  btn._item = item;
  btn._depth = depth;
  return btn;
}

function buildPanel(items, depth) {
  const panel = document.createElement('div');
  panel.className = 'ctx-menu';
  panel.setAttribute('role', 'menu');
  panel.tabIndex = -1;
  panel._depth = depth;

  let lastWasSep = true;
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (isSeparator(item)) {
      if (lastWasSep) continue;
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      panel.appendChild(sep);
      lastWasSep = true;
      continue;
    }
    panel.appendChild(buildItem(item, depth));
    lastWasSep = false;
  }
  while (panel.lastElementChild?.classList.contains('ctx-sep')) panel.lastElementChild.remove();
  if (!panel.children.length) {
    const empty = document.createElement('div');
    empty.className = 'ctx-empty';
    empty.textContent = 'No actions';
    panel.appendChild(empty);
  }
  return panel;
}

function place(panel, anchor) {
  panel.style.visibility = 'hidden';
  panel.style.left = '0px';
  panel.style.top = '0px';
  layer().appendChild(panel);

  const r = panel.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x;
  let y;

  if (anchor.rect) {
    x = anchor.rect.right - 4;
    y = anchor.rect.top - 5;
    if (x + r.width > vw - EDGE) x = anchor.rect.left - r.width + 4;
  } else {
    x = anchor.x;
    y = anchor.y;
    if (x + r.width > vw - EDGE) x = anchor.x - r.width;
  }
  if (y + r.height > vh - EDGE) y = vh - EDGE - r.height;

  panel.style.left = `${Math.max(EDGE, Math.min(x, vw - EDGE - r.width))}px`;
  panel.style.top = `${Math.max(EDGE, y)}px`;
  panel.style.maxHeight = `${vh - 2 * EDGE}px`;
  panel.style.visibility = '';
}

function closeFrom(depth) {
  if (!session) return;
  while (session.panels.length > depth) {
    const panel = session.panels.pop();
    panel._owner?.setAttribute('aria-expanded', 'false');
    panel._owner?.classList.remove('ctx-open');
    panel.remove();
  }
}

function openSubmenu(btn) {
  const depth = btn._depth + 1;
  const existing = session.panels[depth];
  if (existing && existing._owner === btn) return existing;
  closeFrom(depth);
  const panel = buildPanel(itemsOf(btn._item), depth);
  panel._owner = btn;
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('ctx-open');
  place(panel, { rect: btn.getBoundingClientRect() });
  session.panels[depth] = panel;
  return panel;
}

function enabledItems(panel) {
  return [...panel.querySelectorAll('.ctx-item:not(.ctx-disabled)')];
}

function focusItem(panel, index) {
  const items = enabledItems(panel);
  if (!items.length) return;
  const i = ((index % items.length) + items.length) % items.length;
  items[i].focus();
}

function activate(btn) {
  const item = btn._item;
  if (btn.classList.contains('ctx-disabled')) return;
  if (itemsOf(item)) {
    const panel = openSubmenu(btn);
    focusItem(panel, 0);
    return;
  }
  hideContextMenu();
  // No argument: callers read an action's first parameter as a world point.
  item.action?.();
}

function onPointerDown(ev) {
  if (!session) return;
  if (session.panels.some((p) => p && p.contains(ev.target))) return;
  hideContextMenu();
}

function onKeyDown(ev) {
  if (!session) return;
  const deepest = session.panels[session.panels.length - 1];
  const focused = document.activeElement?.closest?.('.ctx-item') ?? null;
  const panel = focused?.closest('.ctx-menu') ?? deepest;
  const items = enabledItems(panel);
  const idx = focused ? items.indexOf(focused) : -1;
  // The canvas listens for plain keys on window, so an open menu has to stop
  // every key it sees from also nudging or deleting the selection behind it.
  const eat = () => { ev.preventDefault(); ev.stopPropagation(); };

  switch (ev.key) {
    case 'Escape':
      eat();
      if (session.panels.length > 1) {
        const owner = deepest._owner;
        closeFrom(session.panels.length - 1);
        owner?.focus();
      } else {
        hideContextMenu();
      }
      return;
    case 'ArrowDown':
      eat();
      focusItem(panel, idx + 1);
      return;
    case 'ArrowUp':
      eat();
      focusItem(panel, idx <= 0 ? items.length - 1 : idx - 1);
      return;
    case 'ArrowRight':
      eat();
      if (focused && itemsOf(focused._item)) focusItem(openSubmenu(focused), 0);
      return;
    case 'ArrowLeft':
      eat();
      if (session.panels.length > 1) {
        const owner = session.panels[session.panels.length - 1]._owner;
        closeFrom(session.panels.length - 1);
        owner?.focus();
      }
      return;
    case 'Home':
      eat();
      focusItem(panel, 0);
      return;
    case 'End':
      eat();
      focusItem(panel, items.length - 1);
      return;
    case 'Enter':
    case ' ':
      eat();
      if (focused) activate(focused);
      return;
    case 'Tab':
      hideContextMenu();
      return;
    default:
      if (ev.ctrlKey || ev.metaKey || ev.altKey) hideContextMenu();
      else ev.stopPropagation();
  }
}

function onPanelPointerOver(ev) {
  const btn = ev.target.closest?.('.ctx-item');
  if (!btn || !session) return;
  closeFrom(btn._depth + 1);
  if (!btn.classList.contains('ctx-disabled') && itemsOf(btn._item)) openSubmenu(btn);
  if (!btn.classList.contains('ctx-disabled')) btn.focus();
}

function onPanelClick(ev) {
  const btn = ev.target.closest?.('.ctx-item');
  if (!btn) return;
  ev.preventDefault();
  activate(btn);
}

export function showContextMenu(clientPt, items) {
  hideContextMenu();

  const root = buildPanel(items, 0);
  session = { panels: [root], detach: null, returnFocus: document.activeElement };
  place(root, { x: clientPt?.x ?? 0, y: clientPt?.y ?? 0 });
  root.focus({ preventScroll: true });

  const host = layer();
  // A wrapper, not hideContextMenu itself: the host page registers the same
  // function for 'blur', and removing it here would unregister theirs too.
  const dismiss = () => hideContextMenu();
  host.addEventListener('pointerover', onPanelPointerOver);
  host.addEventListener('click', onPanelClick);
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', dismiss, true);
  document.addEventListener('wheel', dismiss, { capture: true, passive: true });

  // Deferred so the pointerup/click that spawned the menu cannot close it again.
  const timer = setTimeout(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
  }, 0);

  session.detach = () => {
    clearTimeout(timer);
    host.removeEventListener('pointerover', onPanelPointerOver);
    host.removeEventListener('click', onPanelClick);
    window.removeEventListener('blur', dismiss);
    window.removeEventListener('resize', dismiss);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', dismiss, true);
    document.removeEventListener('wheel', dismiss, { capture: true });
    document.removeEventListener('pointerdown', onPointerDown, true);
  };
}

export function hideContextMenu() {
  if (!session) return;
  const { detach, returnFocus } = session;
  const hadFocus = session.panels.some((p) => p && p.contains(document.activeElement));
  closeFrom(0);
  session = null;
  detach?.();
  if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}
