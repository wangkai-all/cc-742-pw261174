// Drift: raw vs composition-adjusted topic shares, Theil–Sen trend, permutation
// test, and the "composition, not personal drift" verdict — with the example
// clauses that drive each window.

import { h, num, pct, signedPct } from '../dom.js';
import { s } from '../dom.js';
import { table, sectionTitle, statTile, topicChip, topicLabel, legend, kv } from '../components/ui.js';
import { topicColor, rgba } from '../theme.js';

export function driftView(ctx) {
  const { state, actions } = ctx;
  const analysis = state.analysis;
  const pick = state.ui.driftPick;
  const coder = pick.coder;
  const drift = analysis.drift[coder];
  const other = analysis.drift[coder === 'A' ? 'B' : 'A'];
  const topics = state.corpus.meta.topics;

  const head = h('section', { class: 'panel' },
    h('div', { class: 'drift-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, '时间窗 w1–w5 · 每窗 5 篇'),
        h('h2', { class: 'hero-title small' }, '每个主题算两遍：观测值与按全期构成重新加权'),
        h('p', { class: 'hero-lede' },
          '批次构成在变（投诉占比下降、建议上升）。如果只看原始占比，编码者甲对「收费」的关注像是上升了；'
          + '把每个时间窗内的文体构成重新加权到全期比例后，趋势消失。只有重新加权后仍显著的趋势才算个人标准变化。')),
      h('div', { class: 'segmented' },
        ['A', 'B'].map((c) => h('button', {
          class: `seg-btn${coder === c ? ' is-on' : ''}`,
          type: 'button',
          onclick: () => actions.driftPick({ coder: c }),
        }, c === 'A' ? '编码者甲' : '编码者乙')))),
    driftVerdictCards(drift, coder));

  const tableRows = drift.results.map((r) => {
    const tone = r.significant ? (r.adjustedSlope > 0 ? 'up' : 'down') : r.compositionDriven ? 'comp' : 'flat';
    return {
      __class: 'row-click',
      cells: [
        topicChip(r.topic, { small: true }),
        h('span', { class: 'mono' }, signedPct(r.rawSlope, 2)),
        h('span', { class: 'mono' }, signedPct(r.adjustedSlope, 2)),
        h('span', { class: 'mono' }, signedPct(-r.compositionEffect, 2)),
        r.rawTest.p > 0.9999 ? '>0.99' : r.rawTest.p.toFixed(3),
        r.test.p > 0.9999 ? '>0.99' : r.test.p.toFixed(3),
        h('span', { class: `verdict verdict-${tone}` }, r.verdict),
      ],
    };
  });

  const tablePanel = h('section', { class: 'panel' },
    sectionTitle('逐主题趋势', '斜率单位为「每窗口百分点」；p 值来自 2000 次置换检验，固定随机种子'),
    table([
      { label: '主题' }, { label: '原始斜率', numeric: true }, { label: '调整后斜率', numeric: true },
      { label: '构成效应', numeric: true }, { label: '原始 p', numeric: true }, { label: '调整后 p', numeric: true },
      { label: '判定' },
    ], tableRows),
    h('p', { class: 'fineprint' },
      '构成效应 = 原始斜率 − 调整后斜率。构成效应大而调整后不显著，说明观察到的是批次构成变化。'));

  const focus = drift.results.find((r) => r.topic === pick.topic) || drift.results[0];
  const focusPanel = h('section', { class: 'panel' },
    sectionTitle(`样例：${topicLabel(focus.topic)}`, '逐窗占比与构成调整的逐项对照'),
    shareChart(focus, drift.windows),
    h('div', { class: 'chart-legend' },
      legend([
        { color: 'var(--ink-3)', label: '原始占比' },
        { color: topicColor(focus.topic), label: '构成调整后' },
      ]),
      h('span', { class: 'muted small' }, '扇形为置换零假设的 5%–95% 斜率范围，从首个窗口展开')),
    h('div', { class: 'topic-picker-row' }, topics.map((t) => h('button', {
      class: `topic-choice${focus.topic === t.id ? ' is-on' : ''}`,
      type: 'button',
      onclick: () => actions.driftPick({ topic: t.id }),
    }, topicChip(t.id, { small: true })))),
    windowTable(focus, drift, analysis.corpus, coder));

  const relativePanel = h('section', { class: 'panel' },
    sectionTitle('两人对比', '两名编码者在同一主题上的调整后斜率差异；只在一方显著的标为「仅…」'),
    table([
      { label: '主题' }, { label: '甲调整后斜率', numeric: true }, { label: '乙调整后斜率', numeric: true },
      { label: '差值', numeric: true }, { label: '谁在变' },
    ], analysis.relative.map((r) => ({
      cells: [
        topicChip(r.topic, { small: true }),
        h('span', { class: 'mono' }, signedPct(r.aSlope, 2)),
        h('span', { class: 'mono' }, signedPct(r.bSlope, 2)),
        h('span', { class: 'mono' }, signedPct(r.difference, 2)),
        r.onlyA ? '仅甲显著' : r.onlyB ? '仅乙显著' : r.both ? '双方都显著' : h('span', { class: 'muted' }, '都不显著'),
      ],
    }))));

  const examples = driftExamples(analysis, coder, focus.topic);

  return h('div', { class: 'view-inner' },
    head, tablePanel, focusPanel, relativePanel,
    h('div', { class: 'two-col' }, examples.panel, driftMethodPanel(drift)));
}

function driftVerdictCards(drift, coder) {
  const sig = drift.results.filter((r) => r.significant && !r.compositionDriven);
  const comp = drift.results.filter((r) => r.compositionDriven);
  return h('div', { class: 'stat-row' },
    statTile('个人标准变化', sig.length ? sig.map((r) => topicLabel(r.topic)).join('、') : '无显著项',
      { note: sig.length ? sig.map((r) => `${topicLabel(r.topic)} ${signedPct(r.adjustedSlope, 1)}`).join('；') : '调整后均不显著', tone: sig.length ? 'topic' : 'ok' }),
    statTile('构成变化所致', comp.length ? comp.map((r) => topicLabel(r.topic)).join('、') : '无',
      { note: comp.length ? '原始序列看似变化，重加权后消失' : '没有需要归因于构成的假信号', tone: 'comp' }),
    statTile('可用时间窗', `${drift.windows.length} 个`, {
      note: drift.excluded.length ? `排除：${drift.excluded.map((e) => `${e.window}（${e.reason}）`).join('；')}` : `标注 ${num(drift.totals.annotations)} 段`,
    }),
    statTile('检验方式', 'Theil–Sen + 置换', { note: `种子 20261124 · 显著性水平 0.05 · ${coder === 'A' ? '甲' : '乙'}` }));
}

function shareChart(result, windows) {
  const W = 640;
  const H = 240;
  // A wide right gutter holds the two end-of-line labels outside the plot, so
  // they never sit on the series or on each other.
  const pad = { l: 44, r: 104, t: 16, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const values = [...result.series.raw, ...result.series.adjusted].filter((v) => v != null);
  const max = Math.max(0.05, ...values) * 1.15;
  const x = (i) => pad.l + (windows.length === 1 ? iw / 2 : (i / (windows.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'line-chart',
    role: 'img',
    'aria-label': `${topicLabel(result.topic)}：原始与调整后占比`,
  });
  // Permutation null as a slope fan: start from the first adjusted point and
  // spread by the 5th/95th percentile null slopes. Drawing the quantiles as a
  // horizontal band would be wrong — they are slopes, not levels. The fan is
  // clipped to the plot area; a wide fan is the point (it says "this much change
  // is consistent with shuffling"), so it must not spill over the axis.
  const band = result.test.nullQuantiles;
  const i0 = result.series.adjusted.findIndex((v) => v != null);
  if (band && i0 >= 0) {
    const clipId = `null-clip-${Math.random().toString(36).slice(2, 8)}`;
    const defs = s('defs', {}, s('clipPath', { id: clipId },
      s('rect', { x: pad.l, y: pad.t, width: iw, height: ih })));
    svg.appendChild(defs);
    const v0 = result.series.adjusted[i0];
    const n = result.series.adjusted.length - 1;
    const lo = y(Math.max(0, v0 + band.p05 * (n - i0)));
    const hi = y(Math.min(max, v0 + band.p95 * (n - i0)));
    svg.appendChild(s('path', {
      d: `M${x(i0).toFixed(1)},${y(v0).toFixed(1)} L${x(n).toFixed(1)},${lo.toFixed(1)}`
        + ` L${x(n).toFixed(1)},${hi.toFixed(1)} Z`,
      class: 'null-fan',
      'clip-path': `url(#${clipId})`,
      fill: rgba(topicColor(result.topic), 0.12),
    }));
  }
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    svg.appendChild(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid-line' }));
    svg.appendChild(s('text', { x: pad.l - 6, y: y(v) + 3, class: 'axis-text', 'text-anchor': 'end' }, `${(v * 100).toFixed(0)}%`));
  }
  windows.forEach((w, i) => {
    svg.appendChild(s('text', { x: x(i), y: H - 8, class: 'axis-text', 'text-anchor': 'middle' }, w));
  });
  const pathFor = (series, cls) => {
    const pts = series.map((v, i) => (v == null ? null : [x(i), y(v), v])).filter(Boolean);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    svg.appendChild(s('path', { d, class: cls, fill: 'none' }));
    for (const p of pts) {
      const dot = s('circle', { cx: p[0], cy: p[1], r: 4, class: `${cls}-dot` });
      dot.appendChild(s('title', {}, `${(p[2] * 100).toFixed(1)}%`));
      svg.appendChild(dot);
    }
    return pts;
  };
  pathFor(result.series.raw, 'series-raw');
  pathFor(result.series.adjusted, 'series-adjusted');
  // Both labels live in the right gutter, anchored to the left so they clear the
  // plot edge; nudge them apart if the two series end close together.
  const labelX = W - pad.r + 8;
  const endAdjusted = result.series.adjusted[result.series.adjusted.length - 1];
  const endRaw = result.series.raw[result.series.raw.length - 1];
  if (endAdjusted != null) {
    svg.appendChild(s('text', {
      x: labelX, y: y(endAdjusted) + 4, class: 'direct-label', 'text-anchor': 'start',
    }, `调整后 ${(endAdjusted * 100).toFixed(1)}%`));
  }
  if (endRaw != null) {
    let ly = y(endRaw) + 4;
    if (endAdjusted != null && Math.abs(ly - (y(endAdjusted) + 4)) < 18) ly = y(endAdjusted) + 22;
    svg.appendChild(s('text', { x: labelX, y: ly, class: 'direct-label muted', 'text-anchor': 'start' },
      `原始 ${(endRaw * 100).toFixed(1)}%`));
  }
  return h('div', { class: 'chart-wrap' }, svg);
}

function windowTable(result, drift, corpus, coder) {
  const byWindow = new Map();
  for (const doc of corpus.documents) {
    if (!byWindow.has(doc.window)) byWindow.set(doc.window, []);
    byWindow.get(doc.window).push(doc);
  }
  const rows = drift.windows.map((w, i) => ({
    cells: [
      w,
      h('span', { class: 'mono' }, result.series.raw[i] == null ? '—' : pct(result.series.raw[i], 1)),
      h('span', { class: 'mono' }, result.series.adjusted[i] == null ? '—' : pct(result.series.adjusted[i], 1)),
      h('span', { class: 'mono' }, pct(result.series.coverage[i], 0)),
      h('span', { class: 'mini-docs' }, (byWindow.get(w) || []).map((d) => h('span', {
        class: `mini-chip type-${d.type}`,
        title: `${d.id} ${d.typeLabel}`,
      }, d.type))),
    ],
  }));
  return h('div', { class: 'subtable' },
    h('div', { class: 'subtable-title' }, `${coder === 'A' ? '甲' : '乙'} · ${topicLabel(result.topic)} 的逐窗数值`),
    table([
      { label: '窗口' }, { label: '原始', numeric: true }, { label: '调整后', numeric: true },
      { label: '参照构成覆盖', numeric: true }, { label: '本窗文体构成' },
    ], rows),
    result.series.coverage.some((c) => c < 0.999)
      ? h('p', { class: 'fineprint' },
        `某些窗口缺少参照构成中的文体（如 w1 没有 S 类），调整值只覆盖部分参照比例，coverage 小于 100%；`
        + '不插补缺失文体，由读者判断可比性。')
      : null);
}

function driftExamples(analysis, coder, topic) {
  const docs = [];
  for (const { doc } of analysis.docs) {
    const spans = doc.annotations.filter((a) => a.coder === coder && a.topics.includes(topic));
    if (!spans.length) continue;
    const text = doc.versions[0].text;
    docs.push({ doc, spans, text });
  }
  // Pick the first and last window's examples for contrast.
  const first = docs.filter((d) => d.doc.window === analysis.drift[coder].windows[0]);
  const last = docs.filter((d) => d.doc.window === analysis.drift[coder].windows[analysis.drift[coder].windows.length - 1]);
  const panel = h('section', { class: 'panel' },
    sectionTitle('漂移样例', '该主题在每个窗口被标注的原文片段'),
    h('div', { class: 'ex-compare' },
      h('div', { class: 'ex-col' },
        h('div', { class: 'ex-col-title' }, `首个窗口 ${analysis.drift[coder].windows[0]} · ${first.length} 处`),
        first.slice(0, 4).map((d) => exItem(d, topic, coder))),
      h('div', { class: 'ex-col' },
        h('div', { class: 'ex-col-title' }, `末个窗口 ${analysis.drift[coder].windows[analysis.drift[coder].windows.length - 1]} · ${last.length} 处`),
        last.slice(0, 4).map((d) => exItem(d, topic, coder)))),
    h('p', { class: 'fineprint' },
      '样例用来检验判定：如果「收费」在首个窗口只在咨询类里出现、末个窗口因咨询类变多而更常见，就是构成变化；'
      + '如果同一类文体里也开始标「收费」，才是个人标准的移动。'));
  return { panel, docs };
}

function exItem({ doc, spans, text }, topic, coder) {
  void coder;
  return h('div', { class: 'ex-item' },
    h('div', { class: 'ex-meta' },
      h('span', { class: 'doc-id' }, doc.id),
      h('span', { class: `type-chip type-${doc.type}` }, doc.typeLabel),
      h('span', { class: 'muted small' }, doc.date)),
    h('div', { class: 'ex-text' }, text.slice(spans[0].start, Math.min(spans[0].end, spans[0].start + 46))),
    h('div', { class: 'ex-tags' }, spans[0].topics.map((t) => topicChip(t, { small: true }))));
}

function driftMethodPanel(drift) {
  const w = drift.windows[0];
  return h('section', { class: 'panel' },
    sectionTitle('方法', '为什么不用「每窗平均标签数」直接下结论'),
    h('ol', { class: 'method-list' },
      h('li', {}, '按时间窗汇总该编码者的标注；每个时间窗内再按文体（投诉/建议/咨询）分层。'),
      h('li', {}, '每个主题的占比 = 该主题被标注的字符数 / 该层被标注的字符总数。'),
      h('li', {}, '调整后占比：把各层按「全期总字符数」加权，得到只反映层内变化的序列。'),
      h('li', {}, '用 Theil–Sen 求中位斜率（对单个异常窗口稳健），再对时间顺序做置换检验。'),
      h('li', {}, '只有调整后序列显著（p 不超过 0.05）才判为个人标准变化；原始显著而调整后不显著，判为批次构成变化。')),
    kv([
      ['第一个可用窗口', `${w}（${drift.windows.length} 个）`],
      ['置换次数', '2000'],
      ['随机种子', '20261124'],
    ]));
}
