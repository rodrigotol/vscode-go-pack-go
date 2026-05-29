import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GoMainFunction, GoMainRange } from './goMainDetector';
import {
  createGoMainCodeLensDescriptors,
  debugGoMainCommand,
  debugGoMainTitle,
  GoMainCodeLensProvider,
  runGoMainCommand,
  runGoMainTitle,
} from './goMainCodeLens';

test('creates two CodeLens descriptors per detected main function', () => {
  const descriptors = createGoMainCodeLensDescriptors('file:///workspace/main.go', [
    createMainFunction(createRange(2, 0, 2, 13)),
    createMainFunction(createRange(6, 0, 6, 13)),
  ]);

  assert.equal(descriptors.length, 4);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.title),
    [runGoMainTitle, debugGoMainTitle, runGoMainTitle, debugGoMainTitle],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.command),
    [runGoMainCommand, debugGoMainCommand, runGoMainCommand, debugGoMainCommand],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.arguments[0]),
    [
      { uri: 'file:///workspace/main.go' },
      { uri: 'file:///workspace/main.go' },
      { uri: 'file:///workspace/main.go' },
      { uri: 'file:///workspace/main.go' },
    ],
  );
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.range),
    [
      {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 0 },
      },
      {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 0 },
      },
      {
        start: { line: 6, character: 0 },
        end: { line: 6, character: 0 },
      },
      {
        start: { line: 6, character: 0 },
        end: { line: 6, character: 0 },
      },
    ],
  );
});

test('reuses cached results for the same document version', async () => {
  let called = 0;
  const provider = new GoMainCodeLensProvider({
    detectMainFunctions: async () => {
      called += 1;
      return [createMainFunction(createRange(2, 0, 2, 13))];
    },
  });

  const document = createDocument({
    version: 3,
    uri: 'file:///workspace/main.go',
  });

  const first = await provider.provideCodeLensDescriptors(document);
  const second = await provider.provideCodeLensDescriptors(document);

  assert.equal(called, 1);
  assert.strictEqual(second, first);
});

test('refreshes cached results after invalidation and version changes', async () => {
  let called = 0;
  const provider = new GoMainCodeLensProvider({
    detectMainFunctions: async () => {
      called += 1;
      return [createMainFunction(createRange(called, 0, called, 13))];
    },
  });

  const uri = 'file:///workspace/main.go';
  const first = await provider.provideCodeLensDescriptors(createDocument({ version: 1, uri }));

  provider.invalidateDocument(uri);

  const second = await provider.provideCodeLensDescriptors(createDocument({ version: 1, uri }));
  const third = await provider.provideCodeLensDescriptors(createDocument({ version: 2, uri }));

  assert.equal(called, 3);
  assert.notStrictEqual(second, first);
  assert.notStrictEqual(third, second);
  assert.deepEqual(
    third.map((descriptor) => descriptor.range.start.line),
    [3, 3],
  );
});

test('emits change events through onDidChangeCodeLenses', () => {
  const provider = new GoMainCodeLensProvider();
  const events: Array<string | undefined> = [];
  const disposable = provider.onDidChangeCodeLenses((event) => {
    events.push(event?.uri);
  });

  provider.refreshDocument('file:///workspace/main.go');
  provider.refreshDocument();
  disposable.dispose();
  provider.refreshDocument('file:///workspace/ignored.go');

  assert.deepEqual(events, ['file:///workspace/main.go', undefined]);
});

test('produces no lenses when the main detector rejects the document', async () => {
  const provider = new GoMainCodeLensProvider({
    detectMainFunctions: async () => [],
  });

  const descriptors = await provider.provideCodeLensDescriptors(
    createDocument({
      version: 1,
      uri: 'file:///workspace/tools.go',
      isDirty: true,
    }),
  );

  assert.deepEqual(descriptors, []);
});

function createDocument(
  overrides: Partial<{
    languageId: string;
    isUntitled: boolean;
    isDirty: boolean;
    version: number;
    uri: string;
    text: string;
  }> = {},
) {
  return {
    languageId: overrides.languageId ?? 'go',
    isUntitled: overrides.isUntitled ?? false,
    isDirty: overrides.isDirty ?? false,
    version: overrides.version ?? 1,
    uri: {
      toString() {
        return overrides.uri ?? 'file:///workspace/main.go';
      },
    },
    getText() {
      return overrides.text ?? 'package main\n\nfunc main() {}\n';
    },
  };
}

function createMainFunction(range: GoMainRange): GoMainFunction {
  return {
    range,
    selectionRange: range,
  };
}

function createRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): GoMainRange {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}
