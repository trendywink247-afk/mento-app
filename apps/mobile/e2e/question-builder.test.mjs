// Run: npm run test:question
//  (= tsc lib/questionBuilder.ts --outDir .tmp-question --module es2020 --target es2020 --skipLibCheck && node e2e/question-builder.test.mjs)
// NOT a browser spec: a Node unit test of the pure first-question assembly (lib/questionBuilder.ts).
import assert from 'node:assert/strict';
import {
  EMPTY_CHOICE,
  QUESTION_MAX_CHARS,
  assembleQuestion,
  chipsFor,
  chosenChips,
  isChipOn,
  toggleChip,
} from '../.tmp-question/questionBuilder.js';

const EN = { joinList: ', ', joinLast: ', and ', stop: '.' };
const HI = { joinList: ', ', joinLast: ' और ', stop: '।' };
const STARTER = 'I keep recalculating my marks.';
const SECOND = 'this was my second attempt';
const WORKING = "I'm working alongside";
const PREP = "I've started interview prep";

// --- the limit is the server's request-intro limit -------------------------------
assert.equal(QUESTION_MAX_CHARS, 160);

// --- assembly: punctuation, capitalisation, list joining --------------------------
assert.equal(assembleQuestion(STARTER, [], EN).text, STARTER);
assert.equal(assembleQuestion(STARTER, [SECOND], EN).text, `${STARTER} This was my second attempt.`);
assert.equal(
  assembleQuestion(STARTER, [SECOND, PREP], EN).text,
  `${STARTER} This was my second attempt, and I've started interview prep.`,
);
assert.equal(
  assembleQuestion(STARTER, [SECOND, WORKING, PREP], EN).text,
  `${STARTER} This was my second attempt, I'm working alongside, and I've started interview prep.`,
);
// a starter with no end punctuation gets one; a question keeps its own mark
assert.equal(assembleQuestion('What did you do after mains', [SECOND], EN).text, 'What did you do after mains. This was my second attempt.');
assert.equal(assembleQuestion('What did you do after mains?', [SECOND], EN).text, 'What did you do after mains? This was my second attempt.');
// messy input: whitespace collapsed, stray clause punctuation never doubles up, empties skipped
assert.equal(
  assembleQuestion('  I keep   recalculating my marks. ', [' this was my second attempt. ', '', "I've started interview prep,"], EN).text,
  `${STARTER} This was my second attempt, and I've started interview prep.`,
);
// deterministic: same input, same output
assert.deepEqual(assembleQuestion(STARTER, [SECOND, PREP], EN), assembleQuestion(STARTER, [SECOND, PREP], EN));

// --- Hindi: full clauses, its own joiner and stop — no English grammar ------------
const hi = assembleQuestion(STARTER, ['यह मेरा दूसरा प्रयास था', 'साथ में मेरी नौकरी भी चल रही है', 'मैंने इंटरव्यू की तैयारी शुरू कर दी है'], HI);
assert.equal(hi.text, `${STARTER} यह मेरा दूसरा प्रयास था, साथ में मेरी नौकरी भी चल रही है और मैंने इंटरव्यू की तैयारी शुरू कर दी है।`);
assert.ok(!hi.text.includes(' and '));
assert.equal(hi.length, Array.from(hi.text).length); // code points, as the server counts

// --- the 160 limit: drop the LAST clause, never cut a word -------------------------
const long = 'I have been turning this over for weeks and I still cannot tell whether the plan I made is one I believe in.';
const fits = assembleQuestion(long, [SECOND, WORKING, PREP], EN);
assert.ok(fits.length <= 160, `assembled text is ${fits.length} chars`);
assert.equal(fits.used, 1);
assert.equal(fits.dropped, 2);
assert.equal(fits.overLimit, false);
assert.equal(fits.text, `${long} This was my second attempt.`); // whole clauses only
for (const n of [0, 1, 2, 3]) {
  const r = assembleQuestion(STARTER, [SECOND, WORKING, PREP].slice(0, n), EN);
  assert.ok(r.length <= 160);
  assert.equal(r.used + r.dropped, n);
}
// exactly at the limit is allowed; one over drops the clause
const at = assembleQuestion('x'.repeat(100) + '.', ['y'.repeat(57)], EN); // 101 + 1 + 57 + 1 = 160
assert.equal(at.length, 160);
assert.equal(at.dropped, 0);
assert.equal(assembleQuestion('x'.repeat(100) + '.', ['y'.repeat(58)], EN).dropped, 1);
// a starter that is itself too long is never shortened — it is reported, not cut
const over = assembleQuestion('z'.repeat(170) + '.', [SECOND], EN);
assert.equal(over.text, 'z'.repeat(170) + '.');
assert.equal(over.overLimit, true);
assert.equal(over.dropped, 1);

// --- chips: only what is true for the member's road --------------------------------
assert.deepEqual(chipsFor('upsc'), { where: ['first', 'second', 'third', 'working'], tried: ['break', 'prep', 'none'] });
assert.deepEqual(chipsFor('neet'), { where: ['first', 'second', 'third', 'working'], tried: ['break', 'none'] });
assert.deepEqual(chipsFor('life'), { where: [], tried: ['break', 'none'] });
assert.deepEqual(chipsFor(null), { where: [], tried: ['break', 'none'] });

// --- toggling: attempts exclusive, working independent, tried exclusive, all can turn off
let c = toggleChip(EMPTY_CHOICE, 'first');
c = toggleChip(c, 'second');
assert.deepEqual(c, { attempt: 'second', working: false, tried: null });
c = toggleChip(c, 'working');
assert.deepEqual(c, { attempt: 'second', working: true, tried: null });
c = toggleChip(c, 'break');
c = toggleChip(c, 'prep');
assert.deepEqual(c, { attempt: 'second', working: true, tried: 'prep' });
assert.ok(isChipOn(c, 'second') && isChipOn(c, 'working') && isChipOn(c, 'prep') && !isChipOn(c, 'first') && !isChipOn(c, 'break'));
assert.deepEqual(chosenChips(c, 'upsc'), ['second', 'working', 'prep']); // spoken order
assert.deepEqual(chosenChips(c, 'life'), []); // chips a road is not offered never speak
c = toggleChip(toggleChip(toggleChip(c, 'second'), 'working'), 'prep');
assert.deepEqual(c, EMPTY_CHOICE);
assert.deepEqual(toggleChip(EMPTY_CHOICE, 'first'), { attempt: 'first', working: false, tried: null }); // pure: input untouched
assert.deepEqual(EMPTY_CHOICE, { attempt: null, working: false, tried: null });

console.log('QUESTION BUILDER TEST PASSED');
