import Parser = require('web-tree-sitter');

import { findFirstNamedChild, parseGoSource, rangeFromPoints, SourcePosition, SourceRange } from './goTreeSitter';

type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

export type TypeImplementationDeclarationKind = 'struct' | 'interface';

export interface TypeImplementationDeclaration {
  readonly kind: TypeImplementationDeclarationKind;
  readonly typeName: string;
  readonly declarationRange: SourceRange;
  readonly identifierPosition: SourcePosition;
}

export interface DetectTypeImplementationsResult {
  readonly declarations: readonly TypeImplementationDeclaration[];
  readonly parseSucceeded: boolean;
  readonly hasSyntaxError: boolean;
}

export async function detectTypeImplementations(source: string): Promise<DetectTypeImplementationsResult> {
  let tree: Tree;
  try {
    tree = await parseGoSource(source);
  } catch {
    return {
      declarations: [],
      parseSucceeded: false,
      hasSyntaxError: true,
    };
  }

  try {
    const hasSyntaxError = tree.rootNode.hasError();

    return {
      declarations: hasSyntaxError ? [] : findTypeDeclarations(tree.rootNode),
      parseSucceeded: true,
      hasSyntaxError,
    };
  } finally {
    tree.delete();
  }
}

function findTypeDeclarations(rootNode: SyntaxNode): TypeImplementationDeclaration[] {
  const declarations: TypeImplementationDeclaration[] = [];

  for (const typeSpec of rootNode.descendantsOfType('type_spec')) {
    const typeIdentifier = findFirstNamedChild(typeSpec, 'type_identifier');
    const kind = getDeclarationKind(typeSpec);
    if (!typeIdentifier || !kind) {
      continue;
    }

    declarations.push({
      kind,
      typeName: typeIdentifier.text,
      declarationRange: rangeFromPoints(typeSpec.startPosition, typeSpec.endPosition),
      identifierPosition: {
        line: typeIdentifier.startPosition.row,
        character: typeIdentifier.startPosition.column,
      },
    });
  }

  return declarations;
}

function getDeclarationKind(typeSpec: SyntaxNode): TypeImplementationDeclarationKind | undefined {
  if (findFirstNamedChild(typeSpec, 'struct_type')) {
    return 'struct';
  }

  if (findFirstNamedChild(typeSpec, 'interface_type')) {
    return 'interface';
  }

  return undefined;
}
