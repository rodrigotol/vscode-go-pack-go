import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectGoMainFunctions,
  GoMainRange,
  isPackageMainDocument,
} from './goMainDetector';

const functionSymbolKind = 12;

test('detects main functions when the AST package clause is main', async () => {
  let called = 0;
  const result = await detectGoMainFunctions(
    createDocument(`package main

func main() {}
`),
    {
      functionSymbolKind,
      executeDocumentSymbols: async () => {
        called += 1;
        return [
          createDocumentSymbol('main', createRange(2, 0, 2, 13)),
          createDocumentSymbol('helper', createRange(4, 0, 4, 15)),
        ];
      },
      parseSource: async (source) => createParseTree(source, 'main'),
    },
  );

  assert.equal(called, 1);
  assert.deepEqual(result, [
    {
      range: createRange(2, 0, 2, 13),
      selectionRange: createRange(2, 5, 2, 9),
    },
  ]);
});

test('accepts package main when comments appear before the package clause in source text', async () => {
  const document = createDocument(`/*
package ignored
*/
// another comment

package main

func main() {}
`);

  const result = await isPackageMainDocument(document, async (source) => createParseTree(source, 'main'));

  assert.equal(result, true);
});

test('rejects non-main packages before requesting document symbols', async () => {
  let called = 0;
  const result = await detectGoMainFunctions(
    createDocument(`package tools

func main() {}
`),
    {
      functionSymbolKind,
      executeDocumentSymbols: async () => {
        called += 1;
        return [createDocumentSymbol('main', createRange(2, 0, 2, 13))];
      },
      parseSource: async (source) => createParseTree(source, 'tools'),
    },
  );

  assert.equal(called, 0);
  assert.deepEqual(result, []);
});

test('preserves multiple main symbols discovered in the document symbol tree', async () => {
  const result = await detectGoMainFunctions(
    createDocument(`package main

func wrapper() {
	func main() {}
}

func main() {}
`),
    {
      functionSymbolKind,
      executeDocumentSymbols: async () => [
        {
          name: 'wrapper',
          kind: functionSymbolKind,
          range: createRange(2, 0, 4, 1),
          selectionRange: createRange(2, 5, 2, 12),
          children: [createDocumentSymbol('main', createRange(3, 1, 3, 14))],
        },
        createDocumentSymbol('main', createRange(6, 0, 6, 13)),
      ],
      parseSource: async (source) => createParseTree(source, 'main'),
    },
  );

  assert.deepEqual(result, [
    {
      range: createRange(3, 1, 3, 14),
      selectionRange: createRange(3, 6, 3, 10),
    },
    {
      range: createRange(6, 0, 6, 13),
      selectionRange: createRange(6, 5, 6, 9),
    },
  ]);
});

function createDocument(
  text: string,
  overrides: Partial<{
    languageId: string;
    isUntitled: boolean;
    isDirty: boolean;
  }> = {},
) {
  return {
    languageId: overrides.languageId ?? 'go',
    isUntitled: overrides.isUntitled ?? false,
    isDirty: overrides.isDirty ?? false,
    uri: { scheme: 'file', fsPath: '/workspace/main.go' },
    getText() {
      return text.replace(/\r\n/g, '\n');
    },
  };
}

function createParseTree(source: string, packageName: string) {
  return {
    rootNode: {
      hasError: () => false,
      namedChildren: [
        {
          type: 'package_clause',
          text: source,
          namedChildren: [
            {
              type: 'package_identifier',
              text: packageName,
              namedChildren: [],
            },
          ],
        },
      ],
    },
    delete() {},
  };
}

function createDocumentSymbol(name: string, range: GoMainRange) {
  return {
    name,
    kind: functionSymbolKind,
    range,
    selectionRange: {
      start: { line: range.start.line, character: range.start.character + 5 },
      end: { line: range.start.line, character: range.start.character + 9 },
    },
    children: [],
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
