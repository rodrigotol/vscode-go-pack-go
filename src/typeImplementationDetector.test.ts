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
    {
      kind: 'interface-method',
      typeName: 'Reader',
      methodName: 'Read',
      declarationRange: {
        start: { line: 3, character: 1 },
        end: { line: 3, character: 34 },
      },
      identifierPosition: { line: 3, character: 1 },
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
      methodName: declaration.methodName,
    })),
    [
      { kind: 'interface', typeName: 'Reader', methodName: undefined },
      { kind: 'interface-method', typeName: 'Reader', methodName: 'Read' },
      { kind: 'struct', typeName: 'Person', methodName: undefined },
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
      methodName: declaration.methodName,
    })),
    [
      { kind: 'struct', typeName: 'Box', methodName: undefined },
      { kind: 'interface', typeName: 'Reader', methodName: undefined },
      { kind: 'interface-method', typeName: 'Reader', methodName: 'Read' },
    ],
  );
});

test('detects value-receiver and pointer-receiver methods', async () => {
  const result = await detectTypeImplementations(`package p

type Person struct{}

func (p Person) Read() {}
func (p *Person) Write() {}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.declarations.map((declaration) => ({
      kind: declaration.kind,
      typeName: declaration.typeName,
      methodName: declaration.methodName,
      identifierPosition: declaration.identifierPosition,
    })),
    [
      {
        kind: 'struct',
        typeName: 'Person',
        methodName: undefined,
        identifierPosition: { line: 2, character: 5 },
      },
      {
        kind: 'method',
        typeName: 'Person',
        methodName: 'Read',
        identifierPosition: { line: 4, character: 16 },
      },
      {
        kind: 'method',
        typeName: 'Person',
        methodName: 'Write',
        identifierPosition: { line: 5, character: 17 },
      },
    ],
  );
});

test('ignores top-level functions and embedded interface members', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)
	io.Reader
}

func Top() {}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.declarations.map((declaration) => ({
      kind: declaration.kind,
      typeName: declaration.typeName,
      methodName: declaration.methodName,
    })),
    [
      { kind: 'interface', typeName: 'Reader', methodName: undefined },
      { kind: 'interface-method', typeName: 'Reader', methodName: 'Read' },
    ],
  );
});

test('detects mixed files containing structs, interfaces, methods, and top-level functions', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)
}

type Person struct{}

func (p Person) Read() {}
func (p *Person) Write() {}
func Top() {}
`);

  assert.equal(result.parseSucceeded, true);
  assert.equal(result.hasSyntaxError, false);
  assert.deepEqual(
    result.declarations.map((declaration) => ({
      kind: declaration.kind,
      typeName: declaration.typeName,
      methodName: declaration.methodName,
    })),
    [
      { kind: 'interface', typeName: 'Reader', methodName: undefined },
      { kind: 'interface-method', typeName: 'Reader', methodName: 'Read' },
      { kind: 'struct', typeName: 'Person', methodName: undefined },
      { kind: 'method', typeName: 'Person', methodName: 'Read' },
      { kind: 'method', typeName: 'Person', methodName: 'Write' },
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
