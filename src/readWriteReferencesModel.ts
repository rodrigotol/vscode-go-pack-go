import { SourcePosition, SourceRange } from './goTreeSitter';

export type ReadWriteReferenceClassification = 'read' | 'write' | 'read-write';

export interface ReadWriteReferenceQuery {
  readonly symbolLabel: string;
  readonly uri: string;
  readonly position: SourcePosition;
  readonly selectionRange: SourceRange;
}

export interface ReadWriteReferencePreview {
  readonly snippet: string;
  readonly snippetRange: SourceRange;
  readonly focusRange: SourceRange;
  readonly highlightLine: number;
  readonly lineNumber: number;
  readonly errorMessage?: string;
}

export interface ReadWriteReferenceItem {
  readonly uri: string;
  readonly range: SourceRange;
  readonly classification: ReadWriteReferenceClassification;
  readonly preview?: ReadWriteReferencePreview;
}

export interface ReadWriteReferenceCounts {
  readonly read: number;
  readonly write: number;
  readonly readWrite: number;
}

export interface ReadWriteReferencesResult {
  readonly query: ReadWriteReferenceQuery;
  readonly references: readonly ReadWriteReferenceItem[];
  readonly counts: ReadWriteReferenceCounts;
}
