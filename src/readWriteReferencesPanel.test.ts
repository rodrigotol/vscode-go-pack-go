import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

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
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  applyPanelMessage,
  createClearPanelMessage,
  createInitialPanelViewState,
  createRefreshCurrentSymbolMessage,
  createReferenceOpenMessage,
  createReferenceRevealMessage,
  createSetResultPanelMessage,
  getFilteredPanelReferences,
  getSelectedPanelReference,
  selectPanelReference,
  togglePanelFilter,
} = require('./readWriteReferencesPanel') as typeof import('./readWriteReferencesPanel');

test('applyPanelMessage stores the initial panel payload and selects the first visible reference', () => {
  const result = createResult();

  const state = applyPanelMessage(createInitialPanelViewState(), createSetResultPanelMessage(result));

  assert.equal(state.result, result);
  assert.equal(state.showReads, true);
  assert.equal(state.showWrites, true);
  assert.equal(getSelectedPanelReference(state), result.references[0]);
});

test('togglePanelFilter keeps mixed references visible in both filtered views', () => {
  const result = createResult();
  const initialState = applyPanelMessage(createInitialPanelViewState(), createSetResultPanelMessage(result));

  const readsOnlyState = togglePanelFilter(initialState, 'writes');
  assert.deepEqual(
    getFilteredPanelReferences(readsOnlyState).map((reference) => reference.classification),
    ['read', 'read-write'],
  );

  const writesOnlyState = togglePanelFilter(initialState, 'reads');
  assert.deepEqual(
    getFilteredPanelReferences(writesOnlyState).map((reference) => reference.classification),
    ['write', 'read-write'],
  );
});

test('selectPanelReference drives preview selection to the chosen reference', () => {
  const result = createResult();
  const initialState = applyPanelMessage(createInitialPanelViewState(), createSetResultPanelMessage(result));

  const selectedState = selectPanelReference(initialState, result.references[2]);

  assert.equal(getSelectedPanelReference(selectedState), result.references[2]);
});

test('action message helpers produce open, reveal, refresh, and clear payloads', () => {
  const reference = createResult().references[1];

  assert.deepEqual(createReferenceRevealMessage(reference), {
    type: 'revealReference',
    reference,
  });
  assert.deepEqual(createReferenceOpenMessage(reference), {
    type: 'openReference',
    reference,
  });
  assert.deepEqual(createRefreshCurrentSymbolMessage(), {
    type: 'refreshCurrentSymbol',
  });
  assert.deepEqual(createClearPanelMessage(), {
    type: 'clear',
  });
});

function createResult() {
  return {
    query: {
      symbolLabel: 'foo',
      uri: 'file:///workspace/query.go',
      position: { line: 0, character: 1 },
      selectionRange: createRange(0, 0, 0, 3),
    },
    counts: {
      read: 1,
      write: 1,
      readWrite: 1,
    },
    references: [
      createReference('file:///workspace/read.go', createRange(1, 2, 1, 5), 'read', 2),
      createReference('file:///workspace/write.go', createRange(2, 2, 2, 5), 'write', 3),
      createReference('file:///workspace/mixed.go', createRange(3, 2, 3, 5), 'read-write', 4),
    ],
  } as const;
}

function createReference(
  uri: string,
  range: ReturnType<typeof createRange>,
  classification: 'read' | 'write' | 'read-write',
  lineNumber: number,
) {
  return {
    uri,
    range,
    classification,
    preview: {
      snippet: 'line one\nline two',
      snippetRange: createRange(lineNumber - 2, 0, lineNumber - 1, 8),
      focusRange: range,
      highlightLine: lineNumber - 1,
      lineNumber,
    },
  } as const;
}

function createRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    start: {
      line: startLine,
      character: startCharacter,
    },
    end: {
      line: endLine,
      character: endCharacter,
    },
  };
}
