// Shared app shell: header, view tabs, topic legend, toast.

import { h } from '../dom.js';
import { topicChip, toastBar } from './ui.js';
import { setTheme, currentTheme } from '../theme.js';

const VIEWS = [
  { id: 'overview', label: '总览', note: '语料、整体一致性、归因构成' },
  { id: 'align', label: '文档对齐', note: '双栏字符、拖选标注、分段对照' },
  { id: 'revision', label: '修订迁移', note: '逐字符映射、争议区、候选选择' },
  { id: 'adjudicate', label: '争议裁决', note: '独立裁决层，原编码 / 裁决切换' },
  { id: 'drift', label: '漂移', note: '原始 vs 构成调整、置换检验' },
  { id: 'examples', label: '示例与自检', note: '重复文字、交叠标签、中途插入、逐字符核对' },
];

export function shell(ctx, content) {
  const { state, actions } = ctx;
  const ui = state.ui;
  const header = h('header', { class: 'app-head' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, '码'),
      h('div', {},
        h('h1', {}, '文本编码分析台'),
        h('p', { class: 'brand-sub' }, '人工字符区间 · 先对齐再比较 · 修订可核对迁移 · 裁决独立成层'))),
    h('div', { class: 'head-actions' },
      h('span', { class: 'pill' }, '离线 · 不调用模型'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: () => {
          const next = currentTheme() === 'dark' ? 'light' : 'dark';
          setTheme(next);
          actions.rerender();
        },
      }, currentTheme() === 'dark' ? '浅色' : '深色')));

  const tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': '视图' },
    VIEWS.map((v) => h('button', {
      class: `tab${ui.view === v.id ? ' is-active' : ''}`,
      role: 'tab',
      type: 'button',
      'aria-selected': ui.view === v.id ? 'true' : 'false',
      title: v.note,
      onclick: () => actions.setView(v.id),
    }, h('span', { class: 'tab-label' }, v.label))));

  const topicLegend = h('div', { class: 'topic-legend', 'aria-label': '主题' },
    h('span', { class: 'topic-legend-label' }, '主题'),
    state.corpus.meta.topics.map((t) => topicChip(t.id, { small: true })));

  return h('div', { class: 'app' },
    header,
    h('div', { class: 'app-sub' }, tabs, topicLegend),
    h('main', { class: 'view' }, content),
    toastBar(ui.toast, (act) => act.run?.()),
  );
}

export { VIEWS };
