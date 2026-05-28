import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createTypeImplementationCodeLensDescriptors,
  goToTypeImplementationCommand,
} from './typeImplementationCodeLens';
import { detectTypeImplementations } from './typeImplementationDetector';

test('creates one CodeLens descriptor per detected type declaration', async () => {
  const result = await detectTypeImplementations(`package p

type Reader interface {
	Read([]byte) (int, error)
}

type Person struct {
	Name string
}
`);

  const descriptors = createTypeImplementationCodeLensDescriptors(
    'file:///workspace/example.go',
    result.declarations,
  );

  assert.equal(descriptors.length, 2);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.title),
    ['go to implementation', 'go to implementation'],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.command),
    [goToTypeImplementationCommand, goToTypeImplementationCommand],
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
        position: { line: 6, character: 5 },
        typeName: 'Person',
        kind: 'struct',
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

test('creates no CodeLens descriptors when no type declarations are detected', () => {
  const descriptors = createTypeImplementationCodeLensDescriptors('file:///workspace/example.go', []);

  assert.deepEqual(descriptors, []);
});
