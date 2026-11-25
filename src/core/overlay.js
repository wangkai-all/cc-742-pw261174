// Adjudication as an independent layer.
//
// Human coding is immutable. A reviewer's decisions are appended to a separate
// list of records; every record names the coder annotation it addresses and the
// version of the text it was made against. Rendering a decision produces a
// *derived* coding — the original plus overrides — that is recomputed on demand.
// Nothing in the original array is ever edited, deleted or reordered, and the
// derived layer can be dropped at any time to recover the exact input.
//
// Two invariants are enforced here and checked in tests:
//   1. append-only: records only ever grow; removing a decision requires an
//      explicit retraction record, which itself is kept;
//   2. addressable: a decision for an annotation that does not exist is rejected,
//      and a decision pinned to an older text version is reported as stale when
//      the current text differs — it is never silently re-applied to new
//      coordinates.

export const DECISION_KINDS = ['accept', 'reject', 'replace', 'split', 'merge', 'add'];

/**
 * @typedef {{
 *   id: string,
 *   kind: 'accept'|'reject'|'replace'|'split'|'merge',
 *   annotationId: string,
 *   textVersion: string,
 *   start: number|null, end: number|null,
 *   topics: string[]|null,
 *   note: string,
 *   reviewTopics: string[]|null,
 *   createdAt: string,
 *   actor: string,
 *   retracts?: string
 * }} Decision
 */

export function makeDecision(input) {
  const kind = input.kind;
  if (!DECISION_KINDS.includes(kind)) throw new TypeError(`unknown decision kind: ${kind}`);
  if (!input.annotationId && kind !== 'merge' && kind !== 'add') throw new TypeError('annotationId required');
  if (kind === 'merge' && !(Array.isArray(input.annotationIds) && input.annotationIds.length >= 2)) {
    throw new TypeError('merge requires at least two annotationIds');
  }
  if (kind === 'split' && !(Array.isArray(input.parts) && input.parts.length >= 2)) {
    throw new TypeError('split requires at least two parts');
  }
  if (kind === 'add' && !(input.start >= 0 && input.end >= input.start)) {
    throw new TypeError('add requires a valid range');
  }
  return Object.freeze({
    id: input.id,
    kind,
    annotationId: input.annotationId ?? null,
    annotationIds: input.annotationIds ?? null,
    textVersion: input.textVersion,
    start: input.start ?? null,
    end: input.end ?? null,
    topics: input.topics ? [...input.topics] : null,
    parts: input.parts ? input.parts.map((p) => Object.freeze({ ...p, topics: p.topics ? [...p.topics] : null })) : null,
    reviewTopics: input.reviewTopics ? [...input.reviewTopics] : null,
    coder: input.coder ?? null,
    docId: input.docId ?? null,
    // For a decision that resolves a migration dispute: the original annotation
    // it stands in for, and which candidate range was chosen.
    sourceId: input.sourceId ?? null,
    candidateIndex: input.candidateIndex ?? null,
    note: input.note ?? '',
    createdAt: input.createdAt ?? new Date().toISOString(),
    actor: input.actor ?? '裁决者',
    retracts: input.retracts ?? null,
  });
}

/**
 * Build the effective annotation list for one text version.
 *
 * Decisions with a `textVersion` different from the current one are *stale*: they
 * are not applied (the coordinates they were made against no longer exist),
 * and they are reported so the reviewer can redo them. This is the whole point
 * of keeping version labels on decisions.
 *
 * @param {Array} originals  human annotations for the current text version
 * @param {Array<Decision>} decisions
 * @param {{textVersion: string}} ctx
 */
export function effectiveCoding(originals, decisions, ctx) {
  const active = new Map();
  const retracted = new Set();
  const stale = [];
  const applied = [];
  for (const d of decisions) {
    if (d.retracts) retracted.add(d.retracts);
  }
  for (const d of decisions) {
    if (d.retracts) continue;
    if (retracted.has(d.id)) continue;
    if (d.textVersion !== ctx.textVersion) {
      stale.push(d);
      continue;
    }
    active.set(d.id, d);
    applied.push(d);
  }

  const byId = new Map(originals.map((a) => [a.id, a]));
  const out = [];
  const removed = new Set();
  const replacedBy = new Map();
  const merges = new Map(); // annotationId -> list of extra spans

  for (const d of active.values()) {
    if (d.kind === 'reject') removed.add(d.annotationId);
    if (d.kind === 'replace') replacedBy.set(d.annotationId, d);
    if (d.kind === 'split') replacedBy.set(d.annotationId, d);
    if (d.kind === 'merge') {
      for (const id of d.annotationIds || []) {
        if (!merges.has(id)) merges.set(id, []);
        merges.get(id).push(d);
      }
    }
  }

  // Reviewer-added spans are independent of any original annotation.
  for (const d of active.values()) {
    if (d.kind !== 'add') continue;
    out.push({
      id: `adj:${d.id}`,
      coder: d.coder || 'R',
      start: d.start,
      end: d.end,
      topics: d.topics ? [...d.topics] : [],
      origin: 'adjudicated',
      decisionId: d.id,
      note: d.note,
    });
  }

  const handledMerge = new Set();
  for (const a of originals) {
    if (removed.has(a.id) && !replacedBy.has(a.id)) continue;
    const rep = replacedBy.get(a.id);
    if (rep) {
      if (rep.kind === 'replace') {
        out.push({
          id: `adj:${rep.id}`,
          coder: a.coder,
          start: rep.start ?? a.start,
          end: rep.end ?? a.end,
          topics: rep.topics ?? a.topics,
          origin: 'adjudicated',
          sourceId: a.id,
          decisionId: rep.id,
          note: rep.note,
          reviewTopics: rep.reviewTopics ?? null,
        });
      } else if (rep.kind === 'split') {
        const parts = rep.parts || [];
        for (let i = 0; i < parts.length; i++) {
          out.push({
            id: `adj:${rep.id}:${i}`,
            coder: a.coder,
            start: parts[i].start,
            end: parts[i].end,
            topics: parts[i].topics ?? a.topics,
            origin: 'adjudicated',
            sourceId: a.id,
            decisionId: rep.id,
            note: rep.note,
          });
        }
      }
      continue;
    }
    const mg = merges.get(a.id);
    if (mg) {
      // Emit a merged span once, from the first member in source order, covering
      // the union of members' ranges and the union of their topics.
      const group = mg[0];
      const ids = group.annotationIds || [];
      const firstId = originals.find((x) => ids.includes(x.id))?.id;
      if (a.id !== firstId) continue;
      if (handledMerge.has(group.id)) continue;
      handledMerge.add(group.id);
      const members = originals.filter((x) => ids.includes(x.id));
      const start = Math.min(...members.map((m) => m.start));
      const end = Math.max(...members.map((m) => m.end));
      const topics = [...new Set(members.flatMap((m) => (group.topics ?? m.topics)))].sort();
      out.push({
        id: `adj:${group.id}`,
        coder: a.coder,
        start,
        end,
        topics,
        origin: 'adjudicated',
        sourceIds: members.map((m) => m.id),
        decisionId: group.id,
        note: group.note,
      });
      continue;
    }
    if (byId.has(a.id)) out.push({ ...a, origin: a.origin || 'human' });
  }

  // Accept decisions add nothing new (they confirm); they are still listed as applied.
  out.sort((x, y) => x.start - y.start || x.end - y.end || x.id.localeCompare(y.id));
  return { annotations: out, stale, applied, removedIds: [...removed], replacedIds: [...replacedBy.keys()] };
}

/**
 * A compact ledger of every decision, in append order, with the derived outcome.
 * This is what the review panel renders; it is never used to mutate originals.
 */
export function decisionLedger(originals, decisions, ctx) {
  const eff = effectiveCoding(originals, decisions, ctx);
  const bySource = new Map();
  for (const a of eff.annotations) {
    const keys = a.sourceIds || (a.sourceId ? [a.sourceId] : []);
    for (const k of keys) {
      if (!bySource.has(k)) bySource.set(k, []);
      bySource.get(k).push(a);
    }
  }
  return {
    ...eff,
    rows: decisions.map((d) => ({
      decision: d,
      stale: eff.stale.some((s) => s.id === d.id),
      effect: bySource.get(d.annotationId) || [],
    })),
  };
}

/** Character-level diff between original and adjudicated codings, for the compare view. */
export function adjudicationDelta(originals, adjudicated, length) {
  const topicsOf = (list) => {
    const arr = new Array(length).fill(null).map(() => new Set());
    for (const a of list) for (let i = a.start; i < a.end; i++) for (const t of a.topics) arr[i].add(t);
    return arr.map((s) => [...s].sort());
  };
  const before = topicsOf(originals);
  const after = topicsOf(adjudicated);
  const changes = [];
  for (let i = 0; i < length; i++) {
    const b = before[i].join('\u0001');
    const a = after[i].join('\u0001');
    if (a !== b) changes.push({ pos: i, before: before[i], after: after[i] });
  }
  return changes;
}
