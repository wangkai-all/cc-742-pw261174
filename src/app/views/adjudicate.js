// Adjudication: the independent decision layer. The original coding is read-only;
// every reviewer action is an appended record, and the derived coding is
// recomputed from originals + records on each render.

import { h, mount, range, num, pct } from '../dom.js';
import { textTrack } from '../components/textTrack.js';
import {
  table, sectionTitle, statTile, emptyState, topicChip, topicLabel, badge, attributionBar,
} from '../components/ui.js';
import { adjudicationDelta } from '../../core/overlay.js';
import { attribute } from '../../core/attribute.js';

export function adjudicateView(ctx) {
  const { state, actions } = ctx;
  const docsWith = state.corpus.documents.filter((d) => actions.hasDecisions(d.id));
  const docId = state.docById.has(state.ui.docId) ? state.ui.docId : state.corpus.documents[0].id;
  const doc = state.docById.get(docId);
  const version = doc.versions[0].version;
  const eff = actions.effective(doc.id, version);
  const decisions = actions.decisions(doc.id);
  const originals = doc.annotations;
  const text = doc.versions[0].text;
  const origAttr = attribute(originals.filter((s) => s.coder === 'A'), originals.filter((s) => s.coder === 'B'), text.length);
  const adjAttr = attribute(eff.annotations.filter((s) => s.coder === 'A'), eff.annotations.filter((s) => s.coder === 'B'), text.length);
  const delta = adjudicationDelta(originals, eff.annotations, text.length);

  const docPicker = h('select', {
    class: 'select',
    'aria-label': '选择文档',
    onchange: (e) => actions.setUiDoc(e.target.value),
  }, state.corpus.documents.map((d) => h('option', { value: d.id, selected: d.id === docId },
    `${d.id} ${d.title}${actions.hasDecisions(d.id) ? ' •' : ''}`)));

  const head = h('section', { class: 'panel' },
    h('div', { class: 'doc-head' },
      h('div', { class: 'doc-title-row' }, docPicker,
        h('span', { class: 'badge badge-neutral' }, `${doc.window} · ${doc.date}`),
        h('span', { class: `type-chip type-${doc.type}` }, doc.typeLabel),
        decisions.length ? badge(`${decisions.length} 条裁决记录`, 'warn') : badge('尚无裁决', 'neutral')),
      h('p', { class: 'doc-lede' }, '原始标注只读。裁决以追加记录的形式保存，带文本版本；可随时切回原始编码，也可清空裁决层恢复完全相同的输入。')));

  const modeRow = h('div', { class: 'adjudicate-modes', role: 'group', 'aria-label': '显示层级' },
    ['original', 'adjudicated', 'diff'].map((mode) => h('button', {
      class: `seg-btn${state.ui.compare === mode ? ' is-on' : ''}`,
      type: 'button',
      onclick: () => actions.setCompare(mode),
    }, mode === 'original' ? '原编码（只读）' : mode === 'adjudicated' ? '裁决层' : '差异对照')));

  const trackHost = h('div', { class: 'track-host' });
  const paint = () => {
    const a = state.ui.compare === 'adjudicated' ? eff.annotations.filter((x) => x.coder === 'A') : originals.filter((x) => x.coder === 'A');
    const b = state.ui.compare === 'adjudicated' ? eff.annotations.filter((x) => x.coder === 'B') : originals.filter((x) => x.coder === 'B');
    const marks = state.ui.compare === 'diff' && delta.length
      ? [{ start: delta[0].pos, end: delta[delta.length - 1].pos + 1, tone: 'changed', label: `${delta.length} 个字符的标签被裁决改变` }]
      : [];
    mount(trackHost, textTrack({
      text,
      spansA: a,
      spansB: b,
      labelFor: topicLabel,
      marks,
      onSpanClick: (span) => actions.focusSpan(span, doc.id, version),
      onSpanHover: (id) => actions.hoverSpan(id),
    }));
  };
  queueMicrotask(paint);

  const trackCard = h('section', { class: 'panel track-card' },
    sectionTitle('编码对照', state.ui.compare === 'diff'
      ? '橙色竖条标出被裁决改变了标签的字符'
      : state.ui.compare === 'adjudicated' ? '显示原始人工标注 + 裁决层（派生结果）' : '显示原始人工标注'),
    modeRow, trackHost);

  const deltaCard = h('section', { class: 'panel' },
    sectionTitle('裁决影响', '原编码与裁决层之间的逐字符差异'),
    h('div', { class: 'stat-row' },
      statTile('原编码一致率', pct(origAttr.labelledUnion ? origAttr.agree / origAttr.labelledUnion : 0),
        { note: `${num(origAttr.agree)} / ${num(origAttr.labelledUnion)} 字` }),
      statTile('裁决后一致率', pct(adjAttr.labelledUnion ? adjAttr.agree / adjAttr.labelledUnion : 0),
        { note: `${num(adjAttr.agree)} / ${num(adjAttr.labelledUnion)} 字` }),
      statTile('被改变的字符', num(delta.length), { note: delta.length ? '橙条标出位置' : '尚无差异' })),
    h('div', { class: 'attr-compare' },
      h('div', {}, h('div', { class: 'attr-caption' }, '原编码'), attributionBar(origAttr)),
      h('div', {}, h('div', { class: 'attr-caption' }, '裁决层'), attributionBar(adjAttr))));

  const ledgerCard = h('section', { class: 'panel' },
    sectionTitle('裁决记录（追加式）', '记录只增不减；撤销也是一条新记录。版本过期的记录不会被套用到新坐标。'),
    decisions.length ? decisionTable(ctx, doc, version, decisions, eff) : emptyState('还没有裁决记录',
      '到「文档对齐」或「修订迁移」里新增、修改或确认标注，操作会记录在这里。'));

  const readOnly = h('section', { class: 'panel' },
    sectionTitle('原始标注（只读）', '这是输入，不会被任何裁决改写'),
    originalsTable(doc, text));

  const controls = h('div', { class: 'panel-controls' },
    decisions.length
      ? h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: () => {
          if (confirm('清空本地保存的全部裁决记录？原始标注不受影响。')) actions.clearAll();
        },
      }, '清空裁决层')
      : null);

  return h('div', { class: 'view-inner' },
    head, controls, trackCard, deltaCard, ledgerCard, readOnly);
}

function decisionTable(ctx, doc, version, decisions, eff) {
  const { actions } = ctx;
  const rows = decisions.map((d) => {
    const isStale = eff.stale.some((s) => s.id === d.id);
    const isRetracted = decisions.some((x) => x.retracts === d.id);
    const kindLabel = {
      accept: '确认', reject: '驳回', replace: '替换', split: '拆分', merge: '合并', add: '新增',
    }[d.kind] || d.kind;
    return {
      __class: [isStale ? 'is-stale' : '', isRetracted ? 'is-retracted' : ''].join(' '),
      cells: [
        h('span', { class: 'mono small' }, d.id),
        h('span', { class: `kind kind-${d.kind}` }, d.retracts ? '撤销' : kindLabel),
        h('span', { class: 'mono small' },
          d.annotationId || (d.annotationIds ? d.annotationIds.join(' / ') : (d.start != null ? `${range(d.start, d.end)}` : '—'))),
        d.topics ? h('span', { class: 'topic-cell' }, d.topics.map((t) => topicChip(t, { small: true }))) : h('span', { class: 'muted' }, '—'),
        h('span', { class: 'mono small' }, d.textVersion),
        isStale ? badge('过期', 'warn') : badge('生效', 'ok'),
        h('span', { class: 'small' }, d.note || ''),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          disabled: isRetracted || d.retracts,
          onclick: () => actions.retract(doc.id, d.id),
        }, '撤销'),
      ],
    };
  });
  void version;
  return table([
    { label: '编号' }, { label: '类型' }, { label: '对象' }, { label: '主题' }, { label: '版本' },
    { label: '状态' }, { label: '说明' }, { label: '操作' },
  ], rows);
}

function originalsTable(doc, text) {
  const rows = [...doc.annotations].sort((a, b) => a.start - b.start || a.coder.localeCompare(b.coder)).map((a) => ({
    cells: [
      h('span', { class: 'mono small' }, a.id),
      a.coder === 'A' ? '甲' : '乙',
      h('span', { class: 'mono small' }, range(a.start, a.end)),
      h('span', { class: 'topic-cell' }, a.topics.map((t) => topicChip(t, { small: true }))),
      h('span', { class: 'snip' }, text.slice(a.start, Math.min(a.end, a.start + 28))),
    ],
  }));
  return table([
    { label: '编号' }, { label: '编码者' }, { label: '区间' }, { label: '主题' }, { label: '文字' },
  ], rows);
}
