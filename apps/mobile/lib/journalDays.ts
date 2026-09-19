/**
 * The one journal, by day (DECISIONS §L.8) — shared by the hub's shelf and the deeper
 * pages (board A28 Write · A29 A past day). A "day" is a client-side grouping of the merged
 * channels by the member's LOCAL calendar day; nothing here talks to the server.
 *
 * No counts of days, no streaks: a quiet day is simply a blank page.
 */
import type { JournalEntry } from '@/lib/api';
import type { TKey } from '@/lib/i18n';

/** The channels that make up the one journal. Finance is off-path (never merged in). */
export const MERGED_CHANNELS = ['mentor_notes', 'gratitude', 'mood'] as const;

/** Local calendar day of an ISO timestamp as `YYYY-MM-DD` — also the day route's param. */
export function dayId(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Noon of that local day — safe to add/subtract days across DST. */
export function dayDate(id: string): Date {
  const [y, m, d] = id.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function isDayId(id: string | undefined): id is string {
  return Boolean(id && /^\d{4}-\d{2}-\d{2}$/.test(id) && !Number.isNaN(dayDate(id).getTime()));
}

export function shiftDay(id: string, by: number): string {
  const d = dayDate(id);
  d.setDate(d.getDate() + by);
  return dayId(d);
}

/** Whole days between a day and today (0 = today, 1 = yesterday). */
export function daysAgo(id: string): number {
  const ms = dayDate(dayId(new Date())).getTime() - dayDate(id).getTime();
  return Math.round(ms / 86_400_000);
}

export function entriesOn(entries: readonly JournalEntry[], id: string): JournalEntry[] {
  return entries.filter((e) => dayId(e.created_at) === id);
}

/** The earliest day that has anything in it, or null for an empty journal. */
export function earliestDay(entries: readonly JournalEntry[]): string | null {
  let first: string | null = null;
  for (const e of entries) {
    const id = dayId(e.created_at);
    if (!first || id < first) first = id;
  }
  return first;
}

/** One day, read the way the book shows it. */
export type DayPage = {
  mood: string | null;
  kept: JournalEntry[];
  wrote: JournalEntry[];
  grateful: JournalEntry[];
};

export function readDay(entries: readonly JournalEntry[], id: string): DayPage {
  // Oldest first inside the day: a page reads top to bottom in the order it was lived.
  const day = entriesOn(entries, id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const moodEntry = [...day].reverse().find((e) => e.channel === 'mood' && e.meta.mood);
  // A bare mood check-in (body === its own mood value) is the mood row, not writing.
  const written = (e: JournalEntry) => e.body.trim().length > 0 && e.body !== e.meta.mood;
  return {
    mood: moodEntry?.meta.mood ?? null,
    kept: day.filter((e) => e.channel === 'mentor_notes'),
    wrote: day.filter((e) => e.channel === 'mood' && written(e)),
    grateful: day.filter((e) => e.channel === 'gratitude' && written(e)),
  };
}

/**
 * Mood vocabulary. The board's one-tap row (A28) is a five-step scale; the earlier
 * categorical values stay readable (they are already stored in members' entries) and sit
 * on the same scale for the day page's five dots. Stored value = the canonical English
 * word in `meta.mood`; only the label translates.
 */
export const MOOD_SCALE = ['Heavy', 'Low', 'Okay', 'Good', 'Light'] as const;
export type MoodStep = (typeof MOOD_SCALE)[number];

const MOOD_LEVEL: Record<string, number> = {
  Heavy: 1,
  Low: 2,
  Okay: 3,
  Good: 4,
  Light: 5,
  // earlier values
  Anxious: 1,
  Calm: 4,
  Happy: 5,
};
const MOOD_KEY: Record<string, TKey> = {
  Heavy: 'journalPage.moodHeavy',
  Low: 'journals.moodLow',
  Okay: 'journals.moodOkay',
  Good: 'journalPage.moodGood',
  Light: 'journalPage.moodLight',
  Anxious: 'journals.moodAnxious',
  Calm: 'journals.moodCalm',
  Happy: 'journals.moodHappy',
};

/** 1–5, or 0 for a value this build does not know. */
export function moodLevel(mood: string | null | undefined): number {
  return mood ? (MOOD_LEVEL[mood] ?? 0) : 0;
}

export function moodLabelKey(mood: string | null | undefined): TKey | null {
  return mood ? (MOOD_KEY[mood] ?? null) : null;
}
