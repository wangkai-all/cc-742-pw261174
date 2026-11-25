// Tiny DOM helpers. No framework, no innerHTML with data: every node is built
// with createElement/textContent so corpus or imported text can never be parsed
// as markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') throw new Error('html prop disabled: use text nodes');
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple') el[k] = Boolean(v);
    else if (k === 'ref' && typeof v === 'function') v(el);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

export const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const pct0 = (x) => pct(x, 0);
export const signedPct = (x, d = 1) => {
  if (x == null || Number.isNaN(x)) return '—';
  const v = (x * 100).toFixed(d);
  return `${x > 0 ? '+' : ''}${v} pp`;
};
export const range = (a, b) => `${a}–${b}`;
export const num = (x) => new Intl.NumberFormat('zh-CN').format(x);
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function snippetOf(text, start, end, pad = 6) {
  const s0 = Math.max(0, start - pad);
  const e0 = Math.min(text.length, end + pad);
  return {
    before: text.slice(s0, start),
    focus: text.slice(start, end),
    after: text.slice(end, e0),
  };
}

export function chip(text, cls = '') {
  return h('span', { class: `chip ${cls}`.trim() }, text);
}

export function badge(text, tone = 'neutral') {
  return h('span', { class: `badge badge-${tone}` }, text);
}

// Wordless marks are drawn, not typed: the bundled CJK font has no ✓/✕ glyph,
// so a text glyph would fall back to nothing on machines without one.
const ICON_PATHS = {
  check: ['M2.5 7.2 L5.8 10.5 L11.5 4.4'],
  cross: ['M3.4 3.4 L10.6 10.6', 'M10.6 3.4 L3.4 10.6'],
  arrow: ['M3 7 H11', 'M7.8 3.6 L11.2 7 L7.8 10.4'],
};

export function icon(name, cls = '') {
  const svg = s('svg', {
    viewBox: '0 0 14 14',
    class: `icon icon-${name} ${cls}`.trim(),
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const d of ICON_PATHS[name] || []) {
    svg.appendChild(s('path', { d, fill: 'none', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return svg;
}

export function iconButton(label, title, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', title, 'aria-label': title, onclick: onClick }, label);
}

/** Toggle a class on a set of nodes. */
export function setClass(node, cls, on) {
  node.classList.toggle(cls, Boolean(on));
}

export function tooltipText(el, text) {
  el.title = text;
  return el;
}

/** Focus trap for dialogs; returns a cleanup function. */
export function trapFocus(root) {
  const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}
