// Attributing disagreement to boundaries or to topics.
//
// The desk must say *what kind* of disagreement two codings have. Four kinds are
// separated here:
//
//   1. boundary disagreement — the same labelled character run is cut differently
//      (one coder starts a segment where the other continues).
//   2. segmentation-only disagreement — the spans are cut differently but the
//      label sets over the whole aligned region agree. This is a real
//      disagreement about units of analysis, not about meaning.
//   3. topic disagreement — the aligned region's label sets differ.
//   4. coverage gap — one coder labelled characters the other left unlabelled.
//
// Attribution happens on *aligned regions* (see align.js): the connected
// components of the overlap graph. Comparing chars would count the same
// disagreement twice — once for the first half of a merged span and again for the
// second — and would blame a merge on whichever half carried no extra label. A
// region is the unit the two coders actually disagree about.
//
// Region labels are compared as sets; cuts inside the region are counted
// separately, so "same topics, different cut" is reported as segmentation.

import { overlapLength, canonicalLabels } from './text.js';
import { alignedRegions } from './align.js';

/**
 * Boundary positions for one coder: every span start and end. Includes the two
 * document ends as anchors so "one segment vs two" is visible.
 */
export function boundarySet(spans, length) {
  const set = new Set([0, length]);
  for (const s of spans) {
    set.add(s.start);
    set.add(s.end);
  }
  return [...set].sort((x, y) => x - y);
}

/**
 * Compare boundary sets. Returns exact positions where only one coder has a
 * boundary, grouped into runs, plus a summary distance.
 */
export function compareBoundaries(spansA, spansB, length) {
  const ba = boundarySet(spansA, length);
  const bb = boundarySet(spansB, length);
  const sa = new Set(ba);
  const sb = new Set(bb);
  const onlyA = ba.filter((p) => !sb.has(p));
  const onlyB = bb.filter((p) => !sa.has(p));
  const shared = ba.filter((p) => sb.has(p));
  const all = [...new Set([...ba, ...bb])].sort((x, y) => x - y);
  // Nearest-boundary distance for each boundary, in characters: a small value
  // means a minor trimming difference, a large one a different segment entirely.
  const nearestOther = (p, set) => {
    let best = Infinity;
    for (const q of set) best = Math.min(best, Math.abs(q - p));
    return best;
  };
  const distances = onlyA.map((p) => nearestOther(p, bb)).concat(onlyB.map((p) => nearestOther(p, ba)));
  const meanDistance = distances.length ? distances.reduce((x, y) => x + y, 0) / distances.length : 0;
  const runs = groupRuns(all.filter((p) => sa.has(p) !== sb.has(p)));
  return {
    a: ba, b: bb, shared, onlyA, onlyB, runs,
    meanDistance,
    maxDistance: distances.length ? Math.max(...distances) : 0,
    boundaryCountA: ba.length - 2,
    boundaryCountB: bb.length - 2,
    unmatchedCount: onlyA.length + onlyB.length,
  };
}

function groupRuns(points) {
  const runs = [];
  for (const p of points) {
    const last = runs[runs.length - 1];
    if (last && p === last.end) last.end = p;
    else runs.push({ start: p, end: p });
  }
  return runs;
}

/**
 * Full attribution. Deterministic and symmetric.
 *
 * Attribution is per *aligned region* (connected component of the span-overlap
 * graph), weighted by the region's labelled characters:
 *
 *  - the two coders' label sets over the region are equal
 *      -> agreement; if the two sides use a different number of spans, the
 *         region is also counted as `agreeCut` (same meaning, different units)
 *  - both label the region but the sets differ -> topic disagreement
 *  - only one coder labels it                   -> coverage gap
 *  - neither labels it                          -> excluded from denominators
 *
 * Characters are measured as: overlap of the region with the characters at least
 * one side labelled. A region never overlaps another, so every labelled character
 * is counted exactly once.
 *
 * `verify.js` re-derives the same totals from the per-character reference; the
 * two definitions must agree on `labelledUnion`, and the per-character one is
 * what the verification page displays beside this result.
 */
export function attribute(spansA, spansB, length) {
  const regions = alignedRegions(spansA, spansB);
  const bounds = compareBoundaries(spansA, spansB, length);

  let agree = 0;
  let agreeCut = 0;
  let topicDiff = 0;
  let onlyA = 0;
  let onlyB = 0;
  const segOnlyIntervals = [];
  const topicIntervals = [];
  const gapIntervals = [];

  for (const region of regions) {
    const len = region.end - region.start;
    if (!len) continue;
    const A = region.aTopics;
    const B = region.bTopics;
    if (!A.length && !B.length) continue;
    if (A.length && B.length) {
      if (region.topicsEqual) {
        agree += len;
        if (region.aSpanCount !== region.bSpanCount) {
          agreeCut += len;
          pushInterval(segOnlyIntervals, region.start, region.end, {
            cutKind: 'span-count',
            aSpans: region.aSpanCount,
            bSpans: region.bSpanCount,
          });
        }
      } else {
        topicDiff += len;
        pushInterval(topicIntervals, region.start, region.end, {
          aTopics: [...A].sort(), bTopics: [...B].sort(), shared: [...region.sharedTopics].sort(),
        });
      }
    } else if (A.length) {
      onlyA += len;
      pushInterval(gapIntervals, region.start, region.end, { side: 'A', topics: [...A].sort() });
    } else {
      onlyB += len;
      pushInterval(gapIntervals, region.start, region.end, { side: 'B', topics: [...B].sort() });
    }
  }

  const labelledUnion = agree + topicDiff + onlyA + onlyB;
  return {
    length,
    // `agree` counts every labelled character in a region both coders agree on.
    // `agreeCut` is the subset where the two sides also split the region into a
    // different number of spans: the boundary-only disagreement.
    agree, agreeCut, topicDiff, onlyA, onlyB,
    labelledUnion,
    shares: {
      agree: labelledUnion ? agree / labelledUnion : 0,
      agreeCut: labelledUnion ? agreeCut / labelledUnion : 0,
      topic: labelledUnion ? topicDiff / labelledUnion : 0,
      segmentation: labelledUnion ? agreeCut / labelledUnion : 0,
      gapA: labelledUnion ? onlyA / labelledUnion : 0,
      gapB: labelledUnion ? onlyB / labelledUnion : 0,
    },
    boundaries: bounds,
    regions: regions.map((r) => ({
      start: r.start, end: r.end,
      aSpanCount: r.aSpanCount, bSpanCount: r.bSpanCount,
      aTopics: r.aTopics, bTopics: r.bTopics,
      verdict: r.topicsEqual ? (r.aSpanCount === r.bSpanCount ? 'agree' : 'segmentation') : 'topic',
    })),
    intervals: {
      segmentation: segOnlyIntervals,
      topic: topicIntervals,
      gap: gapIntervals,
    },
    // Which explanation dominates, for the headline.
    verdict: dominant({ agree, agreeCut, topicDiff, onlyA, onlyB, labelledUnion }),
  };
}

function pushInterval(list, start, end, extra = {}) {
  const last = list[list.length - 1];
  if (last && last.end === start && sameExtra(last, extra)) {
    last.end = end;
    return;
  }
  list.push({ start, end, ...extra });
}

function sameExtra(a, b) {
  return JSON.stringify(a.aTopics || null) === JSON.stringify(b.aTopics || null)
    && JSON.stringify(a.bTopics || null) === JSON.stringify(b.bTopics || null)
    && JSON.stringify(a.shared || null) === JSON.stringify(b.shared || null)
    && (a.side || null) === (b.side || null);
}

function dominant({ agree, agreeCut, topicDiff, onlyA, onlyB, labelledUnion }) {
  if (!labelledUnion) return { kind: 'none', text: '两人都没有标注', chars: 0 };
  const gap = onlyA + onlyB;
  const entries = [
    { kind: 'topic', n: topicDiff, text: '主题判断不同' },
    { kind: 'segmentation', n: agreeCut, text: '分段边界不同（标签相同）' },
    { kind: 'gap', n: gap, text: '一方漏标' },
    { kind: 'agree', n: agree - agreeCut, text: '一致' },
  ].sort((x, y) => y.n - x.n || x.kind.localeCompare(y.kind));
  return { kind: entries[0].kind, text: entries[0].text, chars: entries[0].n };
}

/**
 * Per-segment detail: each span of each coder with its counterpart overlap, so
 * the reader can see "this A sentence was split by B into two".
 */
export function segmentTable(spansA, spansB, length) {
  const rows = [];
  for (const a of spansA) {
    let ov = 0;
    let partner = null;
    for (const b of spansB) {
      const o = overlapLength(a.start, a.end, b.start, b.end);
      if (o > ov) {
        ov = o;
        partner = b;
      }
    }
    rows.push({
      side: 'A', span: a, partner, overlap: ov,
      coverageOfSelf: a.end > a.start ? ov / (a.end - a.start) : 0,
      topicSame: partner ? canonicalLabels(a.topics).join('|') === canonicalLabels(partner.topics).join('|') : false,
    });
  }
  for (const b of spansB) {
    let ov = 0;
    let partner = null;
    for (const a of spansA) {
      const o = overlapLength(a.start, a.end, b.start, b.end);
      if (o > ov) {
        ov = o;
        partner = a;
      }
    }
    rows.push({
      side: 'B', span: b, partner, overlap: ov,
      coverageOfSelf: b.end > b.start ? ov / (b.end - b.start) : 0,
      topicSame: partner ? canonicalLabels(b.topics).join('|') === canonicalLabels(partner.topics).join('|') : false,
    });
  }
  return rows;
}
