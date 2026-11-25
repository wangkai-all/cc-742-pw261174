// Examples and self-check: the four constructed cases (repeated text, overlap,
// mid-insertion, deletion) rendered with the per-character reference beside the
// batch result, plus the in-browser whole-corpus verification run.

import { h, range, num, icon } from '../dom.js';
import { table, sectionTitle, statTile, topicChip, topicLabel, badge } from '../components/ui.js';
import { runExamples } from '../../core/examples.js';
import { verifyCorpus } from '../../core/verify.js';
import { charLabels } from '../../core/text.js';
import { getVerifyReport, setVerifyReport } from '../verifyCache.js';

export function examplesView(ctx) {
  const { state, actions } = ctx;
  const run = runExamples();
  const cases = run.cases;

  const head = h('section', { class: 'panel panel-hero' },
    h('div', { class: 'hero-grid' },
      h('div', {},
        h('p', { class: 'eyebrow' }, '构造样例 · 逐字符核对'),
        h('h2', { class: 'hero-title small' }, '四个必须处理对的边界情形'),
        h('p', { class: 'hero-lede' },
          '相同文字多次出现、交叠的多标签区间、中途插入文本、整句删除——每一种都用逐字符参照实现核对批量算法。'
          + '下面的每个判定都在本页实时重新计算，并与暴力枚举的最优对齐比较。')),
      h('div', { class: 'hero-stats' },
        statTile('样例检查', `${run.passed} / ${run.total}`, { note: run.ok ? '全部通过' : `${run.failed} 项不符`, tone: run.ok ? 'ok' : 'topic' }),
        statTile('逐字符参照', 'labelsAt()', { note: '每个字符单独求标签集合' }),
        statTile('迁移参照', '暴力枚举对齐', { note: '枚举全部最优 LCS 对齐' }))));

  const cards = cases.map((c) => caseCard(ctx, c));

  const verifyPanel = verifySection(ctx);

  return h('div', { class: 'view-inner' }, head, ...cards, verifyPanel);
}

function caseCard(ctx, c) {
  const body = c.kind === 'migration' ? migrationCase(ctx, c) : codingCase(ctx, c);
  return h('section', { class: 'panel example-card' },
    h('div', { class: 'example-head' },
      h('div', {},
        h('h3', { class: 'example-title' }, c.title),
        h('p', { class: 'example-q' }, c.question),
        h('p', { class: 'example-a' }, c.answer)),
      h('span', { class: `${c.checks.every((x) => x.pass) ? 'badge badge-ok' : 'badge badge-warn'}` },
        c.checks.every((x) => x.pass) ? '核对通过' : '有出入')),
    body,
    checksList([...c.checks, ...(c.variant ? c.variant.checks : [])]));
}

function migrationCase(ctx, c) {
  const oldCells = [...c.oldText].map((ch, i) => {
    const inSpan = c.span && i >= c.span[0] && i < c.span[1];
    return h('span', { class: `plain-char${inSpan ? ' in-span' : ''}`, title: `${i}` }, ch);
  });
  const newMarks = [];
  if (c.rows) {
    for (const row of c.rows) {
      newMarks.push({ start: row.start, end: row.end, label: `候选 ${row.index + 1}` });
    }
  }
  const newCells = [...c.newText].map((ch, i) => {
    const row = (c.rows || []).find((r) => i >= r.start && i < r.end);
    return h('span', {
      class: `plain-char${row ? ' in-cand' : ''}`,
      title: row ? `候选 ${row.index + 1}` : `${i}`,
    }, ch);
  });
  const zone = c.id === 'insert'
    ? h('div', { class: 'insert-parts' }, c.parts.map((p) => h('span', {
      class: `part${p.inserted ? ' is-inserted' : ''}`,
    }, p.text)))
    : null;
  return h('div', { class: 'example-body' },
    h('div', { class: 'plain-block' },
      h('div', { class: 'plain-label' }, `旧文本 · 标注 [${c.span[0]}, ${c.span[1]})`),
      h('div', { class: 'plain-text' }, oldCells)),
    zone,
    h('div', { class: 'plain-block' },
      h('div', { class: 'plain-label' }, '新文本'),
      h('div', { class: 'plain-text' }, newCells)),
    c.rows
      ? h('div', { class: 'cand-grid' }, c.rows.map((row) => h('div', { class: 'cand-box' },
        h('div', { class: 'cand-box-head' }, `候选 ${row.index + 1} · ${range(row.start, row.end)}`),
        h('div', { class: 'cand-box-text' }, row.text),
        h('div', { class: 'cand-box-meta' }, row.alsoInBrute ? '在暴力枚举结果中' : '仅策略判定'))))
      : null,
    c.notes ? h('ul', { class: 'note-list' }, c.notes.map((n) => h('li', {}, n))) : null,
    c.exactCandidates && c.exactCandidates.length
      ? h('div', { class: 'ref-line' },
        h('span', { class: 'ref-label' }, '穷举参照'),
        h('span', { class: 'mono small' }, c.exactCandidates.map((x) => `[${x.start},${x.end})`).join('  ')),
        h('span', { class: 'muted small' }, `暴力枚举 ${c.alignmentCount} 种最优对齐`))
      : null,
    c.id === 'delete'
      ? h('div', { class: 'ref-line' },
        h('span', { class: 'ref-label' }, '策略裁定'),
        h('span', { class: 'mono small' }, `status=${c.policy.status}`),
        h('span', { class: 'muted small' }, '被删句子里的散字没有构成连续锚点'))
      : null);
}

function codingCase(ctx, c) {
  const renderCoding = (codings, title, runs, attr, cmp) => {
    const { text } = c;
    const refA = charLabels(codings.A, text.length);
    const refB = charLabels(codings.B, text.length);
    const cells = [...text].map((ch, i) => {
      const a = refA[i];
      const b = refB[i];
      const same = a.join('|') === b.join('|');
      return h('span', {
        class: `plain-char${same ? '' : ' diff-char'}`,
        title: `A: ${a.map(topicLabel).join('+') || '—'} / B: ${b.map(topicLabel).join('+') || '—'}`,
      }, ch);
    });
    const spanRows = ['A', 'B'].flatMap((side) => (codings[side] || []).map((sp) => ({
      cells: [
        side === 'A' ? '甲' : '乙',
        h('span', { class: 'mono small' }, range(sp.start, sp.end)),
        h('span', { class: 'topic-cell' }, sp.topics.map((t) => topicChip(t, { small: true }))),
        h('span', { class: 'snip' }, text.slice(sp.start, Math.min(sp.end, sp.start + 24))),
      ],
    })));
    return h('div', { class: 'coding-block' },
      title ? h('div', { class: 'coding-title' }, title) : null,
      h('div', { class: 'plain-text' }, cells),
      h('div', { class: 'run-list' }, runs.map((r) => h('div', { class: 'run-row' },
        h('span', { class: 'mono small' }, range(r.start, r.end)),
        h('span', { class: 'run-a' }, `甲 ${r.a ? r.a.split('+').map(topicLabel).join('+') : '—'}`),
        h('span', { class: 'run-b' }, `乙 ${r.b ? r.b.split('+').map(topicLabel).join('+') : '—'}`),
        h('span', { class: 'run-verdict' }, r.a === r.b ? (r.a ? '标签集合相同' : '都未标注') : '标签集合不同')))),
      h('div', { class: 'attr-inline' },
        h('span', {}, `归因：一致 ${num(attr.agree - attr.agreeCut)} · 边界 ${num(attr.agreeCut)} · 主题 ${num(attr.topicDiff)} · 漏标 ${num(attr.onlyA + attr.onlyB)}`),
        h('span', { class: 'muted small' }, `逐字符分歧 ${num(cmp.disagreeChars)} 字`)),
      table([
        { label: '编码者' }, { label: '区间' }, { label: '主题' }, { label: '文字' },
      ], spanRows));
  };
  return h('div', { class: 'example-body' },
    renderCoding(c.codings, '情形一', c.runs, c.attr, c.cmp),
    renderCoding(c.variant.codings, '情形二 · ' + c.variant.title, c.variant.runs, c.variant.attr, c.variant.cmp));
}

function checksList(checks) {
  return h('div', { class: 'check-list' }, checks.map((c) => h('div', { class: `check-row${c.pass ? '' : ' is-fail'}` },
    h('span', { class: `check-mark${c.pass ? '' : ' is-fail'}`, title: c.pass ? '通过' : '不符' }, icon(c.pass ? 'check' : 'cross')),
    h('span', { class: 'check-label' }, c.label),
    h('span', { class: 'check-detail mono' }, c.detail))));
}

function verifySection(ctx) {
  const { state, actions } = ctx;
  const report = getVerifyReport();
  const running = state.ui.verifyRunning;
  const host = h('section', { class: 'panel' },
    sectionTitle('全语料自检', '每篇文档的区间扫描、归因、主题贡献、覆盖、区块都用逐字符参照重算；修订文档另做暴力枚举'),
    h('div', { class: 'verify-actions' },
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        disabled: running,
        onclick: () => runVerify(ctx),
      }, running ? '正在运行…' : report ? '重新运行自检' : '运行自检'),
      report
        ? h('span', { class: 'muted small' }, `${report.passedChecks}/${report.checks.length} 项通过 · 共检查 ${num(report.total)} 项`)
        : h('span', { class: 'muted small' }, '约需 2–4 秒（迁移片段会做暴力枚举）')));

  if (report) {
    host.appendChild(h('div', { class: 'stat-row' },
      statTile('检查项', `${report.passedChecks}/${report.checks.length}`, { tone: report.ok ? 'ok' : 'topic' }),
      statTile('检查总数', num(report.total), { note: '逐字符与逐区间的比对次数' }),
      statTile('失败项', num(report.failedChecks), { tone: report.failedChecks ? 'topic' : 'ok' })));
    host.appendChild(verifyChecks(report));
    host.appendChild(h('p', { class: 'fineprint' },
      '自检结果由浏览器实时计算。本地运行 npm test 会用同一套函数做单元测试断言。'));
  }
  void actions;
  return host;
}

function verifyChecks(report) {
  const groups = new Map();
  for (const c of report.checks) {
    const kind = c.id.split(':')[0];
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(c);
  }
  const titles = {
    sweep: '区间扫描 = labelsAt',
    attribute: '区域归因 = 逐字符分类',
    topics: '主题贡献 = 逐字符计数',
    coverage: '主题覆盖 = 逐字符累加',
    blocks: '区块铺满 = 逐字符标签',
    migration: '迁移定位 = 暴力枚举',
  };
  return h('div', { class: 'verify-groups' }, [...groups.entries()].map(([kind, checks]) => {
    const failed = checks.filter((c) => !c.passed);
    return h('div', { class: 'verify-group' },
      h('div', { class: 'vg-head' },
        h('div', {},
          h('strong', {}, titles[kind] || kind),
          h('span', { class: 'muted small' }, ` ${checks.length} 项`)),
        failed.length ? badge(`${failed.length} 项不符`, 'warn') : badge('全部通过', 'ok')),
      failed.length
        ? table([
          { label: '检查' }, { label: '失败' }, { label: '示例' },
        ], failed.slice(0, 8).map((c) => ({
          cells: [
            h('span', { class: 'mono small' }, c.id),
            c.failureCount,
            h('span', { class: 'mono small' }, JSON.stringify(c.failures[0] || {}).slice(0, 120)),
          ],
        })))
        : h('div', { class: 'vg-method' },
          h('span', { class: 'muted small' }, checks[0]?.method || ''),
          h('span', { class: 'mono small' }, `共 ${num(checks.reduce((n, c) => n + c.total, 0))} 次比对`)));
  }));
}

function runVerify(ctx) {
  ctx.actions.setUiRaw?.({ verifyRunning: true });
  ctx.emit();
  setTimeout(() => {
    try {
      const report = verifyCorpus(ctx.state.corpus, { slices: 60, maxLen: 12 });
      setVerifyReport(report);
    } catch (err) {
      setVerifyReport({
        checks: [{ id: 'error', title: '自检失败', method: String(err?.message || err), total: 0, failures: [], failureCount: 1, passed: false }],
        total: 0, passedChecks: 0, failedChecks: 1, ok: false, ranAt: new Date().toISOString(),
      });
    }
    ctx.actions.setUiRaw?.({ verifyRunning: false });
    ctx.emit();
  }, 30);
}
