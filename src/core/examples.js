// Hand-built micro examples for the three situations the desk must handle, each
// checked against the literal per-character reference:
//
//   1. the same text occurs more than once — the migration may not pick a copy;
//   2. one coder uses overlapping, multi-label spans — comparison must union per
//      character and still attribute boundaries separately;
//   3. text is inserted in the middle of a span — the old coordinates cannot be
//      reused, and the migration must say how many characters moved.
//
// (A fourth, deletion, is included because it is the cleanest way to see the
// dispute zone: a deleted sentence must be "lost", never "ambiguous".)
//
// The cases are data plus assertions: `runExamples()` recomputes everything from
// the texts and annotations and reports pass/fail, so the verification page and
// the unit tests check the same numbers the reader sees.

import { buildRevisionMap } from './diff.js';
import { locateSpan, locateSpanExact, blockAnchors } from './migrate.js';
import { attribute } from './attribute.js';
import { compareTopics } from './align.js';
import { charLabels, canonicalLabels, labelsAt } from './text.js';
import { allOptimalAlignments, bruteImageSet } from './verify.js';

const T = {
  green: '绿化带的围栏倒了一段。路灯也不亮。',
  // The repeated paragraph is separated from its first copy by an unrelated
  // sentence, so "which copy?" is a real question and not a tie-break artefact.
  repeatedNewExtra: '补充：以上情况在二号楼同样存在。',
  overlap: '消防通道堆着纸箱。门禁坏了三个月。',
  insertOld: '物业说门禁的配件要等厂家发货。',
  insertInserted: '，根据保安的说法，',
};

function slices(text, parts) {
  const out = [];
  let at = 0;
  for (const part of parts) {
    const i = text.indexOf(part, at);
    if (i < 0) throw new Error(`example text mismatch: ${part}`);
    if (i > at) out.push({ text: text.slice(at, i), inserted: true });
    out.push({ text: part, inserted: false });
    at = i + part.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), inserted: true });
  return out;
}

function runsOf(refA, refB) {
  const runs = [];
  for (let i = 0; i < refA.length; i++) {
    const a = refA[i].join('+');
    const b = refB[i].join('+');
    const last = runs[runs.length - 1];
    if (last && last.a === a && last.b === b) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, a, b, text: '' });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// 1. repeated text
// ---------------------------------------------------------------------------
function repeatedCase() {
  const oldText = T.green;
  const newText = oldText + T.repeatedNewExtra + oldText;
  const map = buildRevisionMap(oldText, newText);
  const first = oldText.slice(0, 11);
  const span = [0, oldText.length];
  const policy = locateSpan(map, span[0], span[1]);
  const exact = locateSpanExact(map, span[0], span[1]);
  const brute = bruteImageSet(oldText, newText, span[0], span[1]);
  const candidates = policy.candidates || [];
  const exactCandidates = exact.candidates || [];
  const bruteRanges = brute.ranges ? [...brute.ranges] : [];
  const checks = [
    {
      id: 'policy-ambiguous',
      label: '块锚定策略判定为「多处候选」，不自行选择',
      pass: policy.status === 'ambiguous' && candidates.length === 2,
      detail: `status=${policy.status}, candidates=${candidates.length}`,
    },
    {
      id: 'candidates-carry-text',
      label: '每个候选位置上的文字都与原文一致',
      pass: candidates.length > 0 && candidates.every((c) => newText.slice(c.start, c.end) === oldText),
      detail: candidates.map((c) => `[${c.start},${c.end})`).join(' / '),
    },
    {
      id: 'policy-subset-of-brute',
      label: '策略候选包含于暴力枚举的全部最优对齐结果',
      pass: candidates.every((c) => bruteRanges.includes(`${c.start}:${c.end}`)),
      detail: `brute=${bruteRanges.join(' ')}`,
    },
    {
      id: 'brute-agrees',
      label: '暴力枚举全部最优对齐，确认候选不止一处',
      pass: bruteRanges.length >= 2 && !brute.truncated,
      detail: `brute=${bruteRanges.join(' ')}`,
    },
  ];
  const alignmentCount = allOptimalAlignments(oldText, newText, 50000).alignments.length;
  return {
    id: 'repeat',
    title: '相同文字多次出现',
    question: '同一段文字在新文本里出现了两处，旧区间该落在哪一处？',
    answer: '不选。两处都与原文一致，坐标无法唯一确定，进入争议区；审阅者从候选中指定。',
    kind: 'migration',
    oldText,
    newText,
    span,
    annotatedText: first,
    rows: candidates.map((c, i) => ({
      index: i,
      start: c.start,
      end: c.end,
      text: newText.slice(c.start, c.end),
      alsoInBrute: bruteRanges.includes(`${c.start}:${c.end}`),
    })),
    exactCandidates,
    bruteRanges,
    alignmentCount,
    status: policy.status,
    checks,
    notes: [
      `旧区间 [${span[0]},${span[1]}) 在新文本中有 ${candidates.length} 处完整出现。`,
      `「全部最优对齐」语义下另有 ${Math.max(0, exactCandidates.length - candidates.length)} 个跨句候选——短片段可以被不同的对齐拼出来，但不是这段文字的完整副本。`,
      `LCS 最优对齐共有 ${alignmentCount} 种；位置不能由对齐唯一决定。`,
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. overlapping, multi-label spans
// ---------------------------------------------------------------------------
function overlapCase() {
  const text = T.overlap;
  const len = text.length;
  // 甲: one span naming both topics over the whole text.
  const A = [{ id: 'A-1', coder: 'A', start: 0, end: len, topics: ['safety'] }];
  // 乙: two spans that overlap — one names safety, the other names a second
  // topic — so the per-character label set differs only inside the overlap.
  const B = [
    { id: 'B-1', coder: 'B', start: 0, end: 11, topics: ['safety'] },
    { id: 'B-2', coder: 'B', start: 11, end: len, topics: ['safety', 'service'] },
  ];
  const refA = charLabels(A, len);
  const refB = charLabels(B, len);
  const attr = attribute(A, B, len);
  const cmp = compareTopics(A, B, len);
  const runs = runsOf(refA, refB).map((r) => ({
    ...r,
    text: text.slice(r.start, r.end),
  }));

  // A second arrangement where the overlapping copies agree exactly: A names
  // {safety,service} on the whole run; B splits that into two overlapping spans.
  const A2 = [{ id: 'A2-1', coder: 'A', start: 0, end: len, topics: ['safety', 'service'] }];
  const B2 = [
    { id: 'B2-1', coder: 'B', start: 0, end: len, topics: ['safety'] },
    { id: 'B2-2', coder: 'B', start: 0, end: len, topics: ['service'] },
  ];
  const attr2 = attribute(A2, B2, len);
  const cmp2 = compareTopics(A2, B2, len);
  const refA2 = charLabels(A2, len);
  const refB2 = charLabels(B2, len);
  const runs2 = runsOf(refA2, refB2).map((r) => ({ ...r, text: text.slice(r.start, r.end) }));
  const diffChars = cmp.disagreeChars;

  const checks = [
    {
      id: 'overlap-union',
      label: '逐字符标签是重叠区间的并集',
      pass: refB.every((labels, i) => labels.join('|') === labelsAt(B, i).join('|')),
      detail: 'labelsAt() 与 charLabels() 在每个字符上一致',
    },
    {
      id: 'overlap-topic-diff',
      label: '区域归因：对齐区域整体比较，主题分歧覆盖整个区域',
      pass: attr.topicDiff === 17 && attr.agreeCut === 0,
      detail: `topicDiff=${attr.topicDiff}, agreeCut=${attr.agreeCut}`,
    },
    {
      id: 'overlap-per-char',
      label: '逐字符参照：只有重叠区（6 字）的标签集合不同',
      pass: cmp.disagreeChars === 6,
      detail: `compareTopics.disagreeChars=${cmp.disagreeChars}`,
    },
    {
      id: 'overlap-same-set',
      label: '切分不同但标签集合相同时，判为边界分歧（一致）',
      pass: attr2.topicDiff === 0 && attr2.agree === len && attr2.agreeCut === len,
      detail: `agree=${attr2.agree}, agreeCut=${attr2.agreeCut}, topicDiff=${attr2.topicDiff}`,
    },
    {
      id: 'overlap-same-set-per-char',
      label: '逐字符参照确认标签集合确实相同',
      pass: cmp2.disagreeChars === 0,
      detail: `compareTopics.disagreeChars=${cmp2.disagreeChars}`,
    },
  ];
  return {
    id: 'overlap',
    title: '交叠标签与多标签',
    question: '乙在同一段文字上用两个重叠区间写主题，怎样比较才公平？',
    answer: '逐字符取并集；集合相同而切分不同，记边界分歧；集合不同，记主题分歧。',
    kind: 'coding',
    text,
    codings: { A, B },
    runs,
    attr,
    cmp,
    variant: {
      title: '切分不同、标签集合相同',
      codings: { A: A2, B: B2 },
      runs: runs2,
      attr: attr2,
      cmp: cmp2,
      checks: checks.slice(3),
    },
    checks,
  };
}

// ---------------------------------------------------------------------------
// 3. insertion in the middle
// ---------------------------------------------------------------------------
function insertionCase() {
  const oldText = T.insertOld;
  const inserted = T.insertInserted;
  const at = oldText.indexOf('要等');
  const newText = oldText.slice(0, at) + inserted + oldText.slice(at);
  const map = buildRevisionMap(oldText, newText);
  const span = [0, oldText.length];
  const policy = locateSpan(map, span[0], span[1]);
  const exact = locateSpanExact(map, span[0], span[1]);
  const mapped = newText.slice(policy.start, policy.end);

  // Character-by-character proof that the old coordinates cannot be reused: the
  // same text now occupies a longer range, and every old character that survived
  // maps to a new character of the same value under a monotone map.
  let monotone = true;
  let last = -1;
  let sameChar = 0;
  let mappedCount = 0;
  for (let i = 0; i < oldText.length; i++) {
    const p = map.primary[i];
    if (p < 0) continue;
    mappedCount++;
    if (p <= last) monotone = false;
    last = p;
    if (newText[p] === oldText[i]) sameChar++;
  }
  const parts = slices(newText, [oldText.slice(0, at), oldText.slice(at)]);
  const checks = [
    {
      id: 'inserted-inside',
      label: '区间内部的插入被计入 insertedInside',
      pass: (policy.insertedInside || 0) === inserted.length,
      detail: `insertedInside=${policy.insertedInside}, inserted=${inserted.length}`,
    },
    {
      id: 'moved-range',
      label: '旧坐标不能直接套用：区间变长但文字未丢',
      pass: policy.start === exact.start && policy.end === exact.end
        && policy.start === 0 && policy.end === newText.length
        && mapped === newText,
      detail: `policy=[${policy.start},${policy.end})、"${mapped}"`,
    },
    {
      id: 'monotone-map',
      label: '存活字符的映射严格单调，且每个位置的新字符与旧字符相同',
      pass: monotone && sameChar === mappedCount && mappedCount === oldText.length,
      detail: `${sameChar}/${mappedCount} 字符相同，单调=${monotone}`,
    },
  ];
  return {
    id: 'insert',
    title: '文本中途插入',
    question: '在旧区间内部插入一句话后，原来的 [0,' + oldText.length + ') 还能用吗？',
    answer: '不能直接复用。新位置由映射给出，并标明内部插入了多少字；旧标注本身保持不变。',
    kind: 'migration',
    oldText,
    newText,
    span,
    inserted,
    parts,
    policy,
    exact,
    checks,
  };
}

// ---------------------------------------------------------------------------
// 4. deletion -> dispute zone
// ---------------------------------------------------------------------------
function deletionCase() {
  const keep = '门禁坏了以后，快递都堆在一楼大厅。';
  const gone = '门禁坏了以后，外卖员进出反而方便。';
  const tail = '物业说配件要等厂家发货。';
  const oldText = keep + gone + tail;
  const newText = keep + tail;
  const map = buildRevisionMap(oldText, newText);
  const span = [keep.length, keep.length + gone.length];
  const policy = locateSpan(map, span[0], span[1]);
  const exact = locateSpanExact(map, span[0], span[1]);
  const anchors = blockAnchors(map, span[0], span[1]);
  const longest = anchors.reduce((m, a) => Math.max(m, a.length), 0);
  const checks = [
    {
      id: 'deleted-lost',
      label: '整句删除判为「丢失」，不是「多处候选」',
      pass: policy.status === 'lost',
      detail: `status=${policy.status}`,
    },
    {
      id: 'deleted-no-stray-anchor',
      label: '被删句子里与上下文相同的散字没有被当成可迁移的锚',
      pass: longest < Math.max(2, Math.ceil(gone.length / 4)),
      detail: `最长连续锚=${longest}，阈值约 ${Math.max(2, Math.ceil(gone.length / 4))}`,
    },
    {
      id: 'deleted-text-absent',
      label: '新文本中确实找不到这句话',
      pass: !newText.includes(gone) && exact.status !== 'exact',
      detail: `exact.status=${exact.status}`,
    },
  ];
  return {
    id: 'delete',
    title: '原文被删除（争议区）',
    question: '整句被删掉后，旧标注该怎么办？',
    answer: '判为丢失并进入争议区；不把散落的相同字符当作残留位置。',
    kind: 'migration',
    oldText,
    newText,
    span,
    deletedText: gone,
    policy,
    exact,
    checks,
  };
}

export function demoExamples() {
  return [repeatedCase(), overlapCase(), insertionCase(), deletionCase()];
}

export function runExamples() {
  const cases = demoExamples();
  const checks = cases.flatMap((c) => {
    const own = c.checks || [];
    const variant = c.variant ? c.variant.checks : [];
    return [...own, ...variant].map((x) => ({ ...x, case: c.id, caseTitle: c.title }));
  });
  const failed = checks.filter((c) => !c.pass);
  return {
    cases,
    checks,
    total: checks.length,
    failed: failed.length,
    ok: failed.length === 0,
    passed: checks.length - failed.length,
  };
}

export { T as EXAMPLE_TEXTS, runsOf, canonicalLabels };
