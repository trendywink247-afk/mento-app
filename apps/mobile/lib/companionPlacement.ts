/**
 * Where the companion is on a screen (founder ruling 2026-09-19, "the companion lives on the
 * screen" V2). NOT motion: on every ARRIVAL at a screen the member's companion is simply
 * already somewhere else — clinging to a card edge, a header corner, the tab bar — and it
 * stays there until they leave. This file is the choosing, nothing else.
 *
 * Pure and import-free on purpose (unit-tested from Node: `npm run test:placement`). The
 * rendering half is components/art/PerchedCompanion.tsx.
 *
 * The contract:
 *  1. A screen declares its slots. A slot is eligible only if the animal has ART for the
 *     slot's type (`available`) — a Fox has no "hang" painting, so a Fox never hangs. That is
 *     a data question (which pose files exist), so new art widens an animal's range with no
 *     change here.
 *  2. Never the slot used on the previous visit to that screen, when another is eligible.
 *  3. Weighted by the animal's personality (COMPANION_TASTE) and the slot's own weight.
 *  4. Deterministic for a given seed (a small LCG) — so it can be tested, and so one arrival
 *     can never flicker between two answers.
 *  5. `nap` slots exist only at night (the companion's sleepy window) — nobody naps at noon.
 *  6. Still states (error, crisis, limit) do not roll at all: the home slot, every time.
 */

/** How the companion holds on. `top` sits on an edge · `lean` rests against a side, curious ·
 * `nap` is asleep along an edge · `dangle` sits with its legs over the edge · `hang` hangs
 * under an edge by the paws · `peek` is head and paws over an edge. */
export type SlotType = 'top' | 'lean' | 'nap' | 'dangle' | 'hang' | 'peek';

/** Roughly where on the screen the furniture is — personality uses it (an Owl perches high,
 * a Turtle stays low). */
export type SlotLevel = 'high' | 'mid' | 'low';

export type PlacementSlot = {
  id: string;
  type: SlotType;
  /** The screen's own preference for this slot. Default 1. */
  weight?: number;
  level?: SlotLevel;
  /** The slot the companion holds in a still state. One per screen; defaults to the first. */
  home?: boolean;
};

/** The painterly pose each slot type is drawn with. A slot type is available to an animal
 * exactly when that animal has this pose file. */
export const SLOT_POSE = {
  top: 'idle',
  lean: 'curious',
  nap: 'sleepy',
  dangle: 'dangle',
  hang: 'hang',
  peek: 'peek',
} as const satisfies Record<SlotType, string>;

const SLOT_TYPES = Object.keys(SLOT_POSE) as SlotType[];

/** The slot types an animal can take, from the names of the pose files it has. */
export function slotTypesFor(poses: Iterable<string>): Set<SlotType> {
  const have = new Set(poses);
  return new Set(SLOT_TYPES.filter((type) => have.has(SLOT_POSE[type])));
}

export type AnimalTaste = {
  type?: Partial<Record<SlotType, number>>;
  level?: Partial<Record<SlotLevel, number>>;
};

/** Personality = slot weights per animal (ROAM_SPEC_V2 rule 7). A multiplier, never a gate:
 * every eligible slot keeps a real chance, so no animal is stuck in one place. Weights for a
 * type the animal has no art for are harmless — they start to matter the day the art lands. */
export const COMPANION_TASTE: Record<string, AnimalTaste> = {
  // Cat: edges and dangles.
  Cat: { type: { dangle: 3, peek: 2, hang: 1.5, top: 1 } },
  // Panda: hangs (from whatever will hold it); until that art exists, it lounges.
  Panda: { type: { hang: 3, lean: 1.5 } },
  // Fox: peeks; curious by nature.
  Fox: { type: { peek: 3, lean: 2 } },
  // Dog: sits low and close.
  Dog: { type: { top: 1.5 }, level: { low: 3, mid: 1.5, high: 0.5 } },
  // Capybara: naps near the tab bar.
  Capybara: { type: { nap: 4 }, level: { low: 2.5 } },
  // Owl: high perches.
  Owl: { type: { top: 1.5 }, level: { high: 3, mid: 1, low: 0.4 } },
  // Deer: top edges.
  Deer: { type: { top: 2.5, lean: 0.8 } },
  // Turtle: the lowest place there is.
  Turtle: { level: { low: 4, mid: 1, high: 0.3 } },
  // Elephant: peeks (over things it is much too big to hide behind).
  Elephant: { type: { peek: 3, top: 1.2 } },
};

export type PickInput = {
  /** Screen key — mixed into the seed so two screens never roll in lockstep. */
  screen: string;
  slots: readonly PlacementSlot[];
  animal: string | null;
  /** Slot types this animal has art for (see `slotTypesFor`). */
  available: ReadonlySet<SlotType>;
  /** Override the personality table (tests). */
  taste?: Record<string, AnimalTaste>;
  /** The slot used on the previous visit to this screen. */
  previous?: string | null;
  seed: number;
  /** The companion's sleepy window — the only time `nap` slots exist. */
  night?: boolean;
};

/** Slots the companion may take right now, in declaration order. */
export function eligibleSlots(
  slots: readonly PlacementSlot[],
  available: ReadonlySet<SlotType>,
  night = false,
): PlacementSlot[] {
  const seen = new Set<string>();
  return slots.filter((slot) => {
    if (seen.has(slot.id)) return false;
    seen.add(slot.id);
    if (!available.has(slot.type)) return false;
    if (slot.type === 'nap' && !night) return false;
    return (slot.weight ?? 1) > 0;
  });
}

/** The still-state slot: the one marked `home`, else the first eligible. Never random. */
export function homeSlot(
  slots: readonly PlacementSlot[],
  available: ReadonlySet<SlotType>,
  night = false,
): string | null {
  const eligible = eligibleSlots(slots, available, night);
  return (eligible.find((slot) => slot.home) ?? eligible[0])?.id ?? null;
}

function hash(text: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Numerical Recipes LCG; three turns so neighbouring seeds land far apart. → [0, 1). */
function roll(seed: number): number {
  let s = seed >>> 0;
  for (let i = 0; i < 3; i += 1) s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  // The low bits of an LCG are its weakest — fold the high half down before scaling.
  s = (s ^ (s >>> 16)) >>> 0;
  return s / 0x100000000;
}

function tasteWeight(slot: PlacementSlot, taste: AnimalTaste | undefined): number {
  const byType = taste?.type?.[slot.type] ?? 1;
  const byLevel = slot.level ? (taste?.level?.[slot.level] ?? 1) : 1;
  return (slot.weight ?? 1) * byType * byLevel;
}

/** One arrival: the chosen slot id, or null when the screen has nowhere this animal can be. */
export function pickSlot(input: PickInput): string | null {
  const eligible = eligibleSlots(input.slots, input.available, input.night);
  if (eligible.length === 0) return null;
  // Somewhere NEW whenever there is somewhere else to be.
  const fresh = eligible.filter((slot) => slot.id !== input.previous);
  const pool = fresh.length > 0 ? fresh : eligible;
  if (pool.length === 1) return pool[0].id;

  const taste = (input.taste ?? COMPANION_TASTE)[input.animal ?? ''];
  const weights = pool.map((slot) => Math.max(tasteWeight(slot, taste), 0.0001));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let at = roll((input.seed ^ hash(input.screen)) >>> 0) * total;
  for (let i = 0; i < pool.length; i += 1) {
    at -= weights[i];
    if (at < 0) return pool[i].id;
  }
  return pool[pool.length - 1].id;
}

// --- The running app: one seed per launch, a visit counter, the last slot per screen -------

let launchSeed = (Math.random() * 0x100000000) >>> 0;
let visits = 0;
const lastSlot = new Map<string, string>();

export type ArriveInput = Omit<PickInput, 'seed' | 'previous'> & {
  /** A still state (error, crisis, limit): the home slot, no roll, nothing remembered. */
  still?: boolean;
};

/** Call once per arrival at a screen (mount, focus, tab switch, coming back). */
export function arriveAt(input: ArriveInput): string | null {
  if (input.still) return homeSlot(input.slots, input.available, input.night);
  visits += 1;
  // Golden-ratio stride: consecutive visits are far apart in seed space.
  const seed = (launchSeed + Math.imul(visits, 0x9e3779b9)) >>> 0;
  const id = pickSlot({ ...input, seed, previous: lastSlot.get(input.screen) ?? null });
  if (id) lastSlot.set(input.screen, id);
  return id;
}

/** Where the companion was last placed on a screen (null = never, or forgotten). */
export function lastSlotOn(screen: string): string | null {
  return lastSlot.get(screen) ?? null;
}

/** A new identity (Start fresh, a new account) has no history of places. */
export function forgetPlacements(): void {
  lastSlot.clear();
}

/** Tests only: a fixed launch seed, visit counter and history reset. */
export function __setSeedForTests(seed: number): void {
  launchSeed = seed >>> 0;
  visits = 0;
  lastSlot.clear();
}
