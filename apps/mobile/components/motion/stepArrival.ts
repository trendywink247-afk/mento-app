/**
 * How the step an `Entrance` lives in is arriving (board T01 / T02). StepTransition
 * provides it per layer; outside a step flow the default applies and Entrance behaves as
 * it always has (rise 16px from below, delay = index × stagger).
 *
 *  - `enter`   the first step of a flow, reached from another route (landing → role fork)
 *  - `forward` the next step: pieces rise from below, after the old step has left
 *  - `back`    the previous step: the exact reverse — pieces come down from above
 */
import { createContext } from 'react';

export type StepArrival = {
  kind: 'enter' | 'forward' | 'back';
  /** Added to every Entrance delay: the old step is gone by then (ms). */
  delay: number;
  /** How far a piece travels (px); undefined = the Entrance's own distance. */
  travel?: number;
};

export const StepArrivalContext = createContext<StepArrival>({ kind: 'enter', delay: 0 });
