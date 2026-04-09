import {
  addDays,
  differenceInCalendarDays,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import type { PlannerZoom } from '@/types';

export interface PlannerTimelineSegment {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : parseISO(value);
}

export function getPlannerYearBounds(year: number): { start: Date; end: Date } {
  const start = startOfYear(new Date(year, 0, 1));
  return { start, end: endOfYear(start) };
}

export function buildPlannerSegments(year: number, zoom: PlannerZoom): PlannerTimelineSegment[] {
  const { start, end } = getPlannerYearBounds(year);

  if (zoom === 'detail') {
    return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((weekStart, index) => {
      const inYearStart = weekStart < start ? start : weekStart;
      const weekEnd = addDays(weekStart, 6);
      const inYearEnd = weekEnd > end ? end : weekEnd;
      return {
        key: `detail-${format(weekStart, "yyyy-'W'II")}`,
        label: index === 0 || format(inYearStart, 'MMM') !== format(addDays(inYearStart, -7), 'MMM')
          ? format(inYearStart, 'MMM d')
          : format(inYearStart, 'd'),
        startDate: format(inYearStart, 'yyyy-MM-dd'),
        endDate: format(inYearEnd, 'yyyy-MM-dd'),
      };
    });
  }

  if (zoom === 'month') {
    return eachMonthOfInterval({ start, end }).map((monthStart) => ({
      key: format(monthStart, 'yyyy-MM'),
      label: format(monthStart, 'MMM'),
      startDate: format(startOfMonth(monthStart), 'yyyy-MM-dd'),
      endDate: format(endOfMonth(monthStart), 'yyyy-MM-dd'),
    }));
  }

  if (zoom === 'quarter') {
    return [0, 1, 2, 3].map((quarterIndex) => {
      const quarterStart = startOfQuarter(new Date(year, quarterIndex * 3, 1));
      return {
        key: `q${quarterIndex + 1}`,
        label: `Q${quarterIndex + 1}`,
        startDate: format(quarterStart, 'yyyy-MM-dd'),
        endDate: format(endOfQuarter(quarterStart), 'yyyy-MM-dd'),
      };
    });
  }

  return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((weekStart) => {
    const inYearStart = weekStart < start ? start : weekStart;
    const weekEnd = addDays(weekStart, 6);
    const inYearEnd = weekEnd > end ? end : weekEnd;
    return {
      key: format(weekStart, "yyyy-'W'II"),
      label: format(inYearStart, 'MMM').toUpperCase(),
      startDate: format(inYearStart, 'yyyy-MM-dd'),
      endDate: format(inYearEnd, 'yyyy-MM-dd'),
    };
  });
}

export function dateToPercent(date: string | Date, year: number): number {
  const value = toDate(date);
  const { start, end } = getPlannerYearBounds(year);
  if (value <= start) return 0;
  if (value >= end) return 1;
  const total = differenceInCalendarDays(end, start);
  return differenceInCalendarDays(value, start) / total;
}

export function rangeToPercent(startDate: string, endDate: string, year: number): { left: number; width: number } {
  const { start, end } = getPlannerYearBounds(year);
  const rawStart = toDate(startDate);
  const rawEnd = toDate(endDate);
  const clampedStart = rawStart < start ? start : rawStart;
  const clampedEnd = rawEnd > end ? end : rawEnd;
  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const startOffset = differenceInCalendarDays(clampedStart, start);
  const spanDays = Math.max(1, differenceInCalendarDays(clampedEnd, clampedStart) + 1);

  return {
    left: Math.max(0, startOffset / totalDays),
    width: Math.max(spanDays / totalDays, 6 / 1200),
  };
}

export function snapDateToZoom(date: string | Date, zoom: PlannerZoom): Date {
  const value = startOfDay(toDate(date));
  if (zoom === 'quarter') {
    return startOfWeek(value, { weekStartsOn: 1 });
  }
  return value;
}

export function clampDateToYear(date: string | Date, year: number): Date {
  const value = startOfDay(toDate(date));
  const { start, end } = getPlannerYearBounds(year);
  if (value < start) return start;
  if (value > end) return end;
  return value;
}

export function dateToX(date: string | Date, width: number, year: number): number {
  return dateToPercent(date, year) * width;
}

export function xToDate(x: number, width: number, year: number, zoom: PlannerZoom): Date {
  const { start, end } = getPlannerYearBounds(year);
  const totalDays = Math.max(1, differenceInCalendarDays(end, start));
  const percent = Math.max(0, Math.min(1, x / Math.max(width, 1)));
  const raw = addDays(start, Math.round(percent * totalDays));
  return clampDateToYear(snapDateToZoom(raw, zoom), year);
}
