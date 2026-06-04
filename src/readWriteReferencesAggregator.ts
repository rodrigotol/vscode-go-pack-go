import * as vscode from 'vscode';

import { SourcePosition, SourceRange } from './goTreeSitter';
import { classifyReferenceHighlight } from './readWriteReferenceHighlights';
import {
  ReadWriteReferenceClassification,
  ReadWriteReferenceCounts,
  ReadWriteReferenceItem,
  ReadWriteReferencePreview,
  ReadWriteReferenceQuery,
  ReadWriteReferencesResult,
} from './readWriteReferencesModel';

const previewContextLineCount = 2;

export interface ReadWriteReferencesAggregatorDependencies {
  readonly classifyReference?: (
    uri: vscode.Uri,
    target: {
      readonly range: SourceRange;
      readonly position: SourcePosition;
    },
  ) => Promise<ReadWriteReferenceClassification>;
  readonly executeReferenceProvider?: (
    uri: vscode.Uri,
    position: vscode.Position,
  ) => Thenable<readonly vscode.Location[] | undefined>;
  readonly getActiveTextEditor?: () => vscode.TextEditor | undefined;
  readonly openTextDocument?: (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
}

export class ReadWriteReferencesAggregator {
  private readonly classifyReference: NonNullable<ReadWriteReferencesAggregatorDependencies['classifyReference']>;
  private readonly executeReferenceProvider: NonNullable<
    ReadWriteReferencesAggregatorDependencies['executeReferenceProvider']
  >;
  private readonly getActiveTextEditor: NonNullable<ReadWriteReferencesAggregatorDependencies['getActiveTextEditor']>;
  private readonly openTextDocument: NonNullable<ReadWriteReferencesAggregatorDependencies['openTextDocument']>;
  private requestVersion = 0;

  constructor(dependencies: ReadWriteReferencesAggregatorDependencies = {}) {
    this.classifyReference = dependencies.classifyReference ?? classifyReferenceHighlight;
    this.executeReferenceProvider = dependencies.executeReferenceProvider ?? defaultExecuteReferenceProvider;
    this.getActiveTextEditor = dependencies.getActiveTextEditor ?? (() => vscode.window.activeTextEditor);
    this.openTextDocument = dependencies.openTextDocument ?? vscode.workspace.openTextDocument;
  }

  async buildForActiveEditor(
    token?: vscode.CancellationToken,
  ): Promise<ReadWriteReferencesResult | undefined> {
    const editor = this.getActiveTextEditor();
    if (!editor || editor.document.languageId !== 'go') {
      return undefined;
    }

    return this.build(editor.document, editor.selection.active, token);
  }

  async build(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<ReadWriteReferencesResult | undefined> {
    const requestVersion = ++this.requestVersion;
    const query = resolveQuery(document, position);
    if (!query) {
      return undefined;
    }

    const referenceLocations = await this.executeReferenceProvider(document.uri, position);
    if (isStaleOrCancelled(token, requestVersion, this.requestVersion)) {
      return undefined;
    }

    const references = await this.buildReferenceItems(referenceLocations ?? [], token, requestVersion);
    if (!references) {
      return undefined;
    }

    return {
      query,
      references,
      counts: countReferences(references),
    };
  }

  private async buildReferenceItems(
    referenceLocations: readonly vscode.Location[],
    token: vscode.CancellationToken | undefined,
    requestVersion: number,
  ): Promise<readonly ReadWriteReferenceItem[] | undefined> {
    const references: ReadWriteReferenceItem[] = [];

    for (const location of referenceLocations) {
      if (isStaleOrCancelled(token, requestVersion, this.requestVersion)) {
        return undefined;
      }

      references.push(await this.buildReferenceItem(location));
    }

    return references;
  }

  private async buildReferenceItem(location: vscode.Location): Promise<ReadWriteReferenceItem> {
    const range = toSourceRange(location.range);
    const position = toSourcePosition(location.range.start);
    const classification = await this.classifyReference(location.uri, { range, position });

    try {
      const document = await this.openTextDocument(location.uri);
      const preview = buildPreview(document, location.range);

      return {
        uri: location.uri.toString(),
        range,
        classification,
        preview,
      };
    } catch (error) {
      return {
        uri: location.uri.toString(),
        range,
        classification,
        preview: createPreviewError(range, toErrorMessage(error)),
      };
    }
  }
}

export function resolveQuery(
  document: vscode.TextDocument,
  position: vscode.Position,
): ReadWriteReferenceQuery | undefined {
  const selectionRange = document.getWordRangeAtPosition(position);
  if (!selectionRange) {
    return undefined;
  }

  const symbolLabel = document.getText(selectionRange);
  if (!symbolLabel) {
    return undefined;
  }

  return {
    symbolLabel,
    uri: document.uri.toString(),
    position: toSourcePosition(position),
    selectionRange: toSourceRange(selectionRange),
  };
}

export function buildPreview(document: vscode.TextDocument, range: vscode.Range): ReadWriteReferencePreview {
  const startLine = Math.max(0, range.start.line - previewContextLineCount);
  const endLine = Math.min(document.lineCount - 1, range.end.line + previewContextLineCount);
  const lines: string[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    lines.push(document.lineAt(line).text);
  }

  return {
    snippet: lines.join('\n'),
    snippetRange: {
      start: { line: startLine, character: 0 },
      end: {
        line: endLine,
        character: document.lineAt(endLine).text.length,
      },
    },
    focusRange: toSourceRange(range),
    highlightLine: range.start.line,
    lineNumber: range.start.line + 1,
  };
}

export function countReferences(references: readonly ReadWriteReferenceItem[]): ReadWriteReferenceCounts {
  return references.reduce<ReadWriteReferenceCounts>((counts, reference) => {
    if (reference.classification === 'read') {
      return {
        ...counts,
        read: counts.read + 1,
      };
    }

    if (reference.classification === 'write') {
      return {
        ...counts,
        write: counts.write + 1,
      };
    }

    return {
      ...counts,
      readWrite: counts.readWrite + 1,
    };
  }, {
    read: 0,
    write: 0,
    readWrite: 0,
  });
}

function createPreviewError(range: SourceRange, errorMessage: string): ReadWriteReferencePreview {
  return {
    snippet: '',
    snippetRange: range,
    focusRange: range,
    highlightLine: range.start.line,
    lineNumber: range.start.line + 1,
    errorMessage,
  };
}

function isStaleOrCancelled(
  token: vscode.CancellationToken | undefined,
  requestVersion: number,
  currentVersion: number,
): boolean {
  return Boolean(token?.isCancellationRequested) || requestVersion !== currentVersion;
}

async function defaultExecuteReferenceProvider(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<readonly vscode.Location[] | undefined> {
  return vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
}

function toSourcePosition(position: vscode.Position): SourcePosition {
  return {
    line: position.line,
    character: position.character,
  };
}

function toSourceRange(range: vscode.Range): SourceRange {
  return {
    start: toSourcePosition(range.start),
    end: toSourcePosition(range.end),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load preview for this reference.';
}
