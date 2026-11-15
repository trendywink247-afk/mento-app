/**
 * The mentorship intake form's rules (DECISIONS R.6, R.14), pure so they are unit-tested
 * (e2e/mentee-form.test.cjs). The server enforces the same maxima and drops marks a stage
 * never reached; this keeps the form honest before anything is sent.
 */
import type { ExamAttempt, MenteeProfile } from '@/lib/api';

export type MarkField =
  | 'prelims_gs'
  | 'prelims_csat'
  | 'mains_gs1'
  | 'mains_gs2'
  | 'mains_gs3'
  | 'mains_gs4'
  | 'optional_1'
  | 'optional_2'
  | 'interview';

/** Paper maxima (UPSC CSE): Prelims GS and CSAT 200 each, every Mains paper 250, Interview 275. */
export const MARK_MAX: Record<MarkField, number> = {
  prelims_gs: 200,
  prelims_csat: 200,
  mains_gs1: 250,
  mains_gs2: 250,
  mains_gs3: 250,
  mains_gs4: 250,
  optional_1: 250,
  optional_2: 250,
  interview: 275,
};

export const PRELIMS_FIELDS: MarkField[] = ['prelims_gs', 'prelims_csat'];
export const MAINS_FIELDS: MarkField[] = ['mains_gs1', 'mains_gs2', 'mains_gs3', 'mains_gs4', 'optional_1', 'optional_2'];
export const INTERVIEW_FIELDS: MarkField[] = ['interview'];

/** The mark fields an attempt shows: Mains and Optional only if it reached Mains, Interview only if reached. */
export function fieldsFor(stage: ExamAttempt['stage']): MarkField[] {
  if (stage === 'interview') return [...PRELIMS_FIELDS, ...MAINS_FIELDS, ...INTERVIEW_FIELDS];
  if (stage === 'mains') return [...PRELIMS_FIELDS, ...MAINS_FIELDS];
  return [...PRELIMS_FIELDS];
}

/** Text typed into a mark box → a number, null when empty, NaN when not a mark. */
export function parseMark(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Number(s);
}

export function markOk(field: MarkField, value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return Number.isFinite(value) && value >= 0 && value <= MARK_MAX[field];
}

/** The attempt as it will be sent: fields its stage does not show are dropped. */
export function cleanAttempt(a: ExamAttempt): ExamAttempt {
  const keep = new Set(fieldsFor(a.stage));
  const out: ExamAttempt = { year: a.year, stage: a.stage };
  for (const f of Object.keys(MARK_MAX) as MarkField[]) {
    const v = a[f];
    if (keep.has(f) && v !== null && v !== undefined) out[f] = v;
  }
  return out;
}

export function attemptsOk(attempts: ExamAttempt[]): boolean {
  return attempts.every((a) => (Object.keys(MARK_MAX) as MarkField[]).every((f) => markOk(f, a[f])));
}

/** A new attempt row: the year after the newest one, else last year. */
export function nextAttempt(attempts: ExamAttempt[], now: Date = new Date()): ExamAttempt {
  const newest = attempts.reduce((y, a) => Math.max(y, a.year), 0);
  return { year: newest ? Math.min(newest + 1, now.getFullYear()) : now.getFullYear() - 1, stage: 'prelims' };
}

/** True when the member filled in nothing (so "Skip and send" sends no profile at all). */
export function isEmpty(p: MenteeProfile): boolean {
  return (
    !p.exam &&
    !p.current_stage &&
    p.attempts_count == null &&
    !p.furthest_stage &&
    !(p.optional_subject ?? '').trim() &&
    !p.prep_mode &&
    !p.language &&
    !(p.help_with ?? []).length &&
    !(p.note ?? '').trim() &&
    !(p.attempts ?? []).length
  );
}

/** The payload for PUT /me/mentee-profile. */
export function toPayload(p: MenteeProfile): MenteeProfile {
  return {
    exam: p.exam ?? null,
    current_stage: p.current_stage ?? null,
    attempts_count: p.attempts_count ?? null,
    furthest_stage: p.furthest_stage ?? null,
    optional_subject: (p.optional_subject ?? '').trim() || null,
    prep_mode: p.prep_mode ?? null,
    language: p.language ?? null,
    help_with: p.help_with ?? [],
    note: (p.note ?? '').trim() || null,
    attempts: (p.attempts ?? []).map(cleanAttempt),
    marks_visibility: p.marks_visibility ?? 'mentors',
  };
}
