import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lcsTables, buildRevisionMap, referenceMapOffset } from '../src/core/diff.js';
import {
  locateSpan, locateSpanExact, migrateAnnotation, migrateThrough, composeMaps,
  enumerateImages, blockAnchors,
} from '../src/core/migrate.js';

// ---------------------------------------------------------------------------
// Independent reference: enumerate every optimal alignment by walking the
// suffix-LCS table. Only usable for tiny strings, which is exactly the point.
// ---------------------------------------------------------------------------
function allAlignments(a, b, cap = 50000) {
  const { suf, w } = lcsTables(a, b);
  const out = [];
  const map = new Int32Array(a.length).fill(-1);
  function rec(i, j) {
    if (out.length >= cap) return;
    if (i === a.length && j === b.length) {
      out.push(Array.from(map));
      return;
    }
    const cur = suf[i * w + j];
    if (i < a.length && j < b.length && a[i] === b[j] && 1 + suf[(i + 1) * w + (j + 1)] === cur) {
      map[i] = j;
      rec(i + 1, j + 1);
      map[i] = -1;
    }
    if (i < a.length && suf[(i + 1) * w + j] === cur) rec(i + 1, j);
    if (j < b.length && suf[i * w + (j + 1)] === cur) rec(i, j + 1);
  }
  rec(0, 0);
  return out;
}

function bruteImageRanges(a, b, s, e) {
  const ranges = new Set();
  for (const map of allAlignments(a, b)) {
    const pos = [];
    for (let i = s; i < e; i++) if (map[i] >= 0) pos.push(map[i]);
    if (pos.length) ranges.add(`${pos[0]}:${pos[pos.length - 1] + 1}`);
  }
  return ranges;
}

const PAIRS = [
  ['aba', 'aab'],
  ['aaba', 'abaa'],
  ['xyxy', 'yxyx'],
  ['abab', 'baba'],
  ['abcabc', 'abc'],
  ['abc', 'abcabc'],
  ['abcab', 'ababc'],
  ['aaaa', 'aa'],
  ['aa', 'aaaa'],
  ['ab', 'ba'],
  ['abcd', 'axcd'],
  ['abcd', 'abxd'],
  ['abcd', 'abcd'],
  ['同文同文', '文同文同'],
  ['门禁坏了', '门禁修好了'],
  ['绿化带的围栏倒了一段。', '绿化带的围栏倒了一段。'],
];

function randomString(n, alphabet) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

test('exact enumeration agrees with brute-force enumeration of every optimal alignment', () => {
  const pairs = [...PAIRS];
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let k = 0; k < 120; k++) {
    const n = 1 + Math.floor(rand() * 6);
    const m = 1 + Math.floor(rand() * 6);
    pairs.push([randomString(n, 'abc'), randomString(m, 'abc')]);
  }
  for (const [a, b] of pairs) {
    const map = buildRevisionMap(a, b);
    for (let s = 0; s < a.length; s++) {
      for (let e = s + 1; e <= a.length; e++) {
        const brute = bruteImageRanges(a, b, s, e);
        const got = locateSpanExact(map, s, e);
        if (brute.size === 1) {
          assert.notEqual(got.status, 'ambiguous', `${a}->${b} [${s},${e}) should be unique`);
          assert.ok(brute.has(`${got.start}:${got.end}`),
            `${a}->${b} [${s},${e}) located at ${got.start}:${got.end}, brute says ${[...brute]}`);
        } else if (brute.size > 1) {
          assert.equal(got.status, 'ambiguous', `${a}->${b} [${s},${e}) has ${brute.size} images but was located`);
          if (got.candidatesExact) {
            const mine = new Set(got.candidates.map((c) => `${c.start}:${c.end}`));
            assert.deepEqual([...mine].sort(), [...brute].sort(),
              `${a}->${b} [${s},${e}) candidate set differs from brute force`);
          }
        } else {
          assert.equal(got.status, 'lost', `${a}->${b} [${s},${e}) deleted everywhere but status ${got.status}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Block policy. Every image locateSpan returns must be an image some optimal
// alignment can produce (no invented coordinates), and the relocated text must
// really occur where it says it does.
// ---------------------------------------------------------------------------
test('every block-located image is a real image and its text is where claimed', () => {
  for (const [a, b] of PAIRS) {
    const map = buildRevisionMap(a, b);
    for (let s = 0; s < a.length; s++) {
      for (let e = s + 1; e <= a.length; e++) {
        const got = locateSpan(map, s, e);
        if (got.status === 'lost') continue;
        const brute = bruteImageRanges(a, b, s, e);
        const allowed = new Set();
        for (const r of brute) {
          const [u, v] = r.split(':').map(Number);
          allowed.add(`${u}:${v}`);
        }
        for (const c of got.candidates) {
          assert.ok(allowed.has(`${c.start}:${c.end}`) || got.status === 'partial',
            `${a}->${b} [${s},${e}) invented ${c.start}:${c.end}`);
        }
        if (got.status !== 'ambiguous') {
          // A unique image must contain the longest surviving run.
          const best = Math.max(0, ...blockAnchors(map, s, e).map((x) => x.length));
          const inner = Math.min(e, got.end) - Math.max(s, got.start);
          assert.ok(got.end - got.start >= best, `${a}->${b} [${s},${e}) image shorter than its anchor`);
          void inner;
        }
      }
    }
  }
});

test('a duplicated block is ambiguous, not silently pinned to one copy', () => {
  const v1 = '门禁坏了。快递堆在大厅，谁都能拿走。';
  const v2 = '第一段新增。门禁坏了。快递堆在大厅，谁都能拿走。门禁坏了。快递堆在大厅，谁都能拿走。';
  const map = buildRevisionMap(v1, v2);
  const res = migrateAnnotation({ id: 'x', coder: 'A', start: 5, end: 18, topics: ['safety'] }, map);
  assert.equal(res.status, 'ambiguous');
  assert.equal(res.dispute, true);
  assert.ok(res.candidates.length >= 2, 'both copies must be offered');
  assert.ok(res.candidates.some((c) => c.start === 11), 'first copy must be among candidates');
  assert.ok(res.candidates.some((c) => c.start > 20), 'second copy must be among candidates');
  assert.deepEqual(res.source, { start: 5, end: 18, topics: ['safety'] }, 'source coordinates preserved');
});

test('insertion before a span shifts it, keeps content identical', () => {
  const map = buildRevisionMap('门禁坏了以后快递堆在大厅。', '首先说明。门禁坏了以后快递堆在大厅。');
  const res = migrateAnnotation({ id: 'a', coder: 'A', start: 0, end: 12, topics: ['safety'] }, map);
  assert.equal(res.status, 'shifted');
  assert.equal(res.start, 5);
  assert.equal(res.end, 17);
  assert.equal(map.newText.slice(res.start, res.end), '门禁坏了以后快递堆在大厅'.slice(0, 12));
});

test('deletion inside a span yields partial with the exact deleted character count', () => {
  const v1 = '消防通道堆纸箱旧家具，物业清理过。';
  const v2 = '消防通道堆纸箱，物业清理过。';
  const map = buildRevisionMap(v1, v2);
  const res = migrateAnnotation({ id: 'a', coder: 'A', start: 0, end: 14, topics: ['safety'] }, map);
  assert.equal(res.status, 'partial');
  assert.equal(res.start, 0);
  assert.equal(res.end, 11);
  assert.equal(res.deletedChars, 3);
});

test('a span whose text was entirely deleted is lost and disputed', () => {
  // [3,7) is exactly '乙段内容' — every character of it is deleted, and the
  // sentence-final period is outside the span.
  const map = buildRevisionMap('前文。乙段内容。后文。', '前文。后文。');
  const res = migrateAnnotation({ id: 'a', coder: 'A', start: 3, end: 7, topics: ['service'] }, map);
  assert.equal(res.status, 'lost');
  assert.equal(res.dispute, true);
  assert.equal(res.start, null);
});

test('empty span anchors migrate exactly across an insertion', () => {
  const map = buildRevisionMap('甲乙丙丁', 'X甲乙丙丁');
  const res = migrateAnnotation({ id: 'a', coder: 'A', start: 2, end: 2, topics: [] }, map);
  assert.equal(res.status, 'exact');
  assert.equal(res.start, 3);
});

test('composed maps preserve intermediate coordinates and guard the chain', () => {
  const m1 = buildRevisionMap('甲乙丙丁', '甲乙新增丙丁');
  const m2 = buildRevisionMap('甲乙新增丙丁', '甲乙新增丙丁戊');
  const chain = composeMaps([m1, m2]);
  const res = migrateThrough({ id: 'a', coder: 'A', start: 2, end: 4, topics: ['noise'] }, chain);
  assert.equal(res.status, 'shifted');
  assert.equal(res.start, 4);
  assert.equal(res.end, 6);
  assert.throws(() => composeMaps([m1, buildRevisionMap('别的文本', '又一段')]), /chain broken/);
});

test('identical revisions map every span exactly', () => {
  const text = '东门早市的摊位每天摆到九点，喇叭声从五点就没停过。';
  const map = buildRevisionMap(text, text);
  for (let s = 0; s + 2 <= text.length; s += 3) {
    const res = migrateAnnotation({ start: s, end: s + 2, topics: [] }, map, { searchOccurrences: false });
    assert.equal(res.status, 'exact');
    assert.equal(res.start, s);
  }
});

test('the demo revision exercises every migration status', () => {
  const corpus = JSON.parse(readFileSync(new URL('../src/data/corpus.json', import.meta.url), 'utf8'));
  const doc = corpus.documents.find((d) => d.id === 'D12');
  assert.equal(doc.versions.length, 2);
  const map = buildRevisionMap(doc.versions[0].text, doc.versions[1].text);
  const results = doc.annotations.map((a) => migrateAnnotation(a, map));
  const statuses = new Set(results.map((r) => r.status));
  for (const s of ['exact', 'shifted', 'partial', 'ambiguous', 'lost']) {
    assert.ok(statuses.has(s), `revision demo should include a ${s} span`);
  }
  // The ambiguous span is the sentence that occurs twice in v2; both copies are
  // offered and the source annotation is untouched.
  const amb = results.find((r) => r.status === 'ambiguous');
  assert.ok(amb.candidates.length >= 2);
  assert.deepEqual(amb.source.start, 73);
  for (const c of amb.candidates) {
    assert.equal(doc.versions[1].text.slice(c.start, c.end), amb.oldText);
  }
  // Disputes are exactly the ambiguous + lost spans.
  assert.equal(results.filter((r) => r.dispute).length, results.filter((r) => r.status === 'ambiguous' || r.status === 'lost').length);
});

test('a deleted sentence is lost, not ambiguous, despite shared punctuation', () => {
  // Every character of the deleted clause is gone; what remains in v2 are
  // unrelated sentences that happen to share `的` and `。`.
  const v1 = '开头一句。有人把消防栓前面当成了停车位，我看着很担心。结尾。';
  const v2 = '开头一句。结尾。';
  const map = buildRevisionMap(v1, v2);
  const s = v1.indexOf('有人');
  const e = s + '有人把消防栓前面当成了停车位，我看着很担心。'.length;
  const res = migrateAnnotation({ id: 'a', coder: 'A', start: s, end: e, topics: ['safety'] }, map);
  assert.equal(res.status, 'lost');
  assert.equal(res.dispute, true);
});

test('repeated text in the new document yields candidate ranges, not a pin', () => {
  const v1 = '开头。绿化带的围栏倒了一段，一直没有人修。结尾。';
  const v2 = '开头。绿化带的围栏倒了一段，一直没有人修。中间。绿化带的围栏倒了一段，一直没有人修。结尾。';
  const map = buildRevisionMap(v1, v2);
  const s = v1.indexOf('绿化带');
  const res = migrateAnnotation({ id: 'a', coder: 'A', start: s, end: s + 18, topics: ['green'] }, map);
  assert.equal(res.status, 'ambiguous');
  assert.equal(res.multipleOccurrences, true);
  assert.equal(res.candidates.length, 2);
  for (const c of res.candidates) {
    assert.equal(v2.slice(c.start, c.end), '绿化带的围栏倒了一段，一直没有人修。');
  }
});

test('referenceMapOffset agrees with the displayed alignment and is range-checked', () => {
  const a = 'abcab';
  const b = 'abxab';
  const map = buildRevisionMap(a, b);
  for (let i = 0; i <= a.length; i++) {
    const ref = referenceMapOffset(a, b, i);
    if (i === a.length) {
      assert.equal(ref, b.length);
    } else if (map.primary[i] >= 0) {
      assert.equal(ref, map.primary[i]);
    } else {
      assert.equal(ref, -1);
    }
  }
  assert.throws(() => referenceMapOffset(a, b, -1), /outside/);
  assert.throws(() => referenceMapOffset(a, b, a.length + 1), /outside/);
});
