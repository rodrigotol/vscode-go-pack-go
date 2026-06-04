import type * as vscode from 'vscode';

import {
  ReadWriteReferenceClassification,
} from './readWriteReferencesModel';
import { SourcePosition, SourceRange } from './goTreeSitter';

export interface HighlightClassificationTarget {
  readonly range: SourceRange;
  readonly position?: SourcePosition;
}

export interface HighlightClassificationMatch {
  readonly range: SourceRange;
  readonly kind?: HighlightKind;
}

export type HighlightKind = number;

export const documentHighlightKinds = {
  text: 0,
  read: 1,
  write: 2,
} as const;

export async function classifyReferenceHighlight(
  uri: vscode.Uri,
  target: HighlightClassificationTarget,
): Promise<ReadWriteReferenceClassification> {
  const api = loadVsCode();
  const position = toVsCodePosition(target.position ?? target.range.start);
  const highlights = await api.commands.executeCommand<vscode.DocumentHighlight[]>(
    'vscode.executeDocumentHighlights',
    uri,
    position,
  );

  return classifyReferenceHighlightMatches(
    highlights?.map((highlight) => ({
      range: toSourceRange(highlight.range),
      kind: highlight.kind,
    })),
    target,
  );
}

export function classifyReferenceHighlightMatches(
  highlights: readonly HighlightClassificationMatch[] | undefined,
  target: HighlightClassificationTarget,
): ReadWriteReferenceClassification {
  if (!highlights || highlights.length === 0) {
    return 'read-write';
  }

  const position = target.position ?? target.range.start;
  const exactMatches = highlights.filter((highlight) => rangesEqual(highlight.range, target.range));
  const containingMatches = highlights.filter((highlight) => containsPosition(highlight.range, position));
  const intersectingMatches = highlights.filter((highlight) => rangesIntersect(highlight.range, target.range));
  const matches = firstNonEmpty(exactMatches, containingMatches, intersectingMatches);

  if (matches.length === 0) {
    return 'read-write';
  }

  const explicitKinds = new Set<HighlightKind>();
  for (const match of matches) {
    if (match.kind === undefined || match.kind === documentHighlightKinds.text) {
      return 'read-write';
    }

    explicitKinds.add(match.kind);
  }

  if (explicitKinds.size !== 1) {
    return 'read-write';
  }

  const [kind] = explicitKinds;
  if (kind === documentHighlightKinds.read) {
    return 'read';
  }

  if (kind === documentHighlightKinds.write) {
    return 'write';
  }

  return 'read-write';
}

function firstNonEmpty(
  ...groups: ReadonlyArray<readonly HighlightClassificationMatch[]>
): readonly HighlightClassificationMatch[] {
  for (const group of groups) {
    if (group.length > 0) {
      return group;
    }
  }

  return [];
}

function containsPosition(range: SourceRange, position: SourcePosition): boolean {
  return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}

function rangesEqual(left: SourceRange, right: SourceRange): boolean {
  return comparePositions(left.start, right.start) === 0 && comparePositions(left.end, right.end) === 0;
}

function rangesIntersect(left: SourceRange, right: SourceRange): boolean {
  return comparePositions(left.start, right.end) <= 0 && comparePositions(right.start, left.end) <= 0;
}

function comparePositions(left: SourcePosition, right: SourcePosition): number {
  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.character - right.character;
}

function toVsCodePosition(position: SourcePosition): vscode.Position {
  const api = loadVsCode();
  return new api.Position(position.line, position.character);
}

function toSourceRange(range: vscode.Range): SourceRange {
  return {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
}

function loadVsCode(): typeof import('vscode') {
  return require('vscode') as typeof import('vscode');
}
