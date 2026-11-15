/**
 * Admin-side tier rules (DECISIONS R.4, R.7), pure so they are unit-tested
 * (e2e/admin-tiers.test.cjs). The server enforces the same rules; this keeps the
 * admin console from offering a choice the server would refuse.
 */
import type { Tier } from '@/lib/api';

export type ExamCounts = { prelims: number; mains: number; interview: number };
export type ExamCountsText = Record<keyof ExamCounts, string>;

export const TIER_LABEL: Record<Tier, string> = {
  listener: 'Peer listener',
  mentor: 'Mentor',
  verified: 'Mento Verified',
};

/** DECISIONS R.4 (founder, 2026-11-15, option b): in-service proof makes Mento Verified,
 * exam proof makes a Mentor. Mirrors services/tiers.py grant_for_document. */
const EXAM_DOCUMENTS = new Set(['mains_admit_card', 'interview_letter', 'result']);
export function grantForDocument(kind: string): 'mentor' | 'verified' {
  return EXAM_DOCUMENTS.has(kind) ? 'mentor' : 'verified';
}

/** A count box's text → 0..20 (empty or junk is 0). */
export function parseCount(text: string): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 20) : 0;
}

export function parseCounts(t: ExamCountsText): ExamCounts {
  return { prelims: parseCount(t.prelims), mains: parseCount(t.mains), interview: parseCount(t.interview) };
}

/** Nobody who has not cleared prelims mentors (R.4). */
export function canBeMentor(c: ExamCounts): boolean {
  return c.prelims >= 1;
}

/** "PPP MM I" (R.7) for the admin card; "" when nothing is recorded. */
export function badgeLine(c: Partial<ExamCounts> | null | undefined): string {
  if (!c) return '';
  const part = (letter: string, n: number | undefined) => (n && n > 0 ? letter.repeat(Math.min(n, 9)) : '');
  return [part('P', c.prelims), part('M', c.mains), part('I', c.interview)].filter(Boolean).join(' ');
}

export type RosterFilter = { tier: Tier | 'all'; state: 'active' | 'hidden' | 'all' };

type RosterRow = { tier?: Tier; vetting_status: string };

/** Active = approved; hidden = suspended or declined (members never see them). */
export function rosterMatches(row: RosterRow, f: RosterFilter): boolean {
  const tierOk = f.tier === 'all' || (row.tier ?? 'listener') === f.tier;
  const active = row.vetting_status === 'approved';
  const stateOk = f.state === 'all' || (f.state === 'active' ? active : !active);
  return tierOk && stateOk;
}
