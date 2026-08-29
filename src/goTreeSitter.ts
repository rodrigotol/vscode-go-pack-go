import Parser = require('web-tree-sitter');
import * as path from 'node:path';

type Language = Parser.Language;
type Point = Parser.Point;
type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

export interface SourcePosition {
  readonly line: number;
  readonly character: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

let parserRuntimePromise: Promise<void> | undefined;
let goLanguagePromise: Promise<Language> | undefined;
export async function parseGoSource(source: string): Promise<Tree> {
  await ensureParserRuntime();

  const parser = new Parser();
  const language = await ensureGoLanguage();

  try {
    parser.setLanguage(language);

    const tree = parser.parse(source);
    if (!tree) {
      throw new Error('Tree-sitter did not return a parse tree for the Go source.');
    }

    return tree;
  } finally {
    parser.delete();
  }
}

export function findFirstNamedChild(node: SyntaxNode | undefined, type: string): SyntaxNode | undefined {
  return node?.namedChildren.find((child) => child.type === type);
}

export function rangeFromPoints(start: Point, end: Point): SourceRange {
  return {
    start: {
      line: start.row,
      character: start.column,
    },
    end: {
      line: end.row,
      character: end.column,
    },
  };
}

async function ensureParserRuntime(): Promise<void> {
  parserRuntimePromise ??= Parser.init({
    locateFile(fileName: string): string {
      if (fileName === 'tree-sitter.wasm') {
        return runtimeAssetPath(fileName);
      }

      return fileName;
    },
  });

  return parserRuntimePromise;
}

async function ensureGoLanguage(): Promise<Language> {
  goLanguagePromise ??= Parser.Language.load(
    runtimeAssetPath('tree-sitter-go.wasm'),
  );

  return await goLanguagePromise;
}

function runtimeAssetPath(fileName: string): string {
  return path.join(__dirname, fileName);
}
