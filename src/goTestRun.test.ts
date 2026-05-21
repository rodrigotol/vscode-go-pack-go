import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGoTestRunPattern } from './goTestRun';

test('creates an exact Go test run pattern for a subtest', () => {
  assert.equal(createGoTestRunPattern('TestThing', 'first'), '^TestThing$/^first$');
});

test('sanitizes whitespace in subtest names the way Go test names do', () => {
  assert.equal(createGoTestRunPattern('TestThing', 'first case'), '^TestThing$/^first_case$');
});

test('escapes regular expression characters in test and subtest names', () => {
  assert.equal(
    createGoTestRunPattern('TestThing', 'value (1)+'),
    '^TestThing$/^value_\\(1\\)\\+$',
  );
});

test('preserves slash-separated subtest name hierarchy', () => {
  assert.equal(
    createGoTestRunPattern('TestThing', 'group/first case'),
    '^TestThing$/^group$/^first_case$',
  );
});
