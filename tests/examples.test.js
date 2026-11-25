import test from 'node:test';
import assert from 'node:assert/strict';
import { runExamples, demoExamples } from '../src/core/examples.js';

test('every constructed example passes its own per-character check', () => {
  const run = runExamples();
  for (const c of run.cases) {
    const checks = [...c.checks, ...(c.variant ? c.variant.checks : [])];
    for (const chk of checks) {
      assert.ok(chk.pass, `${c.id}/${chk.label}: ${chk.detail}`);
    }
  }
  assert.equal(run.failed, 0);
  assert.equal(run.ok, true);
  assert.ok(run.total >= 17, `ran ${run.total} checks`);
});

test('the repeated-text example puts the duplicate into the dispute path', () => {
  const c = demoExamples().find((x) => x.id === 'repeat');
  assert.equal(c.status, 'ambiguous');
  assert.equal(c.rows.length, 2);
  // Both candidates must be real ranges in the new text and reproduce the span.
  for (const cand of c.rows) {
    assert.equal(c.newText.slice(cand.start, cand.end), c.oldText.slice(c.span[0], c.span[1]));
  }
  // The policy may never claim more locations than brute-force enumeration finds.
  const brute = new Set(c.exactCandidates.map((x) => `${x.start}:${x.end}`));
  for (const cand of c.rows) assert.ok(brute.has(`${cand.start}:${cand.end}`));
});

test('the overlap example separates boundary disagreement from topic disagreement', () => {
  const c = demoExamples().find((x) => x.id === 'overlap');
  // Variant 1: same characters, different cut, labels agree -> boundary only.
  assert.ok(c.attr.topicDiff > 0);
  // Variant 2: two overlapping full-length spans with identical label sets.
  assert.equal(c.variant.attr.topicDiff, 0);
  assert.equal(c.variant.attr.agreeCut, c.variant.attr.agree);
  assert.equal(c.variant.cmp.disagreeChars, 0);
});

test('the insertion example reports the inserted characters and a monotone map', () => {
  const c = demoExamples().find((x) => x.id === 'insert');
  assert.ok(c.policy.insertedInside > 0);
  assert.ok(c.policy.status !== 'ambiguous');
  for (const chk of c.checks) assert.ok(chk.pass, `${chk.label}: ${chk.detail}`);
});
