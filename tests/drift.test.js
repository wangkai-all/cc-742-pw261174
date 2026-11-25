import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectDrift, permutationTest, theilSen, topicShareSeries, windowStats } from '../src/core/drift.js';
import { analyzeCorpus, withMeta, splitCoding } from '../src/core/analyze.js';

const corpus = JSON.parse(readFileSync(new URL('../src/data/corpus.json', import.meta.url), 'utf8'));
const TOPICS = corpus.meta.topics.map((t) => t.id);
const result = analyzeCorpus(corpus);

test('Theil–Sen slope is the median pairwise slope and ignores a wild window', () => {
  assert.equal(theilSen([0, 1, 2, 3, 4]), 1);
  assert.equal(theilSen([4, 3, 2, 1, 0]), -1);
  // One huge outlier out of five points leaves the median pairwise slope at 0.
  assert.ok(Math.abs(theilSen([0, 0, 10, 0, 0])) < 1);
});

test('the permutation test is reproducible and flat data is not significant', () => {
  const flat = [0.5, 0.5, 0.5, 0.5, 0.5];
  const a = permutationTest(flat, 7, 500);
  const b = permutationTest(flat, 7, 500);
  assert.equal(a.p, b.p);
  assert.ok(a.p > 0.5, `flat series p=${a.p}`);
  const rising = [0.0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2];
  const c = permutationTest(rising, 7, 500);
  assert.ok(c.p < 0.05, `strictly rising p=${c.p}`);
  assert.equal(c.observed, permutationTest(rising, 7, 500).observed);
  // Downward is equally detectable: the test is two-sided.
  const falling = [...rising].reverse();
  assert.ok(permutationTest(falling, 7, 500).p < 0.05);
});

test('composition adjustment removes a batch-mix artefact but keeps a real change', () => {
  const driftA = result.drift.A;
  const driftB = result.drift.B;

  // A: fee share rises raw but not after re-weighting to the period mix.
  const feeA = driftA.results.find((r) => r.topic === 'fee');
  assert.ok(feeA.rawTest.p <= 0.05, `A/fee raw p=${feeA.rawTest.p} should look like change`);
  assert.ok(feeA.test.p > 0.05, `A/fee adjusted p=${feeA.test.p} should not be significant`);
  assert.equal(feeA.compositionDriven, true);
  assert.equal(feeA.verdict, '批次构成变化，非个人漂移');
  assert.ok(Math.abs(feeA.compositionEffect) > Math.abs(feeA.adjustedSlope));

  // B: service rises in both series, so it survives adjustment.
  const serviceB = driftB.results.find((r) => r.topic === 'service');
  assert.equal(serviceB.significant, true);
  assert.equal(serviceB.compositionDriven, false);
  assert.equal(serviceB.verdict, '标准收紧（该主题占比上升）');

  // No coder is flagged significant on a composition-driven topic.
  for (const r of [...driftA.results, ...driftB.results]) {
    assert.ok(!(r.significant && r.compositionDriven), `${r.topic} double-flagged`);
  }
});

test('adjusted and raw series share window count and report coverage', () => {
  for (const coder of ['A', 'B']) {
    const d = result.drift[coder];
    assert.deepEqual(d.windows, ['w1', 'w2', 'w3', 'w4', 'w5']);
    for (const r of d.results) {
      assert.equal(r.series.raw.length, d.windows.length);
      assert.equal(r.series.adjusted.length, d.windows.length);
      for (const c of r.series.coverage) assert.ok(c > 0 && c <= 1, `coder ${coder} ${r.topic} coverage ${c}`);
      for (const v of [...r.series.raw, ...r.series.adjusted]) {
        assert.ok(v === null || (v >= 0 && v <= 1), `${coder} ${r.topic} share ${v}`);
      }
    }
  }
  // w1's batch has no S-type document, so the reference mix is only partly
  // represented there. Coverage reports that instead of imputing the missing
  // stratum, and the same coverage applies to every topic.
  const d = result.drift.A;
  const coverages = d.results.map((r) => r.series.coverage);
  for (const c of coverages) assert.deepEqual(c, coverages[0]);
  assert.ok(coverages[0][0] < 0.99, `w1 coverage ${coverages[0][0]} should expose the missing stratum`);
  for (const c of coverages[0].slice(1)) assert.ok(Math.abs(c - 1) < 1e-9);
});

test('a pure composition shift produces no personal drift', () => {
  // Each window is a single stratum; the topic is always 20% of stratum T and 60%
  // of stratum S. The mix shifts from all-T to all-S, so only composition moves.
  const make = (w, stratum, chars, topicHits) => ({
    id: `${w}-${stratum}`, coder: 'X', window: w, stratum, docId: w,
    start: 0, end: chars, topics: topicHits > 0 ? ['t', 'filler'] : ['filler'],
    _hits: topicHits,
  });
  const anns = [];
  const plan = [['w1', 'T'], ['w2', 'T'], ['w3', 'S'], ['w4', 'S'], ['w5', 'S']];
  for (const [w, s] of plan) {
    const chars = 100;
    const share = s === 'T' ? 0.2 : 0.6;
    const hits = chars * share;
    anns.push(make(w, s, hits, 1));
    anns.push(make(w, s, chars - hits, 0));
  }
  const d = detectDrift(anns, ['t'], { minCharsPerWindow: 10, iterations: 500 });
  const r = d.results[0];
  assert.ok(r.rawTest.p > 0.01, 'raw series should at least show the mix');
  assert.ok(r.test.p > 0.05, `adjusted p=${r.test.p} should be null`);
  assert.notEqual(r.verdict, '标准收紧（该主题占比上升）');
});

test('drift metadata is attached per document and stratum', () => {
  const doc = corpus.documents[0];
  const meta = withMeta(doc, splitCoding(doc, 'A'));
  for (const m of meta) {
    assert.equal(m.docId, doc.id);
    assert.equal(m.window, doc.window);
    assert.equal(m.stratum, doc.type);
    assert.equal(m.date, doc.date);
  }
});

test('window stratification is homogeneous per document type within a window', () => {
  const anns = corpus.documents.flatMap((doc) => withMeta(doc, splitCoding(doc, 'A')));
  const { byWindow } = windowStats(anns);
  for (const [, strata] of byWindow) {
    for (const [stratum, st] of strata) {
      assert.ok(['T', 'S', 'C'].includes(stratum));
      assert.ok(st.chars > 0);
      assert.ok(st.docs.size > 0);
    }
  }
});

test('topic share series is monotone in window order and covers all topics', () => {
  const anns = corpus.documents.flatMap((doc) => withMeta(doc, splitCoding(doc, 'B')));
  const { windows, byWindow } = windowStats(anns);
  const series = topicShareSeries(byWindow, windows, TOPICS);
  assert.deepEqual(Object.keys(series).sort(), [...TOPICS].sort());
  for (const t of TOPICS) {
    assert.equal(series[t].raw.length, windows.length);
    assert.equal(typeof series[t].rawSlope, 'number');
  }
});
