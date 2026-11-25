// One analysis pass over a corpus: alignment, attribution and drift for a pair of
// coders, with every intermediate kept so the UI and the tests can inspect it.

import { buildRevisionMap } from './diff.js';
import { migrateThrough, composeMaps } from './migrate.js';
import { compareTopics, pairSegments, segmentBlocks } from './align.js';
import { attribute, segmentTable } from './attribute.js';
import { detectDrift, relativeDrift, windowProfile } from './drift.js';
import { topicCoverage } from './text.js';

export function splitCoding(doc, coder) {
  return doc.annotations.filter((a) => a.coder === coder);
}

/** Annotations with the document's window/stratum/date attached, for drift. */
export function withMeta(doc, annotations) {
  return annotations.map((a) => ({
    ...a,
    docId: doc.id,
    window: doc.window,
    stratum: doc.type,
    date: doc.date,
  }));
}

export function analyzeDocument(doc, coderA, coderB, opts = {}) {
  const version = opts.version || 'v1';
  const ver = doc.versions.find((v) => v.version === version);
  if (!ver) throw new Error(`no version ${version} for ${doc.id}`);
  const length = ver.text.length;
  const spansA = splitCoding(doc, coderA);
  const spansB = splitCoding(doc, coderB);
  const topics = compareTopics(spansA, spansB, length);
  const attribution = attribute(spansA, spansB, length);
  const pairing = pairSegments(spansA, spansB);
  const rows = segmentTable(spansA, spansB, length);
  return {
    docId: doc.id,
    version,
    length,
    text: ver.text,
    spansA,
    spansB,
    topics,
    attribution,
    pairing,
    rows,
    coverageA: topicCoverage(spansA, length),
    coverageB: topicCoverage(spansB, length),
  };
}

/**
 * Whole-corpus analysis.
 *
 * `decisions` are reviewer decisions for the *current* text version. They are
 * applied to produce an adjudicated coding for the alignment view, but all
 * statistics are computed from the human originals unless `useAdjudicated` is
 * true. The distinction is explicit so nobody mistakes a reviewer's opinion for
 * data.
 */
export function analyzeCorpus(corpus, opts = {}) {
  const coders = opts.coders || corpus.meta.coders.map((c) => c.id);
  const [coderA, coderB] = coders;
  const topicIds = corpus.meta.topics.map((t) => t.id);
  const docs = corpus.documents.map((doc) => ({
    doc,
    raw: analyzeDocument(doc, coderA, coderB, opts),
  }));

  const annsA = docs.flatMap(({ doc, raw }) => withMeta(doc, raw.spansA));
  const annsB = docs.flatMap(({ doc, raw }) => withMeta(doc, raw.spansB));

  const driftA = detectDrift(annsA, topicIds, opts);
  const driftB = detectDrift(annsB, topicIds, opts);
  const relative = relativeDrift(driftA, driftB);
  const profileA = windowProfile(annsA, topicIds, opts);
  const profileB = windowProfile(annsB, topicIds, opts);

  const totals = docs.reduce((acc, { raw }) => {
    acc.agree += raw.attribution.agree;
    acc.agreeCut += raw.attribution.agreeCut;
    acc.topicDiff += raw.attribution.topicDiff;
    acc.onlyA += raw.attribution.onlyA;
    acc.onlyB += raw.attribution.onlyB;
    acc.labelledUnion += raw.attribution.labelledUnion;
    acc.length += raw.length;
    return acc;
  }, { agree: 0, agreeCut: 0, topicDiff: 0, onlyA: 0, onlyB: 0, labelledUnion: 0, length: 0 });

  return {
    corpus,
    coderA,
    coderB,
    topicIds,
    docs,
    drift: { [coderA]: driftA, [coderB]: driftB },
    relative,
    profile: { [coderA]: profileA, [coderB]: profileB },
    totals,
    overallAgreement: totals.labelledUnion ? totals.agree / totals.labelledUnion : 1,
  };
}

/**
 * Build the revision comparison for a document that has a second version.
 * Returns the migration of every v1 annotation of both coders through v1->v2.
 */
export function analyzeRevision(corpus, docId, opts = {}) {
  const doc = corpus.documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`unknown document ${docId}`);
  if (doc.versions.length < 2) throw new Error(`${docId} has no revision`);
  const [v1, v2] = doc.versions;
  const map = buildRevisionMap(v1.text, v2.text);
  const migrated = doc.annotations.map((a) => migrateThrough(a, map, opts));
  const byCoder = { A: [], B: [] };
  for (const m of migrated) (byCoder[m.coder] ||= []).push(m);

  // Does re-coding the *new* text by each coder still line up with the migrated
  // spans? The corpus has no re-coding of v2, so this is only meaningful when the
  // caller supplies one; the function returns null otherwise rather than pretending.
  return { doc, v1, v2, map, migrated, byCoder, recountedAt: null };
}

export { composeMaps, segmentBlocks };
