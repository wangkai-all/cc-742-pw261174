// Topic identity and the validated categorical palette.
//
// Six topics, fixed hue order, assigned by the topic's `color` index from the
// corpus metadata — never cycled, never reassigned by rank or by which topics
// happen to be present. Light and dark are separate validated step sets.
//
// The validator (dataviz skill, light surface) reported contrast WARN on aqua,
// yellow and magenta; therefore every chart using those slots carries direct
// labels or an accompanying table (the relief rule), and no information is
// encoded by colour alone: topic chips always show the label text.

const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

export const PALETTE = { light: LIGHT, dark: DARK };

// Shared neutral roles for attribution categories. These are *not* topic hues:
// attribution answers a different question (agree / boundary / topic / gap), so
// it gets its own reserved set and never borrows a topic's colour.
export const ATTR_COLORS = {
  agree: { light: '#3f7f5f', dark: '#5fae85', label: '一致' },
  segmentation: { light: '#8a6d1f', dark: '#c8a44a', label: '边界分歧' },
  topic: { light: '#b23a48', dark: '#e0707d', label: '主题分歧' },
  gap: { light: '#6b6f76', dark: '#9aa0a8', label: '漏标' },
};

let theme = 'light';

export function setTheme(t) {
  theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
}

export function currentTheme() {
  return theme;
}

export function topicColor(id) {
  const meta = window.__topicMeta?.(id);
  const idx = meta ? meta.color : 0;
  return (theme === 'dark' ? DARK : LIGHT)[idx % 6];
}

export function attrColor(kind) {
  const entry = ATTR_COLORS[kind] || ATTR_COLORS.gap;
  return entry[theme];
}

export function attrLabel(kind) {
  return (ATTR_COLORS[kind] || ATTR_COLORS.gap).label;
}

/** Ink for text on a filled topic swatch (all six pass 4.5:1 against #fff/#111?). */
export function inkOn(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#14181d' : '#ffffff';
}

export function rgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
