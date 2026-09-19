/**
 * The member's message allowance inside one conversation (DECISIONS §L.2, boards A05 / A22):
 * three in a row before the mentor writes, ten a day.
 *
 * `GET /conversations/{id}/allowance` is the source of truth. It is read on focus, after
 * every own send, when a mentor message arrives (the run resets) and after any send Stream
 * answers with `type: "error"` (a held message).
 *
 * The NOTE is decided from the COUNTS, not from `held_reason`: server-side holding ships
 * switched off (`enforced: false`, `held_reason` always null), and the member must still
 * meet the pause — the still note and the quiet send key — at three in a row or at the
 * daily limit. When the server does hold, its `held_reason` wins.
 *
 * Crisis exemption: never a note. Exempt = the server says so (`exempt`, optional — an
 * older server omits it) OR this thread carries a crisis-flagged message from within the
 * server's exempt window (the client sees the same `crisis` payload the card renders).
 * Urgent words are never held back, never counted, and never met with a limit.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type Allowance } from '@/lib/api';

export type AllowanceNoteReason = 'in_a_row' | 'daily';

/** The fast path on a held message: the custom field Stream hands back with it. */
export type HeldAllowance = Partial<
  Pick<Allowance, 'in_a_row' | 'in_a_row_limit' | 'left_today' | 'daily_limit' | 'resets_at'>
> & { held?: boolean; reason?: AllowanceNoteReason };

export type AllowanceView = {
  /** Null until the first answer (and if it never comes): no meter, no note — never guessed. */
  allowance: Allowance | null;
  /** Which pause the member is in right now, if any. */
  note: AllowanceNoteReason | null;
  /** Inside the crisis-exempt window: the meter says the last message was not counted. */
  exempt: boolean;
  refresh: () => Promise<Allowance | null>;
  /** Apply the `allowance` field of a held message at once, then re-read the endpoint. */
  applyHeld: (held: HeldAllowance | undefined) => Promise<Allowance | null>;
};

export function noteFor(allowance: Allowance | null, exempt: boolean): AllowanceNoteReason | null {
  if (!allowance || exempt) return null;
  if (allowance.held_reason) return allowance.held_reason;
  if (allowance.left_today <= 0) return 'daily';
  if (allowance.in_a_row >= allowance.in_a_row_limit) return 'in_a_row';
  return null;
}

export function useAllowance(conversationId: string | undefined, crisisRecent: boolean): AllowanceView {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<Allowance | null> => {
    if (!conversationId) return null;
    try {
      const next = await api.conversationAllowance(conversationId);
      if (alive.current) setAllowance(next);
      return next;
    } catch {
      // Stays still: the meter keeps whatever it last knew; it never blocks a send.
      return null;
    }
  }, [conversationId]);

  const applyHeld = useCallback(
    (held: HeldAllowance | undefined) => {
      if (held?.held && held.reason) {
        const reason = held.reason;
        setAllowance((prev) =>
          prev
            ? {
                ...prev,
                in_a_row: held.in_a_row ?? prev.in_a_row,
                in_a_row_limit: held.in_a_row_limit ?? prev.in_a_row_limit,
                left_today: held.left_today ?? prev.left_today,
                daily_limit: held.daily_limit ?? prev.daily_limit,
                resets_at: held.resets_at ?? prev.resets_at,
                can_send: false,
                held_reason: reason,
              }
            : prev,
        );
      }
      return refresh();
    },
    [refresh],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const exempt = allowance?.exempt === true || crisisRecent;
  return { allowance, note: noteFor(allowance, exempt), exempt, refresh, applyHeld };
}

/** The server's exempt window (ALLOWANCE_CRISIS_EXEMPT_HOURS default). Only used to read
 * the thread the way the server does; the server stays the judge of what is held. */
export const CRISIS_EXEMPT_MS = 24 * 60 * 60 * 1000;
