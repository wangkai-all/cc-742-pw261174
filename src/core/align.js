// Aligning two coders' span sets before comparing topics.
//
// The point of the desk: an opinion can discuss several topics, and the two
// coders may cut it into different segments. Comparing the whole-document label
// sets would say "both used T1 and T3" even when one coder put T1 in the opening
// and the other attached it to the closing sentence. So the unit of comparison
// is a *segment pair*: one coder's span and the best-overlapping span(s) of the
// other, together with the exact character overlap.
//
// Everything here is deterministic and symmetric with respect to the two codings:
// no coder is the "reference". Ties are broken by a fixed rule documented inline.

import { overlapLength, canonicalLabels } from './text.js';

/**
 * @typedef {{id:string, coder:string, start:number, end:number, topics:string[]}} Span
 */

/**
 * All span pairs with non-zero overlap, using a two-pointer sweep over
 * start-sorted lists. O((n+m) log(n+m) + pairs).
 */
export function overlapPairs(spansA, spansB) {
  const A = [...spansA].sort((x, y) => x.start - y.start || x.end - y.end || x.id.localeCompare(y.id));
  const B = [...spansB].sort((x, y) => x.start - y.start || x.end - y.end || x.id.localeCompare(y.id));
  const pairs = [];
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      // B is start-sorted, so once B[j] starts at or after A[i]'s end no later B
      // span can overlap A[i].
      if (B[j].start >= A[i].end) break;
      const ov = overlapLength(A[i].start, A[i].end, B[j].start, B[j].end);
      if (ov > 0) pairs.push({ a: A[i], b: B[j], overlap: ov });
    }
  }
  return pairs;
}

/**
 * Build matched segment blocks.
 *
 * A "block" is a maximal character interval within which the *sets* of A-spans
 * and B-spans covering the text are constant. Blocks are the atoms on which we
 * can compare topics fairly. Each block lists which A and B spans cover it.
 */
export function segmentBlocks(spansA, spansB, length) {
  const points = new Set([0, length]);
  for (const s of spansA) {
    points.add(s.start);
    points.add(s.end);
  }
  for (const s of spansB) {
    points.add(s.start);
    points.add(s.end);
  }
  const sorted = [...points].filter((p) => p >= 0 && p <= length).sort((x, y) => x - y);
  const blocks = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const coverA = spansA.filter((s) => s.start <= start && end <= s.end);
    const coverB = spansB.filter((s) => s.start <= start && end <= s.end);
    blocks.push({
      start,
      end,
      aIds: coverA.map((s) => s.id),
      bIds: coverB.map((s) => s.id),
      aTopics: canonicalLabels(coverA.flatMap((s) => s.topics)),
      bTopics: canonicalLabels(coverB.flatMap((s) => s.topics)),
    });
  }
  return blocks;
}

/**
 * Connected components of the overlap graph between two codings.
 *
 * Two spans are connected when they overlap. A component is the largest stretch
 * of text the two coders argue about *as a unit*: if A marks [0,48) as
 * {noise,parking} and B marks [0,23) {noise} and [23,48) {parking}, they disagree
 * about where the cut goes, not about which topics the stretch contains. If A
 * puts a topic at the start of the document and B puts it at the end, the two
 * mentions land in different components and remain a real topic disagreement.
 *
 * Spans with no overlap form singleton components. Components are returned in
 * text order, each with the union of topics on each side and the sorted set of
 * internal cut positions, so a reviewer can see the unit that was compared.
 */
export function alignedRegions(spansA, spansB) {
  const nodes = [
    ...spansA.map((s) => ({ side: 'A', span: s })),
    ...spansB.map((s) => ({ side: 'B', span: s })),
  ];
  const parent = nodes.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  for (let i = 0; i < spansA.length; i++) {
    for (let j = 0; j < spansB.length; j++) {
      if (overlapLength(spansA[i].start, spansA[i].end, spansB[j].start, spansB[j].end) > 0) {
        union(i, spansA.length + j);
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(nodes[i]);
  }
  const regions = [];
  for (const members of groups.values()) {
    const aSpans = members.filter((m) => m.side === 'A').map((m) => m.span);
    const bSpans = members.filter((m) => m.side === 'B').map((m) => m.span);
    const all = [...aSpans, ...bSpans];
    const start = Math.min(...all.map((s) => s.start));
    const end = Math.max(...all.map((s) => s.end));
    const aTopics = canonicalLabels(aSpans.flatMap((s) => s.topics));
    const bTopics = canonicalLabels(bSpans.flatMap((s) => s.topics));
    const cuts = new Set([start, end]);
    for (const s of all) {
      cuts.add(s.start);
      cuts.add(s.end);
    }
    regions.push({
      start,
      end,
      aSpans,
      bSpans,
      aTopics,
      bTopics,
      sharedTopics: aTopics.filter((t) => bTopics.includes(t)),
      topicsEqual: aTopics.length === bTopics.length && aTopics.every((t, i) => t === bTopics[i]),
      cuts: [...cuts].sort((x, y) => x - y),
      aSpanCount: aSpans.length,
      bSpanCount: bSpans.length,
    });
  }
  regions.sort((x, y) => x.start - y.start || x.end - y.end);
  return regions;
}

/**
 * Pair each coder's spans with the best counterpart, for the "aligned segment"
 * table and for boundary/IoU attribution.
 *
 * For each span in A we select the set of B spans with maximal character overlap
 * (if several are tied, all are selected — the coder's segment genuinely spans
 * them). Reciprocal best matches are marked as `aligned`; one-sided spans are
 * `unmatched`. This is symmetric: running it on (B,A) yields the same pairing.
 */
export function pairSegments(spansA, spansB, opts = {}) {
  const iouFloor = opts.iouFloor ?? 0;
  const pairs = overlapPairs(spansA, spansB);
  const byA = new Map();
  const byB = new Map();
  for (const p of pairs) {
    if (!byA.has(p.a.id)) byA.set(p.a.id, []);
    byA.get(p.a.id).push(p);
    if (!byB.has(p.b.id)) byB.set(p.b.id, []);
    byB.get(p.b.id).push(p);
  }
  const bestFor = (list) => {
    if (!list || !list.length) return { spans: [], overlap: 0 };
    let max = 0;
    for (const p of list) max = Math.max(max, p.overlap);
    return { spans: list.filter((p) => p.overlap === max), overlap: max };
  };
  const aBest = new Map();
  for (const s of spansA) {
    const best = bestFor(byA.get(s.id));
    aBest.set(s.id, { span: s, partners: best.spans, overlap: best.overlap });
  }
  const bBest = new Map();
  for (const s of spansB) {
    const best = bestFor(byB.get(s.id));
    bBest.set(s.id, { span: s, partners: best.spans, overlap: best.overlap });
  }
  const matched = new Map(); // "idA|idB" -> { reciprocal: boolean, overlap }
  const mark = (a, b, reciprocal, overlap) => {
    const key = `${a}|${b}`;
    const cur = matched.get(key);
    if (!cur || reciprocal) matched.set(key, { reciprocal: reciprocal || (cur && cur.reciprocal), overlap });
  };
  for (const [, info] of aBest) {
    for (const p of info.partners) {
      const rb = bBest.get(p.b.id);
      const reciprocal = rb ? rb.partners.some((q) => q.a.id === info.span.id) : false;
      mark(info.span.id, p.b.id, reciprocal, p.overlap);
    }
  }
  const spanByIdA = new Map(spansA.map((s) => [s.id, s]));
  const spanByIdB = new Map(spansB.map((s) => [s.id, s]));

  const links = [];
  for (const [key, v] of matched) {
    const [aid, bid] = key.split('|');
    const a = spanByIdA.get(aid);
    const b = spanByIdB.get(bid);
    const union = (a.end - a.start) + (b.end - b.start) - v.overlap;
    const iou = union > 0 ? v.overlap / union : 0;
    const boundaryDiff = Math.abs(a.start - b.start) + Math.abs(a.end - b.end);
    const topicSame = canonicalLabels(a.topics).join('\u0001') === canonicalLabels(b.topics).join('\u0001');
    links.push({
      a,
      b,
      overlap: v.overlap,
      iou,
      boundaryDiff,
      reciprocal: v.reciprocal,
      topicSame,
      meetsIou: iou >= iouFloor,
    });
  }
  links.sort((x, y) => x.a.start - y.a.start || x.b.start - y.b.start || x.a.id.localeCompare(y.a.id));

  const matchedA = new Set(links.filter((l) => l.reciprocal).map((l) => l.a.id));
  const matchedB = new Set(links.filter((l) => l.reciprocal).map((l) => l.b.id));
  const unpairedA = spansA.filter((s) => !matchedA.has(s.id));
  const unpairedB = spansB.filter((s) => !matchedB.has(s.id));
  return { links, unpairedA, unpairedB, pairs };
}

/**
 * Compare topics block by block, weighted by characters.
 *
 * Agreements, disagreements and one-sided labels are counted over *labels*, not
 * spans: a block where both coders put T1 counts one agreement per character,
 * regardless of how many overlapping spans produced T1.
 *
 * The result distinguishes:
 *   - topicDisagreement: same characters, different label sets
 *   - coverageGap: characters labelled by one coder only
 *   - agreement: same label set on the same characters
 */
export function compareTopics(spansA, spansB, length) {
  const blocks = segmentBlocks(spansA, spansB, length);
  let agreeChars = 0;
  let disagreeChars = 0;
  let onlyAChars = 0;
  let onlyBChars = 0;
  let bothEmptyChars = 0;
  const topicStats = new Map();
  const touch = (t) => {
    if (!topicStats.has(t)) {
      topicStats.set(t, { topic: t, both: 0, aOnly: 0, bOnly: 0, conflictWith: new Map() });
    }
    return topicStats.get(t);
  };
  const conflict = (t, u, len) => {
    const st = touch(t);
    st.conflictWith.set(u, (st.conflictWith.get(u) || 0) + len);
  };
  const disagreements = [];

  for (const block of blocks) {
    const len = block.end - block.start;
    const A = new Set(block.aTopics);
    const B = new Set(block.bTopics);
    if (!A.size && !B.size) {
      bothEmptyChars += len;
      continue;
    }
    if (A.size && B.size) {
      const same = A.size === B.size && [...A].every((t) => B.has(t));
      const aOnlySet = [...A].filter((t) => !B.has(t));
      const bOnlySet = [...B].filter((t) => !A.has(t));
      for (const t of A) if (B.has(t)) touch(t).both += len;
      for (const t of aOnlySet) touch(t).aOnly += len;
      for (const t of bOnlySet) touch(t).bOnly += len;
      // A conflict is a character where one coder said t and the other said u,
      // with t and u both exclusive to their side. Shared labels never conflict;
      // an "extra label" is already visible as a one-sided contribution.
      for (const t of aOnlySet) for (const u of bOnlySet) {
        conflict(t, u, len);
        conflict(u, t, len);
      }
      if (same) agreeChars += len;
      else {
        disagreeChars += len;
        disagreements.push({
          start: block.start, end: block.end, length: len,
          aTopics: [...A].sort(), bTopics: [...B].sort(),
          shared: [...A].filter((t) => B.has(t)).sort(),
        });
      }
    } else if (A.size) {
      onlyAChars += len;
      for (const t of A) touch(t).aOnly += len;
    } else {
      onlyBChars += len;
      for (const t of B) touch(t).bOnly += len;
    }
  }

  const labelledA = agreeChars + disagreeChars + onlyAChars;
  const labelledB = agreeChars + disagreeChars + onlyBChars;
  const unionChars = agreeChars + disagreeChars + onlyAChars + onlyBChars;
  return {
    length,
    blocks,
    agreeChars, disagreeChars, onlyAChars, onlyBChars, bothEmptyChars,
    coverageA: length ? labelledA / length : 0,
    coverageB: length ? labelledB / length : 0,
    // Agreement measured on the union of labelled characters: both coders
    // labelled the character and gave it the same label set. Characters labelled
    // by only one coder count against, since that is a real difference in what
    // the text was said to be about.
    agreement: unionChars ? agreeChars / unionChars : 1,
    jaccard: unionChars ? agreeChars / unionChars : 1,
    topicStats: [...topicStats.values()].map((s) => ({
      ...s,
      // `both` is the number of characters where this topic was named by both
      // coders (with the same label set). Kept separate from conflicts so that
      // aOnly + bOnly are exactly the one-sided contributions and sum to
      // disagreeChars + onlyAChars + onlyBChars across all topics.
      agree: s.both,
      conflictWith: [...s.conflictWith.entries()]
        .map(([topic, chars]) => ({ topic, chars }))
        .sort((x, y) => y.chars - x.chars || x.topic.localeCompare(y.topic)),
    })).sort((x, y) => (y.both + y.aOnly + y.bOnly) - (x.both + x.aOnly + x.bOnly) || x.topic.localeCompare(y.topic)),
    disagreements,
  };
}
