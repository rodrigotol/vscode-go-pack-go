import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';
import type * as vscode from 'vscode';

const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load;

moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
) {
  if (request === 'vscode') {
    return {
      commands: {
        executeCommand: async () => undefined,
      },
      window: {
        activeTextEditor: undefined,
      },
      workspace: {
        openTextDocument: async () => {
          throw new Error('openTextDocument was not stubbed for this test');
        },
      },
      Position: class Position {
        readonly line: number;
        readonly character: number;

        constructor(line: number, character: number) {
          this.line = line;
          this.character = character;
        }
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  ReadWriteReferencesAggregator,
  buildPreview,
} = require('./readWriteReferencesAggregator') as typeof import('./readWriteReferencesAggregator');

test('build returns mixed read, write, and read-write references with counts and previews', async () => {
  const document = createQueryDocument();
  const locations = [
    createLocation('file:///workspace/read.go', createRange(1, 5, 1, 8)),
    createLocation('file:///workspace/write.go', createRange(3, 2, 3, 5)),
    createLocation('file:///workspace/mixed.go', createRange(2, 7, 2, 10)),
  ];
  const classifications = new Map([
    ['file:///workspace/read.go', 'read' as const],
    ['file:///workspace/write.go', 'write' as const],
    ['file:///workspace/mixed.go', 'read-write' as const],
  ]);
  const aggregator = new ReadWriteReferencesAggregator({
    executeReferenceProvider: async () => locations as readonly vscode.Location[],
    classifyReference: async (uri) => classifications.get(uri.toString()) ?? 'read-write',
    openTextDocument: async (uri) => createTextDocument(uri.toString(), [
      'package sample',
      'var foo = 1',
      'func read() { _ = foo }',
      'func write() { foo = 2 }',
      'func mixed() { foo++ }',
      'func done() {}',
    ]),
  });

  const result = await aggregator.build(document, createPosition(0, 1));

  assert.ok(result);
  assert.equal(result.query.symbolLabel, 'foo');
  assert.deepEqual(result.counts, {
    read: 1,
    write: 1,
    readWrite: 1,
  });
  assert.deepEqual(
    result.references.map((reference) => ({
      uri: reference.uri,
      classification: reference.classification,
      lineNumber: reference.preview?.lineNumber,
    })),
    [
      { uri: 'file:///workspace/read.go', classification: 'read', lineNumber: 2 },
      { uri: 'file:///workspace/write.go', classification: 'write', lineNumber: 4 },
      { uri: 'file:///workspace/mixed.go', classification: 'read-write', lineNumber: 3 },
    ],
  );
  assert.match(result.references[0].preview?.snippet ?? '', /var foo = 1/);
});

test('buildPreview includes surrounding lines and highlights the matched line', () => {
  const preview = buildPreview(
    createTextDocument('file:///workspace/preview.go', [
      'package preview',
      'type sample struct {}',
      'func first() {}',
      'func second() { foo() }',
      'func third() {}',
      'func fourth() {}',
      'func fifth() {}',
    ]),
    createRange(3, 16, 3, 19),
  );

  assert.equal(
    preview.snippet,
    [
      'package preview',
      'type sample struct {}',
      'func first() {}',
      'func second() { foo() }',
      'func third() {}',
      'func fourth() {}',
      'func fifth() {}',
    ].join('\n'),
  );
  assert.deepEqual(preview.snippetRange, createRange(0, 0, 6, 15));
  assert.deepEqual(preview.focusRange, createRange(3, 16, 3, 19));
  assert.equal(preview.highlightLine, 3);
  assert.equal(preview.lineNumber, 4);
});

test('build returns an empty payload when no references are found', async () => {
  const aggregator = new ReadWriteReferencesAggregator({
    executeReferenceProvider: async () => [] as readonly vscode.Location[],
    openTextDocument: async (uri) => createTextDocument(uri.toString(), ['package empty']),
  });

  const result = await aggregator.build(createQueryDocument(), createPosition(0, 1));

  assert.ok(result);
  assert.equal(result.query.symbolLabel, 'foo');
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.counts, {
    read: 0,
    write: 0,
    readWrite: 0,
  });
});

test('build drops stale results when a newer request finishes first', async () => {
  let releaseFirstRequest!: () => void;
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const aggregator = new ReadWriteReferencesAggregator({
    executeReferenceProvider: async (_uri, position) => {
      if (position.character === 1) {
        await firstRequestGate;
      }

      return [
        createLocation(`file:///workspace/${position.character}.go`, createRange(1, 0, 1, 3)),
      ] as readonly vscode.Location[];
    },
    classifyReference: async () => 'read',
    openTextDocument: async (uri) => createTextDocument(uri.toString(), [
      'package stale',
      'var foo = 1',
      'func use() { foo() }',
    ]),
  });

  const firstBuild = aggregator.build(createQueryDocument(), createPosition(0, 1));
  const secondBuild = aggregator.build(createQueryDocument(), createPosition(0, 2));

  releaseFirstRequest();

  const [firstResult, secondResult] = await Promise.all([firstBuild, secondBuild]);

  assert.equal(firstResult, undefined);
  assert.ok(secondResult);
  assert.equal(secondResult.query.position.character, 2);
  assert.equal(secondResult.references[0].uri, 'file:///workspace/2.go');
});

function createQueryDocument() {
  return createTextDocument('file:///workspace/query.go', ['foo target symbol'], {
    getWordRangeAtPosition(position: vscode.Position) {
      if (position.character < 0 || position.character > 2) {
        return undefined;
      }

      return createRange(0, 0, 0, 3);
    },
  });
}

function createTextDocument(
  uri: string,
  lines: readonly string[],
  overrides: Partial<vscode.TextDocument> = {},
): vscode.TextDocument {
  return {
    uri: createUri(uri),
    languageId: 'go',
    lineCount: lines.length,
    fileName: uri,
    isUntitled: false,
    encoding: 'utf8',
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineAt(line: number) {
      return { text: lines[line] } as vscode.TextLine;
    },
    offsetAt() {
      return 0;
    },
    positionAt() {
      return createPosition(0, 0) as vscode.Position;
    },
    getText(range?: vscode.Range) {
      if (!range) {
        return lines.join('\n');
      }

      if (range.start.line !== range.end.line) {
        throw new Error('test helper only supports single-line getText ranges');
      }

      return lines[range.start.line].slice(range.start.character, range.end.character);
    },
    getWordRangeAtPosition() {
      return undefined;
    },
    validateRange(range: vscode.Range) {
      return range;
    },
    validatePosition(position: vscode.Position) {
      return position;
    },
    save: async () => true,
    ...overrides,
  } as unknown as vscode.TextDocument;
}

function createUri(value: string): vscode.Uri {
  return {
    scheme: 'file',
    authority: '',
    path: value.replace(/^file:\/\//, ''),
    query: '',
    fragment: '',
    fsPath: value.replace(/^file:\/\//, ''),
    toString() {
      return value;
    },
    with() {
      return createUri(value);
    },
    toJSON() {
      return value;
    },
  } as unknown as vscode.Uri;
}

function createLocation(uri: string, range: vscode.Range): vscode.Location {
  return {
    uri: createUri(uri),
    range,
  } as vscode.Location;
}

function createPosition(line: number, character: number): vscode.Position {
  return { line, character } as vscode.Position;
}

function createRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): vscode.Range {
  return {
    start: createPosition(startLine, startCharacter),
    end: createPosition(endLine, endCharacter),
  } as vscode.Range;
}
