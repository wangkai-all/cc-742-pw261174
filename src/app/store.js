// Application state: the corpus, the analysis pass, the adjudication overlay and
// the current view selection. Everything derived is recomputed from these three
// inputs; nothing on screen is stored twice.

import { analyzeCorpus, analyzeRevision } from '../core/analyze.js';
import { makeDecision, effectiveCoding } from '../core/overlay.js';
import { attribute } from '../core/attribute.js';
import { compareTopics } from '../core/align.js';

const LS_KEY = 'coding-desk/decisions/v1';
const listeners = new Set();

export const state = {
  corpus: null,
  analysis: null,
  docById: new Map(),
  decisions: {}, // docId -> Decision[]
  revisions: new Map(), // docId -> revision model
  ui: {
    view: 'overview',
    docId: 'D01',
    version: null,
    compare: 'original', // original | adjudicated | diff
    statsFrom: 'original', // original | adjudicated
    revisionDocId: null,
    verifyDocId: 'D01',
    driftPick: { coder: 'B', topic: 'service', mode: 'adjusted' },
    toast: null,
  },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn();
}

export async function boot() {
  const res = await fetch('/src/data/corpus.json');
  if (!res.ok) throw new Error(`语料加载失败 (${res.status})`);
  state.corpus = await res.json();
  state.analysis = analyzeCorpus(state.corpus);
  state.docById = new Map(state.corpus.documents.map((d) => [d.id, d]));
  const rev = state.corpus.documents.find((d) => d.versions.length > 1);
  state.ui.revisionDocId = rev ? rev.id : null;
  state.decisions = loadDecisions(state.corpus);
  const first = state.corpus.documents[0];
  state.ui.docId = first.id;
  state.ui.version = first.versions[0].version;
}

function loadDecisions(corpus) {
  const out = {};
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return out;
  const docIds = new Set(corpus.documents.map((d) => d.id));
  for (const [docId, list] of Object.entries(raw)) {
    if (!docIds.has(docId) || !Array.isArray(list)) continue;
    const kept = [];
    for (const d of list) {
      try {
        kept.push(makeDecision(d));
      } catch {
        // A malformed record is dropped rather than guessed at.
      }
    }
    if (kept.length) out[docId] = kept;
  }
  return out;
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.decisions));
  } catch {
    // Storage can be unavailable (private mode); the session still works.
  }
}

let seq = 0;
function nextId() {
  seq += 1;
  return `d-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function decisionsFor(docId) {
  return state.decisions[docId] || [];
}

export function addDecision(docId, input) {
  const d = makeDecision({
    ...input,
    id: input.id || nextId(),
    docId,
    createdAt: new Date().toISOString(),
    actor: input.actor || '裁决者',
  });
  if (!state.decisions[docId]) state.decisions[docId] = [];
  state.decisions[docId].push(d);
  persist();
  emit();
  return d;
}

export function retractDecision(docId, targetId) {
  const target = decisionsFor(docId).find((d) => d.id === targetId);
  if (!target) throw new Error(`no decision ${targetId}`);
  const base = {
    id: nextId(),
    docId,
    textVersion: target.textVersion,
    retracts: target.id,
    note: `撤销 ${target.kind} 记录`,
    actor: '裁决者',
    createdAt: new Date().toISOString(),
  };
  let record;
  if (target.kind === 'merge') {
    record = makeDecision({ ...base, kind: 'merge', annotationIds: target.annotationIds });
  } else if (target.kind === 'add') {
    record = makeDecision({ ...base, kind: 'add', start: target.start, end: target.end, topics: target.topics });
  } else {
    record = makeDecision({ ...base, kind: 'accept', annotationId: target.annotationId });
  }
  state.decisions[docId].push(record);
  persist();
  emit();
  return record;
}

export function clearDecisions() {
  state.decisions = {};
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function annotationsFor(doc, version) {
  if (version === doc.versions[0].version) return doc.annotations;
  return revisionModel(doc.id).basis;
}

export function revisionModel(docId) {
  if (state.revisions.has(docId)) return state.revisions.get(docId);
  const rev = analyzeRevision(state.corpus, docId);
  const map = rev.map;
  const rows = rev.migrated.map((m, i) => {
    const ann = rev.doc.annotations[i];
    return {
      ...m,
      id: m.annotationId,
      ann,
      oldText: rev.v1.text.slice(ann.start, ann.end),
    };
  });
  const placed = rows.filter((r) => r.status === 'exact' || r.status === 'shifted' || r.status === 'partial');
  const basis = placed.map((r) => ({
    id: r.id,
    coder: r.coder,
    start: r.start,
    end: r.end,
    topics: [...r.topics],
    origin: 'migrated',
    sourceStart: r.source.start,
    sourceEnd: r.source.end,
    status: r.status,
  }));
  const disputes = rows.filter((r) => r.dispute);
  const model = {
    doc: rev.doc,
    v1: rev.v1,
    v2: rev.v2,
    map,
    rows,
    placed,
    basis,
    disputes,
    counts: countStatuses(rows),
  };
  state.revisions.set(docId, model);
  return model;
}

function countStatuses(rows) {
  const out = { exact: 0, shifted: 0, partial: 0, ambiguous: 0, lost: 0 };
  for (const r of rows) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}

/** Original annotations plus the adjudication overlay, for one text version. */
export function effectiveFor(doc, version) {
  const originals = annotationsFor(doc, version);
  return effectiveCoding(originals, decisionsFor(doc.id), { textVersion: version });
}

/** The coding used for statistics, per the explicit toggle. */
export function codingFor(doc, version, statsFrom) {
  const eff = effectiveFor(doc, version);
  return statsFrom === 'adjudicated' ? eff.annotations : annotationsFor(doc, version);
}

export function documentAnalysis(doc, version, statsFrom = 'original') {
  const spansA = codingFor(doc, version, statsFrom).filter((s) => s.coder === 'A');
  const spansB = codingFor(doc, version, statsFrom).filter((s) => s.coder === 'B');
  const text = doc.versions.find((v) => v.version === version)?.text || '';
  const topics = compareTopics(spansA, spansB, text.length);
  const attribution = attribute(spansA, spansB, text.length);
  return { text, spansA, spansB, topics, attribution };
}

export function docList() {
  return state.corpus.documents;
}

export function topicMeta(id) {
  return state.corpus.meta.topics.find((t) => t.id === id) || { id, label: id, color: 0 };
}

export function coderMeta(id) {
  return state.corpus.meta.coders.find((c) => c.id === id) || { id, name: id };
}

export function setView(view) {
  state.ui.view = view;
  emit();
}

export function setUi(patch) {
  Object.assign(state.ui, patch);
  emit();
}

export function toast(text, action) {
  state.ui.toast = { text, action, at: Date.now() };
  emit();
  const at = state.ui.toast.at;
  setTimeout(() => {
    if (state.ui.toast && state.ui.toast.at === at) {
      state.ui.toast = null;
      emit();
    }
  }, 4200);
}

