// Shared constants and helpers for the My Day time grid

export const START_HOUR = 0;   // grid starts at midnight
export const END_HOUR   = 26;  // grid extends to 2 AM next day (late-night overflow zone)
export const SLOT_HEIGHT = 56; // px per hour — 12h (8am–8pm) ≈ 672px

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Pixel offset from top of grid for a given wall-clock minute value */
export function minutesToOffset(minutes: number): number {
  return (minutes / 60) * SLOT_HEIGHT;
}

export function durationToHeight(start: string, end: string): number {
  return ((timeToMinutes(end) - timeToMinutes(start)) / 60) * SLOT_HEIGHT;
}

export function snapTo15Min(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}
