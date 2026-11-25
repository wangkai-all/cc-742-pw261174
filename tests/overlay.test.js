import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDecision, effectiveCoding, decisionLedger, adjudicationDelta, DECISION_KINDS,
} from '../src/core/overlay.js';

// Two human spans on a 20-character text. The arrays are frozen in some tests to
// prove the overlay never mutates them.
const originals = [
  { id: 'A-1', coder: 'A', start: 0, end: 8, topics: ['noise'] },
  { id: 'A-2', coder: 'A', start: 8, end: 20, topics: ['parking'] },
];
const V1 = 'v1';

function decision(over) {
  return makeDecision({
    id: over.id || 'd1',
    kind: over.kind || 'replace',
    annotationId: over.annotationId ?? 'A-1',
    textVersion: over.textVersion || V1,
    start: over.start,
    end: over.end,
    topics: over.topics,
    parts: over.parts,
    annotationIds: over.annotationIds,
    actor: 'tester',
    note: over.note,
  });
}

test('accepting or rejecting never mutates the human annotations', () => {
  const before = JSON.stringify(originals);
  const snapshotIds = originals.map((a) => a.id);
  const withAccept = effectiveCoding(originals, [decision({ id: 'd1', kind: 'accept', annotationId: 'A-1' })], { textVersion: V1 });
  const withReject = effectiveCoding(originals, [decision({ id: 'd2', kind: 'reject', annotationId: 'A-1' })], { textVersion: V1 });
  assert.equal(JSON.stringify(originals), before);
  assert.deepEqual(originals.map((a) => a.id), snapshotIds);
  // Accept keeps both; reject drops only the addressed span.
  assert.deepEqual(withAccept.annotations.map((a) => a.id), ['A-1', 'A-2']);
  assert.deepEqual(withReject.annotations.map((a) => a.id), ['A-2']);
});

test('the effective coding is derived, not stored: same input, same output', () => {
  const decisions = [decision({ id: 'd1', kind: 'replace', annotationId: 'A-1', topics: ['noise', 'service'] })];
  const a = effectiveCoding(originals, decisions, { textVersion: V1 });
  const b = effectiveCoding(originals, decisions, { textVersion: V1 });
  assert.deepEqual(a.annotations.map((x) => x.topics), b.annotations.map((x) => x.topics));
  assert.equal(a.annotations[0].origin, 'adjudicated');
  assert.equal(a.annotations[0].sourceId, 'A-1');
  assert.equal(a.annotations[1].origin, 'human');
});

test('a decision pinned to an older text version is stale, not silently reapplied', () => {
  const d = decision({ id: 'd1', kind: 'replace', annotationId: 'A-1', textVersion: 'v1', topics: ['service'] });
  const eff = effectiveCoding(originals, [d], { textVersion: 'v2' });
  assert.deepEqual(eff.annotations.map((x) => x.id), ['A-1', 'A-2'], 'original survives unchanged');
  assert.equal(eff.annotations[0].topics[0], 'noise', 'stale replacement not applied');
  assert.equal(eff.stale.length, 1);
  assert.equal(eff.stale[0].id, 'd1');
  assert.equal(eff.applied.length, 0);
});

test('replace and split produce the reviewer spans while keeping the source link', () => {
  const split = decision({
    id: 'd1', kind: 'split', annotationId: 'A-1',
    parts: [
      { start: 0, end: 3, topics: ['noise'] },
      { start: 3, end: 8, topics: ['parking'] },
    ],
  });
  const eff = effectiveCoding(originals, [split], { textVersion: V1 });
  assert.deepEqual(eff.annotations.map((x) => `${x.start}-${x.end}:${x.topics.join('+')}`), [
    '0-3:noise', '3-8:parking', '8-20:parking',
  ]);
  assert.equal(eff.annotations[0].sourceId, 'A-1');
  assert.equal(eff.annotations[0].origin, 'adjudicated');
  assert.ok(eff.annotations.every((x) => x.id !== 'A-1'), 'the split replaces the original');
});

test('merge unions the members once, with the union of their topics', () => {
  const merge = decision({
    id: 'd1', kind: 'merge', annotationId: null,
    annotationIds: ['A-1', 'A-2'],
  });
  const eff = effectiveCoding(originals, [merge], { textVersion: V1 });
  assert.equal(eff.annotations.length, 1);
  assert.equal(eff.annotations[0].start, 0);
  assert.equal(eff.annotations[0].end, 20);
  assert.deepEqual(eff.annotations[0].topics, ['noise', 'parking']);
  assert.deepEqual(eff.annotations[0].sourceIds, ['A-1', 'A-2']);
});

test('add creates a reviewer span that is not tied to an original', () => {
  const add = decision({ id: 'd1', kind: 'add', annotationId: null, start: 4, end: 12, topics: ['safety'] });
  const eff = effectiveCoding(originals, [add], { textVersion: V1 });
  const added = eff.annotations.find((a) => a.id === 'adj:d1');
  assert.ok(added);
  assert.ok(!added.sourceId);
  assert.deepEqual(added.topics, ['safety']);
  assert.equal(eff.annotations.length, 3);
});

test('decisions are append-only: retraction is itself a record', () => {
  const d1 = decision({ id: 'd1', kind: 'reject', annotationId: 'A-1' });
  const retract = makeDecision({
    id: 'd2', kind: 'accept', annotationId: 'A-1', textVersion: V1, retracts: 'd1',
  });
  const eff = effectiveCoding(originals, [d1, retract], { textVersion: V1 });
  assert.deepEqual(eff.annotations.map((a) => a.id), ['A-1', 'A-2'], 'retraction restores the original');
  assert.ok([d1, retract].every(Object.isFrozen), 'records are frozen');
  assert.equal(DECISION_KINDS.includes('retract'), false, 'retraction reuses accept/others via `retracts`');
});

test('the ledger reports every decision, its staleness and its derived effect', () => {
  const d1 = decision({ id: 'd1', kind: 'replace', annotationId: 'A-1', topics: ['service'] });
  const d2 = decision({ id: 'd2', kind: 'reject', annotationId: 'A-2', textVersion: 'v0' });
  const ledger = decisionLedger(originals, [d1, d2], { textVersion: V1 });
  assert.equal(ledger.rows.length, 2);
  assert.equal(ledger.rows[0].stale, false);
  assert.equal(ledger.rows[1].stale, true);
  assert.ok(ledger.rows[0].effect.length >= 1, 'applied decision has a derived span');
  assert.deepEqual(ledger.rows[1].effect, []);
});

test('adjudicationDelta lists exactly the characters whose labels changed', () => {
  const before = originals;
  const after = effectiveCoding(originals, [
    decision({ id: 'd1', kind: 'replace', annotationId: 'A-1', start: 0, end: 8, topics: ['service'] }),
  ], { textVersion: V1 }).annotations;
  const delta = adjudicationDelta(before, after, 20);
  assert.equal(delta.length, 8);
  assert.equal(delta[0].pos, 0);
  assert.deepEqual(delta[0].before, ['noise']);
  assert.deepEqual(delta[0].after, ['service']);
  assert.equal(delta[delta.length - 1].pos, 7);
});

test('unknown decision kinds and missing annotation ids are rejected at construction', () => {
  assert.throws(() => makeDecision({ id: 'x', kind: 'delete', annotationId: 'A-1', textVersion: V1 }), /unknown decision kind/);
  assert.throws(() => makeDecision({ id: 'x', kind: 'replace', textVersion: V1 }), /annotationId required/);
  assert.throws(() => makeDecision({ id: 'x', kind: 'merge', textVersion: V1 }), /at least two annotationIds/);
  assert.throws(() => makeDecision({ id: 'x', kind: 'merge', textVersion: V1, annotationIds: ['A-1'] }), /at least two annotationIds/);
  assert.throws(() => makeDecision({ id: 'x', kind: 'split', annotationId: 'A-1', textVersion: V1, parts: [{ start: 0, end: 8 }] }), /at least two parts/);
  assert.throws(() => makeDecision({ id: 'x', kind: 'add', textVersion: V1, start: -1, end: 3 }), /valid range/);
});
