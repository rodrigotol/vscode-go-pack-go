import Parser = require('web-tree-sitter');

import { findFirstNamedChild, parseGoSource, rangeFromPoints, SourcePosition, SourceRange } from './goTreeSitter';

type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

export type TypeImplementationDeclarationKind = 'struct' | 'interface';
export type TypeImplementationTargetKind =
  | TypeImplementationDeclarationKind
  | 'method'
  | 'interface-method';

export interface TypeImplementationDeclaration {
  readonly kind: TypeImplementationTargetKind;
  readonly typeName: string;
  readonly methodName?: string;
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
  collectDeclarations(rootNode, declarations);
  return declarations;
}

function collectDeclarations(
  node: SyntaxNode,
  declarations: TypeImplementationDeclaration[],
  enclosingInterface?: {
    readonly typeName: string;
  },
): void {
  if (node.type === 'type_spec') {
    const typeDeclaration = createTypeDeclaration(node);
    if (typeDeclaration) {
      declarations.push(typeDeclaration);
    }

    const interfaceTypeName = typeDeclaration?.kind === 'interface' ? typeDeclaration.typeName : undefined;
    for (const child of node.namedChildren) {
      collectDeclarations(
        child,
        declarations,
        interfaceTypeName ? { typeName: interfaceTypeName } : undefined,
      );
    }
    return;
  }

  if (node.type === 'method_declaration') {
    const methodDeclaration = createMethodDeclaration(node);
    if (methodDeclaration) {
      declarations.push(methodDeclaration);
    }
  } else if (node.type === 'method_spec' && enclosingInterface) {
    const interfaceMethodDeclaration = createInterfaceMethodDeclaration(node, enclosingInterface.typeName);
    if (interfaceMethodDeclaration) {
      declarations.push(interfaceMethodDeclaration);
    }
  }

  for (const child of node.namedChildren) {
    collectDeclarations(child, declarations, enclosingInterface);
  }
}

function createTypeDeclaration(typeSpec: SyntaxNode): TypeImplementationDeclaration | undefined {
  const typeIdentifier = findFirstNamedChild(typeSpec, 'type_identifier');
  const kind = getDeclarationKind(typeSpec);
  if (!typeIdentifier || !kind) {
    return undefined;
  }

  return {
    kind,
    typeName: typeIdentifier.text,
    declarationRange: rangeFromPoints(typeSpec.startPosition, typeSpec.endPosition),
    identifierPosition: toSourcePosition(typeIdentifier),
  };
}

function createMethodDeclaration(methodDeclaration: SyntaxNode): TypeImplementationDeclaration | undefined {
  const methodIdentifier = findFirstNamedChild(methodDeclaration, 'field_identifier');
  const receiver = findFirstNamedChild(methodDeclaration, 'parameter_list');
  const receiverType = receiver?.descendantsOfType('type_identifier')[0];
  if (!methodIdentifier || !receiverType) {
    return undefined;
  }

  return {
    kind: 'method',
    typeName: receiverType.text,
    methodName: methodIdentifier.text,
    declarationRange: rangeFromPoints(methodDeclaration.startPosition, methodDeclaration.endPosition),
    identifierPosition: toSourcePosition(methodIdentifier),
  };
}

function createInterfaceMethodDeclaration(
  methodSpec: SyntaxNode,
  interfaceName: string,
): TypeImplementationDeclaration | undefined {
  const methodIdentifier = findFirstNamedChild(methodSpec, 'field_identifier');
  if (!methodIdentifier) {
    return undefined;
  }

  return {
    kind: 'interface-method',
    typeName: interfaceName,
    methodName: methodIdentifier.text,
    declarationRange: rangeFromPoints(methodSpec.startPosition, methodSpec.endPosition),
    identifierPosition: toSourcePosition(methodIdentifier),
  };
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

function toSourcePosition(node: SyntaxNode): SourcePosition {
  return {
    line: node.startPosition.row,
    character: node.startPosition.column,
  };
}
