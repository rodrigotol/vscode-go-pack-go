import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectTypeImplementations } from './typeImplementationDetector';

test('detects a single struct declaration', async () => {
  const result = await detectTypeImplementations(`package p

type Person struct {
	Name string
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(result.declarations, [
    {
      kind: 'struct',
      typeName: 'Person',
      declarationRange: {
        start: { line: 2, character: 5 },
        end: { line: 4, character: 1 },
      },
      identifierPosition: { line: 2, character: 5 },
    },
  ]);
});

test('detects a single interface declaration', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read(p []byte) (n int, err error)
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(result.declarations, [
    {
      kind: 'interface',
      typeName: 'Reader',
      declarationRange: {
        start: { line: 2, character: 5 },
        end: { line: 4, character: 1 },
      },
      identifierPosition: { line: 2, character: 5 },
    },
  ]);
});

test('detects mixed struct and interface declarations in one file', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)
}

type Person struct {
	Name string
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.declarations.map((declaration) => ({
      kind: declaration.kind,
      typeName: declaration.typeName,
    })),
    [
      { kind: 'interface', typeName: 'Reader' },
      { kind: 'struct', typeName: 'Person' },
    ],
  );
});

test('detects generic struct and interface declarations', async () => {
  const result = await detectTypeImplementations(`package p

type Box[T any] struct {
	Value T
}

type Reader[T any] interface {
	Read(T) error
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.declarations.map((declaration) => ({
      kind: declaration.kind,
      typeName: declaration.typeName,
    })),
    [
      { kind: 'struct', typeName: 'Box' },
      { kind: 'interface', typeName: 'Reader' },
    ],
  );
});

test('ignores type aliases', async () => {
  const result = await detectTypeImplementations(`package p

type Reader = interface {
	Read([]byte) (int, error)
}

type Person = OtherPerson
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(result.declarations, []);
});

test('ignores non-struct and non-interface type specs', async () => {
  const result = await detectTypeImplementations(`package p

type Age int
type Names []string
type Lookup map[string]int
type Fn func() error
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(result.declarations, []);
});

test('returns no declarations for malformed in-progress source', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)

type Person struct {
	Name string
}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, true);
  assert.deepEqual(result.declarations, []);
});
