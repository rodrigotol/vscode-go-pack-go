import Parser = require('web-tree-sitter');
import { createRequire } from 'module';

type Language = Parser.Language;
type Point = Parser.Point;
type Tree = Parser.Tree;

export interface SourcePosition {
  readonly line: number;
  readonly character: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface TestTableScenario {
  readonly testName: string;
  readonly tableName: string;
  readonly label?: string;
  readonly scenarioRange: SourceRange;
  readonly loopRange: SourceRange;
}

export interface DetectTestTableScenariosResult {
  readonly scenarios: TestTableScenario[];
  readonly parseSucceeded: boolean;
  readonly hasSyntaxError: boolean;
}

let parserRuntimePromise: Promise<void> | undefined;
let goLanguagePromise: Promise<Language> | undefined;
const nodeRequire = createRequire(__filename);

export async function detectTestTableScenarios(source: string): Promise<DetectTestTableScenariosResult> {
  let tree: Tree;
  try {
    tree = await parseGoSource(source);
  } catch {
    return {
      scenarios: [],
      parseSucceeded: false,
      hasSyntaxError: true,
    };
  }

  try {
    return {
      scenarios: [],
      parseSucceeded: true,
    hasSyntaxError: tree.rootNode.hasError(),
    };
  } finally {
    tree.delete();
  }
}

async function parseGoSource(source: string): Promise<Tree> {
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

async function ensureParserRuntime(): Promise<void> {
  parserRuntimePromise ??= Parser.init({
    locateFile(fileName: string): string {
      if (fileName === 'tree-sitter.wasm') {
        return nodeRequire.resolve('web-tree-sitter/tree-sitter.wasm');
      }

      return fileName;
    },
  });

  return parserRuntimePromise;
}

async function ensureGoLanguage(): Promise<Language> {
  goLanguagePromise ??= Parser.Language.load(
    nodeRequire.resolve('tree-sitter-wasms/out/tree-sitter-go.wasm'),
  );

  return await goLanguagePromise;
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
