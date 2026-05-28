import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createTypeImplementationCodeLensDescriptors,
  goToTypeImplementationCommand,
  goToTypeImplementationTitle,
} from './typeImplementationCodeLens';
import { detectTypeImplementations } from './typeImplementationDetector';

test('creates one CodeLens descriptor per detected implementation target', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)
}

type Person struct {
	Name string
}

func (p Person) Read() {}
`);

  const descriptors = createTypeImplementationCodeLensDescriptors(
    'file:///workspace/example.go',
    result.declarations,
  );

  assert.equal(descriptors.length, 4);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.title),
    [
      goToTypeImplementationTitle,
      goToTypeImplementationTitle,
      goToTypeImplementationTitle,
      goToTypeImplementationTitle,
    ],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.command),
    [
      goToTypeImplementationCommand,
      goToTypeImplementationCommand,
      goToTypeImplementationCommand,
      goToTypeImplementationCommand,
    ],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.arguments[0]),
    [
      {
        uri: 'file:///workspace/example.go',
        position: { line: 2, character: 5 },
        typeName: 'Reader',
        kind: 'interface',
      },
      {
        uri: 'file:///workspace/example.go',
        position: { line: 3, character: 1 },
        typeName: 'Reader',
        methodName: 'Read',
        kind: 'interface-method',
      },
      {
        uri: 'file:///workspace/example.go',
        position: { line: 6, character: 5 },
        typeName: 'Person',
        kind: 'struct',
      },
      {
        uri: 'file:///workspace/example.go',
        position: { line: 10, character: 16 },
        typeName: 'Person',
        methodName: 'Read',
        kind: 'method',
      },
    ],
  );

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const declaration = result.declarations[index];

    assert.deepEqual(descriptor.range.end, descriptor.range.start);
    assert.deepEqual(descriptor.range.start, declaration.declarationRange.start);
  }
});

test('anchors receiver method lenses to the func line and preserves method payloads', async () => {
  const result = await detectTypeImplementations(`package p

type Person struct{}

func (p Person) Read() {}
func (p *Person) Write() {}
`);

  const descriptors = createTypeImplementationCodeLensDescriptors(
    'file:///workspace/example.go',
    result.declarations.filter((declaration) => declaration.kind === 'method'),
  );

  assert.equal(descriptors.length, 2);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.arguments[0]),
    [
      {
        uri: 'file:///workspace/example.go',
        position: { line: 4, character: 16 },
        typeName: 'Person',
        methodName: 'Read',
        kind: 'method',
      },
      {
        uri: 'file:///workspace/example.go',
        position: { line: 5, character: 17 },
        typeName: 'Person',
        methodName: 'Write',
        kind: 'method',
      },
    ],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.range),
    [
      {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 0 },
      },
      {
        start: { line: 5, character: 0 },
        end: { line: 5, character: 0 },
      },
    ],
  );
});

test('anchors interface method lenses to the method signature line and preserves payloads', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
}
`);

  const descriptors = createTypeImplementationCodeLensDescriptors(
    'file:///workspace/example.go',
    result.declarations.filter((declaration) => declaration.kind === 'interface-method'),
  );

  assert.equal(descriptors.length, 2);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.arguments[0]),
    [
      {
        uri: 'file:///workspace/example.go',
        position: { line: 3, character: 1 },
        typeName: 'Reader',
        methodName: 'Read',
        kind: 'interface-method',
      },
      {
        uri: 'file:///workspace/example.go',
        position: { line: 4, character: 1 },
        typeName: 'Reader',
        methodName: 'Write',
        kind: 'interface-method',
      },
    ],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.range),
    [
      {
        start: { line: 3, character: 1 },
        end: { line: 3, character: 1 },
      },
      {
        start: { line: 4, character: 1 },
        end: { line: 4, character: 1 },
      },
    ],
  );
});

test('creates no CodeLens descriptors when no implementation targets are detected', () => {
  const descriptors = createTypeImplementationCodeLensDescriptors('file:///workspace/example.go', []);

  assert.deepEqual(descriptors, []);
});
