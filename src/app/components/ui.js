// Small shared UI pieces: topic chips, stat tiles, tables, dialogs and toasts.

import { h, mount, pct, pct0, num, trapFocus, icon } from '../dom.js';
import { topicColor, attrColor, ATTR_COLORS } from '../theme.js';

let metaLookup = (id) => ({ id, label: id, color: 0 });

export function setTopicMeta(fn) {
  metaLookup = fn;
}

export function topicLabel(id) {
  return metaLookup(id).label;
}

/** A chip: colour swatch + label text. Identity is never colour-only. */
export function topicChip(id, opts = {}) {
  const meta = metaLookup(id);
  const style = opts.outline
    ? { borderColor: topicColor(id), color: 'var(--ink)' }
    : { background: topicColor(id), color: '#fff' };
  if (opts.small) style.fontSize = '11px';
  return h('span', { class: `tchip${opts.outline ? ' tchip-outline' : ''}${opts.small ? ' tchip-sm' : ''}`, style },
    h('span', { class: 'tchip-dot', style: { background: opts.outline ? topicColor(id) : 'rgba(255,255,255,0.85)' } }),
    meta.label);
}

export function topicBar(id, share, opts = {}) {
  const width = Math.max(0, Math.min(1, share || 0));
  return h('span', { class: 'topic-bar', title: `${topicLabel(id)} ${pct(share)}` },
    h('span', { class: 'topic-bar-fill', style: { width: `${width * 100}%`, background: topicColor(id) } }));
}

export function statTile(label, value, opts = {}) {
  return h('div', { class: `stat${opts.tone ? ` stat-${opts.tone}` : ''}` },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    opts.note ? h('div', { class: 'stat-note' }, opts.note) : null);
}

export function legend(items, opts = {}) {
  return h('div', { class: 'legend', role: 'list', 'aria-label': opts.label || '图例' },
    items.map((it) => h('span', { class: 'legend-item', role: 'listitem' },
      h('span', { class: 'legend-swatch', style: { background: it.color } }),
      h('span', {}, it.label))));
}

export function table(headers, rows, opts = {}) {
  const head = h('thead', {}, h('tr', {}, headers.map((c) => h('th', {
    class: c.numeric ? 'num' : '',
    scope: 'col',
  }, c.label || c))));
  const body = h('tbody', {}, rows.map((r) => h('tr', { class: r.__class || '' },
    r.cells.map((cell, i) => {
      const col = headers[i];
      const cls = col && col.numeric ? 'num' : '';
      if (cell instanceof Node) return h('td', { class: cls }, cell);
      return h('td', { class: cls }, cell == null ? '—' : String(cell));
    }))));
  // Eight or more columns cannot fit a phone without each column becoming three
  // characters wide; let the table scroll inside its wrapper instead, and say so
  // on narrow screens (the hint is hidden above 620px, where the table fits).
  // Callers can also pin a minimum width for a wide-bodied table below that
  // column count. The hint sits outside the scroll box so it never scrolls away.
  const wide = headers.length >= 8 || Boolean(opts.minWidth);
  return h('div', { class: 'table-block' },
    h('div', { class: `table-wrap${wide ? ' is-wide' : ''}` },
      h('table', {
        class: `table${wide ? ' is-wide' : ''} ${opts.class || ''}`.trim(),
        style: opts.minWidth ? { '--table-min': `${opts.minWidth}px` } : null,
      }, head, body)),
    wide ? h('div', { class: 'table-scroll-hint' }, '左右滑动查看完整表格') : null);
}

export function emptyState(title, note) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, title), note ? h('div', { class: 'empty-note' }, note) : null);
}

/** Attribution split bar: agree / boundary / topic / gap, direct-labelled. */
export function attributionBar(attr, opts = {}) {
  const total = attr.labelledUnion || 1;
  const parts = [
    { kind: 'agree', n: attr.agree - attr.agreeCut, label: '一致' },
    { kind: 'segmentation', n: attr.agreeCut, label: '边界分歧' },
    { kind: 'topic', n: attr.topicDiff, label: '主题分歧' },
    { kind: 'gap', n: attr.onlyA + attr.onlyB, label: '漏标' },
  ].filter((p) => p.n > 0);
  const bar = h('div', { class: 'attr-bar', role: 'img', 'aria-label': parts.map((p) => `${p.label} ${p.n} 字`).join('；') });
  parts.forEach((p, i) => {
    bar.appendChild(h('span', {
      class: 'attr-seg',
      style: {
        width: `${(p.n / total) * 100}%`,
        background: attrColor(p.kind),
        marginLeft: i ? '2px' : '0',
      },
      title: `${p.label} ${p.n} 字（${pct(p.n / total)}）`,
    }));
  });
  if (!parts.length) bar.appendChild(h('span', { class: 'attr-seg', style: { width: '100%', background: 'var(--rule)' } }));
  return h('div', { class: 'attr-wrap' },
    bar,
    h('div', { class: 'attr-labels' }, parts.map((p) => h('span', { class: 'attr-label' },
      h('span', { class: 'legend-swatch', style: { background: attrColor(p.kind) } }),
      `${p.label} ${num(p.n)}（${pct0(p.n / total)}）`))));
}

export function openDialog({ title, body, actions = [], onClose, wide = false }) {
  const panel = h('div', { class: `dialog${wide ? ' dialog-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dialog-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', onclick: close }, icon('cross'))),
    h('div', { class: 'dialog-body' }, body),
    actions.length ? h('div', { class: 'dialog-actions' }, actions) : null);
  const backdrop = h('div', { class: 'dialog-backdrop' }, panel);
  const release = trapFocus(panel);
  function close() {
    release();
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    const focusable = panel.querySelector('button, input, select, textarea');
    if (focusable) focusable.focus();
  });
  return { close, panel };
}

export function toastBar(toastState, onAction) {
  if (!toastState) return null;
  return h('div', { class: 'toast', role: 'status' },
    h('span', {}, toastState.text),
    toastState.action
      ? h('button', {
        class: 'btn btn-sm btn-ghost',
        type: 'button',
        onclick: () => onAction?.(toastState.action),
      }, toastState.action.label)
      : null);
}

export function sectionTitle(title, note) {
  return h('div', { class: 'section-head' },
    h('h2', { class: 'section-title' }, title),
    note ? h('p', { class: 'section-note' }, note) : null);
}

export function kv(list) {
  return h('dl', { class: 'kv' }, list.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

export { mount, pct, pct0, num, ATTR_COLORS };
export { badge, chip } from '../dom.js';
