// Carrying span annotations across a text revision.
//
// An old span is moved only when its new image is forced by the text. When the
// same characters could have come from more than one place in the new text — or
// when they were deleted — the span becomes a dispute rather than being attached
// to an arbitrary copy. Every result carries the reasons and the competing
// candidate ranges, so a reviewer can check the decision character by character.
//
// Exactness
// ---------
// Two questions are answered from the LCS prefix/suffix tables (diff.js):
//
//   canMatch(i,p)  old char i may sit on new char p in *some* optimal alignment
//   canCut(i,p)    an optimal alignment may pass between old char i and new char p
//
// Image of [s,e): the pair (u, v) of cuts surrounding the span's matched
// characters, where u is the new position of the span's first surviving
// character and v-1 that of the last. A span is uniquely locatable iff the set of
// possible first positions and the set of possible last positions are each
// singletons. This equivalence, and the enumeration of every reachable image,
// are checked against brute-force enumeration of all optimal alignments in
// tests/alignment.test.js.
//
// Statuses
//   exact      one image, same coordinates, no interior edit
//   shifted    one image, different coordinates
//   partial    one image, with characters deleted or inserted inside
//   ambiguous  more than one image -> dispute
//   lost       no surviving character -> dispute
//
// The source annotation is never mutated. Review choices live in a separate
// overlay layer (see overlay.js) and change only the view.

import { findOccurrences } from './text.js';

const MAX_LISTED = 24;
const ENUM_CELL_BUDGET = 4_000_000;

/** New positions the first surviving character of [s,e) can take. */
export function firstPositions(t, a, b, s, e) {
  const { pre, suf, w, L } = t;
  const out = new Set();
  for (let p = 0; p < b.length; p++) {
    for (let i = s; i < e; i++) {
      if (a.charCodeAt(i) !== b.charCodeAt(p)) continue;
      if (pre[s * w + p] + 1 + suf[(i + 1) * w + (p + 1)] === L) {
        out.add(p);
        break;
      }
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** New positions the last surviving character of [s,e) can take. */
export function lastPositions(t, a, b, s, e) {
  const { pre, suf, w, L } = t;
  const out = new Set();
  for (let p = 0; p < b.length; p++) {
    for (let i = e - 1; i >= s; i--) {
      if (a.charCodeAt(i) !== b.charCodeAt(p)) continue;
      if (pre[i * w + p] + 1 + suf[e * w + (p + 1)] === L) {
        out.add(p);
        break;
      }
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** New positions a boundary at old index i can take. */
export function boundaryPositions(t, i) {
  const { pre, suf, w, L } = t;
  const out = [];
  for (let p = 0; p <= t.m; p++) {
    if (pre[i * w + p] + suf[i * w + p] === L) out.push(p);
  }
  return out;
}

/**
 * Enumerate every image [u, v) of [s,e) that some optimal alignment produces.
 * Used for dispute candidates and for verification; exponential in nothing but
 * bounded by a work budget, in which case it returns null and the caller keeps
 * the min/max candidate set.
 */
export function enumerateImages(t, a, b, s, e) {
  const { pre, suf, w, L } = t;
  const m = b.length;
  const out = new Set();
  if (s === e) {
    for (let j = 0; j <= m; j++) if (pre[s * w + j] + suf[s * w + j] === L) out.add(`${j}:${j}`);
    return [...out];
  }
  let work = 0;
  for (let u = 0; u < m; u++) {
    if (pre[s * w + u] + suf[s * w + u] !== L) continue;
    const base = pre[s * w + u];
    for (let i0 = s; i0 < e; i0++) {
      if (a.charCodeAt(i0) !== b.charCodeAt(u)) continue;
      if (pre[i0 * w + u] !== base) continue;
      if (1 + suf[(i0 + 1) * w + (u + 1)] !== L - base) continue;
      const rows = e - i0;
      const cols = m - u;
      work += rows * cols;
      if (work > ENUM_CELL_BUDGET) return null;
      const best = new Int32Array(cols).fill(-1);
      for (let i = i0; i < e; i++) {
        const cur = new Int32Array(cols).fill(-1);
        let prefix = -1;
        for (let jj = 0; jj < cols; jj++) {
          const j = u + jj;
          if (i === i0 && j === u) {
            cur[jj] = 1;
          } else if (a.charCodeAt(i) === b.charCodeAt(j) &&
                     pre[i * w + j] + 1 + suf[(i + 1) * w + (j + 1)] === L && prefix >= 0) {
            cur[jj] = prefix + 1;
          }
          if (best[jj] > prefix) prefix = best[jj];
        }
        for (let jj = 0; jj < cols; jj++) {
          if (cur[jj] > 0) {
            const j = u + jj;
            if (pre[e * w + (j + 1)] + suf[e * w + (j + 1)] === L &&
                pre[e * w + (j + 1)] === base + cur[jj]) {
              out.add(`${u}:${j + 1}`);
            }
          }
          if (cur[jj] > best[jj]) best[jj] = cur[jj];
        }
      }
    }
  }
  return [...out];
}

function charCanSurvive(t, a, b, i) {
  const { pre, suf, w, L } = t;
  const ca = a.charCodeAt(i);
  for (let p = 0; p < t.m; p++) {
    if (b.charCodeAt(p) === ca && pre[i * w + p] + 1 + suf[(i + 1) * w + (p + 1)] === L) return true;
  }
  return false;
}

function dedupe(ranges) {
  const seen = new Set();
  const out = [];
  for (const r of ranges) {
    const key = `${r.start}:${r.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function capRanges(ranges, center) {
  if (ranges.length <= MAX_LISTED) return ranges;
  return [...ranges]
    .sort((x, y) => Math.abs(x.start - center) - Math.abs(y.start - center))
    .slice(0, MAX_LISTED)
    .sort((x, y) => x.start - y.start);
}

/**
 * Classify and, where unique, locate the image of [s,e).
 *
 * The locator is *block based*. An "anchor" is a maximal run of the span's
 * characters that appears as one contiguous run in the new text and can sit on an
 * optimal alignment (prefix + run + suffix = LCS length). The span is located by
 * anchoring its surviving text, not by asking where scattered single characters
 * happen to reappear: a deleted Chinese sentence still shares `的`, `。` and the
 * odd character with the rest of the document, and matching those would label a
 * deleted sentence "ambiguous" instead of "deleted".
 *
 * Rules (minRun = 1 for spans of 1-2 chars, else max(2, ceil(len/3))):
 *   - whole span appears as one run, exactly once  -> exact / shifted
 *   - whole span appears as one run, several times -> ambiguous (dispute)
 *   - only a prefix / suffix / middle run survives  -> partial
 *   - no run of at least minRun characters          -> lost (dispute)
 *
 * The anchor feasibility test is exact (see diff.js); the minRun threshold is a
 * stated policy, reported in `reasons` so a reviewer can see what was kept.
 *
 * @returns {{
 *   status: 'exact'|'shifted'|'partial'|'ambiguous'|'lost',
 *   start: number|null, end: number|null,
 *   candidates: Array<{start:number,end:number}>,
 *   candidatesExact: boolean,
 *   survivors: number, deleted: number, insertedInside: number,
 *   anchors: Array<{oldStart:number,oldEnd:number,newStart:number,newEnd:number,length:number}>
 * }}
 */
export function locateSpan(map, s, e) {
  const t = map.tables;
  const a = map.oldText;
  const b = map.newText;

  if (s === e) {
    const cuts = boundaryPositions(t, s);
    if (cuts.length === 1) {
      return { status: 'exact', start: cuts[0], end: cuts[0], candidates: [{ start: cuts[0], end: cuts[0] }],
        candidatesExact: true, survivors: 0, deleted: 0, insertedInside: 0, anchors: [] };
    }
    return {
      status: cuts.length ? 'ambiguous' : 'lost', start: null, end: null,
      candidates: cuts.map((p) => ({ start: p, end: p })),
      candidatesExact: true, survivors: 0, deleted: 0, insertedInside: 0, anchors: [],
    };
  }

  let survivors = 0;
  for (let i = s; i < e; i++) if (charCanSurvive(t, a, b, i)) survivors++;

  const len = e - s;
  const anchors = blockAnchors(map, s, e);
  // How much contiguous text must survive before the span is "moved" rather than
  // "deleted". A deleted sentence still shares stray characters and punctuation
  // with the new text; requiring a block keeps those coincidences out. Very short
  // spans cannot have long blocks, so they accept single characters.
  const minRun = len <= 3 ? 1 : Math.max(2, Math.min(6, Math.ceil(len / 4)));

  // 1. The whole span survives as one contiguous run.
  const whole = anchors.filter((x) => x.oldStart === s && x.oldEnd === e);
  if (whole.length) {
    const images = dedupe(whole.map((x) => ({ start: x.newStart, end: x.newEnd })));
    if (images.length === 1) {
      const im = images[0];
      // The optimal alignment can prefer one copy of a repeated sentence without
      // the coordinates being determined: the same text sits elsewhere too. When
      // the whole span survives intact and its text occurs more than once in the
      // new document, a reviewer — not the diff tie-break — must choose.
      const repeated = repeatedImages(map, s, e, im);
      if (repeated) {
        return {
          status: 'ambiguous', start: null, end: null,
          candidates: capRanges(repeated, s), candidatesExact: true,
          survivors, deleted: 0, insertedInside: 0, anchors, multipleOccurrences: true,
        };
      }
      return {
        status: im.start === s && im.end === e ? 'exact' : 'shifted',
        start: im.start, end: im.end, candidates: [im], candidatesExact: true,
        survivors, deleted: 0, insertedInside: 0, anchors,
      };
    }
    return {
      status: 'ambiguous', start: null, end: null,
      candidates: capRanges(images, s), candidatesExact: true,
      survivors, deleted: 0, insertedInside: 0, anchors, multipleOccurrences: true,
    };
  }

  // 2. Partial survival: the best monotone chain of anchors. A chain is a set of
  // runs that can be matched together (both coordinates increase). Maximise the
  // characters covered; the image is the chain's hull.
  const chains = bestChains(anchors);
  const bestCover = chains.length ? chains[0].covered : 0;
  const longest = anchors.reduce((m, x) => Math.max(m, x.length), 0);
  if (longest < minRun) {
    return {
      status: 'lost', start: null, end: null, candidates: [],
      candidatesExact: true, survivors, deleted: len, insertedInside: 0, anchors,
    };
  }
  const images = dedupe(chains.filter((c) => c.covered === bestCover).map((c) => ({ start: c.start, end: c.end })));
  if (images.length > 1) {
    return {
      status: 'ambiguous', start: null, end: null,
      candidates: capRanges(images, s), candidatesExact: true, survivors,
      deleted: len - bestCover, insertedInside: 0, anchors,
    };
  }
  const im = images[0];
  const deleted = len - bestCover;
  const insertedInside = Math.max(0, (im.end - im.start) - bestCover);
  return {
    status: deleted || insertedInside ? 'partial' : (im.start === s && im.end === e ? 'exact' : 'shifted'),
    start: im.start, end: im.end, candidates: [{ start: im.start, end: im.end }], candidatesExact: true,
    survivors, deleted, insertedInside, anchors,
  };
}

/**
 * If the span's text occurs more than once in the new document *at positions an
 * optimal alignment can actually map it to*, return every such occurrence. The
 * located image is one of them; the others are equally faithful readings of
 * "where did this sentence go". Returns null when the image is unique.
 */
function repeatedImages(map, s, e, located) {
  const needle = map.oldText.slice(s, e);
  if (!needle || e - s < 2) return null;
  const images = new Set([`${located.start}:${located.end}`]);
  for (const x of blockAnchors(map, s, e)) {
    if (x.oldStart === s && x.oldEnd === e) images.add(`${x.newStart}:${x.newEnd}`);
  }
  if (images.size <= 1) return null;
  return [...images].map((k) => {
    const [start, end] = k.split(':').map(Number);
    return { start, end };
  }).sort((a, b) => a.start - b.start);
}

/**
 * All monotone chains of anchors, best first. A chain is a sequence of runs with
 * strictly increasing old and new coordinates; `covered` is the number of old
 * characters it accounts for, `start`/`end` the hull in the new text.
 */
function bestChains(anchors) {
  if (!anchors.length) return [];
  const sorted = [...anchors].sort((x, y) => x.oldStart - y.oldStart || x.newStart - y.newStart || y.length - x.length);
  const best = new Array(sorted.length).fill(null);
  const results = [];
  for (let i = 0; i < sorted.length; i++) {
    const x = sorted[i];
    let bestPrev = null;
    for (let j = 0; j < i; j++) {
      const y = sorted[j];
      if (y.oldEnd <= x.oldStart && y.newEnd <= x.newStart) {
        if (!bestPrev || best[j].covered > bestPrev.covered) bestPrev = best[j];
      }
    }
    const covered = x.length + (bestPrev ? bestPrev.covered : 0);
    best[i] = {
      covered,
      start: bestPrev ? Math.min(bestPrev.start, x.newStart) : x.newStart,
      end: Math.max(bestPrev ? bestPrev.end : x.newEnd, x.newEnd),
    };
    results.push(best[i]);
  }
  return results.sort((p, q) => q.covered - p.covered || p.start - q.start || p.end - q.end);
}

/**
 * Every maximal contiguous run of the span's characters that sits on some optimal
 * alignment. A run may be shorter than the span (partial survival) but never
 * extends outside it. Exact: the feasibility test is pre + k + suf === L.
 */
export function blockAnchors(map, s, e) {
  const t = map.tables;
  const a = map.oldText;
  const b = map.newText;
  const { pre, suf, w, L, m } = t;
  const out = [];
  for (let p = s; p < e; p++) {
    const cp = a.charCodeAt(p);
    for (let q = 0; q < m; q++) {
      if (b.charCodeAt(q) !== cp) continue;
      const base = pre[p * w + q];
      if (base + 1 + suf[(p + 1) * w + (q + 1)] !== L) continue;
      let k = 1;
      while (p + k < e && q + k < m && a.charCodeAt(p + k) === b.charCodeAt(q + k) &&
             base + (k + 1) + suf[(p + k + 1) * w + (q + k + 1)] === L) k++;
      out.push({ oldStart: p, oldEnd: p + k, newStart: q, newEnd: q + k, length: k });
    }
  }
  return out;
}

/**
 * Exact image enumeration under the "every optimal alignment" reading, kept as a
 * primitive for verification. Unlike locateSpan it does not apply a block policy,
 * so a deleted sentence whose stray characters match elsewhere shows up as
 * ambiguous here; tests/alignment.test.js checks it against brute force.
 */
export function locateSpanExact(map, s, e) {
  const t = map.tables;
  const a = map.oldText;
  const b = map.newText;

  if (s === e) {
    const cuts = boundaryPositions(t, s);
    if (cuts.length === 1) {
      return { status: 'exact', start: cuts[0], end: cuts[0], candidates: [{ start: cuts[0], end: cuts[0] }],
        candidatesExact: true, survivors: 0, deleted: 0, insertedInside: 0 };
    }
    return {
      status: cuts.length ? 'ambiguous' : 'lost', start: null, end: null,
      candidates: cuts.map((p) => ({ start: p, end: p })),
      candidatesExact: true, survivors: 0, deleted: 0, insertedInside: 0,
    };
  }

  let survivors = 0;
  for (let i = s; i < e; i++) if (charCanSurvive(t, a, b, i)) survivors++;
  const deleted = (e - s) - survivors;
  if (!survivors) {
    return { status: 'lost', start: null, end: null, candidates: [],
      candidatesExact: true, survivors: 0, deleted, insertedInside: 0 };
  }

  const firstSeen = firstPositions(t, a, b, s, e);
  const lastSeen = lastPositions(t, a, b, s, e);
  if (firstSeen.length === 1 && lastSeen.length === 1) {
    const start = firstSeen[0];
    const end = lastSeen[0] + 1;
    const insertedInside = Math.max(0, (end - start) - survivors);
    return {
      status: deleted || insertedInside ? 'partial' : (start === s && end === e ? 'exact' : 'shifted'),
      start, end, candidates: [{ start, end }], candidatesExact: true,
      survivors, deleted, insertedInside,
    };
  }

  // Ambiguous. Prefer the exact enumerated image set; fall back to the
  // first×last cross product (a superset) when the budget is exhausted.
  const exact = enumerateImages(t, a, b, s, e);
  let candidates;
  let candidatesExact;
  if (exact) {
    candidates = exact.map((k) => {
      const [x, y] = k.split(':').map(Number);
      return { start: x, end: y };
    });
    candidatesExact = true;
  } else {
    const ranges = [];
    for (const u of firstSeen) for (const v of lastSeen) if (v >= u) ranges.push({ start: u, end: v + 1 });
    candidates = ranges;
    candidatesExact = false;
  }
  candidates = capRanges(dedupe(candidates), s);
  return {
    status: 'ambiguous', start: null, end: null, candidates, candidatesExact,
    survivors, deleted, insertedInside: 0,
  };
}

/**
 * Migrate one annotation through one revision map.
 *
 * @param {{id?:string,coder?:string,start:number,end:number,topics:string[]}} ann
 * @param {ReturnType<import('./diff.js').buildRevisionMap>} map
 * @param {{searchOccurrences?: boolean}} [opts]
 */
export function migrateAnnotation(ann, map, opts = {}) {
  const oldLen = map.oldText.length;
  if (!(ann.start >= 0 && ann.end <= oldLen && ann.start <= ann.end)) {
    throw new RangeError(`annotation ${ann.id ?? ''} outside ${oldLen}-char text`);
  }
  const loc = locateSpan(map, ann.start, ann.end);
  const oldText = map.oldText.slice(ann.start, ann.end);
  const trace = map.ops.filter((op) =>
    op.type === 'delete' ? op.oldStart < ann.end && op.oldEnd > ann.start
      : op.type === 'insert' ? op.newStart <= ann.end && op.newEnd >= ann.start
        : op.oldStart < ann.end && op.oldEnd > ann.start);
  const occurrences = opts.searchOccurrences === false
    ? [] : findOccurrences(map.newText, oldText, 20);

  const base = {
    annotationId: ann.id ?? null,
    coder: ann.coder ?? null,
    source: { start: ann.start, end: ann.end, topics: [...ann.topics] },
    topics: [...ann.topics],
    oldText,
    trace,
    survivors: loc.survivors,
    deletedChars: loc.deleted,
    insertedInside: loc.insertedInside,
    exactDeletion: loc.deleted > 0 && loc.survivors === 0,
    occurrencesInNew: occurrences,
  };

  if (loc.status === 'lost') {
    return {
      ...base, status: 'lost', start: null, end: null,
      candidates: occurrences.map((p) => ({ start: p, end: p + oldText.length, relocated: true })),
      candidatesExact: true,
      reasons: ['该段文字在新修订中被删除'],
      dispute: true,
    };
  }

  if (loc.status === 'ambiguous') {
    return {
      ...base, status: 'ambiguous', start: null, end: null,
      candidates: loc.candidates,
      candidatesExact: loc.candidatesExact,
      multipleOccurrences: Boolean(loc.multipleOccurrences),
      anchors: loc.anchors,
      reasons: loc.multipleOccurrences
        ? [`原文片段在新版本中出现 ${loc.candidates.length} 处`, '各处都与原文一致，坐标不能唯一确定']
        : [
          `有 ${loc.candidates.length} 个可能的新位置`,
          ann.start === ann.end ? '空区间边界落在重复文本处' : '存在多个同等可信的位置',
        ],
      dispute: true,
    };
  }

  const reasons = [];
  if (loc.deleted) reasons.push(`${loc.deleted} 个字符被删除，标注缩短`);
  if (loc.insertedInside) reasons.push(`区间内插入 ${loc.insertedInside} 个字符`);
  if (loc.status === 'shifted') reasons.push(`坐标由 ${ann.start}–${ann.end} 变为 ${loc.start}–${loc.end}`);
  if (!reasons.length) reasons.push(ann.start === ann.end ? '空区间锚点唯一' : '坐标与内容均未变');

  return {
    ...base,
    status: loc.status,
    start: loc.start,
    end: loc.end,
    candidates: [{ start: loc.start, end: loc.end }],
    candidatesExact: true,
    reasons,
    dispute: false,
  };
}

export function migrateCoding(annotations, map, opts = {}) {
  return annotations.map((a) => migrateAnnotation(a, map, opts));
}

/** Compose a chain of revision maps (oldest -> newest), guarding continuity. */
export function composeMaps(maps) {
  if (!maps.length) throw new Error('at least one map required');
  for (let i = 1; i < maps.length; i++) {
    if (maps[i - 1].newText !== maps[i].oldText) {
      throw new Error(`revision chain broken between ${i - 1} and ${i}`);
    }
  }
  return { composite: true, maps, oldText: maps[0].oldText, newText: maps[maps.length - 1].newText };
}

/**
 * Migrate a range through a single map or a composed chain. Ambiguity at any
 * step is sticky; a branch that cannot be located dies.
 */
export function migrateThroughRange(start, end, map) {
  const chain = map.composite ? map.maps : [map];
  let ranges = [{ start, end }];
  let lostAt = null;
  for (let step = 0; step < chain.length; step++) {
    const next = [];
    for (const r of ranges) {
      const loc = locateSpan(chain[step], r.start, r.end);
      if (loc.status === 'lost') {
        lostAt = step;
        continue;
      }
      if (loc.status === 'ambiguous') {
        for (const c of loc.candidates) next.push({ start: c.start, end: c.end });
      } else {
        next.push({ start: loc.start, end: loc.end });
      }
    }
    ranges = dedupe(next);
    if (!ranges.length) break;
  }
  return { ranges: capRanges(ranges, start), lostAt, steps: chain.length };
}

/** Migrate one annotation through a single map or a composed chain. */
export function migrateThrough(ann, map, opts = {}) {
  if (!map.composite) return migrateAnnotation(ann, map, opts);
  const { ranges, lostAt, steps } = migrateThroughRange(ann.start, ann.end, map);
  const oldText = map.oldText.slice(ann.start, ann.end);
  const base = {
    annotationId: ann.id ?? null,
    coder: ann.coder ?? null,
    source: { start: ann.start, end: ann.end, topics: [...ann.topics] },
    topics: [...ann.topics],
    oldText,
    trace: [],
    survivors: null,
    deletedChars: 0,
    insertedInside: 0,
    exactDeletion: false,
    occurrencesInNew: opts.searchOccurrences === false ? [] : findOccurrences(map.newText, oldText, 20),
    steps,
  };
  if (!ranges.length) {
    return {
      ...base, status: 'lost', start: null, end: null, candidates: [], candidatesExact: true,
      reasons: [`跨 ${steps} 个修订后无法定位${lostAt != null ? `（断在第 ${lostAt + 1} 步）` : ''}`],
      dispute: true,
    };
  }
  if (ranges.length > 1) {
    return {
      ...base, status: 'ambiguous', start: null, end: null, candidates: ranges, candidatesExact: true,
      reasons: [`跨 ${steps} 个修订后存在 ${ranges.length} 个可能位置`], dispute: true,
    };
  }
  const r = ranges[0];
  const status = r.start === ann.start && r.end === ann.end ? 'exact' : 'shifted';
  return {
    ...base, status, start: r.start, end: r.end, candidates: [r], candidatesExact: true,
    reasons: status === 'shifted' ? [`坐标由 ${ann.start}–${ann.end} 变为 ${r.start}–${r.end}`] : ['坐标与内容均未变'],
    dispute: false,
  };
}

/** Human-readable summary of a migration result. */
export function migrationLabel(result) {
  switch (result.status) {
    case 'exact': return '原样保留';
    case 'shifted': return '位置移动';
    case 'partial': return '部分删除';
    case 'ambiguous': return '争议：多处候选';
    case 'lost': return '争议：原文删除';
    default: return result.status;
  }
}
