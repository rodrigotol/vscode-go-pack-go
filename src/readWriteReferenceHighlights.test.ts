import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyReferenceHighlightMatches,
  documentHighlightKinds,
  HighlightClassificationMatch,
  HighlightClassificationTarget,
} from './readWriteReferenceHighlights';

test('maps Read highlights to read', () => {
  const classification = classifyReferenceHighlightMatches(
    [createHighlight(createRange(3, 4, 3, 10), documentHighlightKinds.read)],
    createTarget(createRange(3, 4, 3, 10)),
  );

  assert.equal(classification, 'read');
});

test('maps Write highlights to write', () => {
  const classification = classifyReferenceHighlightMatches(
    [createHighlight(createRange(7, 1, 7, 5), documentHighlightKinds.write)],
    createTarget(createRange(7, 1, 7, 5)),
  );

  assert.equal(classification, 'write');
});

test('maps Text highlights to read-write', () => {
  const classification = classifyReferenceHighlightMatches(
    [createHighlight(createRange(1, 0, 1, 6), documentHighlightKinds.text)],
    createTarget(createRange(1, 0, 1, 6)),
  );

  assert.equal(classification, 'read-write');
});

test('maps missing highlights to read-write', () => {
  const classification = classifyReferenceHighlightMatches(
    undefined,
    createTarget(createRange(5, 2, 5, 8)),
  );

  assert.equal(classification, 'read-write');
});

test('maps conflicting highlight kinds to read-write', () => {
  const range = createRange(9, 3, 9, 9);
  const classification = classifyReferenceHighlightMatches(
    [
      createHighlight(range, documentHighlightKinds.read),
      createHighlight(range, documentHighlightKinds.write),
    ],
    createTarget(range),
  );

  assert.equal(classification, 'read-write');
});

function createTarget(range: HighlightClassificationTarget['range']): HighlightClassificationTarget {
  return {
    range,
    position: range.start,
  };
}

function createHighlight(
  range: HighlightClassificationMatch['range'],
  kind: HighlightClassificationMatch['kind'],
): HighlightClassificationMatch {
  return {
    range,
    kind,
  };
}

function createRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}
