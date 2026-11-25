// Document alignment view: dual-coder character track, drag-select, aligned
// region table, disagreement contributions.

import { h, mount, range, pct, num, clamp } from '../dom.js';
import { textTrack } from '../components/textTrack.js';
import {
  attributionBar, table, sectionTitle, topicChip, topicLabel, statTile, openDialog, emptyState, kv,
} from '../components/ui.js';
import { attrColor } from '../theme.js';
import { alignedRegions } from '../../core/align.js';

export function alignView(ctx) {
  const { state, actions } = ctx;
  const ui = state.ui;
  const doc = state.docById.get(ui.docId) || state.corpus.documents[0];
  const versions = doc.versions;
  const version = versions.find((v) => v.version === ui.version) ? ui.version : versions[0].version;
  const model = actions.docModel(doc.id, version);
  const { text, spansA, spansB, topics, attribution } = model;
  const regions = alignedRegions(spansA, spansB);

  const versionSwitch = versions.length > 1
    ? h('div', { class: 'segmented', role: 'group', 'aria-label': '文本版本' },
      versions.map((v) => h('button', {
        class: `seg-btn${v.version === version ? ' is-on' : ''}`,
        type: 'button',
        onclick: () => actions.setDocVersion(doc.id, v.version),
      }, v.version === versions[0].version ? '原文' : '修订')))
    : h('span', { class: 'badge badge-neutral' }, '无修订');

  const docPicker = h('select', {
    class: 'select',
    'aria-label': '选择文档',
    onchange: (e) => actions.setDoc(e.target.value),
  }, state.corpus.documents.map((d) => h('option', {
    value: d.id,
    selected: d.id === doc.id,
  }, `${d.id} ${d.title}`)));

  const head = h('section', { class: 'panel panel-doc' },
    h('div', { class: 'doc-head' },
      h('div', { class: 'doc-title-row' },
        docPicker,
        h('span', { class: 'badge badge-neutral' }, `${doc.window} · ${doc.date}`),
        h('span', { class: `type-chip type-${doc.type}` }, doc.typeLabel),
        versionSwitch),
      h('p', { class: 'doc-lede' },
        doc.note || (version === versions[0].version ? '原始文本' : versions.find((v) => v.version === version)?.note || '修订文本')),
    ),
    h('div', { class: 'compare-toggle', role: 'group', 'aria-label': '显示哪一层' },
      ['original', 'adjudicated', 'diff'].map((mode) => h('button', {
        class: `seg-btn${ui.compare === mode ? ' is-on' : ''}`,
        type: 'button',
        onclick: () => actions.setCompare(mode),
        disabled: mode !== 'original' && !actions.hasDecisions(doc.id),
        title: mode !== 'original' && !actions.hasDecisions(doc.id) ? '该文档还没有裁决记录' : '',
      }, mode === 'original' ? '原编码' : mode === 'adjudicated' ? '裁决层' : '对照'))),
    h('p', { class: 'fineprint' },
      '在文本上按下拖动即可框选字符区间；松开后可在弹层里指定编码者与主题。'
      + '新区间与已有标注并存，不会覆盖。单击字符定位单个字。'));

  const trackHost = h('div', { class: 'track-host' });
  const selectionBar = h('div', { class: 'selection-bar', hidden: true });

  const renderTrack = () => {
    const mode = ui.compare;
    const eff = actions.effective(doc.id, version);
    let a = spansA;
    let b = spansB;
    if (mode === 'adjudicated') {
      a = eff.annotations.filter((x) => x.coder === 'A');
      b = eff.annotations.filter((x) => x.coder === 'B');
    }
    const marks = mode === 'diff'
      ? actions.diffMarks(doc.id, version)
      : [];
    const track = textTrack({
      text,
      spansA: a,
      spansB: b,
      labelFor: topicLabel,
      selection: ui.pendingSelection,
      marks,
      onSelect: (start, end) => actions.beginSelection(doc.id, version, start, end),
      onSpanClick: (span) => actions.focusSpan(span, doc.id, version),
      onSpanHover: (id) => actions.hoverSpan(id),
    });
    mount(trackHost, track);
    const bar = selectionSummary(ctx, doc, version, start0(ui.pendingSelection), end0(ui.pendingSelection), text);
    mount(selectionBar, bar ? bar : []);
    selectionBar.hidden = !bar;
  };

  queueMicrotask(renderTrack);

  const sidebar = h('div', { class: 'doc-side' },
    statTile('对齐后一致', pct(attribution.labelledUnion ? attribution.agree / attribution.labelledUnion : 0),
      { note: `${num(attribution.agree)} / ${num(attribution.labelledUnion)} 字` }),
    statTile('边界分歧', num(attribution.agreeCut), { note: '标签相同、切分不同', tone: 'seg' }),
    statTile('主题分歧', num(attribution.topicDiff), { note: '对齐区域内标签集合不同', tone: 'topic' }),
    statTile('对齐区域数', num(regions.length), { note: `A ${spansA.length} 段 · B ${spansB.length} 段` }));

  const legendRow = h('div', { class: 'track-legend' },
    h('span', { class: 'track-legend-item' }, h('span', { class: 'band-demo band-demo-a' }), '甲的区间（上）'),
    h('span', { class: 'track-legend-item' }, h('span', { class: 'band-demo band-demo-b' }), '乙的区间（下）'),
    h('span', { class: 'track-legend-item' }, h('span', { class: 'sel-demo' }), '拖选'),
    h('span', { class: 'track-legend-item muted' }, '色带按主题着色；多主题为分段渐变，悬停显示标签'));

  const regionRows = regions.map((r) => {
    const len = r.end - r.start;
    const verdict = !r.aTopics.length && !r.bTopics.length
      ? { kind: 'none', label: '未标注' }
      : !r.aTopics.length || !r.bTopics.length
        ? { kind: 'gap', label: '漏标' }
        : r.topicsEqual
          ? (r.aSpanCount === r.bSpanCount ? { kind: 'agree', label: '一致' } : { kind: 'segmentation', label: '边界分歧' })
          : { kind: 'topic', label: '主题分歧' };
    return {
      __class: 'row-click',
      cells: [
        h('button', {
          class: 'link-btn mono',
          type: 'button',
          title: '定位到该区域',
          onclick: () => actions.focusRegion(r, doc.id, version),
        }, range(r.start, r.end)),
        num(len),
        h('div', { class: 'span-mini' }, r.aSpans.length ? r.aSpans.map((sp) => h('span', {
          class: 'mini-span',
          title: `${sp.id} ${range(sp.start, sp.end)}`,
        }, `${sp.topics.map(topicLabel).join('+')} `)).slice(0, 4) : h('span', { class: 'muted' }, '—')),
        String(r.aSpanCount),
        h('div', { class: 'span-mini' }, r.bSpans.length ? r.bSpans.map((sp) => h('span', {
          class: 'mini-span',
          title: `${sp.id} ${range(sp.start, sp.end)}`,
        }, `${sp.topics.map(topicLabel).join('+')} `)).slice(0, 4) : h('span', { class: 'muted' }, '—')),
        String(r.bSpanCount),
        h('div', { class: 'topic-cell' }, r.aTopics.length ? r.aTopics.map((t) => topicChip(t, { small: true })) : h('span', { class: 'muted' }, '—')),
        h('div', { class: 'topic-cell' }, r.bTopics.length ? r.bTopics.map((t) => topicChip(t, { small: true })) : h('span', { class: 'muted' }, '—')),
        h('span', { class: `verdict verdict-${verdict.kind}` }, verdict.label),
      ],
      region: r,
    };
  });

  const regionPanel = h('section', { class: 'panel' },
    sectionTitle('对齐区域', '重叠关系的连通分量；区域内的标签集合整体比较，切分单独计数'),
    table([
      { label: '区间' }, { label: '字数', numeric: true }, { label: '甲的区间' }, { label: '段数', numeric: true },
      { label: '乙的区间' }, { label: '段数', numeric: true }, { label: '甲的标签' }, { label: '乙的标签' }, { label: '判定' },
    ], regionRows));

  const contributions = topicContributionRows(topics, attribution);

  const contribPanel = h('section', { class: 'panel' },
    sectionTitle('分歧贡献', '按主题：双方共同标注的字数、单侧多出的字数、冲突对象'),
    contributions.length
      ? table([
        { label: '主题' }, { label: '双方共同', numeric: true }, { label: '仅甲多出', numeric: true },
        { label: '仅乙多出', numeric: true }, { label: '冲突对象' },
      ], contributions)
      : emptyState('这一篇没有主题层面的差异', '切分与标签集合都一致，或只存在边界分歧。'));

  const boundaryPanel = h('section', { class: 'panel' },
    sectionTitle('边界对照', '两人各自的切分点；只在一侧出现的切分点即为边界分歧'),
    boundaryDetail(attribution, text));

  return h('div', { class: 'view-inner view-align' },
    h('div', { class: 'align-top' },
      h('div', { class: 'panel-stack' }, head, h('div', { class: 'track-card' }, legendRow, trackHost, selectionBar)),
      h('aside', { class: 'panel side-panel' }, h('h2', { class: 'section-title' }, '本篇概况'), sidebar,
        h('div', { class: 'callout callout-sm' }, attributionBar(attribution)))),
    regionPanel,
    h('div', { class: 'two-col' }, contribPanel, boundaryPanel));
}

function start0(sel) {
  return sel ? sel.start : null;
}
function end0(sel) {
  return sel ? sel.end : null;
}

function selectionSummary(ctx, doc, version, start, end, text) {
  if (start == null || end == null) return null;
  const { actions, state } = ctx;
  const len = end - start;
  return h('div', { class: 'selection-inner' },
    h('div', { class: 'selection-info' },
      h('span', { class: 'selection-range mono' }, `[${start}, ${end})`),
      h('span', {}, `${len} 字`),
      h('span', { class: 'selection-text' }, `「${text.slice(start, Math.min(end, start + 32))}${len > 32 ? '…' : ''}」`)),
    h('div', { class: 'selection-actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.actions.editSelection(doc, version, start, end) }, '新增标注'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.actions.clearSelection() }, '取消')));
}

function topicContributionRows(cmp, attribution) {
  const rows = [];
  for (const st of cmp.topicStats) {
    rows.push({
      cells: [
        topicChip(st.topic, { small: true }),
        num(st.both),
        num(st.aOnly),
        num(st.bOnly),
        st.conflictWith.length
          ? st.conflictWith.map((c) => h('span', { class: 'conflict-pair' },
            `${topicLabel(c.topic)} ${num(c.chars)}字`)).slice(0, 5)
          : h('span', { class: 'muted' }, '—'),
      ],
    });
  }
  void attribution;
  return rows;
}

function boundaryDetail(attribution, text) {
  const b = attribution.boundaries;
  const marks = h('div', { class: 'boundary-marks', 'aria-hidden': 'true' });
  const total = text.length || 1;
  for (const p of b.onlyA) marks.appendChild(h('span', {
    class: 'bmark bmark-a', style: { left: `${(p / total) * 100}%` }, title: `仅甲在 ${p} 处分段`,
  }));
  for (const p of b.onlyB) marks.appendChild(h('span', {
    class: 'bmark bmark-b', style: { left: `${(p / total) * 100}%` }, title: `仅乙在 ${p} 处分段`,
  }));
  return h('div', { class: 'boundary-card' },
    kv([
      ['甲的切分点', `${b.boundaryCountA} 个`],
      ['乙的切分点', `${b.boundaryCountB} 个`],
      ['单侧切分点', `${b.unmatchedCount} 个`],
      ['平均偏差', `${b.meanDistance.toFixed(1)} 字`],
    ]),
    h('div', { class: 'boundary-axis' }, marks),
    h('div', { class: 'boundary-legend' },
      h('span', {}, h('span', { class: 'legend-swatch', style: { background: attrColor('segmentation') } }), '仅甲'),
      h('span', {}, h('span', { class: 'legend-swatch', style: { background: attrColor('gap') } }), '仅乙')),
    b.unmatchedCount === 0
      ? h('p', { class: 'fineprint' }, '两人的切分点完全一致。')
      : h('p', { class: 'fineprint' },
        `共有 ${b.unmatchedCount} 个切分点只出现在一方：这些位置上的文字标签可能相同，`
        + '只是「一段还是两段」不同，因此记边界分歧而不是主题分歧。'));
}

export function spanEditorDialog(ctx, { doc, version, start, end, span, onDone }) {
  const { actions } = ctx;
  const text = doc.versions.find((v) => v.version === version)?.text || '';
  const current = span ? [...span.topics] : [];
  const chosen = new Set(current);
  const coder = span ? span.coder : 'A';
  const state = { coder, start: span ? span.start : start, end: span ? span.end : end };

  const rangeFields = h('div', { class: 'range-fields' },
    h('label', {}, '起', h('input', {
      class: 'input input-sm mono', type: 'number', min: '0', max: String(text.length), value: String(state.start),
      oninput: (e) => { state.start = clamp(Number(e.target.value) || 0, 0, text.length); preview(); },
    })),
    h('label', {}, '止', h('input', {
      class: 'input input-sm mono', type: 'number', min: '0', max: String(text.length), value: String(state.end),
      oninput: (e) => { state.end = clamp(Number(e.target.value) || 0, 0, text.length); preview(); },
    })));

  const previewEl = h('p', { class: 'editor-preview' });
  function preview() {
    const s0 = Math.min(state.start, state.end);
    const e0 = Math.max(state.start, state.end);
    previewEl.textContent = `「${text.slice(s0, e0) || '（空）'}」`;
  }
  preview();

  const coderHost = h('div');
  function mountCoder() {
    mount(coderHost, h('div', { class: 'segmented' },
      ['A', 'B', 'R'].map((c) => h('button', {
        class: `seg-btn${state.coder === c ? ' is-on' : ''}`,
        type: 'button',
        onclick: () => { state.coder = c; mountCoder(); },
      }, c === 'A' ? '甲' : c === 'B' ? '乙' : '裁决新增'))));
  }
  mountCoder();

  const topicHost = h('div', { class: 'topic-picker' });
  function paintTopics() {
    mount(topicHost, ctx.state.corpus.meta.topics.map((t) => h('button', {
      class: `topic-choice${chosen.has(t.id) ? ' is-on' : ''}`,
      type: 'button',
      'aria-pressed': chosen.has(t.id) ? 'true' : 'false',
      onclick: () => {
        if (chosen.has(t.id)) chosen.delete(t.id);
        else chosen.add(t.id);
        paintTopics();
      },
    }, topicChip(t.id, { small: true }))));
  }
  paintTopics();

  const body = h('div', { class: 'editor' },
    h('div', { class: 'editor-row' }, h('span', { class: 'field-label' }, '编码者'), coderHost),
    rangeFields,
    previewEl,
    h('div', { class: 'editor-row' }, h('span', { class: 'field-label' }, '主题（可多选）'), topicHost),
    span ? h('p', { class: 'fineprint' }, `正在修改 ${span.id}。原记录不会被覆盖：编辑会作为一条追加的裁决记录保存。`) : null,
    h('p', { class: 'fineprint' }, '保存时：甲/乙 写入裁决层的替换记录；裁决新增 则新增一段裁决标注。原始人工标注保持不变。'));

  const dlg = openDialog({
    title: span ? '编辑标注' : '新增标注',
    body,
    actions: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, '取消'),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          const s0 = Math.min(state.start, state.end);
          const e0 = Math.max(state.start, state.end);
          if (s0 === e0) { actions.toast('区间不能为空'); return; }
          if (!chosen.size) { actions.toast('至少选择一个主题'); return; }
          actions.saveSpanDecision({ doc, version, span, coder: state.coder, start: s0, end: e0, topics: [...chosen] });
          dlg.close();
          onDone?.();
        },
      }, '保存到裁决层'),
    ],
  });
  return dlg;
}
