// Character-level text track: one row of characters with per-coder annotation
// bands above and below, drag-selection, and hover linking.
//
// Why one shared row: the whole point is to see where two coders cut the *same*
// characters differently. Coder A's spans sit above the text, coder B's below.
// Each span gets its own lane, so overlapping spans and multi-topic spans are
// visible rather than flattened into one colour per character.
//
// Text always wears ink tokens; colour lives in the bands (with the topic label
// in the band's tooltip and in the adjacent span table), never in the glyphs.

import { h, s, clamp, range } from '../dom.js';
import { topicColor, rgba } from '../theme.js';

const BAND_H = 5;
const BAND_GAP = 6;
const LANE_GAP = 2;

/**
 * @param {{
 *   text: string,
 *   spansA: Array, spansB: Array,
 *   labelFor: (id:string)=>string,
 *   colorFor?: (span)=>string,
 *   selection?: {start:number,end:number}|null,
 *   onSelect?: (start:number,end:number,  mode:'replace'|'add'|'toggle')=>void,
 *   onSpanClick?: (span)=>void,
 *   onSpanHover?: (span|null)=>void,
 *   hoverSpanId?: string|null,
 *   marks?: Array<{start:number,end:number,tone:string,label:string}>,
 *   disabled?: boolean,
 * }} opts
 */
export function textTrack(opts) {
  const {
    text, spansA = [], spansB = [], labelFor, selection = null,
    onSelect, onSpanClick, onSpanHover, hoverSpanId = null,
    marks = [], disabled = false,
  } = opts;
  const colorFor = opts.colorFor || ((span) => topicColor(span.topics[0] || 'service'));

  const line = h('div', { class: 'track-line', role: 'group', 'aria-label': '文本，逐字符' });
  const layer = h('div', { class: 'track-bands', 'aria-hidden': 'true' });
  line.appendChild(layer);

  const cells = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cell = h('span', {
      class: 'track-char',
      'data-i': i,
      dataset: { i: String(i) },
    }, ch === ' ' ? ' ' : ch);
    cells.push(cell);
    line.appendChild(cell);
  }
  if (!text.length) line.appendChild(h('span', { class: 'muted' }, '（空文本）'));

  const state = { dragAnchor: null, dragging: false, lastEnd: null, moved: false };

  const charIndexAt = (target) => {
    const cell = target && target.closest ? target.closest('.track-char') : null;
    if (!cell) return null;
    const i = Number(cell.dataset.i);
    return Number.isInteger(i) ? i : null;
  };

  const paintSelection = () => {
    const sel = state.dragging
      ? { start: Math.min(state.dragAnchor, state.lastEnd), end: Math.max(state.dragAnchor, state.lastEnd) + 1 }
      : selection;
    for (const cell of cells) cell.classList.remove('sel', 'sel-edge');
    if (!sel || sel.end <= sel.start) return;
    for (let i = Math.max(0, sel.start); i < Math.min(cells.length, sel.end); i++) {
      const c = cells[i];
      if (!c) continue;
      c.classList.add('sel');
      if (i === sel.start) c.classList.add('sel-edge');
    }
  };

  const onPointerDown = (e) => {
    if (disabled || e.button !== 0) return;
    const i = charIndexAt(e.target);
    if (i == null) return;
    e.preventDefault();
    line.setPointerCapture?.(e.pointerId);
    state.dragAnchor = i;
    state.lastEnd = i;
    state.dragging = true;
    state.moved = false;
    paintSelection();
    document.body.classList.add('dragging-text');
  };

  const onPointerMove = (e) => {
    if (!state.dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const i = charIndexAt(el);
    if (i == null || i === state.lastEnd) return;
    state.lastEnd = i;
    state.moved = true;
    paintSelection();
  };

  const finishDrag = (e, cancelled = false) => {
    if (!state.dragging) return;
    const anchor = state.dragAnchor;
    const end = state.lastEnd;
    const dragged = state.moved && Math.abs(anchor - end) >= 1;
    state.dragging = false;
    state.dragAnchor = null;
    document.body.classList.remove('dragging-text');
    try { line.releasePointerCapture?.(e.pointerId); } catch { /* no capture */ }
    paintSelection();
    if (cancelled) return;
    if (dragged) {
      const start = Math.min(anchor, end);
      const stop = Math.max(anchor, end) + 1;
      onSelect?.(start, stop);
    } else if (onSelect) {
      // A plain click picks that one character; the views treat a 1-char
      // selection as "start here" rather than as a span to save.
      onSelect(anchor, anchor + 1);
    }
  };

  line.addEventListener('pointerdown', onPointerDown);
  line.addEventListener('pointermove', onPointerMove);
  line.addEventListener('pointerup', (e) => finishDrag(e, false));
  line.addEventListener('pointercancel', (e) => finishDrag(e, true));
  line.addEventListener('lostpointercapture', (e) => finishDrag(e, true));

  // Hover linking from bands back to the text.
  layer.addEventListener('pointerover', (e) => {
    const band = e.target.closest?.('.track-band');
    if (!band) return;
    const id = band.dataset.id;
    onSpanHover?.(id || null);
  });
  layer.addEventListener('pointerout', (e) => {
    if (e.relatedTarget && layer.contains(e.relatedTarget)) return;
    onSpanHover?.(null);
  });
  layer.addEventListener('click', (e) => {
    const band = e.target.closest?.('.track-band');
    if (!band) return;
    const span = [...spansA, ...spansB].find((x) => x.id === band.dataset.id);
    if (span) onSpanClick?.(span);
  });

  function laneAssignment(spans) {
    const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end || String(a.id).localeCompare(String(b.id)));
    const laneEnds = [];
    const out = sorted.map((span) => {
      let lane = laneEnds.findIndex((end) => end <= span.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(span.end);
      } else {
        laneEnds[lane] = span.end;
      }
      return { span, lane };
    });
    return { placed: out, lanes: Math.max(0, laneEnds.length) };
  }

  function layout() {
    const a = laneAssignment(spansA);
    const b = laneAssignment(spansB);
    const padTop = 6 + a.lanes * (BAND_H + LANE_GAP);
    const padBottom = 6 + b.lanes * (BAND_H + LANE_GAP);
    if (line.style.paddingTop !== `${padTop}px`) line.style.paddingTop = `${padTop}px`;
    if (line.style.paddingBottom !== `${padBottom}px`) line.style.paddingBottom = `${padBottom}px`;

    const rects = cells.map((cell) => ({
      x: cell.offsetLeft,
      y: cell.offsetTop,
      w: cell.offsetWidth,
      h: cell.offsetHeight,
    }));
    if (!rects.length) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      return;
    }
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    for (const mark of marks) {
      for (const seg of segmentsOf(mark.start, mark.end, rects)) {
        layer.appendChild(h('div', {
          class: `track-mark tone-${mark.tone}`,
          style: `left:${seg.x}px;top:${top - 2}px;width:${Math.max(1, seg.w)}px;height:${bottom - top + 4}px`,
          title: mark.label,
        }));
      }
    }

    const drawSide = (placed, side) => {
      for (const { span, lane } of placed) {
        for (const seg of segmentsOf(span.start, span.end, rects)) {
          const y = side === 'A'
            ? top - 4 - lane * (BAND_H + LANE_GAP) - BAND_H
            : bottom + 4 + lane * (BAND_H + LANE_GAP);
          const band = h('div', {
            class: `track-band side-${side}`,
            style: `left:${seg.x}px;top:${y}px;width:${Math.max(2, seg.w)}px;height:${BAND_H}px;`
              + `background:${bandPaint(span, colorFor)}`,
            dataset: { id: span.id },
            title: `${span.coder} · ${range(span.start, span.end)} · ${span.topics.map(labelFor).join(' / ')}`
              + (span.origin === 'adjudicated' ? ' · 裁决' : span.origin === 'migrated' ? ' · 已迁移' : ''),
          });
          if (span.origin === 'adjudicated') band.classList.add('is-adjudicated');
          if (hoverSpanId && span.id === hoverSpanId) band.classList.add('is-hover');
          layer.appendChild(band);
        }
      }
    };
    drawSide(a.placed, 'A');
    drawSide(b.placed, 'B');
    paintSelection();
  }

  function bandPaint(span, colorOf) {
    if (span.topics.length <= 1) return colorOf(span);
    const stops = span.topics.map((t, i) => {
      const from = (i / span.topics.length) * 100;
      const to = ((i + 1) / span.topics.length) * 100;
      return `${topicColor(t)} ${from}% ${to}%`;
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  function segmentsOf(start, end, rects) {
    const out = [];
    let current = null;
    for (let i = Math.max(0, start); i < Math.min(rects.length, end); i++) {
      const r = rects[i];
      if (!r) continue;
      if (current && r.y === current.y) {
        current.x1 = Math.max(current.x1, r.x + r.w);
      } else {
        if (current) out.push(current);
        current = { y: r.y, x: r.x, x1: r.x + r.w };
      }
    }
    if (current) out.push(current);
    return out.map((seg) => ({ x: seg.x, w: seg.x1 - seg.x, y: seg.y }));
  }

  let raf = 0;
  const scheduleLayout = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(scheduleLayout);
    ro.observe(line);
    line.addEventListener('desk:refresh', scheduleLayout);
  }

  // First layout once mounted.
  requestAnimationFrame(layout);

  const root = h('div', { class: 'track' }, line);
  if (onSpanHover) {
    line.addEventListener('pointerover', (e) => {
      const cell = e.target.closest?.('.track-char');
      if (!cell) return;
      const i = Number(cell.dataset.i);
      const span = [...spansA, ...spansB].find((sp) => sp.start <= i && i < sp.end);
      if (span) onSpanHover(span.id);
    });
    line.addEventListener('pointerout', (e) => {
      if (e.relatedTarget && line.contains(e.relatedTarget)) return;
      onSpanHover(null);
    });
  }
  return root;
}

/** Colour for a span, using a stable topic order. */
export function spanPaint(span) {
  if (!span.topics.length) return 'rgba(107,111,118,0.5)';
  if (span.topics.length === 1) return topicColor(span.topics[0]);
  return rgba(topicColor(span.topics[0]), 0.9);
}

export function clampRange(start, end, length) {
  return { start: clamp(start, 0, length), end: clamp(end, 0, length) };
}
