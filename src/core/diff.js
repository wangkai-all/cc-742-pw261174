// Character-level diff between two revisions of one document.
//
// This desk must explain *why* an old coordinate can or cannot be carried into a
// new revision, so the diff is not an opaque string distance. It computes two LCS
// tables (prefix and suffix). With those, every question the migration layer asks
// — "can this old character sit on this new position in some optimal alignment?",
// "can the text be cut here?" — is answered exactly, by a formula. No tie-break
// decides anything structural; tie-breaks exist only to draw one alignment.
//
// Vocabulary
//   optimal alignment   a monotonically increasing set of matched (old,new) pairs
//                       of maximum possible size L = LCS length
//   cut (i, p)          a point between characters: i old chars and p new chars
//                       consumed. A cut is reachable in an optimal alignment iff
//                       pre[i][p] + suf[i][p] === L.

const MAX_CELLS = 26_000_000; // ~104 MB at Uint16, refusal is better than a hang

/**
 * Build prefix and suffix LCS length tables.
 * pre[i][p] = LCS(a[0..i), b[0..p))
 * suf[i][p] = LCS(a[i..n), b[p..m))
 */
export function lcsTables(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    throw new RangeError(`text pair too large to align exactly (${n}×${m} cells)`);
  }
  const wide = Math.min(n, m) > 65000;
  const T = wide ? Uint32Array : Uint16Array;
  const w = m + 1;
  const pre = new T((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    const ca = a.charCodeAt(i - 1);
    const row = i * w;
    const prev = (i - 1) * w;
    for (let p = 1; p <= m; p++) {
      pre[row + p] = ca === b.charCodeAt(p - 1)
        ? pre[prev + p - 1] + 1
        : (pre[prev + p] >= pre[row + p - 1] ? pre[prev + p] : pre[row + p - 1]);
    }
  }
  const suf = new T((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const ca = a.charCodeAt(i);
    const row = i * w;
    const next = (i + 1) * w;
    for (let p = m - 1; p >= 0; p--) {
      suf[row + p] = ca === b.charCodeAt(p)
        ? suf[next + p + 1] + 1
        : (suf[next + p] >= suf[row + p + 1] ? suf[next + p] : suf[row + p + 1]);
    }
  }
  return { pre, suf, n, m, w, L: pre[n * w + m] };
}

/** Could old character i be matched to new position p in some optimal alignment? */
export function canMatch(t, i, p) {
  return t.pre[i * t.w + p] + 1 + t.suf[(i + 1) * t.w + p + 1] === t.L;
}

/** Could the document be cut between old char i and new char p on an optimal path? */
export function canCut(t, i, p) {
  return t.pre[i * t.w + p] + t.suf[i * t.w + p] === t.L;
}

/** Every new position old character i can occupy in some optimal alignment. */
export function matchPositions(t, a, b, i, cap = 4096) {
  const out = [];
  const ca = a.charCodeAt(i);
  for (let p = 0; p < t.m && out.length < cap; p++) {
    if (b.charCodeAt(p) === ca && canMatch(t, i, p)) out.push(p);
  }
  return out;
}

/** One optimal alignment for display. `policy` only chooses between duplicate copies. */
export function tracebackLatest(t, a, b) {
  const { pre, n, m, w } = t;
  const oldToNew = new Int32Array(n).fill(-1);
  let i = n;
  let p = m;
  while (i > 0 || p > 0) {
    if (i > 0 && p > 0 && a.charCodeAt(i - 1) === b.charCodeAt(p - 1) &&
        pre[i * w + p] === pre[(i - 1) * w + (p - 1)] + 1) {
      oldToNew[i - 1] = p - 1;
      i--;
      p--;
      continue;
    }
    if (p > 0 && (i === 0 || pre[i * w + (p - 1)] >= pre[(i - 1) * w + p])) p--;
    else i--;
  }
  return oldToNew;
}

/** Turn a per-character map into contiguous equal/insert/delete operations. */
export function mappingOps(a, b, oldToNew) {
  const ops = [];
  const n = a.length;
  const m = b.length;
  let i = 0;
  let lastNewEnd = 0;
  while (i < n) {
    const p = oldToNew[i];
    if (p < 0) {
      let k = i + 1;
      while (k < n && oldToNew[k] < 0) k++;
      ops.push({ type: 'delete', oldStart: i, oldEnd: k, newStart: null, newEnd: null });
      i = k;
      continue;
    }
    let k = i + 1;
    let q = p + 1;
    while (k < n && oldToNew[k] === q) {
      k++;
      q++;
    }
    if (p > lastNewEnd) ops.push({ type: 'insert', oldStart: i, oldEnd: i, newStart: lastNewEnd, newEnd: p });
    ops.push({ type: 'equal', oldStart: i, oldEnd: k, newStart: p, newEnd: q });
    lastNewEnd = q;
    i = k;
  }
  if (lastNewEnd < m) ops.push({ type: 'insert', oldStart: n, oldEnd: n, newStart: lastNewEnd, newEnd: m });
  return ops;
}

/**
 * Per-character status for the ribbon, computed from the exact matchability
 * formula rather than from the displayed alignment:
 *   'kept'      exactly one optimal new position
 *   'ambiguous' more than one
 *   'deleted'   none
 */
export function perCharStatus(t, a, b, cap = 64) {
  const out = new Array(t.n);
  for (let i = 0; i < t.n; i++) {
    let count = 0;
    const ca = a.charCodeAt(i);
    for (let p = 0; p < t.m; p++) {
      if (b.charCodeAt(p) !== ca) continue;
      if (canMatch(t, i, p)) {
        count++;
        if (count > cap) break;
      }
    }
    out[i] = count === 0 ? 'deleted' : count > 1 ? 'ambiguous' : 'kept';
  }
  return out;
}

/** Contiguous runs of ambiguous old characters, shown as dispute zones on the ribbon. */
export function ambiguityZones(t, a, b, status, minLen = 4) {
  const zones = [];
  let start = -1;
  for (let i = 0; i <= t.n; i++) {
    const isAmbig = i < t.n && status[i] === 'ambiguous';
    if (isAmbig && start < 0) start = i;
    if (!isAmbig && start >= 0) {
      const text = a.slice(start, i);
      // A single ambiguous character (usually shared punctuation) is not a
      // reviewer-facing dispute; span-level ambiguity is reported by migrate.js.
      if (text.length < minLen) {
        start = -1;
        continue;
      }
      const positions = new Set();
      for (let k = start; k < i; k++) {
        for (const p of matchPositions(t, a, b, k, 512)) positions.add(p);
      }
      let reason = '多个同等最优对齐';
      for (const p of positions) {
        if (b.slice(p, p + text.length) === text) {
          reason = '同一段文字在新版本中出现不止一处';
          break;
        }
      }
      zones.push({
        oldStart: start,
        oldEnd: i,
        candidates: [...positions].sort((x, y) => x - y),
        reason,
        text,
      });
      start = -1;
    }
  }
  return zones;
}

/**
 * Everything the desk needs to display one revision step.
 * `tables` is kept on the object (it is needed by migrate.js).
 */
export function buildRevisionMap(oldText, newText) {
  const t = lcsTables(oldText, newText);
  const primary = tracebackLatest(t, oldText, newText);
  const status = perCharStatus(t, oldText, newText);
  return {
    oldText,
    newText,
    tables: t,
    primary,
    ops: mappingOps(oldText, newText, primary),
    perChar: status,
    ambiguityZones: ambiguityZones(t, oldText, newText, status),
    lcsLength: t.L,
    sameLength: oldText.length === newText.length,
  };
}

/** Reference: where does one old offset land under one displayed alignment? */
export function referenceMapOffset(oldText, newText, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > oldText.length) {
    throw new RangeError('offset outside old text');
  }
  const t = lcsTables(oldText, newText);
  const map = t.length === 0 ? new Int32Array(0) : tracebackLatest(t, oldText, newText);
  if (offset === oldText.length) {
    for (let i = map.length - 1; i >= 0; i--) if (map[i] >= 0) return map[i] + 1;
    return newText.length;
  }
  return map[offset];
}
