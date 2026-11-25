// Overview: corpus design, whole-corpus agreement, attribution split, documents.

import { h } from '../dom.js';
import { statTile, attributionBar, table, sectionTitle, legend, topicChip, pct, num } from '../components/ui.js';
import { attrColor } from '../theme.js';
import { range } from '../dom.js';

export function overviewView(ctx) {
  const { state, actions } = ctx;
  const a = state.analysis;
  const corpus = state.corpus;
  const totals = a.totals;
  const agreedShare = totals.labelledUnion ? (totals.agree - totals.agreeCut) / totals.labelledUnion : 0;
  const docsByWindow = new Map();
  for (const d of corpus.documents) {
    if (!docsByWindow.has(d.window)) docsByWindow.set(d.window, []);
    docsByWindow.get(d.window).push(d);
  }

  const hero = h('section', { class: 'panel panel-hero' },
    h('div', { class: 'hero-grid' },
      h('div', {},
        h('p', { class: 'eyebrow' }, '虚构语料 · 2 名编码者 · 5 个时间窗'),
        h('h2', { class: 'hero-title' }, '把「两人用了同样的主题」和「两人说了同样的意思」分开'),
        h('p', { class: 'hero-lede' },
          '整篇标签集合相同并不代表判断一致：一个主题可能被甲放在开头、被乙挂在结尾。'
          + '本台先把两人的区间按重叠关系对齐成区域，再比较区域内的标签集合；切分不同而主题相同，记为边界分歧。')),
      h('div', { class: 'hero-stats' },
        statTile('已对齐字符合计', num(totals.labelledUnion), { note: `全文 ${num(totals.length)} 字` }),
        statTile('一致（含边界切分）', pct(totals.labelledUnion ? totals.agree / totals.labelledUnion : 0),
          { note: `${num(totals.agree)} 字` }),
        statTile('其中仅边界分歧', pct(totals.labelledUnion ? totals.agreeCut / totals.labelledUnion : 0),
          { note: `${num(totals.agreeCut)} 字`, tone: 'seg' }),
        statTile('主题分歧', pct(totals.labelledUnion ? totals.topicDiff / totals.labelledUnion : 0),
          { note: `${num(totals.topicDiff)} 字`, tone: 'topic' }))));

  const attrPanel = h('section', { class: 'panel' },
    sectionTitle('整体归因', '按对齐区域加权；逐字符参照由自检页独立核算，两套数字必须一致'),
    attributionBar({
      labelledUnion: totals.labelledUnion,
      agree: totals.agree,
      agreeCut: totals.agreeCut,
      topicDiff: totals.topicDiff,
      onlyA: totals.onlyA,
      onlyB: totals.onlyB,
    }),
    h('div', { class: 'callout' },
      h('p', {},
        `按区域比较，一致（同一切分的标签集合）为 ${num(totals.agree - totals.agreeCut)} 字；`
        + `另有 ${num(totals.agreeCut)} 字标签集合相同但切分不同，单独记为边界分歧。`
        + '逐字符口径会更严厉——同一段标签集合相同、切分不同的文字在每个字符上都会被算作不同——'
        + '两个口径并排显示，避免把「切分习惯」读成「主题判断不同」。')));

  const rows = a.docs.map(({ doc, raw }) => {
    const t = raw.attribution;
    const verdictTone = t.verdict.kind === 'topic' ? 'topic' : t.verdict.kind === 'segmentation' ? 'seg' : t.verdict.kind === 'gap' ? 'gap' : 'ok';
    return {
      __class: 'row-click',
      doc,
      cells: [
        h('button', { class: 'link-btn', type: 'button', onclick: () => actions.openDoc(doc.id) },
          h('span', { class: 'doc-id' }, doc.id), ' ', h('span', {}, doc.title)),
        `${doc.window} · ${doc.date}`,
        h('span', { class: 'type-chip type-' + doc.type }, doc.typeLabel),
        num(raw.length),
        `${num(t.agree)}`,
        `${num(t.agreeCut)}`,
        `${num(t.topicDiff)}`,
        h('span', { class: `verdict verdict-${verdictTone}` }, verdictLabel(t.verdict.kind)),
        doc.versions.length > 1 ? h('button', { class: 'link-btn', type: 'button', onclick: () => actions.openRevision(doc.id) }, '查看修订') : '—',
      ],
    };
  });

  const tablePanel = h('section', { class: 'panel' },
    sectionTitle('逐篇归因', '点击文档进入对齐视图；数字为字符数'),
    table([
      { label: '文档' }, { label: '窗口' }, { label: '类型' }, { label: '字数', numeric: true },
      { label: '一致', numeric: true }, { label: '边界分歧', numeric: true }, { label: '主题分歧', numeric: true },
      { label: '主要构成' }, { label: '修订' },
    ], rows));

  const designPanel = h('section', { class: 'panel' },
    sectionTitle('语料设计', '受控构造：每个时间窗都含三种文体，但构成随时间变化'),
    h('div', { class: 'window-grid' }, [...docsByWindow.entries()].map(([w, docs]) => h('div', { class: 'window-col' },
      h('div', { class: 'window-name' }, w),
      docs.map((d) => h('button', {
        class: `mini-doc type-${d.type}`,
        type: 'button',
        title: `${d.id} ${d.title}`,
        onclick: () => actions.openDoc(d.id),
      }, d.id))))),
    h('p', { class: 'fineprint' },
      '构成变化（T 投诉、S 建议、C 咨询的比例随时间移动）正是漂移检测要防的假信号：'
      + '编码者甲对「收费」的原始占比上升，但按全期构成重新加权后持平——那不是个人漂移，是批次构成变化。'));

  return h('div', { class: 'view-inner' },
    hero, attrPanel, tablePanel, designPanel);
}

function verdictLabel(kind) {
  switch (kind) {
    case 'topic': return '主题分歧';
    case 'segmentation': return '边界分歧';
    case 'gap': return '漏标';
    case 'agree': return '基本一致';
    default: return '无标注';
  }
}

export { range, topicChip, legend, attrColor };
