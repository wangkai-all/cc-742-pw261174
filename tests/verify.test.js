import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCorpus, allOptimalAlignments, verifyDemoMigration } from '../src/core/verify.js';

const corpus = JSON.parse(readFileSync(new URL('../src/data/corpus.json', import.meta.url), 'utf8'));

test('the self-check passes on the whole corpus', () => {
  const report = verifyCorpus(corpus, { slices: 40, maxLen: 10 });
  for (const c of report.checks) {
    assert.ok(c.passed, `${c.id}: ${JSON.stringify(c.failures.slice(0, 3))}`);
  }
  assert.equal(report.failedChecks, 0);
  assert.ok(report.total > 2400, `checked ${report.total} characters`);
});

test('brute-force alignment enumeration lists only maximum-length alignments', () => {
  const { alignments } = allOptimalAlignments('aba', 'aab');
  assert.equal(alignments.length, 3);
  for (const map of alignments) {
    let n = 0;
    let last = -1;
    for (const p of map) {
      if (p >= 0) {
        assert.ok(p > last, 'alignment must be monotone');
        last = p;
        n++;
      }
    }
    assert.equal(n, 2, 'LCS(aba,aab)=2');
  }
});

test('the demo migration report exposes a policy decision where it differs from exact enumeration', () => {
  const demo = verifyDemoMigration(corpus, 'D12');
  assert.ok(demo.passed);
  // B codes sentence by sentence, so the deleted sentence is exactly one span.
  const lost = demo.rows.filter((r) => r.status === 'lost');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].coder, 'B');
  // A merged that sentence into a longer span, so for A the deletion is partial:
  // the same edit is reported differently because the units differ. That is the
  // whole point of aligning before comparing.
  const aPartial = demo.rows.filter((r) => r.coder === 'A' && r.status === 'partial');
  assert.ok(aPartial.length >= 1);
  // Where the block policy and exact enumeration differ, the policy is the one
  // that must be defensible: it may not invent a location from stray characters.
  const differing = demo.rows.filter((r) => r.policyDiffers);
  assert.ok(differing.length >= 1, 'the demo should include at least one policy decision');
  for (const r of differing) {
    assert.ok(r.status !== 'ambiguous' || r.candidates.length >= 2);
  }
  const amb = demo.rows.find((r) => r.status === 'ambiguous');
  assert.ok(amb.target === null);
  assert.ok(amb.candidates.length >= 2);
});
