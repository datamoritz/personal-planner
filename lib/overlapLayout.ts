import { timeToMinutes } from './timeGrid';

export interface OverlapItem {
  id: string;
  startTime: string;
  endTime: string;
}

/**
 * For a list of time-grid items (entries + timed tasks combined),
 * computes a "depth" for each item so overlapping items cascade visually
 * like Apple Calendar — each overlap group gets depth 0, 1, 2…
 */
export function computeOverlapDepths(items: OverlapItem[]): Map<string, number> {
  const sorted = [...items].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );
  const depths = new Map<string, number>();

  for (const item of sorted) {
    const itemStart = timeToMinutes(item.startTime);
    const itemEnd   = timeToMinutes(item.endTime);

    // Depths already claimed by items that overlap with this one
    const usedDepths = sorted
      .filter((other) => other.id !== item.id && depths.has(other.id))
      .filter((other) => {
        const s = timeToMinutes(other.startTime);
        const e = timeToMinutes(other.endTime);
        return s < itemEnd && e > itemStart;
      })
      .map((other) => depths.get(other.id)!);

    let depth = 0;
    while (usedDepths.includes(depth)) depth++;
    depths.set(item.id, depth);
  }

  return depths;
}
