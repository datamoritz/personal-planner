export type HighlightLayer = 'hourly' | 'daily';
export interface HighlightColor { id: string; color: string; label: string }
export interface HighlightSection { id: string; colorId: string; label: string; start: number; end: number }
export interface HighlightData { colors: Record<HighlightLayer, HighlightColor[]>; sections: Record<HighlightLayer, HighlightSection[]> }
export interface HighlightDocument { revision: number; data: HighlightData }
export type HighlightAction =
  | { type: 'paint'; layer: HighlightLayer; section: HighlightSection }
  | { type: 'erase'; layer: HighlightLayer; start: number; end: number; colorId?: string }
  | { type: 'color'; layer: HighlightLayer; color: HighlightColor };
export interface HighlightMutation { id: string; actions: HighlightAction[] }
const DAY = 86400000;
export function dayNumber(date: string): number { return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY); }
export function dayString(day: number): string { return new Date(day * DAY).toISOString().slice(0, 10); }
export function atDay(date: string, layer: HighlightLayer): number { return dayNumber(date) * (layer === 'hourly' ? 48 : 1); }
export function positionDate(position: number, layer: HighlightLayer): string { return dayString(Math.floor(position / (layer === 'hourly' ? 48 : 1))); }
export function positionTime(position: number): string { const m = ((position % 48) + 48) % 48 * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
export function fromDateTime(date: string, time: string): number { const [h, m] = time.split(':').map(Number); return atDay(date, 'hourly') + (h * 60 + m) / 30; }
export function emptyHighlights(): HighlightData {
  const colors = ['#7c83c9', '#4b9c91', '#c69854', '#bf7d91', '#7296c5'];
  const palette = (layer: HighlightLayer) => colors.map((color, i) => ({ id: `${layer}-${i}`, color, label: '' }));
  return { colors: { hourly: palette('hourly'), daily: palette('daily') }, sections: { hourly: [], daily: [] } };
}
export function normalizeSections(sections: HighlightSection[]): HighlightSection[] {
  const sorted = sections.filter(s => s.start < s.end).sort((a, b) => a.start - b.start);
  const result: HighlightSection[] = [];
  for (const section of sorted) {
    const previous = result.at(-1);
    if (previous && previous.end === section.start && previous.colorId === section.colorId && previous.label === section.label) previous.end = section.end;
    else result.push({ ...section, id: `${section.id.split('~')[0]}~${section.start}` });
  }
  return result;
}
export function eraseRange(sections: HighlightSection[], start: number, end: number, colorId?: string): HighlightSection[] {
  return sections.flatMap(s => {
    if (s.end <= start || s.start >= end || (colorId && s.colorId !== colorId)) return [s];
    const parts: HighlightSection[] = [];
    if (s.start < start) parts.push({ ...s, end: start });
    if (s.end > end) parts.push({ ...s, id: `${s.id.split('~')[0]}~${end}`, start: end });
    return parts;
  });
}
export function applyHighlightActions(data: HighlightData, actions: HighlightAction[]): HighlightData {
  let next = data;
  for (const action of actions) {
    const layer = action.layer;
    if (action.type === 'color') {
      const colors = next.colors[layer];
      next = { ...next, colors: { ...next.colors, [layer]: colors.some(c => c.id === action.color.id) ? colors.map(c => c.id === action.color.id ? action.color : c) : [...colors, action.color] } };
    } else {
      const sections = action.type === 'erase'
        ? eraseRange(next.sections[layer], action.start, action.end, action.colorId)
        : [...eraseRange(next.sections[layer], action.section.start, action.section.end), action.section];
      next = { ...next, sections: { ...next.sections, [layer]: normalizeSections(sections) } };
    }
  }
  return next;
}
/** Undo only the touched ranges, preserving unrelated highlights from other devices. */
export function inverseHighlightActions(before: HighlightData, actions: HighlightAction[]): HighlightAction[] {
  const inverse: HighlightAction[] = [];
  let current = before;
  for (const action of actions) {
    const layer = action.layer;
    if (action.type === 'color') {
      const color = current.colors[layer].find(c => c.id === action.color.id);
      if (color) inverse.unshift({ type: 'color', layer, color });
    } else {
      const { start, end } = action.type === 'paint' ? action.section : action;
      const matching = current.sections[layer].filter(s => s.start < end && s.end > start && (action.type === 'paint' || !action.colorId || s.colorId === action.colorId));
      // Clearing a color affects only its existing sections, not other colors in the range.
      const ranges = action.type === 'erase' && action.colorId ? matching.map(s => ({ start: Math.max(start, s.start), end: Math.min(end, s.end) })) : [{ start, end }];
      const restore: HighlightAction[] = ranges.flatMap(range => [
        { type: 'erase', layer, ...range } as HighlightAction,
        ...matching.filter(s => s.start < range.end && s.end > range.start).map(s => ({ type: 'paint', layer, section: { ...s, start: Math.max(s.start, range.start), end: Math.min(s.end, range.end) } } as HighlightAction)),
      ]);
      inverse.unshift(...restore);
    }
    current = applyHighlightActions(current, [action]);
  }
  return inverse;
}
export function highlightAt(data: HighlightData, layer: HighlightLayer, point: number) { return data.sections[layer].find(s => s.start <= point && s.end > point); }
export function highlightColor(data: HighlightData, layer: HighlightLayer, section: HighlightSection) { return data.colors[layer].find(c => c.id === section.colorId)?.color ?? '#7c83c9'; }
