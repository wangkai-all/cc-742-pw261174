// Entry point: wires the store, the views and the document-level actions.

import {
  state, boot, subscribe, emit, setView, setUi, decisionsFor, addDecision, retractDecision,
  clearDecisions, effectiveFor, revisionModel, documentAnalysis, topicMeta, toast,
} from './store.js';
import { h, mount } from './dom.js';
import { shell } from './components/shell.js';
import { setTopicMeta } from './components/ui.js';
import { adjudicationDelta } from '../core/overlay.js';
import { setTheme } from './theme.js';
import { overviewView } from './views/overview.js';
import { alignView, spanEditorDialog } from './views/align.js';
import { revisionView } from './views/revision.js';
import { adjudicateView } from './views/adjudicate.js';
import { driftView } from './views/drift.js';
import { examplesView } from './views/examples.js';

const root = document.getElementById('root');
let hoverId = null;
let pending = null;

// ---------------------------------------------------------------------------
// Actions (the only way views change state)
// ---------------------------------------------------------------------------
const actions = {
  rerender: () => render(),
  setView(id) {
    setView(id);
  },
  setDoc(id) {
    const doc = state.docById.get(id);
    if (!doc) return;
    pending = null;
    setUi({ docId: id, version: doc.versions[0].version, compare: 'original' });
  },
  openDoc(id) {
    const doc = state.docById.get(id);
    if (!doc) return;
    pending = null;
    setUi({ view: 'align', docId: id, version: doc.versions[0].version, compare: 'original' });
  },
  openRevision(id) {
    setUi({ view: 'revision', revisionDocId: id });
  },
  setDocVersion(docId, version) {
    pending = null;
    setUi({ docId, version, compare: 'original' });
  },
  setCompare(mode) {
    setUi({ compare: mode });
  },
  setStatsFrom(which) {
    setUi({ statsFrom: which });
  },
  setUiDoc(docId) {
    pending = null;
    setUi({ docId, version: state.docById.get(docId).versions[0].version, compare: 'original' });
  },
  hasDecisions(docId) {
    return decisionsFor(docId).length > 0;
  },
  decisions: (docId) => decisionsFor(docId),
  effective(docId, version) {
    const doc = state.docById.get(docId);
    return effectiveFor(doc, version);
  },
  docModel(docId, version) {
    const doc = state.docById.get(docId);
    return documentAnalysis(doc, version, state.ui.statsFrom);
  },
  diffMarks(docId, version) {
    const doc = state.docById.get(docId);
    const eff = effectiveFor(doc, version);
    const originals = version === doc.versions[0].version ? doc.annotations : revisionModel(docId).basis;
    const text = (doc.versions.find((v) => v.version === version) || doc.versions[0]).text;
    const delta = adjudicationDelta(originals, eff.annotations, text.length);
    return delta.length ? [{ start: delta[0].pos, end: delta[delta.length - 1].pos + 1, tone: 'changed', label: `${delta.length} 个字符的标签被裁决改变` }] : [];
  },
  beginSelection(docId, version, start, end) {
    pending = { docId, version, start, end };
    setUi({ pendingSelection: { start, end } });
  },
  clearSelection() {
    pending = null;
    setUi({ pendingSelection: null });
  },
  editSelection(doc, version, start, end) {
    spanEditorDialog(ctx, { doc, version, start, end, onDone: () => actions.clearSelection() });
  },
  hoverSpan(id) {
    hoverId = id;
    for (const el of document.querySelectorAll('.track-band')) {
      el.classList.toggle('is-hover', Boolean(id) && el.dataset.id === id);
    }
    for (const row of document.querySelectorAll('[data-span-id]')) {
      row.classList.toggle('is-hover', Boolean(id) && row.dataset.spanId === id);
    }
  },
  focusSpan(span, docId, version) {
    const doc = state.docById.get(docId);
    const text = (doc.versions.find((v) => v.version === version) || doc.versions[0]).text;
    spanEditorDialog(ctx, { doc, version, start: span.start, end: span.end, span, onDone: () => {} });
  },
  focusRegion(region, docId, version) {
    pending = { docId, version, start: region.start, end: region.end };
    setUi({ pendingSelection: { start: region.start, end: region.end } });
    requestAnimationFrame(() => {
      document.querySelector('.track-host')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  },
  saveSpanDecision({ doc, version, span, coder, start, end, topics }) {
    if (span && coder !== 'R' && (span.origin !== 'adjudicated')) {
      addDecision(doc.id, {
        kind: 'replace',
        annotationId: span.id,
        textVersion: version,
        coder: span.coder,
        start,
        end,
        topics,
        note: `裁决修改主题/范围（原 ${span.topics.join('+') || '无'}）`,
      });
      toast('已追加替换记录；原始标注未改动');
    } else if (span) {
      // Editing an already-adjudicated span: reject the old decision's output by
      // rejecting its source when possible, then add the new range.
      addDecision(doc.id, {
        kind: 'add',
        textVersion: version,
        coder,
        start,
        end,
        topics,
        sourceId: span.sourceId || null,
        note: '在裁决层内追加修正',
      });
      toast('已追加新的裁决区间');
    } else {
      addDecision(doc.id, {
        kind: 'add',
        textVersion: version,
        coder: coder === 'R' ? 'R' : coder,
        start,
        end,
        topics,
        note: '裁决新增区间',
      });
      toast('已新增裁决区间');
    }
    pending = null;
    setUi({ pendingSelection: null, compare: 'adjudicated' });
  },
  rejectSpan(doc, version, span) {
    addDecision(doc.id, {
      kind: 'reject',
      annotationId: span.id,
      textVersion: version,
      coder: span.coder,
      note: '裁决驳回该区间',
    });
    toast('已追加驳回记录');
  },
  splitSpan(doc, version, span, cut) {
    const parts = [
      { start: span.start, end: cut, topics: [...span.topics] },
      { start: cut, end: span.end, topics: [...span.topics] },
    ];
    addDecision(doc.id, {
      kind: 'split',
      annotationId: span.id,
      textVersion: version,
      coder: span.coder,
      parts,
      note: `在 ${cut} 处拆分`,
    });
    toast('已追加拆分记录');
  },
  mergeSpans(doc, version, spans) {
    const ids = spans.map((s) => s.id);
    addDecision(doc.id, {
      kind: 'merge',
      annotationIds: ids,
      textVersion: version,
      coder: spans[0].coder,
      note: `合并 ${ids.length} 段`,
    });
    toast('已追加合并记录');
  },
  retract(docId, id) {
    retractDecision(docId, id);
    toast('已追加撤销记录（原记录保留）');
  },
  adjudicateMigration(doc, version, ann, candidates, index) {
    const c = candidates[index];
    addDecision(doc.id, {
      kind: 'add',
      textVersion: version,
      coder: ann.coder,
      start: c.start,
      end: c.end,
      topics: [...ann.topics],
      sourceId: ann.id,
      candidateIndex: index,
      note: `迁移争议：选择候选 ${index + 1}`,
    });
    toast(`已按候选 ${index + 1} 落位并记入裁决层`);
  },
  markLost(doc, version, ann) {
    addDecision(doc.id, {
      kind: 'reject',
      annotationId: ann.id,
      textVersion: version,
      coder: ann.coder,
      note: '迁移争议：确认原文已删除',
    });
    toast('已记录「原文删除」的裁决');
  },
  clearAll() {
    clearDecisions();
    toast('已清空本地裁决层');
  },
  driftPick(patch) {
    setUi({ driftPick: { ...state.ui.driftPick, ...patch } });
  },
  async refreshVerify() {
    setUi({ verifyRunId: (state.ui.verifyRunId || 0) + 1 });
  },
  setUiRaw(patch) {
    Object.assign(state.ui, patch);
  },
  toast: (text) => toast(text),
};

const ctx = { state, actions, emit, toast };

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const VIEWS = {
  overview: overviewView,
  align: alignView,
  revision: revisionView,
  adjudicate: adjudicateView,
  drift: driftView,
  examples: examplesView,
};

function render() {
  const scrollY = window.scrollY;
  const view = VIEWS[state.ui.view] || overviewView;
  mount(root, shell(ctx, view(ctx)));
  if (hoverId) actions.hoverSpan(hoverId);
  window.scrollTo(0, Math.min(scrollY, document.body.scrollHeight));
}

function syncHash() {
  const { view, docId } = state.ui;
  const next = `#/${view}${docId ? `/${docId}` : ''}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function readHash() {
  const m = /^#\/([a-z]+)(?:\/([A-Za-z0-9-]+))?/.exec(location.hash || '');
  if (!m) return;
  if (VIEWS[m[1]]) state.ui.view = m[1];
  if (m[2] && state.docById.has(m[2])) {
    state.ui.docId = m[2];
    state.ui.version = state.docById.get(m[2]).versions[0].version;
  }
}

async function main() {
  setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  try {
    await boot();
  } catch (err) {
    mount(root, h('div', { class: 'boot-error' },
      h('h1', {}, '无法加载语料'),
      h('p', {}, String(err?.message || err)),
      h('p', { class: 'fineprint' }, '请通过 npm start 打开本站，而不是直接双击 HTML 文件。')));
    return;
  }
  setTopicMeta(topicMeta);
  window.__topicMeta = topicMeta;
  readHash();
  subscribe(() => {
    syncHash();
    render();
  });
  window.addEventListener('hashchange', () => {
    readHash();
    render();
  });
  render();
  // Deferred: the whole-corpus self-check takes a couple of seconds, so it runs
  // only when the examples view is first opened (and on demand thereafter).
}

main();

export { ctx, actions };
