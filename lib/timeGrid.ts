// Shared constants and helpers for the My Day time grid

export const START_HOUR = 0;   // grid starts at midnight
export const END_HOUR   = 26;  // grid extends to 2 AM next day (late-night overflow zone)
export const SLOT_HEIGHT        = 56; // px per hour — 12h (8am–8pm) ≈ 672px
export const MOBILE_SLOT_HEIGHT = 36; // px per hour on mobile — more compact scroll

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function shiftIsoDate(date: string, dayOffset: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(year, month - 1, day + dayOffset);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeGridEventRange(baseDate: string, startTime: string, endTime: string) {
  const startRawMinutes = timeToMinutes(startTime);
  let endRawMinutes = timeToMinutes(endTime);

  if (endRawMinutes < startRawMinutes) {
    endRawMinutes += 24 * 60;
  }

  const startDayOffset = Math.floor(startRawMinutes / (24 * 60));
  const endDayOffset = Math.floor(endRawMinutes / (24 * 60));

  return {
    startDate: shiftIsoDate(baseDate, startDayOffset),
    startTime: minutesToTime(startRawMinutes % (24 * 60)),
    endDate: shiftIsoDate(baseDate, endDayOffset),
    endTime: minutesToTime(endRawMinutes % (24 * 60)),
  };
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
