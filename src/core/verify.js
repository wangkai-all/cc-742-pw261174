// Independent checks the desk runs on itself.
//
// The analysis code is fast and table-driven. The risk with that kind of code is
// not a crash but a quiet disagreement with the obvious definition. So every
// batch result is re-derived the slow, literal way:
//
//   sweepLabels      vs labelsAt for every character of every document
//   attribute()      vs a per-character classification of the same text
//   topicStats       vs per-character label counting
//   topicCoverage    vs a per-character tally
//   segment blocks   vs a per-character tile
//   locateSpanExact  vs brute-force enumeration of every optimal alignment, on
//                    small slices of the revision text
//
// Everything returns plain data ({id, title, method, total, failures, passed})
// so the browser page and the unit tests read the same report.

import { charLabels, labelsAt, sweepLabels, topicCoverage, canonicalLabels } from './text.js';
import { segmentBlocks, compareTopics } from './align.js';
import { attribute } from './attribute.js';
import { lcsTables, buildRevisionMap } from './diff.js';
import { locateSpanExact, locateSpan } from './migrate.js';

// ---------------------------------------------------------------------------
// Brute force: enumerate every optimal alignment of two short texts by walking
// the suffix-LCS table. Exponential by design; used only as a reference.
// ---------------------------------------------------------------------------

export function allOptimalAlignments(a, b, cap = 20000) {
  const { suf, w } = lcsTables(a, b);
  const out = [];
  const map = new Int32Array(a.length).fill(-1);
  let truncated = false;
  function rec(i, p) {
    if (truncated) return;
    if (out.length >= cap) {
      truncated = true;
      return;
    }
    if (i === a.length && p === b.length) {
      out.push(Array.from(map));
      return;
    }
    const cur = suf[i * w + p];
    if (i < a.length && p < b.length && a[i] === b[p] && 1 + suf[(i + 1) * w + (p + 1)] === cur) {
      map[i] = p;
      rec(i + 1, p + 1);
      map[i] = -1;
    }
    if (i < a.length && suf[(i + 1) * w + p] === cur) rec(i + 1, p);
    if (p < b.length && suf[i * w + (p + 1)] === cur) rec(i, p + 1);
  }
  rec(0, 0);
  return { alignments: out, truncated };
}

export function bruteImageSet(a, b, s, e, cap = 20000) {
  const { alignments, truncated } = allOptimalAlignments(a, b, cap);
  if (truncated) return { ranges: null, truncated: true };
  const ranges = new Set();
  for (const map of alignments) {
    const pos = [];
    for (let i = s; i < e; i++) if (map[i] >= 0) pos.push(map[i]);
    if (pos.length) ranges.add(`${pos[0]}:${pos[pos.length - 1] + 1}`);
  }
  return { ranges, truncated: false };
}

// ---------------------------------------------------------------------------
// Per-document checks
// ---------------------------------------------------------------------------

function check(id, title, method, total, failures, extra = {}) {
  return { id, title, method, total, failures: failures.slice(0, 40), failureCount: failures.length, passed: failures.length === 0, ...extra };
}

/** Atom-by-atom comparison of the sweep against labelsAt. */
export function verifySweep(doc, version = 'v1') {
  const text = textOf(doc, version);
  const A = spansOf(doc, 'A');
  const B = spansOf(doc, 'B');
  const refA = charLabels(A, text.length);
  const refB = charLabels(B, text.length);
  const atoms = sweepLabels({ annotations: A }, { annotations: B }, text.length);
  const failures = [];
  let covered = 0;
  for (const atom of atoms) {
    covered += atom.end - atom.start;
    for (let i = atom.start; i < atom.end; i++) {
      if (atom.a.join('|') !== refA[i].join('|') || atom.b.join('|') !== refB[i].join('|')) {
        failures.push({ docId: doc.id, pos: i, ch: text[i], sweep: { a: atom.a, b: atom.b }, ref: { a: refA[i], b: refB[i] } });
      }
    }
  }
  if (covered !== text.length) failures.push({ docId: doc.id, pos: null, message: `sweep covered ${covered}/${text.length}` });
  return check(`sweep:${doc.id}`, '区间扫描与逐字符参照一致', '对每个原子区间抽取每个字符，与 labelsAt() 的集合逐一比较', text.length, failures);
}

/**
 * Attribution totals vs an independent per-character classification.
 *
 * Two different questions are checked separately, because they have different
 * answers and the desk reports both:
 *
 *   a) per-character agreement — how many characters carry the same label set
 *      (this is compareTopics' `agreeChars`, shown as "逐字符一致");
 *   b) aligned-region attribution — whether each region's label sets agree once
 *      the coders' cuts are aligned (attribute()).
 *
 * The check below re-derives (a) literally, character by character, and confirms
 * that attribute()'s totals equal the region-weighted application of (a)'s
 * classification: every labelled character is in exactly one region, and a
 * region's contribution is decided by the union of its members' labels. It also
 * verifies that each region's topic sets really are the union of per-character
 * labels on its side.
 */
export function verifyAttribution(doc, version = 'v1') {
  const text = textOf(doc, version);
  const A = spansOf(doc, 'A');
  const B = spansOf(doc, 'B');
  const refA = charLabels(A, text.length);
  const refB = charLabels(B, text.length);
  const attr = attribute(A, B, text.length);
  const failures = [];

  // Per-character reference tally, for the summary line.
  let perCharAgree = 0;
  let perCharTopic = 0;
  let perCharOnlyA = 0;
  let perCharOnlyB = 0;
  for (let i = 0; i < text.length; i++) {
    const a = refA[i];
    const b = refB[i];
    if (a.length && b.length) {
      if (a.length === b.length && a.every((t, k) => t === b[k])) perCharAgree++;
      else perCharTopic++;
    } else if (a.length) perCharOnlyA++;
    else if (b.length) perCharOnlyB++;
  }

  // Regions must partition the labelled characters.
  let covered = 0;
  for (const r of attr.regions) {
    if (r.end <= r.start) continue;
    covered += r.end - r.start;
    // Region topic sets must be the union of the per-character labels inside it.
    const unionA = new Set();
    const unionB = new Set();
    for (let i = r.start; i < r.end; i++) {
      for (const t of refA[i]) unionA.add(t);
      for (const t of refB[i]) unionB.add(t);
    }
    const sortedA = [...unionA].sort().join('|');
    const sortedB = [...unionB].sort().join('|');
    if (sortedA !== r.aTopics.join('|')) {
      failures.push({ docId: doc.id, region: [r.start, r.end], side: 'A', got: r.aTopics, want: [...unionA].sort() });
    }
    if (sortedB !== r.bTopics.join('|')) {
      failures.push({ docId: doc.id, region: [r.start, r.end], side: 'B', got: r.bTopics, want: [...unionB].sort() });
    }
  }
  if (covered !== attr.labelledUnion) {
    failures.push({ docId: doc.id, field: 'labelledUnion', got: attr.labelledUnion, want: covered });
  }

  // Recompute the attribution from the checked regions; it must match exactly.
  let agree = 0;
  let topic = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (const r of attr.regions) {
    const len = r.end - r.start;
    if (!len) continue;
    const hasA = r.aTopics.length > 0;
    const hasB = r.bTopics.length > 0;
    if (hasA && hasB) {
      const equal = r.aTopics.length === r.bTopics.length && r.aTopics.every((t, i) => t === r.bTopics[i]);
      if (equal) agree += len;
      else topic += len;
    } else if (hasA) onlyA += len;
    else if (hasB) onlyB += len;
  }
  const cmp = (name, got, want) => {
    if (got !== want) failures.push({ docId: doc.id, field: name, got, want });
  };
  cmp('agree', attr.agree, agree);
  cmp('topicDiff', attr.topicDiff, topic);
  cmp('onlyA', attr.onlyA, onlyA);
  cmp('onlyB', attr.onlyB, onlyB);
  cmp('perCharAgreeChars', perCharAgree, compareTopics(A, B, text.length).agreeChars);
  void perCharTopic;
  void perCharOnlyA;
  void perCharOnlyB;
  return check(`attribute:${doc.id}`, '对齐区域归因与逐字符参照一致', '逐字符计算标签集合，核对区域划分、区域标签并集，以及归因总数', text.length, failures, {
    perChar: { agree: perCharAgree, topic: perCharTopic, onlyA: perCharOnlyA, onlyB: perCharOnlyB },
  });
}

/** Topic contribution table vs per-character label counting. */
export function verifyTopicStats(doc, version = 'v1') {
  const text = textOf(doc, version);
  const A = spansOf(doc, 'A');
  const B = spansOf(doc, 'B');
  const refA = charLabels(A, text.length);
  const refB = charLabels(B, text.length);
  const want = new Map();
  const touch = (t) => {
    if (!want.has(t)) want.set(t, { both: 0, aOnly: 0, bOnly: 0 });
    return want.get(t);
  };
  for (let i = 0; i < text.length; i++) {
    const a = new Set(refA[i]);
    const b = new Set(refB[i]);
    for (const t of a) if (b.has(t)) touch(t).both++;
    for (const t of a) if (!b.has(t)) touch(t).aOnly++;
    for (const t of b) if (!a.has(t)) touch(t).bOnly++;
  }
  const cmp = compareTopics(A, B, text.length);
  const failures = [];
  for (const st of cmp.topicStats) {
    const w = want.get(st.topic) || { both: 0, aOnly: 0, bOnly: 0 };
    if (st.both !== w.both || st.aOnly !== w.aOnly || st.bOnly !== w.bOnly) {
      failures.push({ docId: doc.id, topic: st.topic, got: { both: st.both, aOnly: st.aOnly, bOnly: st.bOnly }, want: w });
    }
    want.delete(st.topic);
  }
  for (const [t, w] of want) failures.push({ docId: doc.id, topic: t, got: null, want: w });
  return check(`topics:${doc.id}`, '主题贡献表与逐字符计数一致', '逐字符统计每个主题被双方/单方标注的次数，与 topicStats 比较', text.length, failures);
}

/** Coverage vs a per-character tally. */
export function verifyCoverage(doc, version = 'v1') {
  const text = textOf(doc, version);
  const failures = [];
  for (const coder of ['A', 'B']) {
    const spans = spansOf(doc, coder);
    const ref = charLabels(spans, text.length);
    const per = new Map();
    let covered = 0;
    for (let i = 0; i < text.length; i++) {
      if (ref[i].length) covered++;
      for (const t of ref[i]) per.set(t, (per.get(t) || 0) + 1);
    }
    const cov = topicCoverage(spans, text.length);
    if (cov.covered !== covered) failures.push({ docId: doc.id, coder, field: 'covered', got: cov.covered, want: covered });
    for (const [t, n] of per) {
      if (cov.perTopic.get(t) !== n) failures.push({ docId: doc.id, coder, topic: t, got: cov.perTopic.get(t), want: n });
    }
  }
  return check(`coverage:${doc.id}`, '主题覆盖与逐字符统计一致', '逐字符累加每个主题的覆盖长度，与 topicCoverage() 的差分数组结果比较', text.length, failures);
}

/** Blocks tile the text; successive atoms carry the covering label sets. */
export function verifyBlocks(doc, version = 'v1') {
  const text = textOf(doc, version);
  const A = spansOf(doc, 'A');
  const B = spansOf(doc, 'B');
  const blocks = segmentBlocks(A, B, text.length);
  const refA = charLabels(A, text.length);
  const refB = charLabels(B, text.length);
  const failures = [];
  let cursor = 0;
  for (const b of blocks) {
    if (b.start !== cursor) failures.push({ docId: doc.id, message: `gap/overlap at ${cursor}..${b.start}` });
    cursor = b.end;
    if (b.aTopics.join('|') !== refA[b.start].join('|') || b.bTopics.join('|') !== refB[b.start].join('|')) {
      failures.push({ docId: doc.id, pos: b.start, block: { a: b.aTopics, b: b.bTopics }, ref: { a: refA[b.start], b: refB[b.start] } });
    }
  }
  if (cursor !== text.length) failures.push({ docId: doc.id, message: `blocks end at ${cursor}/${text.length}` });
  return check(`blocks:${doc.id}`, '分段区块完整铺满文本', '区块必须首尾相接覆盖全文，且首字符的覆盖标签与逐字符参照一致', text.length, failures);
}

// ---------------------------------------------------------------------------
// Migration check: exact enumeration vs brute force on small text slices
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Take random short slices of the old/new revision text and check that the
 * exact locator's answer equals brute-force enumeration. Slices are kept small
 * so the brute-force walk stays bounded; slices whose alignment count explodes
 * are skipped and counted separately.
 */
export function verifyMigrationBySlices(corpus, docId, opts = {}) {
  const doc = corpus.documents.find((d) => d.id === docId);
  const pairs = doc.versions;
  const count = opts.slices ?? 80;
  const maxLen = opts.maxLen ?? 12;
  const rand = makeRng(opts.seed ?? 20261124);
  const failures = [];
  let tested = 0;
  let skipped = 0;
  for (let k = 0; k < count; k++) {
    const oldLen = pairs[0].text.length;
    const newLen = pairs[1].text.length;
    const len = 3 + Math.floor(rand() * (maxLen - 3));
    const s = Math.floor(rand() * (oldLen - len));
    // Keep the new slice near the same neighbourhood so the pair usually has
    // structure (some equal runs and some edits) instead of being unrelated.
    const shift = Math.floor(rand() * 17) - 8;
    const ns = Math.max(0, Math.min(newLen - len, s + shift));
    const a = pairs[0].text.slice(s, s + len);
    const b = pairs[1].text.slice(ns, ns + len);
    if (!a || !b) { skipped++; continue; }
    const map = buildRevisionMap(a, b);
    for (let x = 0; x < a.length; x++) {
      for (let y = x + 1; y <= a.length; y++) {
        const brute = bruteImageSet(a, b, x, y, opts.cap ?? 20000);
        if (brute.truncated || brute.ranges === null) { skipped++; continue; }
        tested++;
        const got = locateSpanExact(map, x, y);
        if (brute.ranges.size === 1) {
          const only = [...brute.ranges][0];
          if (got.status === 'ambiguous' || `${got.start}:${got.end}` !== only) {
            failures.push({ a, b, span: [x, y], brute: only, got: got.status === 'ambiguous' ? 'ambiguous' : `${got.start}:${got.end}` });
          }
        } else if (brute.ranges.size > 1) {
          if (got.status !== 'ambiguous') {
            failures.push({ a, b, span: [x, y], brute: [...brute.ranges], got: got.status });
          } else if (got.candidatesExact) {
            const mine = new Set(got.candidates.map((c) => `${c.start}:${c.end}`));
            const want = [...brute.ranges].sort().join(',');
            const have = [...mine].sort().join(',');
            if (mine.size !== brute.ranges.size || have !== want) failures.push({ a, b, span: [x, y], brute: want, got: have });
          }
        } else if (got.status !== 'lost') {
          failures.push({ a, b, span: [x, y], brute: 'none', got: got.status });
        }
      }
    }
  }
  return check('migration:slices', '迁移定位与暴力枚举一致', `在修订文本上抽取 ${count} 组短片段，枚举全部最优对齐，逐区间比对 locateSpanExact()`, tested, failures, { skipped });
}

/**
 * Report every v1 annotation migrating into v2: the exact locator, the
 * block-policy locator, and whether the returned image really carries the text.
 */
export function verifyDemoMigration(corpus, docId) {
  const doc = corpus.documents.find((d) => d.id === docId);
  const [v1, v2] = doc.versions;
  const map = buildRevisionMap(v1.text, v2.text);
  const rows = [];
  const failures = [];
  for (const ann of doc.annotations) {
    const policy = locateSpan(map, ann.start, ann.end);
    const exact = locateSpanExact(map, ann.start, ann.end);
    const oldText = v1.text.slice(ann.start, ann.end);
    const row = {
      id: ann.id, coder: ann.coder, source: [ann.start, ann.end],
      status: policy.status, exactStatus: exact.status,
      target: policy.status === 'ambiguous' || policy.status === 'lost' ? null : [policy.start, policy.end],
      candidates: policy.candidates,
      policyDiffers: policy.status !== exact.status ||
        (policy.status !== 'ambiguous' && policy.status !== 'lost' && (policy.start !== exact.start || policy.end !== exact.end)),
    };
    if (row.target) {
      const moved = v2.text.slice(row.target[0], row.target[1]);
      // A moved span must contain at least the longest surviving block.
      const longest = (policy.anchors || []).reduce((m, x) => Math.max(m, x.length), 0);
      if (moved.length < longest) {
        failures.push({ id: ann.id, message: `target text shorter than its longest anchor (${moved.length} < ${longest})` });
      }
      if (policy.status === 'exact' || policy.status === 'shifted') {
        // Whole span survived: the characters must be identical.
        if (moved !== oldText) failures.push({ id: ann.id, message: 'span marked intact but its new text differs' });
      }
    }
    row.oldText = oldText;
    rows.push(row);
  }
  return { ...check(`migration:demo:${docId}`, '示例修订的迁移结果可核对', '每个标注的定位结果、候选区间与目标文本逐条列出', rows.length, failures), rows };
}

// ---------------------------------------------------------------------------
// Whole-corpus report
// ---------------------------------------------------------------------------

export function verifyCorpus(corpus, opts = {}) {
  const checks = [];
  for (const doc of corpus.documents) {
    checks.push(verifySweep(doc));
    checks.push(verifyAttribution(doc));
    checks.push(verifyTopicStats(doc));
    checks.push(verifyCoverage(doc));
    checks.push(verifyBlocks(doc));
  }
  const revised = corpus.documents.filter((d) => d.versions.length > 1);
  for (const doc of revised) {
    checks.push(verifyMigrationBySlices(corpus, doc.id, opts));
    const demo = verifyDemoMigration(corpus, doc.id);
    checks.push(demo);
  }
  const failed = checks.filter((c) => !c.passed);
  return {
    checks,
    total: checks.reduce((n, c) => n + c.total, 0),
    passedChecks: checks.length - failed.length,
    failedChecks: failed.length,
    ok: failed.length === 0,
    ranAt: new Date().toISOString(),
  };
}

function textOf(doc, version) {
  const v = doc.versions.find((x) => x.version === version) || doc.versions[0];
  return v.text;
}

function spansOf(doc, coder) {
  return doc.annotations.filter((a) => a.coder === coder);
}

export { labelsAt, canonicalLabels };
