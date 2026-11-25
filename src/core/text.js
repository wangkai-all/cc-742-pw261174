// Character-coordinate primitives.
//
// Every span in this desk is a half-open character range [start, end) over the
// exact text the coder saw. Nothing here normalises or cleans the text: a single
// character moving must show up as a coordinate change, not silently vanish.
//
// There are two implementations of "what labels cover this character":
//   - labelsAt()      the obvious per-character reference, used by tests and the
//                     in-app verification page;
//   - sweepLabels()   an interval sweep used by the analysis. The two must agree
//                     on every character; tests/verify.js enforces that.

/** @typedef {{id: string, start: number, end: number, topics: string[]}} Annotation */

export function normalizeBoundaries(boundaries, length) {
  const set = new Set([0, length]);
  for (const b of boundaries || []) {
    if (Number.isInteger(b) && b >= 0 && b <= length) set.add(b);
  }
  return [...set].sort((x, y) => x - y);
}

export function assertRange(start, end, length, label = 'range') {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new TypeError(`${label}: start/end must be integers`);
  }
  if (start < 0 || end > length || start > end) {
    throw new RangeError(`${label}: [${start}, ${end}) outside [0, ${length}]`);
  }
}

/**
 * Reference implementation: the sorted, de-duplicated topic set covering a
 * single character. Multi-label and overlapping spans are unioned; an empty
 * result means "unlabelled".
 */
export function labelsAt(annotations, pos) {
  const out = new Set();
  for (const a of annotations) {
    if (a.start <= pos && pos < a.end) {
      for (const t of a.topics) out.add(t);
    }
  }
  return [...out].sort();
}

/** Reference implementation: per-character label arrays for a whole coding. */
export function charLabels(annotations, length) {
  const out = new Array(length);
  for (let i = 0; i < length; i++) out[i] = labelsAt(annotations, i);
  return out;
}

export function sameLabels(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function canonicalLabels(topics) {
  return [...new Set(topics)].sort();
}

/** Union of two sorted topic arrays. */
export function unionLabels(a, b) {
  return canonicalLabels([...a, ...b]);
}

export function intersectLabels(a, b) {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

export function symmetricDiffSize(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let n = 0;
  for (const x of A) if (!B.has(x)) n++;
  for (const x of B) if (!A.has(x)) n++;
  return n;
}

/**
 * Interval sweep. `breaks` must include every annotation endpoint. Returns one
 * entry per non-empty atom with the topic sets of both codings. O(b log b + a).
 *
 * @param {{annotations: Annotation[]}} a
 * @param {{annotations: Annotation[]}} b
 * @param {number} length
 * @param {number[]} [extraBreaks]
 */
export function sweepLabels(a, b, length, extraBreaks = []) {
  const breaks = new Set([0, length, ...extraBreaks]);
  for (const ann of a.annotations) {
    breaks.add(Math.max(0, Math.min(length, ann.start)));
    breaks.add(Math.max(0, Math.min(length, ann.end)));
  }
  for (const ann of b.annotations) {
    breaks.add(Math.max(0, Math.min(length, ann.start)));
    breaks.add(Math.max(0, Math.min(length, ann.end)));
  }
  const points = [...breaks].filter((x) => x >= 0 && x <= length).sort((x, y) => x - y);
  const atoms = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const mid = start; // half-open atom: any covering annotation includes start
    atoms.push({
      start,
      end,
      a: labelsAt(a.annotations, mid),
      b: labelsAt(b.annotations, mid),
    });
  }
  return atoms;
}

/** Char-weighted topic coverage for one coding. */
export function topicCoverage(annotations, length) {
  const counts = new Map();
  const step = new Map();
  for (const ann of annotations) {
    for (const t of ann.topics) {
      step.set(t, (step.get(t) || 0));
    }
  }
  // Difference array per topic is simpler and exact.
  const diff = new Map();
  for (const ann of annotations) {
    for (const t of new Set(ann.topics)) {
      if (!diff.has(t)) diff.set(t, new Int32Array(length + 1));
      const d = diff.get(t);
      d[ann.start] += 1;
      d[ann.end] -= 1;
    }
  }
  for (const [t, d] of diff) {
    let run = 0;
    let n = 0;
    for (let i = 0; i < length; i++) {
      run += d[i];
      if (run > 0) n++;
    }
    counts.set(t, n);
  }
  let covered = 0;
  const active = new Int32Array(length + 1);
  for (const ann of annotations) {
    active[ann.start] += 1;
    active[ann.end] -= 1;
  }
  let run = 0;
  for (let i = 0; i < length; i++) {
    run += active[i];
    if (run > 0) covered++;
  }
  return { perTopic: counts, covered, length };
}

/** Merge overlapping/adjacent annotation spans when rendering underline bands. */
export function mergeSpans(annotations) {
  const sorted = [...annotations].sort((x, y) => x.start - y.start || x.end - y.end);
  const out = [];
  for (const ann of sorted) {
    const last = out[out.length - 1];
    if (last && ann.start <= last.end) {
      last.end = Math.max(last.end, ann.end);
      for (const t of ann.topics) if (!last.topics.includes(t)) last.topics.push(t);
    } else {
      out.push({ start: ann.start, end: ann.end, topics: [...ann.topics], ids: [ann.id] });
    }
  }
  return out;
}

/** Intersection length of two half-open ranges. */
export function overlapLength(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function snippet(text, start, end, pad = 8) {
  const s = Math.max(0, start - pad);
  const e = Math.min(text.length, end + pad);
  return {
    before: text.slice(s, start),
    focus: text.slice(start, end),
    after: text.slice(end, e),
    truncatedLeft: s > 0,
    truncatedRight: e < text.length,
  };
}

/** Find every literal occurrence of a string; used for "same text, which one?" notes. */
export function findOccurrences(haystack, needle, limit = 50) {
  const out = [];
  if (!needle) return out;
  let from = 0;
  while (out.length < limit) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + 1;
  }
  return out;
}

/** Compact a range for display: "12–27" (en dash, character coordinates). */
export function fmtRange(start, end) {
  return `${start}–${end}`;
}

export function fmtPct(x, digits = 0) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtSignedPct(x, digits = 0) {
  if (x == null || Number.isNaN(x)) return '—';
  const v = (x * 100).toFixed(digits);
  return `${x > 0 ? '+' : ''}${v} pp`;
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
