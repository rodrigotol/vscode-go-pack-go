import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectTestTableScenarios } from './testTableDetector';

test('detects slice table scenarios with positional and keyed labels', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

type testCase struct {
	name string
	args args
	want int
}

type args struct {
	a int
	b int
}

func TestAdd(t *testing.T) {
	tests := []testCase{
		{"positive numbers", args{a: 1, b: 2}, 3},
		{
			type: "negative numbers",
			args: args{
				a: -1,
				b: -2,
			},
			want: -3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.type, func(t *testing.T) {})
	}
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.label),
    ['positive numbers', 'negative numbers'],
  );
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.testName),
    ['TestAdd', 'TestAdd'],
  );
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.tableName),
    ['tests', 'tests'],
  );
});

test('detects map table scenarios from range key labels', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

type testCase struct {
	value int
}

func TestLookup(t *testing.T) {
	tests := map[string]testCase{
		"first": {value: 1},
		"second": {value: 2},
	}

	for name, tt := range tests {
		_ = tt
		t.Run(name, func(t *testing.T) {})
	}
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.label),
    ['first', 'second'],
  );
});

test('resolves nearest in-function table declaration used by t.Run range loop', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

type testCase struct {
	name string
}

func TestNearest(t *testing.T) {
	tests := []testCase{
		{name: "unused shadowed table"},
	}
	_ = tests

	other, tests := 1, []testCase{
		{name: "used table"},
	}
	_ = other

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {})
	}
}
`);

  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.label),
    ['used table'],
  );
});

test('ignores table-like literals not connected to a t.Run range loop', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

type testCase struct {
	name string
}

func TestIgnored(t *testing.T) {
	tests := []testCase{
		{name: "unused"},
	}
	_ = tests

	for _, value := range []int{1, 2} {
		_ = value
	}
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(result.scenarios, []);
});

test('ignores non-Test functions', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

type testCase struct {
	name string
}

func BenchmarkThing(t *testing.T) {
	tests := []testCase{
		{name: "benchmark"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {})
	}
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(result.scenarios, []);
});

test('returns no scenarios for malformed in-progress source', async () => {
  const result = await detectTestTableScenarios(`package p

import "testing"

func TestBroken(t *testing.T) {
	tests := []struct { name string }{
		{name: "broken"},

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {})
	}
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, true);
  assert.deepEqual(result.scenarios, []);
});
