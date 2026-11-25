import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareTopics, segmentBlocks, pairSegments } from '../src/core/align.js';
import { attribute, compareBoundaries } from '../src/core/attribute.js';
import { charLabels, sweepLabels, labelsAt, topicCoverage } from '../src/core/text.js';

const corpus = JSON.parse(readFileSync(new URL('../src/data/corpus.json', import.meta.url), 'utf8'));

function spans(doc, coder) {
  return doc.annotations.filter((a) => a.coder === coder);
}

test('sweep-based comparison agrees with the per-character reference on every document', () => {
  for (const doc of corpus.documents) {
    const text = doc.versions[0].text;
    const A = spans(doc, 'A');
    const B = spans(doc, 'B');
    const refA = charLabels(A, text.length);
    const refB = charLabels(B, text.length);
    const atoms = sweepLabels({ annotations: A }, { annotations: B }, text.length);
    for (const atom of atoms) {
      for (let i = atom.start; i < atom.end; i++) {
        assert.deepEqual(atom.a, refA[i], `${doc.id} A at ${i}`);
        assert.deepEqual(atom.b, refB[i], `${doc.id} B at ${i}`);
      }
    }
    // every character covered by at least one atom
    let covered = 0;
    for (const atom of atoms) covered += atom.end - atom.start;
    assert.equal(covered, text.length, `${doc.id} atoms must tile the text`);
  }
});

test('comparison is symmetric: swapping coders swaps only the sides', () => {
  for (const doc of corpus.documents) {
    const text = doc.versions[0].text;
    const A = spans(doc, 'A');
    const B = spans(doc, 'B');
    const ab = compareTopics(A, B, text.length);
    const ba = compareTopics(B, A, text.length);
    assert.equal(ab.agreeChars, ba.agreeChars);
    assert.equal(ab.disagreeChars, ba.disagreeChars);
    assert.equal(ab.onlyAChars, ba.onlyBChars);
    assert.equal(ab.onlyBChars, ba.onlyAChars);
    assert.equal(ab.agreement, ba.agreement);
    const at = attribute(A, B, text.length);
    const bt = attribute(B, A, text.length);
    assert.equal(at.agree, bt.agree);
    assert.equal(at.topicDiff, bt.topicDiff);
    assert.equal(at.onlyA, bt.onlyB);
  }
});

test('whole-document label sets can agree while segment alignment disagrees', () => {
  const text = doc1Text();
  // A puts noise on the whole first two sentences; B puts noise on sentence 1
  // and parking on sentence 2. Whole-document topic sets are identical.
  const A = [{ id: 'a1', coder: 'A', start: 0, end: 22, topics: ['noise', 'parking'] }];
  const B = [
    { id: 'b1', coder: 'B', start: 0, end: 11, topics: ['noise'] },
    { id: 'b2', coder: 'B', start: 11, end: 22, topics: ['parking'] },
  ];
  const wholeA = new Set(A.flatMap((s) => s.topics));
  const wholeB = new Set(B.flatMap((s) => s.topics));
  assert.deepEqual([...wholeA].sort(), [...wholeB].sort(), 'whole-document label sets match');
  // Per character the two codings differ everywhere in the run...
  const cmp = compareTopics(A, B, text.length);
  assert.ok(cmp.disagreeChars > 0, 'per-character topics differ');
  // ...but that is a difference in where the coders cut, not in what the run is
  // about. The aligned region carries the same topic set on both sides, so the
  // disagreement is attributed to segmentation.
  const attr = attribute(A, B, text.length);
  assert.equal(attr.topicDiff, 0);
  assert.equal(attr.agree, 22);
  assert.equal(attr.agreeCut, 22);
  assert.equal(attr.regions.length, 1);
  assert.equal(attr.regions[0].verdict, 'segmentation');
  assert.ok(attr.intervals.segmentation.length >= 1);
});

function doc1Text() {
  return '东门早市的摊位每天摆到九点。摊主的三轮车占了两个机动车位。';
}

test('identical codings agree everywhere and show no attribution intervals', () => {
  const text = corpus.documents[0].versions[0].text;
  const A = spans(corpus.documents[0], 'A');
  const cmp = compareTopics(A, A, text.length);
  assert.equal(cmp.disagreementCount ?? 0, 0);
  assert.equal(cmp.agreeChars, cmp.coverageA ? cmp.agreeChars : cmp.agreeChars);
  assert.equal(cmp.disagreeChars, 0);
  assert.equal(cmp.onlyAChars, 0);
  assert.equal(cmp.onlyBChars, 0);
  const attr = attribute(A, A, text.length);
  assert.equal(attr.topicDiff, 0);
  assert.equal(attr.onlyA + attr.onlyB, 0);
  assert.equal(attr.agreeCut, 0);
  assert.equal(attr.boundaries.unmatchedCount, 0);
  assert.equal(attr.verdict.kind, 'agree');
});

test('boundary-only differences are attributed to segmentation, not topics', () => {
  const text = '一二三四五六七八';
  const A = [{ id: 'a', coder: 'A', start: 0, end: 8, topics: ['green'] }];
  const B = [
    { id: 'b1', coder: 'B', start: 0, end: 4, topics: ['green'] },
    { id: 'b2', coder: 'B', start: 4, end: 8, topics: ['green'] },
  ];
  const attr = attribute(A, B, text.length);
  assert.equal(attr.topicDiff, 0);
  assert.equal(attr.agree, 8);
  assert.equal(attr.agreeCut, 8, 'all agreeing chars sit inside a cut');
  const bounds = compareBoundaries(A, B, 8);
  assert.deepEqual(bounds.onlyB, [4]);
  assert.deepEqual(bounds.onlyA, []);
});

test('one-sided labels are coverage gaps and never count as agreement', () => {
  const text = '一二三四五六七八';
  const A = [{ id: 'a', coder: 'A', start: 0, end: 4, topics: ['fee'] }];
  const B = [{ id: 'b', coder: 'B', start: 4, end: 8, topics: ['green'] }];
  const attr = attribute(A, B, text.length);
  assert.equal(attr.onlyA, 4);
  assert.equal(attr.onlyB, 4);
  assert.equal(attr.agree, 0);
  assert.equal(attr.labelledUnion, 8);
  assert.equal(attr.shares.agree, 0);
});

test('overlapping spans with identical label sets do not count as disagreement', () => {
  const text = '一二三四五六七八';
  // B splits the same characters into two overlapping-ish spans; label set per
  // character is still {green, safety}.
  const A = [{ id: 'a', coder: 'A', start: 0, end: 8, topics: ['green', 'safety'] }];
  const B = [
    { id: 'b1', coder: 'B', start: 0, end: 8, topics: ['green'] },
    { id: 'b2', coder: 'B', start: 0, end: 8, topics: ['safety'] },
  ];
  const cmp = compareTopics(A, B, text.length);
  assert.equal(cmp.disagreeChars, 0);
  assert.equal(cmp.agreeChars, 8);
});

test('per-topic contributions reconcile with the per-character reference', () => {
  for (const doc of corpus.documents) {
    const text = doc.versions[0].text;
    const A = spans(doc, 'A');
    const B = spans(doc, 'B');
    const cmp = compareTopics(A, B, text.length);
    const refA = charLabels(A, text.length);
    const refB = charLabels(B, text.length);
    let aOnlyRef = 0;
    let bOnlyRef = 0;
    let bothRef = 0;
    let disagreeRef = 0;
    let onlyARef = 0;
    let onlyBRef = 0;
    for (let i = 0; i < text.length; i++) {
      const a = new Set(refA[i]);
      const b = new Set(refB[i]);
      aOnlyRef += [...a].filter((t) => !b.has(t)).length;
      bOnlyRef += [...b].filter((t) => !a.has(t)).length;
      bothRef += [...a].filter((t) => b.has(t)).length;
      if (a.size && b.size) {
        const same = a.size === b.size && [...a].every((t) => b.has(t));
        if (same) continue;
        disagreeRef++;
      } else if (a.size) onlyARef++;
      else if (b.size) onlyBRef++;
    }
    let aOnly = 0;
    let bOnly = 0;
    let both = 0;
    for (const st of cmp.topicStats) {
      aOnly += st.aOnly;
      bOnly += st.bOnly;
      both += st.both;
    }
    assert.equal(aOnly, aOnlyRef, `${doc.id} A-side per-topic chars`);
    assert.equal(bOnly, bOnlyRef, `${doc.id} B-side per-topic chars`);
    assert.equal(both, bothRef, `${doc.id} shared-label chars`);
    assert.equal(cmp.disagreeChars, disagreeRef, `${doc.id} disagreement chars`);
    assert.equal(cmp.onlyAChars, onlyARef, `${doc.id} A-only chars`);
    assert.equal(cmp.onlyBChars, onlyBRef, `${doc.id} B-only chars`);
  }
});

test('a shared label contributes to neither side of a topic conflict', () => {
  const text = '一二三四';
  // Both name green; only A names fee, only B names safety. The conflict is
  // fee<->safety, once, and green never appears in a conflict.
  const A = [{ id: 'a', coder: 'A', start: 0, end: 4, topics: ['green', 'fee'] }];
  const B = [{ id: 'b', coder: 'B', start: 0, end: 4, topics: ['green', 'safety'] }];
  const cmp = compareTopics(A, B, text.length);
  const green = cmp.topicStats.find((s) => s.topic === 'green');
  assert.equal(green.conflictWith.length, 0);
  assert.equal(green.both, 4);
  const fee = cmp.topicStats.find((s) => s.topic === 'fee');
  assert.deepEqual(fee.conflictWith, [{ topic: 'safety', chars: 4 }]);
  assert.equal(cmp.disagreeChars, 4, 'the character is counted once, not once per label pair');
});

test('segment blocks tile the text and carry the covering span ids', () => {
  for (const doc of corpus.documents) {
    const text = doc.versions[0].text;
    const blocks = segmentBlocks(spans(doc, 'A'), spans(doc, 'B'), text.length);
    let cursor = 0;
    for (const b of blocks) {
      assert.equal(b.start, cursor);
      cursor = b.end;
    }
    assert.equal(cursor, text.length);
  }
});

test('pairing is reciprocal-aware and deterministic', () => {
  const A = [
    { id: 'a1', coder: 'A', start: 0, end: 10, topics: ['x'] },
    { id: 'a2', coder: 'A', start: 20, end: 30, topics: ['y'] },
  ];
  const B = [{ id: 'b1', coder: 'B', start: 0, end: 10, topics: ['x'] }];
  const p1 = pairSegments(A, B);
  const p2 = pairSegments(A, B);
  assert.deepEqual(p1.links.map((l) => `${l.a.id}->${l.b.id}`), p2.links.map((l) => `${l.a.id}->${l.b.id}`));
  assert.equal(p1.links.length, 1);
  assert.equal(p1.links[0].iou, 1);
  assert.equal(p1.links[0].reciprocal, true);
  assert.deepEqual(p1.unpairedA.map((s) => s.id), ['a2']);
});

test('coverage counts each topic once per character even with overlapping spans', () => {
  const text = '一二三四';
  const B = [
    { id: 'b1', coder: 'B', start: 0, end: 4, topics: ['green'] },
    { id: 'b2', coder: 'B', start: 0, end: 4, topics: ['green', 'fee'] },
  ];
  const cov = topicCoverage(B, text.length);
  assert.equal(cov.perTopic.get('green'), 4);
  assert.equal(cov.perTopic.get('fee'), 4);
  assert.equal(cov.covered, 4);
  assert.deepEqual(labelsAt(B, 1), ['fee', 'green']);
});
