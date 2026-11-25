// Revision migration: the ribbon of edits, per-character status, and every
// annotation's migration result with candidates for the dispute zone.

import { h, range, num } from '../dom.js';
import { table, sectionTitle, statTile, emptyState, topicChip, badge } from '../components/ui.js';
import { revisionModel } from '../store.js';
import { migrationLabel } from '../../core/migrate.js';

const STATUS_TONE = {
  exact: 'ok', shifted: 'move', partial: 'part', ambiguous: 'dispute', lost: 'lost',
};

export function revisionView(ctx) {
  const { state, actions } = ctx;
  const revised = state.corpus.documents.filter((d) => d.versions.length > 1);
  if (!revised.length) return emptyState('没有带修订的文档');
  const docId = revised.some((d) => d.id === state.ui.revisionDocId) ? state.ui.revisionDocId : revised[0].id;
  const model = revisionModel(docId);
  const picker = h('select', {
    class: 'select',
    'aria-label': '选择带修订的文档',
    onchange: (e) => actions.openRevision(e.target.value),
  }, revised.map((d) => h('option', { value: d.id, selected: d.id === docId }, `${d.id} ${d.title}`)));

  const counts = model.counts;
  const shown = new Set(['exact', 'shifted', 'partial', 'ambiguous', 'lost']);

  const head = h('section', { class: 'panel' },
    h('div', { class: 'doc-head' },
      h('div', { class: 'doc-title-row' }, picker,
        h('span', { class: 'badge badge-neutral' }, `${model.v1.version} 至 ${model.v2.version}`),
        h('span', { class: 'type-chip type-' + model.doc.type }, model.doc.typeLabel)),
      h('p', { class: 'doc-lede' }, model.v2.note || '修订文本')),
    h('div', { class: 'callout' },
      h('p', {},
        '旧标注的坐标不能直接套到新文本上。下面每个标注都重新定位：只有位置被文本唯一确定时才自动落位；'
        + '同一段文字出现在多处、或整句被删时进入争议区，由审阅者在候选里指定，裁决记在独立层。')));

  const statRow = h('div', { class: 'stat-row' },
    statTile('原样保留', num(counts.exact || 0), { tone: 'ok' }),
    statTile('位置移动', num(counts.shifted || 0), { note: '内容未变，坐标变了' }),
    statTile('部分删除/插入', num(counts.partial || 0), { note: '区间内被改写' }),
    statTile('多处候选', num(counts.ambiguous || 0), { note: '进入争议区', tone: 'dispute' }),
    statTile('原文删除', num(counts.lost || 0), { note: '进入争议区', tone: 'lost' }));

  const opsPanel = h('section', { class: 'panel' },
    sectionTitle('修订操作', '逐字符状态来自「所有最优对齐」的可行性判定，不是某一次回溯的结果'),
    opsRibbon(model),
    perCharLegend(model),
    zonesPanel(model));

  const rows = model.rows.map((r) => migrationRow(ctx, model, r));
  const migrationPanel = h('section', { class: 'panel' },
    sectionTitle('标注迁移', `共 ${model.rows.length} 条；判为争议的 ${model.disputes.length} 条需要裁决`),
    table([
      { label: '标注' }, { label: '编码者' }, { label: '原区间', numeric: true },
      { label: '状态' }, { label: '新区间', numeric: true }, { label: '说明' }, { label: '候选' },
    ], rows, { minWidth: 820 }));

  const disputePanel = disputesPanel(ctx, model);

  const sideBySide = h('section', { class: 'panel' },
    sectionTitle('新旧文本对照', '修订前后逐句对照；插入与删除在对应位置标出'),
    textCompare(model));

  return h('div', { class: 'view-inner' },
    head, statRow, opsPanel, migrationPanel, disputePanel, sideBySide);
}

function opsRibbon(model) {
  const ops = model.map.ops;
  const totalOld = model.v1.text.length || 1;
  const totalNew = model.v2.text.length || 1;
  const oldRow = h('div', { class: 'ops-row', 'aria-label': '旧文本操作' });
  const newRow = h('div', { class: 'ops-row', 'aria-label': '新文本操作' });
  for (const op of ops) {
    if (op.type === 'equal') {
      const len = op.oldEnd - op.oldStart;
      oldRow.appendChild(h('span', {
        class: 'op-seg op-equal',
        style: { flex: `${len / totalOld} 0 0` },
        title: `保留 ${range(op.oldStart, op.oldEnd)} 至 ${range(op.newStart, op.newEnd)}`,
      }, len >= 8 ? model.v1.text.slice(op.oldStart, op.oldEnd) : ''));
      newRow.appendChild(h('span', {
        class: 'op-seg op-equal',
        style: { flex: `${len / totalNew} 0 0` },
      }));
    } else if (op.type === 'delete') {
      const len = op.oldEnd - op.oldStart;
      oldRow.appendChild(h('span', {
        class: 'op-seg op-delete',
        style: { flex: `${len / totalOld} 0 0` },
        title: `删除 ${model.v1.text.slice(op.oldStart, op.oldEnd)}`,
      }, len >= 6 ? '删除' : ''));
    } else if (op.type === 'insert') {
      const len = op.newEnd - op.newStart;
      newRow.appendChild(h('span', {
        class: 'op-seg op-insert',
        style: { flex: `${len / totalNew} 0 0` },
        title: `插入 ${model.v2.text.slice(op.newStart, op.newEnd)}`,
      }, len >= 6 ? '插入' : ''));
    }
  }
  const axis = h('div', { class: 'ops-axis' },
    h('span', {}, `${model.v1.text.length} 字`), h('span', {}, `${model.v2.text.length} 字`));
  return h('div', { class: 'ops-card' },
    h('div', { class: 'ops-label' }, '旧文本 v1'), oldRow,
    h('div', { class: 'ops-label' }, '新文本 v2'), newRow,
    axis,
    h('div', { class: 'ops-legend' },
      h('span', {}, h('span', { class: 'legend-swatch', style: { background: 'var(--ok-soft)' } }), '保留'),
      h('span', {}, h('span', { class: 'legend-swatch', style: { background: 'var(--topic-soft)' } }), '删除'),
      h('span', {}, h('span', { class: 'legend-swatch', style: { background: 'var(--seg-soft)' } }), '插入')));
}

function perCharLegend(model) {
  const text = model.v1.text;
  const status = model.map.perChar;
  const cells = [];
  for (let i = 0; i < text.length; i++) {
    const st = status[i];
    cells.push(h('span', {
      class: `pchar pchar-${st}`,
      title: `${i} 「${text[i]}」${st === 'kept' ? '保留' : st === 'deleted' ? '删除' : '多处候选'}`,
    }, text[i]));
  }
  return h('div', { class: 'pchar-card' },
    h('div', { class: 'pchar-head' },
      h('strong', {}, '旧文本逐字符状态'),
      h('span', { class: 'pc-legend' },
        h('span', { class: 'pc-key pc-kept' }, '保留'),
        h('span', { class: 'pc-key pc-ambiguous' }, '多处候选'),
        h('span', { class: 'pc-key pc-deleted' }, '删除'))),
    h('div', { class: 'pchar-text' }, cells),
    h('p', { class: 'fineprint' },
      `共 ${text.length} 字：保留 ${status.filter((s) => s === 'kept').length}、`
      + `多处候选 ${status.filter((s) => s === 'ambiguous').length}、删除 ${status.filter((s) => s === 'deleted').length}。`));
}

function zonesPanel(model) {
  const zones = model.map.ambiguityZones || [];
  if (!zones.length) return h('p', { class: 'fineprint' }, '没有连续的歧义片段。');
  return h('div', { class: 'zone-card' },
    h('div', { class: 'zone-head' }, '争议区（连续多处候选）'),
    zones.map((z) => h('div', { class: 'zone-row' },
      h('span', { class: 'mono' }, range(z.oldStart, z.oldEnd)),
      h('span', { class: 'zone-text' }, `「${z.text}」`),
      h('span', { class: 'muted' }, z.reason),
      h('span', { class: 'muted' }, `候选起点 ${z.candidates.slice(0, 8).join('、')}${z.candidates.length > 8 ? '…' : ''}`))));
}

function migrationRow(ctx, model, r) {
  const { actions } = ctx;
  const statusBadge = h('span', { class: `mig mig-${STATUS_TONE[r.status] || 'ok'}` }, migrationLabel(r));
  const cand = r.candidates || [];
  const target = r.start != null
    ? h('span', { class: 'mono' }, range(r.start, r.end))
    : h('span', { class: 'muted' }, '—');
  const reasons = h('div', { class: 'reason-list' }, (r.reasons || []).map((x) => h('div', {}, x)));
  let candidatesCell;
  if (!cand.length) {
    candidatesCell = h('span', { class: 'muted' }, r.status === 'lost' ? '无' : '—');
  } else if (r.status === 'ambiguous') {
    candidatesCell = h('div', { class: 'cand-list' }, cand.map((c, i) => h('button', {
      class: 'btn btn-sm btn-outline',
      type: 'button',
      title: `新文本「${model.v2.text.slice(c.start, c.end)}」`,
      onclick: () => ctx.actions.adjudicateMigration(model.doc, model.v2.version, r, cand, i),
    }, `候选 ${i + 1} ${range(c.start, c.end)}`)));
  } else {
    candidatesCell = h('span', { class: 'mono' }, `${cand[0].start}–${cand[0].end}`);
  }
  const idCell = h('div', { class: 'mig-id' },
    h('span', { class: 'mono' }, r.id || '—'),
    h('span', { class: 'mig-snippet' }, `「${r.oldText.length > 18 ? `${r.oldText.slice(0, 18)}…` : r.oldText}」`),
    h('div', { class: 'mig-topics' }, (r.topics || []).map((t) => topicChip(t, { small: true }))),
    r.policyDiffers ? badge('策略与穷举不同', 'warn') : null);
  void actions;
  return {
    cells: [
      idCell,
      r.coder === 'A' ? '甲' : '乙',
      h('span', { class: 'mono' }, `${range(r.source.start, r.source.end)}`),
      statusBadge,
      target,
      reasons,
      candidatesCell,
    ],
  };
}

function disputesPanel(ctx, model) {
  const { actions } = ctx;
  const rows = model.disputes;
  if (!rows.length) return emptyState('没有争议', '所有标注都能被唯一确定地迁移。');
  return h('section', { class: 'panel' },
    sectionTitle('争议区', '不能唯一确定位置的标注；选择候选或确认删除，都会写入独立裁决层'),
    h('div', { class: 'dispute-grid' }, rows.map((r) => h('div', { class: 'dispute-card' },
      h('div', { class: 'dispute-head' },
        h('span', { class: 'mono' }, r.id || '—'),
        h('span', { class: `mig mig-${STATUS_TONE[r.status]}` }, migrationLabel(r)),
        h('span', { class: 'muted' }, `${r.coder === 'A' ? '甲' : '乙'} · 原 ${range(r.source.start, r.source.end)}`)),
      h('p', { class: 'dispute-text' }, `「${r.oldText}」`),
      h('div', { class: 'dispute-cands' }, (r.candidates || []).map((c, i) => h('button', {
        class: 'cand-card',
        type: 'button',
        onclick: () => actions.adjudicateMigration(model.doc, model.v2.version, r, r.candidates, i),
      },
      h('div', { class: 'cand-head' }, `候选 ${i + 1} · ${range(c.start, c.end)}`),
      h('div', { class: 'cand-text' }, model.v2.text.slice(c.start, Math.min(c.end, c.start + 40)))))),
      r.status === 'lost'
        ? h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: () => actions.markLost(model.doc, model.v2.version, r),
        }, '确认原文已删除')
        : null,
      h('p', { class: 'fineprint' }, (r.reasons || []).join('；'))))));
}

function textCompare(model) {
  const ops = model.map.ops;
  const rows = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      const t = model.v1.text.slice(op.oldStart, op.oldEnd);
      rows.push(h('div', { class: 'cmp-row' },
        h('span', { class: 'cmp-tag cmp-eq' }, '保留'),
        h('div', { class: 'cmp-old' }, t),
        h('div', { class: 'cmp-new' }, model.v2.text.slice(op.newStart, op.newEnd))));
    } else if (op.type === 'delete') {
      rows.push(h('div', { class: 'cmp-row' },
        h('span', { class: 'cmp-tag cmp-del' }, '删除'),
        h('div', { class: 'cmp-old is-del' }, model.v1.text.slice(op.oldStart, op.oldEnd)),
        h('div', { class: 'cmp-new muted' }, '（无）')));
    } else if (op.type === 'insert') {
      rows.push(h('div', { class: 'cmp-row' },
        h('span', { class: 'cmp-tag cmp-ins' }, '插入'),
        h('div', { class: 'cmp-old muted' }, '（无）'),
        h('div', { class: 'cmp-new is-ins' }, model.v2.text.slice(op.newStart, op.newEnd))));
    }
  }
  return h('div', { class: 'cmp-table' }, rows);
}

