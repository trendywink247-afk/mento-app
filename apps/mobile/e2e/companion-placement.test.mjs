// Run: npm run test:placement
//  (= tsc lib/companionPlacement.ts --outDir .tmp-placement --module es2020 --target es2020 --skipLibCheck && node e2e/companion-placement.test.mjs)
// NOT a browser spec: a Node unit test of the pure slot choosing (lib/companionPlacement.ts).
import assert from 'node:assert/strict';
import {
  COMPANION_TASTE,
  SLOT_POSE,
  __setSeedForTests,
  arriveAt,
  eligibleSlots,
  homeSlot,
  lastSlotOn,
  pickSlot,
  slotTypesFor,
} from '../.tmp-placement/companionPlacement.js';

const ANIMALS = ['Panda', 'Dog', 'Cat', 'Fox', 'Capybara', 'Elephant', 'Turtle', 'Deer', 'Owl'];
const BASE_POSES = ['idle', 'greet', 'joy', 'comfort', 'curious', 'sleepy'];
// The art that exists today: only the Cat has the cling poses.
const POSES = Object.fromEntries(ANIMALS.map((a) => [a, a === 'Cat' ? [...BASE_POSES, 'hang', 'peek', 'dangle'] : BASE_POSES]));

// A screen with every kind of slot, shaped like the real ones.
const SCREEN = [
  { id: 'titleCorner', type: 'top', level: 'high', home: true },
  { id: 'cardLean', type: 'lean', level: 'mid' },
  { id: 'tabBarLeft', type: 'top', level: 'low' },
  { id: 'tabBarNap', type: 'nap', level: 'low' },
  { id: 'cardDangle', type: 'dangle', level: 'mid' },
  { id: 'cardHang', type: 'hang', level: 'mid' },
  { id: 'cardPeek', type: 'peek', level: 'low' },
];
const TYPE_OF = Object.fromEntries(SCREEN.map((s) => [s.id, s.type]));
const CLING = new Set(['dangle', 'hang', 'peek']);
const ARRIVALS = 2000;

// --- the pose table: a slot type is available exactly when its pose file exists -------------
assert.deepEqual(SLOT_POSE, { top: 'idle', lean: 'curious', nap: 'sleepy', dangle: 'dangle', hang: 'hang', peek: 'peek' });
assert.deepEqual([...slotTypesFor(POSES.Fox)].sort(), ['lean', 'nap', 'top']);
assert.deepEqual([...slotTypesFor(POSES.Cat)].sort(), ['dangle', 'hang', 'lean', 'nap', 'peek', 'top']);
assert.deepEqual([...slotTypesFor(['idle'])], ['top']);
assert.deepEqual([...slotTypesFor([])], []);
// every animal in the picker has a personality row
for (const animal of ANIMALS) assert.ok(COMPANION_TASTE[animal], `${animal} has no taste row`);

// --- 2,000 arrivals per animal, day and night ---------------------------------------------------
for (const night of [false, true]) {
  for (const animal of ANIMALS) {
    const available = slotTypesFor(POSES[animal]);
    const eligibleIds = new Set(eligibleSlots(SCREEN, available, night).map((s) => s.id));
    __setSeedForTests(0xc0ffee);
    const seen = new Map();
    let previous = null;
    for (let i = 0; i < ARRIVALS; i += 1) {
      const id = arriveAt({ screen: 'demo', slots: SCREEN, animal, available, night });
      assert.ok(id, `${animal}: arrival ${i} found no slot`);
      // only a slot this animal has art for — and naps only at night
      assert.ok(eligibleIds.has(id), `${animal}: took ineligible slot ${id}`);
      assert.ok(available.has(TYPE_OF[id]), `${animal}: took ${id} (${TYPE_OF[id]}) with no art for it`);
      if (animal !== 'Cat') assert.ok(!CLING.has(TYPE_OF[id]), `${animal} took a cling slot: ${id}`);
      if (!night) assert.notEqual(TYPE_OF[id], 'nap', `${animal} napped in daytime`);
      // never where it was on the previous visit
      assert.notEqual(id, previous, `${animal}: arrival ${i} repeated ${id}`);
      assert.equal(lastSlotOn('demo'), id);
      previous = id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    // personality weights, never gates: every eligible slot is actually visited
    for (const id of eligibleIds) assert.ok((seen.get(id) ?? 0) > 0, `${animal} (${night ? 'night' : 'day'}) never took ${id}`);
  }
}

// --- personality shows up in the counts ------------------------------------------------------------
function tally(animal, night = false) {
  const available = slotTypesFor(POSES[animal]);
  __setSeedForTests(7);
  const counts = {};
  for (let i = 0; i < ARRIVALS; i += 1) {
    const id = arriveAt({ screen: 'demo', slots: SCREEN, animal, available, night });
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
const cat = tally('Cat');
assert.ok(cat.cardDangle > cat.titleCorner, `Cat should dangle more than it sits: ${JSON.stringify(cat)}`);
const owl = tally('Owl');
assert.ok(owl.titleCorner > owl.tabBarLeft, `Owl should perch high: ${JSON.stringify(owl)}`);
const turtle = tally('Turtle');
assert.ok(turtle.tabBarLeft > turtle.titleCorner, `Turtle should stay low: ${JSON.stringify(turtle)}`);
const dog = tally('Dog');
assert.ok(dog.tabBarLeft > dog.titleCorner, `Dog should sit low: ${JSON.stringify(dog)}`);
const capybara = tally('Capybara', true);
assert.ok(
  capybara.tabBarNap > capybara.titleCorner && capybara.tabBarNap > capybara.cardLean,
  `Capybara should nap by the tab bar at night: ${JSON.stringify(capybara)}`,
);

// --- deterministic for a seed; different seeds differ ---------------------------------------------------
const foxTypes = slotTypesFor(POSES.Fox);
const once = (seed, previous = null) =>
  pickSlot({ screen: 'demo', slots: SCREEN, animal: 'Fox', available: foxTypes, previous, seed });
for (let seed = 0; seed < 200; seed += 1) assert.equal(once(seed), once(seed));
assert.ok(new Set(Array.from({ length: 200 }, (_, seed) => once(seed))).size > 1, 'every seed gave the same slot');
// the screen key is part of the roll: two screens do not move in lockstep
const lockstep = Array.from({ length: 200 }, (_, seed) =>
  pickSlot({ screen: 'a', slots: SCREEN, animal: 'Fox', available: foxTypes, seed }) ===
  pickSlot({ screen: 'b', slots: SCREEN, animal: 'Fox', available: foxTypes, seed }),
);
assert.ok(lockstep.includes(false), 'two screens always chose the same slot');
// same launch seed → the same walk
__setSeedForTests(42);
const walkA = Array.from({ length: 50 }, () => arriveAt({ screen: 'demo', slots: SCREEN, animal: 'Cat', available: slotTypesFor(POSES.Cat) }));
__setSeedForTests(42);
const walkB = Array.from({ length: 50 }, () => arriveAt({ screen: 'demo', slots: SCREEN, animal: 'Cat', available: slotTypesFor(POSES.Cat) }));
assert.deepEqual(walkA, walkB);

// --- edges -------------------------------------------------------------------------------------------------
// one slot only: it is used again (there is nowhere else)
assert.equal(once(1, 'x'), once(1, 'x'));
assert.equal(pickSlot({ screen: 's', slots: [SCREEN[0]], animal: 'Fox', available: foxTypes, previous: 'titleCorner', seed: 3 }), 'titleCorner');
// two slots: strict alternation
__setSeedForTests(9);
const two = [SCREEN[0], SCREEN[1]];
const alt = Array.from({ length: 10 }, () => arriveAt({ screen: 'two', slots: two, animal: 'Deer', available: foxTypes }));
for (let i = 1; i < alt.length; i += 1) assert.notEqual(alt[i], alt[i - 1]);
// nowhere to be: null, not a crash
assert.equal(pickSlot({ screen: 's', slots: [], animal: 'Fox', available: foxTypes, seed: 1 }), null);
assert.equal(pickSlot({ screen: 's', slots: [{ id: 'h', type: 'hang' }], animal: 'Fox', available: foxTypes, seed: 1 }), null);
assert.equal(pickSlot({ screen: 's', slots: SCREEN, animal: 'Fox', available: new Set(), seed: 1 }), null);
// an unknown animal (or none chosen yet) still gets a place — neutral taste
assert.ok(pickSlot({ screen: 's', slots: SCREEN, animal: null, available: foxTypes, seed: 1 }));
assert.ok(pickSlot({ screen: 's', slots: SCREEN, animal: 'Dragon', available: foxTypes, seed: 1 }));
// a zero-weight slot is switched off; a duplicate id counts once
assert.deepEqual(
  eligibleSlots([{ id: 'a', type: 'top', weight: 0 }, { id: 'b', type: 'top' }, { id: 'b', type: 'lean' }], foxTypes).map((s) => s.id),
  ['b'],
);

// --- still states: the home slot, no roll, nothing remembered ------------------------------------------
__setSeedForTests(5);
const moved = arriveAt({ screen: 'still', slots: SCREEN, animal: 'Cat', available: slotTypesFor(POSES.Cat) });
for (let i = 0; i < 50; i += 1) {
  assert.equal(arriveAt({ screen: 'still', slots: SCREEN, animal: 'Cat', available: slotTypesFor(POSES.Cat), still: true }), 'titleCorner');
}
assert.equal(lastSlotOn('still'), moved, 'a still state must not rewrite where the companion last was');
assert.equal(homeSlot(SCREEN, foxTypes), 'titleCorner');
assert.equal(homeSlot([SCREEN[1], SCREEN[2]], foxTypes), 'cardLean', 'no home marked → the first eligible');
assert.equal(homeSlot([{ id: 'h', type: 'hang', home: true }, SCREEN[2]], foxTypes), 'tabBarLeft', 'a home the animal has no art for is skipped');
assert.equal(homeSlot([], foxTypes), null);

console.log(`companion-placement: PASS (${ARRIVALS} arrivals × ${ANIMALS.length} animals × day/night, invariants held)`);
