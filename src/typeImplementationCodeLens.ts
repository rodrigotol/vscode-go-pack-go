import { SourcePosition, SourceRange } from './goTreeSitter';
import { TypeImplementationDeclaration } from './typeImplementationDetector';

export const goToTypeImplementationCommand = 'go-pack-go.goToTypeImplementation';

export interface GoToTypeImplementationCommandArgument {
  readonly uri: string;
  readonly position: SourcePosition;
  readonly typeName: string;
  readonly kind: 'struct' | 'interface';
}

export interface TypeImplementationCodeLensDescriptor {
  readonly range: SourceRange;
  readonly title: string;
  readonly command: string;
  readonly arguments: readonly [GoToTypeImplementationCommandArgument];
}

export function createTypeImplementationCodeLensDescriptors(
  uri: string,
  declarations: readonly TypeImplementationDeclaration[],
): TypeImplementationCodeLensDescriptor[] {
  return declarations.map((declaration) => ({
    range: createCodeLensRange(declaration.declarationRange),
    title: 'go to implementation',
    command: goToTypeImplementationCommand,
    arguments: [
      {
        uri,
        position: declaration.identifierPosition,
        typeName: declaration.typeName,
        kind: declaration.kind,
      },
    ],
  }));
}

function createCodeLensRange(range: SourceRange): SourceRange {
  return {
    start: range.start,
    end: range.start,
  };
}
