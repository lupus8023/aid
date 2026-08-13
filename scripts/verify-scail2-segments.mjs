import assert from 'node:assert/strict';

function normalizedTotal(value) {
  const bounded = Math.max(1, Math.floor(value));
  return bounded - ((bounded - 1) % 4);
}

function segments(sourceFrames) {
  const total = normalizedTotal(sourceFrames);
  const count = total <= 81 ? 1 : 1 + Math.ceil((total - 81) / 76);
  return Array.from({ length: count }, (_, index) => Math.min(81, total - index * 76));
}

const cases = new Map([
  [17, [17]],
  [81, [81]],
  [82, [81]],
  [157, [81, 81]],
  [294, [81, 81, 81, 65]],
]);

for (const [sourceFrames, expected] of cases) {
  const actual = segments(sourceFrames);
  assert.deepEqual(actual, expected, `${sourceFrames} source frames`);
  const reconstructed = actual[0] + actual.slice(1).reduce((sum, frames) => sum + frames - 5, 0);
  assert.equal(reconstructed, normalizedTotal(sourceFrames), `${sourceFrames} reconstructed frames`);
}

console.log('SCAIL2 segment cases passed');
