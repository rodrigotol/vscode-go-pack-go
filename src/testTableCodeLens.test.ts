import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createTableTestCodeLensDescriptors,
  debugTableTestScenarioCommand,
  runTableTestScenarioCommand,
} from './testTableCodeLens';
import { detectTestTableScenarios } from './testTableDetector';

test('creates run and debug CodeLens descriptors for detected table scenarios', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

type testCase struct {
	name string
}

func TestCodeLens(t *testing.T) {
	tests := []testCase{
		{name: "first"},
		{name: "second"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {})
	}
}
`);

  const descriptors = createTableTestCodeLensDescriptors(
    'file:///workspace/example_test.go',
    result.scenarios,
  );

  assert.equal(descriptors.length, 4);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.title),
    ['run test', 'debug test', 'run test', 'debug test'],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.command),
    [
      runTableTestScenarioCommand,
      debugTableTestScenarioCommand,
      runTableTestScenarioCommand,
      debugTableTestScenarioCommand,
    ],
  );

  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.arguments[0].label),
    ['first', 'first', 'second', 'second'],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.arguments[0].uri),
    [
      'file:///workspace/example_test.go',
      'file:///workspace/example_test.go',
      'file:///workspace/example_test.go',
      'file:///workspace/example_test.go',
    ],
  );

  for (const descriptor of descriptors) {
    assert.deepEqual(descriptor.range.end, descriptor.range.start);
    assert.deepEqual(descriptor.range.start, descriptor.arguments[0].scenarioRange.start);
  }
});

test('creates no CodeLens descriptors when no scenarios are detected', () => {
  const descriptors = createTableTestCodeLensDescriptors('file:///workspace/example_test.go', []);

  assert.deepEqual(descriptors, []);
});
