// Build src/data/corpus.json from data-source/corpus.js.
//
// Clause tables -> exact character ranges. Fails on unknown topics/coders or on
// a clause list that does not match the per-clause label rows, so a silent
// off-by-one cannot reach the analysis.
//
// Coder A: maximal runs of consecutive labelled clauses -> one span per run.
// Coder B: one span per clause per topic (overlapping spans when a clause has
// two topics, unless the row opts out).

import { writeFileSync, mkdirSync } from 'node:fs';
import { DOCS, TOPICS, CODERS } from '../data-source/corpus.js';

const topicIds = new Set(TOPICS.map((t) => t.id));
const coderIds = new Set(CODERS.map((c) => c.id));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function buildV1(doc) {
  const clauseStart = [];
  const clauseEnd = [];
  let text = '';
  for (const [clause] of doc.clauses) {
    clauseStart.push(text.length);
    text += clause;
    clauseEnd.push(text.length);
  }
  const annotations = [];

  // Coder A: a new span at each labelled clause unless `aJoin` merges it upward.
  for (let c = 0; c < doc.clauses.length; c++) {
    const aTopics = doc.clauses[c][1];
    const flags = doc.clauses[c][3] || {};
    const prev = annotations[annotations.length - 1];
    if (flags.aJoin && prev && prev.coder === 'A' && prev.clauseRange[1] === c - 1) {
      prev.end = clauseEnd[c];
      prev.clauseRange[1] = c;
      for (const t of aTopics) if (!prev.topics.includes(t)) prev.topics.push(t);
      prev.topics.sort();
    } else if (aTopics.length) {
      annotations.push({
        coder: 'A',
        start: clauseStart[c],
        end: clauseEnd[c],
        topics: [...aTopics].sort(),
        clauseRange: [c, c],
      });
    }
  }

  // Coder B: per-clause spans. Topics are already widened in the source table.
  for (let c = 0; c < doc.clauses.length; c++) {
    const [, , bTopics, flags = {}] = doc.clauses[c];
    const topics = [...bTopics];
    if (!topics.length) continue;
    if (flags.overlap) {
      for (const t of topics) {
        annotations.push({ coder: 'B', start: clauseStart[c], end: clauseEnd[c], topics: [t], clauseRange: [c, c] });
      }
    } else {
      annotations.push({ coder: 'B', start: clauseStart[c], end: clauseEnd[c], topics: topics.sort(), clauseRange: [c, c] });
    }
  }

  for (const a of annotations) {
    assert(coderIds.has(a.coder), `${doc.id}: unknown coder ${a.coder}`);
    for (const t of a.topics) assert(topicIds.has(t), `${doc.id}: unknown topic ${t}`);
    assert(a.start >= 0 && a.end <= text.length && a.start < a.end, `${doc.id}: bad range ${a.start}-${a.end}`);
  }
  // Stable ids in source order: A spans first, then B spans.
  annotations.sort((x, y) => (x.coder === y.coder ? x.start - y.start || x.end - y.end : x.coder < y.coder ? -1 : 1));
  const counters = { A: 0, B: 0 };
  for (const a of annotations) {
    counters[a.coder] += 1;
    a.id = `${doc.id}-${a.coder}-${String(counters[a.coder]).padStart(2, '0')}`;
  }
  return { text, clauseStart, clauseEnd, annotations };
}

function buildRevision(doc) {
  if (!doc.revision) return null;
  const parts = [];
  const operations = [];
  let cursor = 0;
  for (const op of doc.revision.ops) {
    if (op.keep) {
      assert(op.keep[0] === cursor, `${doc.id}: revision keep must be contiguous (expected ${cursor}, got ${op.keep[0]})`);
      for (let c = op.keep[0]; c < op.keep[1]; c++) {
        parts.push(doc.clauses[c][0]);
        operations.push({ kind: 'keep', text: doc.clauses[c][0], clause: c });
      }
      cursor = op.keep[1];
    } else if (op.insert) {
      parts.push(op.insert);
      operations.push({ kind: 'insert', text: op.insert });
    } else if (op.duplicate) {
      // Re-emit an already-kept clause a second time. The opeation list records
      // it explicitly so the UI can show "this text now appears twice".
      assert(op.duplicate[0] === op.duplicate[1] - 1, `${doc.id}: duplicate must name one clause`);
      const text = doc.clauses[op.duplicate[0]][0];
      parts.push(text);
      operations.push({ kind: 'duplicate', text, clause: op.duplicate[0] });
    } else if (op.delete) {
      assert(op.delete[0] === cursor, `${doc.id}: revision delete must be contiguous`);
      for (let c = op.delete[0]; c < op.delete[1]; c++) {
        operations.push({ kind: 'delete', text: doc.clauses[c][0], clause: c });
      }
      cursor = op.delete[1];
    } else if (op.replace) {
      assert(op.replace[0] === cursor, `${doc.id}: revision replace must be contiguous`);
      parts.push(op.text);
      operations.push({
        kind: 'replace',
        text: op.text,
        replaced: doc.clauses.slice(op.replace[0], op.replace[1]).map((c) => c[0]).join(''),
        clause: op.replace[0],
      });
      cursor = op.replace[1];
    }
  }
  assert(cursor === doc.clauses.length, `${doc.id}: revision did not consume every clause (${cursor}/${doc.clauses.length})`);
  return {
    version: `${doc.id}-${doc.revision.version || 'v2'}`,
    text: parts.join(''),
    note: '示例修订：插入一句、删除一句、重复一句、改写一句。',
    operations,
  };
}

const out = {
  meta: {
    title: '虚构社区意见文本编码示例',
    disclaimer: '全部文本为虚构示例，用于演示编码对齐与漂移检测，不含真实投诉信息。',
    topics: TOPICS,
    coders: CODERS,
    generatedAt: null,
  },
  documents: [],
};

for (const doc of DOCS) {
  const v1 = buildV1(doc);
  const rev = buildRevision(doc);
  out.documents.push({
    id: doc.id,
    window: doc.window,
    date: doc.date,
    type: doc.type,
    typeLabel: { T: '投诉', S: '建议', C: '咨询' }[doc.type],
    title: doc.title,
    versions: [
      { version: 'v1', text: v1.text, clauseStart: v1.clauseStart, clauseEnd: v1.clauseEnd, note: '原始意见' },
      ...(rev ? [{ version: rev.version, text: rev.text, note: rev.note, operations: rev.operations, basedOn: 'v1' }] : []),
    ],
    annotations: v1.annotations,
  });
}

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/corpus.json', JSON.stringify(out, null, 2) + '\n');

const totalChars = out.documents.reduce((s, d) => s + d.versions[0].text.length, 0);
const totalAnn = out.documents.reduce((s, d) => s + d.annotations.length, 0);
const byCoder = out.documents.flatMap((d) => d.annotations).reduce((m, a) => ((m[a.coder] = (m[a.coder] || 0) + 1), m), {});
console.log(`corpus: ${out.documents.length} documents, ${totalChars} chars, ${totalAnn} annotations (${JSON.stringify(byCoder)})`);
const dups = out.documents.filter((d) => d.versions.length > 1);
console.log(`revisions: ${dups.map((d) => d.versions[1].version).join(', ') || 'none'}; windows: ${[...new Set(out.documents.map((d) => d.window))].join(' ')}`);
