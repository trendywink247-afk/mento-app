/**
 * First-question builder (DECISIONS §L.8, board X07b) — the pure logic, no React, no
 * imports: which chips a community is offered, how a tap changes the choice, and how a
 * starter plus optional clauses become ONE clean first message.
 *
 * Kept import-free on purpose so `npm run test:question` can compile this single file
 * with plain `tsc` and run e2e/question-builder.test.mjs against it (same wiring as
 * lib/notificationRoute.ts). Words never live here: the screen hands in clauses that
 * are already translated — each one a FULL clause in its own language, so Hindi is
 * never English grammar with Hindi words poured in — plus that language's joiners.
 *
 * This module only ever produces TEXT. Nothing here sends anything: the screen hands
 * the text to the chat composer through the existing `?starter=` contract and the
 * member presses Send themselves.
 */

/** The longest a first message may be. Mirrors the server's request-intro limit —
 * `intro_message: ... Field(max_length=160)` on `MatchRequest` and `PersonalRequestIn`
 * in services/api/app/schemas.py — so a built question always fits a request intro. */
export const QUESTION_MAX_CHARS = 160;

export type AttemptId = 'first' | 'second' | 'third';
export type TriedId = 'break' | 'prep' | 'none';
export type ChipId = AttemptId | 'working' | TriedId;

export type BuilderChoice = {
  /** Exclusive: at most one attempt. */
  attempt: AttemptId | null;
  /** Independent toggle, sits beside any attempt. */
  working: boolean;
  /** Exclusive: at most one. */
  tried: TriedId | null;
};

export const EMPTY_CHOICE: BuilderChoice = { attempt: null, working: false, tried: null };

const ATTEMPTS: readonly AttemptId[] = ['first', 'second', 'third'];
const TRIED: readonly TriedId[] = ['break', 'prep', 'none'];

/** Communities whose road is an exam — attempts and "working alongside" only mean
 * something there. Slugs from services/api/app/services/paths_data.py. */
const EXAM_COMMUNITIES: readonly string[] = ['upsc', 'neet', 'jee', 'exams'];
/** Only UPSC has an interview stage to prepare for. */
const INTERVIEW_COMMUNITIES: readonly string[] = ['upsc'];

/** The chips a community is offered. A chip that would be untrue for the member's road
 * is simply not there (no "second attempt" on the Life path); an unknown community
 * gets only the chips that are true for anyone. A group with no chips is not shown. */
export function chipsFor(community: string | null | undefined): { where: ChipId[]; tried: ChipId[] } {
  const exam = !!community && EXAM_COMMUNITIES.includes(community);
  const interview = !!community && INTERVIEW_COMMUNITIES.includes(community);
  return {
    where: exam ? [...ATTEMPTS, 'working'] : [],
    tried: TRIED.filter((id) => id !== 'prep' || interview),
  };
}

/** One tap on a chip. Attempts are exclusive, tried is exclusive, working is its own
 * switch — and any chip that is on can be tapped off again. */
export function toggleChip(choice: BuilderChoice, id: ChipId): BuilderChoice {
  if (id === 'working') return { ...choice, working: !choice.working };
  if ((ATTEMPTS as readonly string[]).includes(id)) {
    return { ...choice, attempt: choice.attempt === id ? null : (id as AttemptId) };
  }
  return { ...choice, tried: choice.tried === id ? null : (id as TriedId) };
}

export function isChipOn(choice: BuilderChoice, id: ChipId): boolean {
  return id === 'working' ? choice.working : choice.attempt === id || choice.tried === id;
}

/** The chosen chips in the order their clauses are spoken: where I am (attempt, then
 * working), then what I've tried. Chips the community is not offered never speak. */
export function chosenChips(choice: BuilderChoice, community: string | null | undefined): ChipId[] {
  const offered = chipsFor(community);
  const allowed = new Set<ChipId>([...offered.where, ...offered.tried]);
  const order: (ChipId | null)[] = [choice.attempt, choice.working ? 'working' : null, choice.tried];
  return order.filter((id): id is ChipId => id !== null && allowed.has(id));
}

/** A language's joiners, handed in by the screen from the locale files. */
export type QuestionGrammar = {
  /** Between clauses in a list: ", ". */
  joinList: string;
  /** Before the last clause: ", and " (EN) · " और " (HI). */
  joinLast: string;
  /** Sentence stop: "." (EN) · "।" (HI). */
  stop: string;
};

export type AssembledQuestion = {
  text: string;
  /** Length in code points — what the server's `max_length` counts. */
  length: number;
  /** Clauses that made it in. */
  used: number;
  /** Clauses left out so the message fits (always the last ones, never a cut word). */
  dropped: number;
  /** True only when the STARTER alone is already over the limit (nothing to drop). */
  overLimit: boolean;
};

const TERMINAL = /[.?!।…]["'”’)\]]?$/;

function codePoints(s: string): number {
  return Array.from(s).length;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function capitalise(s: string): string {
  const [first = '', ...rest] = Array.from(s);
  return first.toLocaleUpperCase() + rest.join('');
}

function compose(starter: string, clauses: string[], g: QuestionGrammar): string {
  if (clauses.length === 0) return starter;
  const tail =
    clauses.length === 1
      ? clauses[0]
      : clauses.slice(0, -1).join(g.joinList) + g.joinLast + clauses[clauses.length - 1];
  return `${starter} ${capitalise(tail)}${g.stop}`.trim();
}

/** Starter + optional clauses → one clean sentence pair.
 *  - whitespace collapsed; a starter with no end punctuation gets the language's stop;
 *  - clauses are joined as a list ("A, B, and C") and closed with one stop, whatever
 *    punctuation they arrived with;
 *  - if the whole would run past `max`, the LAST clause is dropped (then the next)
 *    rather than cutting mid-word. The starter itself is never shortened. */
export function assembleQuestion(
  starter: string,
  clauses: readonly string[],
  grammar: QuestionGrammar,
  max: number = QUESTION_MAX_CHARS,
): AssembledQuestion {
  let lead = tidy(starter);
  if (lead && !TERMINAL.test(lead)) lead += grammar.stop;
  const clean = clauses.map((c) => tidy(c).replace(/[.?!।…,;:]+$/, '')).filter((c) => c.length > 0);

  for (let used = clean.length; used >= 0; used--) {
    const text = compose(lead, clean.slice(0, used), grammar);
    const length = codePoints(text);
    if (length <= max || used === 0) {
      return { text, length, used, dropped: clean.length - used, overLimit: length > max };
    }
  }
  // Unreachable: the loop always returns at used === 0.
  return { text: lead, length: codePoints(lead), used: 0, dropped: clean.length, overLimit: codePoints(lead) > max };
}
