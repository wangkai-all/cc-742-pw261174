// Detecting whether a coder gradually changed their standard over time.
//
// Naively, "average labels per character by week" drifts whenever the incoming
// batches change their mix of document types — a coder reading more long
// procedural letters will look different without having changed at all. So every
// drift score here is computed twice:
//
//   raw        observed behaviour in each window
//   adjusted   behaviour re-weighted to the *reference* batch mix (the mix of the
//              whole period), so only within-stratum change remains
//
// Only the adjusted series is interpreted as personal drift. The difference
// between the two is reported explicitly as "composition effect".
//
// Detection, per coder and topic:
//   1. split the coder's annotations into consecutive time windows (default:
//      fixed-size batches, or calendar weeks if a date is available);
//   2. in each window compute the topic's share of that coder's labelled
//      characters, stratified by batch (document stratum);
//   3. re-weight strata to the overall mix -> adjusted share per window;
//   4. fit a monotone trend (Theil–Sen slope) and run a permutation test on the
//      adjusted window shares. Report a change only when the adjusted trend is
//      both large and statistically distinguishable from a shuffle.
//
// Everything is seeded: the same input and seed give the same p-value.

/** Theil–Sen slope: median of pairwise slopes. Robust to one wild window. */
export function theilSen(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return 0;
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j][0] - pts[i][0];
      if (dx !== 0) slopes.push((pts[j][1] - pts[i][1]) / dx);
    }
  }
  slopes.sort((x, y) => x - y);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

/** Deterministic PRNG (mulberry32) so permutation tests are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Two-sided permutation test of the Theil–Sen slope against random ordering.
 * Returns { p, observed, nullQuantiles }.
 */
export function permutationTest(values, seed = 20261124, iterations = 2000) {
  const vals = values.filter((v) => v != null);
  if (vals.length < 3) return { p: 1, observed: theilSen(values), iterations: 0 };
  const observed = theilSen(values);
  const rand = rng(seed);
  let atLeast = 0;
  const nulls = [];
  for (let it = 0; it < iterations; it++) {
    const perm = [...vals];
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const s = theilSen(perm);
    nulls.push(s);
    if (Math.abs(s) >= Math.abs(observed) - 1e-12) atLeast++;
  }
  nulls.sort((x, y) => x - y);
  return {
    p: (atLeast + 1) / (iterations + 1),
    observed,
    iterations,
    nullQuantiles: {
      p05: quantile(nulls, 0.05),
      median: quantile(nulls, 0.5),
      p95: quantile(nulls, 0.95),
    },
  };
}

/**
 * Assemble per-window statistics for one coder.
 *
 * @param {Array<{id:string,start:number,end:number,topics:string[],stratum:string,date?:string,docId:string}>} annotations
 * @param {{windowKey?: (ann)=>string}} opts
 */
export function windowStats(annotations, opts = {}) {
  const byWindow = new Map();
  const get = opts.windowKey || ((a) => a.window || a.date || 'all');
  for (const ann of annotations) {
    const w = get(ann);
    if (!byWindow.has(w)) byWindow.set(w, new Map());
    const stratumMap = byWindow.get(w);
    const b = ann.stratum || 'default';
    if (!stratumMap.has(b)) stratumMap.set(b, { chars: 0, perTopic: new Map(), docs: new Set() });
    const st = stratumMap.get(b);
    const n = ann.end - ann.start;
    st.chars += n;
    st.docs.add(ann.docId);
    for (const t of new Set(ann.topics)) {
      st.perTopic.set(t, (st.perTopic.get(t) || 0) + n);
    }
  }
  const windows = [...byWindow.keys()].sort(windowOrder);
  return { windows, byWindow };
}

function windowOrder(a, b) {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true });
}

/**
 * Compute raw and composition-adjusted topic share series.
 *
 * Strata are batch identifiers (e.g. the document type of a document). Adjusted
 * share for window w = sum_s (weight_s * share_{w,s}) / sum_s weight_s over strata
 * present in window w, where weight_s is the stratum's *total* labelled chars
 * across all windows (the reference mix). Strata missing from a window are not
 * imputed; the weights of present strata are renormalised, and the coverage of
 * the reference mix is reported so a reader can judge comparability.
 */
export function topicShareSeries(byWindow, windows, topics) {
  const totalByStratum = new Map();
  for (const w of windows) {
    const bm = byWindow.get(w);
    for (const [stratum, st] of bm) {
      const cur = totalByStratum.get(stratum) || { chars: 0, perTopic: new Map() };
      cur.chars += st.chars;
      for (const [t, n] of st.perTopic) cur.perTopic.set(t, (cur.perTopic.get(t) || 0) + n);
      totalByStratum.set(stratum, cur);
    }
  }
  const totalChars = [...totalByStratum.values()].reduce((s, v) => s + v.chars, 0);

  const series = {};
  for (const t of topics) {
    const raw = [];
    const adjusted = [];
    const coverage = [];
    for (const w of windows) {
      const bm = byWindow.get(w);
      let chars = 0;
      let hits = 0;
      for (const st of bm.values()) {
        chars += st.chars;
        hits += st.perTopic.get(t) || 0;
      }
      raw.push(chars ? hits / chars : null);
      let wsum = 0;
      let weightPresent = 0;
      let acc = 0;
      for (const [stratum, st] of bm) {
        const ref = totalByStratum.get(stratum);
        const weight = ref ? ref.chars : 0;
        if (!st.chars) continue;
        wsum += weight;
        weightPresent += weight;
        acc += weight * ((st.perTopic.get(t) || 0) / st.chars);
      }
      adjusted.push(wsum ? acc / wsum : null);
      coverage.push(totalChars ? weightPresent / totalChars : 0);
    }
    const rawSlope = theilSen(raw);
    const adjustedSlope = theilSen(adjusted);
    series[t] = {
      topic: t,
      raw,
      adjusted,
      coverage,
      rawSlope,
      adjustedSlope,
      compositionEffect: rawSlope - adjustedSlope,
    };
  }
  return series;
}

/**
 * Detect drift for one coder across their annotations.
 *
 * @param {Array} annotations  one coder's spans, each with stratum + window metadata
 * @param {string[]} topics    the topic vocabulary to test
 * @param {{seed?:number, alpha?:number, minCharsPerWindow?:number, windowKey?:Function}} opts
 */
export function detectDrift(annotations, topics, opts = {}) {
  const alpha = opts.alpha ?? 0.05;
  const seed = opts.seed ?? 20261124;
  const minChars = opts.minCharsPerWindow ?? 30;
  const { windows, byWindow } = windowStats(annotations, opts);

  const usable = [];
  const excluded = [];
  for (const w of windows) {
    let chars = 0;
    let docs = new Set();
    for (const st of byWindow.get(w).values()) {
      chars += st.chars;
      for (const d of st.docs) docs.add(d);
    }
    if (chars < minChars) excluded.push({ window: w, chars, reason: `少于 ${minChars} 字` });
    else usable.push(w);
  }

  const series = topicShareSeries(byWindow, usable, topics);
  const results = [];
  for (const t of topics) {
    const s = series[t];
    const test = permutationTest(s.adjusted, seed, opts.iterations ?? 2000);
    const rawTest = permutationTest(s.raw, seed, opts.iterations ?? 2000);
    const enough = s.adjusted.filter((v) => v != null).length >= 3;
    const significant = enough && test.p <= alpha;
    // "Composition-driven" is only claimed when the raw series would itself have
    // looked like a change (p <= alpha) and re-weighting to the period mix removes
    // most of it. Otherwise there was nothing to explain in the first place.
    const rawLooksChanged = enough && rawTest.p <= alpha;
    const compositionDriven = rawLooksChanged && !significant
      && Math.abs(s.compositionEffect) > Math.abs(s.adjustedSlope) * 2;
    const borderline = enough && test.p > alpha && test.p <= alpha * 2;
    results.push({
      topic: t,
      series: s,
      test,
      rawTest,
      rawSlope: rawTest.observed,
      adjustedSlope: test.observed,
      compositionEffect: s.compositionEffect,
      significant,
      compositionDriven,
      borderline,
      verdict: significant && !compositionDriven
        ? (test.observed > 0 ? '标准收紧（该主题占比上升）' : '标准放松（该主题占比下降）')
        : compositionDriven
          ? '批次构成变化，非个人漂移'
          : borderline ? '边缘，证据不足' : '未见漂移',
    });
  }

  return {
    windows: usable,
    excluded,
    series,
    results,
    totals: {
      annotations: annotations.length,
      chars: annotations.reduce((s, a) => s + (a.end - a.start), 0),
    },
  };
}

/**
 * Per-window topic profile of a coder, for the small-multiples sparkline row.
 * Unlabelled share is included so the reader sees coverage change too.
 */
export function windowProfile(annotations, topics, opts = {}) {
  const { windows, byWindow } = windowStats(annotations, opts);
  const rows = [];
  for (const w of windows) {
    const row = { window: w, chars: 0, topics: new Map(), unlabelled: 0 };
    for (const st of byWindow.get(w).values()) {
      row.chars += st.chars;
      for (const [t, n] of st.perTopic) row.topics.set(t, (row.topics.get(t) || 0) + n);
    }
    for (const t of topics) if (!row.topics.has(t)) row.topics.set(t, 0);
    rows.push(row);
  }
  return rows;
}

/**
 * Compare two coders' drift in the same windows. A coder is changing relative to
 * the other when their adjusted slope diverges while the other's stays flat.
 */
export function relativeDrift(a, b) {
  const byTopic = new Map();
  for (const r of a.results) byTopic.set(r.topic, { a: r });
  for (const r of b.results) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, {});
    byTopic.get(r.topic).b = r;
  }
  const out = [];
  for (const [topic, v] of byTopic) {
    if (!v.a || !v.b) continue;
    const diff = v.a.adjustedSlope - v.b.adjustedSlope;
    out.push({
      topic,
      aSlope: v.a.adjustedSlope,
      bSlope: v.b.adjustedSlope,
      difference: diff,
      onlyA: v.a.significant && !v.b.significant,
      onlyB: v.b.significant && !v.a.significant,
      both: v.a.significant && v.b.significant,
    });
  }
  return out.sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference));
}
