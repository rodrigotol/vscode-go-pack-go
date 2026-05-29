import type * as vscode from 'vscode';
import { parseGoSource } from './goTreeSitter';

export interface GoMainFunction {
  readonly range: GoMainRange;
  readonly selectionRange: GoMainRange;
}

export interface GoMainRange {
  readonly start: GoMainPosition;
  readonly end: GoMainPosition;
}

export interface GoMainPosition {
  readonly line: number;
  readonly character: number;
}

interface GoMainTextDocument {
  readonly languageId: string;
  readonly isUntitled: boolean;
  readonly isDirty: boolean;
  readonly uri: unknown;
  getText(): string;
}

interface GoMainDocumentSymbol {
  readonly name: string;
  readonly kind: number;
  readonly range: GoMainRange;
  readonly selectionRange: GoMainRange;
  readonly children?: readonly GoMainDocumentSymbol[];
}

interface GoMainSymbolInformation {
  readonly name: string;
  readonly kind: number;
  readonly location: {
    readonly range: GoMainRange;
  };
}

interface GoMainDetectorDependencies {
  readonly executeDocumentSymbols?: (
    uri: unknown,
  ) => Thenable<readonly GoMainDocumentSymbol[] | readonly GoMainSymbolInformation[] | undefined>;
  readonly functionSymbolKind?: number;
  readonly parseSource?: (source: string) => Promise<GoMainSyntaxTree>;
}

interface GoMainSyntaxNode {
  readonly namedChildren: readonly GoMainSyntaxNode[];
  readonly type: string;
  readonly text: string;
}

interface GoMainSyntaxTree {
  readonly rootNode: {
    readonly hasError: () => boolean;
    readonly namedChildren: readonly GoMainSyntaxNode[];
  };
  delete(): void;
}

export async function detectGoMainFunctions(
  document: GoMainTextDocument,
  dependencies: GoMainDetectorDependencies = {},
): Promise<readonly GoMainFunction[]> {
  if (!isEligibleGoMainDocument(document)) {
    return [];
  }

  const parseSource = dependencies.parseSource ?? parseGoSource;
  if (!(await isPackageMainDocument(document, parseSource))) {
    return [];
  }

  const executeDocumentSymbols = dependencies.executeDocumentSymbols ?? defaultExecuteDocumentSymbols;
  const functionSymbolKind = dependencies.functionSymbolKind ?? defaultFunctionSymbolKind();
  const symbols = await executeDocumentSymbols(document.uri);

  if (!symbols?.length) {
    return [];
  }

  return collectMainFunctions(symbols, functionSymbolKind);
}

export function isEligibleGoMainDocument(document: GoMainTextDocument): boolean {
  return (
    document.languageId === 'go' &&
    !document.isUntitled &&
    !document.isDirty
  );
}

export async function isPackageMainDocument(
  document: Pick<GoMainTextDocument, 'getText'>,
  parseSource: (source: string) => Promise<GoMainSyntaxTree> = parseGoSource,
): Promise<boolean> {
  const tree = await parseSource(document.getText());

  try {
    if (tree.rootNode.hasError()) {
      return false;
    }

    const packageClause = tree.rootNode.namedChildren.find((child) => child.type === 'package_clause');
    const packageIdentifier = packageClause?.namedChildren.find((child) => child.type === 'package_identifier');
    return packageIdentifier?.text === 'main';
  } finally {
    tree.delete();
  }
}

export function collectMainFunctions(
  symbols: readonly GoMainDocumentSymbol[] | readonly GoMainSymbolInformation[],
  functionSymbolKind: number,
): readonly GoMainFunction[] {
  if (!symbols.length) {
    return [];
  }

  const [firstSymbol] = symbols;
  if (isDocumentSymbol(firstSymbol)) {
    const mainFunctions: GoMainFunction[] = [];
    for (const symbol of symbols as readonly GoMainDocumentSymbol[]) {
      collectMainDocumentSymbols(symbol, functionSymbolKind, mainFunctions);
    }
    return mainFunctions;
  }

  return (symbols as readonly GoMainSymbolInformation[])
    .filter((symbol) => symbol.name === 'main' && symbol.kind === functionSymbolKind)
    .map((symbol) => ({
      range: symbol.location.range,
      selectionRange: symbol.location.range,
    }));
}

function collectMainDocumentSymbols(
  symbol: GoMainDocumentSymbol,
  functionSymbolKind: number,
  mainFunctions: GoMainFunction[],
): void {
  if (symbol.name === 'main' && symbol.kind === functionSymbolKind) {
    mainFunctions.push({
      range: symbol.range,
      selectionRange: symbol.selectionRange,
    });
  }

  for (const child of symbol.children ?? []) {
    collectMainDocumentSymbols(child, functionSymbolKind, mainFunctions);
  }
}

function isDocumentSymbol(
  symbol: GoMainDocumentSymbol | GoMainSymbolInformation,
): symbol is GoMainDocumentSymbol {
  return 'range' in symbol && 'selectionRange' in symbol;
}

async function defaultExecuteDocumentSymbols(
  uri: unknown,
): Promise<readonly GoMainDocumentSymbol[] | readonly GoMainSymbolInformation[] | undefined> {
  const api = loadVsCode();
  return api.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri as vscode.Uri);
}

function defaultFunctionSymbolKind(): number {
  return loadVsCode().SymbolKind.Function;
}

function loadVsCode(): typeof import('vscode') {
  return require('vscode') as typeof import('vscode');
}
