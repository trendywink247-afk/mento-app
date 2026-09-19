/**
 * PerchedCompanion — the member's companion, holding on to the UI (founder ruling
 * 2026-09-19: "naturally appearing at random places, screen after screen, and staying
 * there"). The choosing is lib/companionPlacement.ts; this is the rendering.
 *
 * How a screen uses it:
 *
 *   const perch = useCompanionPlacement('journal', SLOTS, { still: failed });
 *   <CompanionPerches placement={perch}>
 *     …
 *     <View>                                   ← the real card / row / bar
 *       <CompanionSlot id="todayTopRight" inset={space.md} size={64} />
 *       <EdgeSurface>…</EdgeSurface>
 *     </View>
 *   </CompanionPerches>
 *
 * Every slot is an absolutely-positioned CHILD OF THE FURNITURE it clings to, so its
 * geometry is relative to that card on every phone size and inside the desktop web frame —
 * never window coordinates. Exactly one slot per screen draws the companion (the one the
 * hook chose on this arrival); every other slot renders nothing. A screen that already
 * showed the companion in a fixed place declares that place as a slot too (`flow`), so
 * there are never two.
 *
 * It is simply THERE when the screen arrives: no travel, no entrance beyond a ≤200 ms
 * opacity fade (none under reduced motion), then the breathing idle (off under reduced
 * motion). Placement itself is not motion, so reduced motion keeps it. Decorative: it never
 * takes a tap (`pointerEvents="none"`, unless a `flow` home slot opts into the tap-react it
 * already had) and is hidden from assistive tech.
 *
 * Pose follows the slot type (SLOT_POSE): top → idle · lean → curious · nap → sleepy ·
 * dangle / hang / peek → the cling art, for the animals that have it. Rendering goes through
 * components/art/Companion — the single entry point for companion art.
 */
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { COMPANION_GENERATED, COMPANION_GROUND, type CompanionPose } from '@/assets/companions/generated';
import { Companion, type CompanionTrigger } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { isSleepyHour } from '@/components/art/ReactiveCompanion';
import { useBreathing } from '@/components/motion/useBreathing';
import {
  SLOT_POSE,
  arriveAt,
  eligibleSlots,
  homeSlot,
  slotTypesFor,
  type PlacementSlot,
} from '@/lib/companionPlacement';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';

/** A perched companion is small: it shares the screen, it does not own it. */
export const PERCH_MAX_SIZE = 72;
/** Sit INTO the edge by a hair — a companion resting exactly on a line reads as floating. */
const SEAT_SINK = 1;

export type CompanionPlacement = {
  screen: string;
  /** The slot drawing the companion right now; null = nowhere (not chosen yet, or hidden). */
  slotId: string | null;
  slot: PlacementSlot | null;
  animal: CompanionAnimal | null;
  /** A still state: home slot, sit pose. */
  still: boolean;
};

function resolveAnimal(animal: CompanionAnimal | null): CompanionAnimal {
  return animal && animal in COMPANION_GENERATED ? animal : 'Panda';
}

/**
 * Picks ONE slot on every arrival at the screen (mount, tab switch, coming back) and keeps
 * it until the next arrival. `slots` is the list that exists RIGHT NOW — a screen leaves out
 * furniture that is not mounted; if the chosen slot's furniture goes away the companion
 * finds another place, otherwise nothing moves it.
 */
export function useCompanionPlacement(
  screen: string,
  slots: readonly PlacementSlot[],
  options: {
    /** Error / crisis / limit: the home slot in the sit pose, no roll (T&S #11 — still). */
    still?: boolean;
    /** Quiet Pause / Away Mask / a sheet over the screen: not drawn at all. */
    hidden?: boolean;
  } = {},
): CompanionPlacement {
  const { still = false, hidden = false } = options;
  const stored = useCompanionAnimal(); // undefined while the read is in flight
  const known = stored !== undefined;
  const animal = stored ?? null;
  const resolved = resolveAnimal(animal);
  // Which slot types this animal can take = which pose files it has. Data, not code.
  const available = useMemo(
    () => slotTypesFor(Object.keys(COMPANION_GENERATED[resolved].poses)),
    [resolved],
  );

  const [arrivals, setArrivals] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setArrivals((n) => n + 1);
    }, []),
  );

  const night = isSleepyHour();
  const eligible = eligibleSlots(slots, available, night);
  const eligibleKey = eligible.map((slot) => slot.id).join('|');
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const [chosen, setChosen] = useState<string | null>(null);
  const rolledFor = useRef(0);
  useEffect(() => {
    if (!known || arrivals === 0) return;
    const ids = eligibleKey ? eligibleKey.split('|') : [];
    const arrived = rolledFor.current !== arrivals;
    // Between arrivals it STAYS — unless the furniture it was on is gone.
    if (!arrived && chosen !== null && ids.includes(chosen)) return;
    if (!arrived && chosen === null && ids.length === 0) return;
    rolledFor.current = arrivals;
    setChosen(arriveAt({ screen, slots: slotsRef.current, animal: resolved, available, night }));
    // reason: `chosen` is read, not a trigger — re-running on it would re-roll in a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivals, known, eligibleKey, screen, resolved, available, night]);

  // Dev builds only: pin a screen's slot to look at it (`globalThis.__MENTO_PERCH__ =
  // { journal: 'todayHang' }` before the screen mounts). Ignored unless that slot is eligible.
  const pinned = __DEV__
    ? (globalThis as { __MENTO_PERCH__?: Record<string, string> }).__MENTO_PERCH__?.[screen]
    : undefined;
  const rolled = pinned && eligible.some((s) => s.id === pinned) ? pinned : chosen;
  const slotId = hidden || !known ? null : still ? homeSlot(slots, available, night) : rolled;
  const slot = slotId ? (eligible.find((s) => s.id === slotId) ?? null) : null;

  return useMemo(
    () => ({ screen, slotId: slot ? slotId : null, slot, animal, still }),
    // reason: `slot` is derived from slotId + eligibleKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screen, slotId, eligibleKey, animal, still],
  );
}

/** How far a companion on a `top` slot stands ABOVE the edge it sits on (px) — the room a
 * list resting on that edge must keep free so its last row is never under the art (the
 * chat's composer seat, A05 / A22). Mirrors Perched's `vertical` for a `top` slot. */
export function perchRise(animal: CompanionAnimal | null, size: number, nudge = 0): number {
  const set = COMPANION_GENERATED[resolveAnimal(animal)];
  const box = Math.min(size, PERCH_MAX_SIZE);
  return Math.max(0, (set.ground ?? COMPANION_GROUND) * box - SEAT_SINK - nudge);
}

const PerchContext = createContext<CompanionPlacement | null>(null);

/** Hands a screen's placement to the slots inside it. */
export function CompanionPerches({
  placement,
  children,
}: {
  placement: CompanionPlacement;
  children: React.ReactNode;
}) {
  return <PerchContext.Provider value={placement}>{children}</PerchContext.Provider>;
}

type SlotProps = {
  /** Must match an id in the screen's slot list. */
  id: string;
  /** Art box side in px (the visible animal is ~0.89 of it). Perches cap at 72. */
  size?: number;
  /** Which side of the furniture it keeps to, and how far in from that side. */
  align?: 'left' | 'right' | 'center';
  inset?: number;
  /** `edge` (default): ON the furniture's top edge — or under its bottom edge for `hang`.
   * `floor`: standing INSIDE the wrapper, feet on its bottom line (an empty header corner). */
  attach?: 'edge' | 'floor';
  /** Fine vertical nudge in px (positive = down). */
  nudge?: number;
  /** In-flow instead of absolute — for a place the screen ALREADY gave the companion. The
   * pose is left to Companion (rest / trigger), and the size cap does not apply. */
  flow?: boolean;
  /** With `flow`: keep the box when the companion is elsewhere, so the layout never shifts. */
  reserve?: boolean;
  /** Reactions happen in place (rule 4): a small joy, a greet. `flow` slots only. */
  trigger?: CompanionTrigger;
  /** The tap-react a `flow` home slot already had. Everything else never takes a tap. */
  interactive?: boolean;
};

/** One possible place. Draws the companion only when this arrival chose it. */
export function CompanionSlot(props: SlotProps) {
  const placement = useContext(PerchContext);
  const { id, flow = false, reserve = false, size = 56 } = props;
  if (!placement || placement.slotId !== id || !placement.slot) {
    return flow && reserve ? <View style={{ width: size, height: size }} /> : null;
  }
  return <Perched {...props} placement={placement} slot={placement.slot} />;
}

function Perched({
  id,
  size: wanted = 56,
  align = 'right',
  inset = 0,
  attach = 'edge',
  nudge = 0,
  flow = false,
  trigger = null,
  interactive = false,
  placement,
  slot,
}: SlotProps & { placement: CompanionPlacement; slot: PlacementSlot }) {
  const reduced = useReducedMotion();
  const size = flow ? wanted : Math.min(wanted, PERCH_MAX_SIZE);
  const animal = resolveAnimal(placement.animal);
  const set = COMPANION_GENERATED[animal];

  // Still states sit; otherwise the pose is the slot's. A `flow` home keeps Companion's own
  // rest / trigger poses (it had them before it became a slot).
  const pose: CompanionPose | undefined = placement.still ? 'idle' : flow ? undefined : SLOT_POSE[slot.type];
  const poseName = pose ?? 'rest';

  // Simply there: a short opacity fade on a manual shared value, nothing else. None under
  // reduced motion (and if the preference resolves late, the fade is cut short, not replayed).
  const opacity = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    opacity.value = reduced ? 1 : withTiming(1, { duration: duration.fast, easing: easing.enter });
  }, [reduced, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const breathStyle = useBreathing(true); // off under reduced motion, inside the hook

  const body = (
    <Animated.View style={fadeStyle}>
      <Animated.View style={breathStyle} testID="companion-breath">
        <View testID={`companion-art-${animal}-${poseName}`}>
          <Companion
            animal={placement.animal}
            size={size}
            pose={pose}
            trigger={flow ? trigger : null}
            interactive={flow && interactive}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );

  const decorative = {
    pointerEvents: flow && interactive ? ('box-none' as const) : ('none' as const),
    accessibilityElementsHidden: !(flow && interactive),
    importantForAccessibility: flow && interactive ? ('auto' as const) : ('no-hide-descendants' as const),
    'aria-hidden': !(flow && interactive),
  };

  if (flow) {
    return (
      <View testID={`companion-slot-${id}`} style={{ width: size, height: size }} {...decorative}>
        {body}
      </View>
    );
  }

  // Where the art touches the furniture, as a fraction of its square box from the top.
  const cling = slot.type === 'hang' || slot.type === 'peek' || slot.type === 'dangle' ? slot.type : null;
  const contact = cling ? (set.contact?.[cling] ?? (cling === 'hang' ? 0 : 1)) : (set.ground ?? COMPANION_GROUND);

  let vertical: ViewStyle;
  if (attach === 'floor') {
    vertical = { bottom: -(1 - contact) * size - SEAT_SINK + -nudge };
  } else if (slot.type === 'hang') {
    // Under the furniture: the paws (the art's top edge) meet its bottom edge.
    vertical = { top: '100%' as DimensionValue, marginTop: -contact * size - SEAT_SINK + nudge };
  } else {
    vertical = { top: -contact * size + SEAT_SINK + nudge };
  }
  const horizontal: ViewStyle =
    align === 'center'
      ? { left: '50%' as DimensionValue, marginLeft: -size / 2 + inset }
      : align === 'left'
        ? { left: inset }
        : { right: inset };

  return (
    <View
      testID={`companion-slot-${id}`}
      style={[{ position: 'absolute', width: size, height: size, zIndex: 3 }, vertical, horizontal]}
      {...decorative}
    >
      {body}
    </View>
  );
}
