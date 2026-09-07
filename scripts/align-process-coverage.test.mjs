import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { alignProcessBranches } from './align-process-coverage.mjs';
const { createCoverageMap } = createRequire(import.meta.url)('istanbul-lib-coverage');
function report(end, hits = [0, 0]) {
  const loc = { start: { line: 3, column: 2 }, end: { line: 5, column: end } };
  return {
    path: '/fixture.ts',
    statementMap: {},
    s: {},
    fnMap: {},
    f: {},
    branchMap: { 0: { type: 'if', loc, locations: [loc, { start: {}, end: {} }] } },
    b: { 0: hits },
  };
}
test('merges observed branch arms once despite differing mapped ends', () => {
  const unit = report(null),
    process = report(5, [2, 3]);
  const copy = structuredClone(process);
  const merged = createCoverageMap({ '/fixture.ts': unit });
  merged.addFileCoverage(alignProcessBranches(unit, process));
  assert.deepEqual(Object.values(merged.fileCoverageFor('/fixture.ts').b), [[2, 3]]);
  assert.deepEqual(process, copy);
});
test('sums unit and process evidence without inventing an unexecuted arm', () => {
  const unit = report(null, [4, 0]),
    process = report(5, [2, 0]);
  const merged = createCoverageMap({ '/fixture.ts': unit });
  merged.addFileCoverage(alignProcessBranches(unit, process));
  assert.deepEqual(Object.values(merged.fileCoverageFor('/fixture.ts').b), [[6, 0]]);
});
for (const difference of [
  'type',
  'start',
  'arms',
  'count',
  'unknown',
  'ambiguous-reference',
  'ambiguous-incoming',
]) {
  test(`keeps ${difference} mappings separate`, () => {
    const unit = report(null),
      process = report(5, [2, 3]);
    if (difference === 'type') process.branchMap[0].type = 'cond-expr';
    if (difference === 'start') process.branchMap[0].loc.start.column = 3;
    if (difference === 'arms') process.branchMap[0].locations.reverse();
    if (difference === 'count') process.b[0] = [2];
    if (difference === 'unknown') delete process.branchMap[0].loc.start.column;
    if (difference === 'ambiguous-reference') {
      unit.branchMap[1] = structuredClone(unit.branchMap[0]);
      unit.b[1] = [0, 0];
    }
    if (difference === 'ambiguous-incoming') {
      process.branchMap[1] = structuredClone(process.branchMap[0]);
      process.b[1] = [0, 0];
    }
    assert.deepEqual(alignProcessBranches(unit, process), process);
  });
}

test('matches implicit else arms before undefined positions are JSON serialized', () => {
  const unit = report(null),
    process = report(5, [2, 3]);
  unit.branchMap[0].locations[1] = {
    start: { line: undefined, column: undefined },
    end: { line: undefined, column: undefined },
  };
  const merged = createCoverageMap({ '/fixture.ts': unit });
  merged.addFileCoverage(alignProcessBranches(unit, process));
  assert.deepEqual(Object.values(merged.fileCoverageFor('/fixture.ts').b), [[2, 3]]);
});
