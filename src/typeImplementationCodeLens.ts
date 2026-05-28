import { SourcePosition, SourceRange } from './goTreeSitter';
import { TypeImplementationDeclaration, TypeImplementationTargetKind } from './typeImplementationDetector';

export const goToTypeImplementationCommand = 'go-pack-go.goToTypeImplementation';

export interface GoToTypeImplementationCommandArgument {
  readonly uri: string;
  readonly position: SourcePosition;
  readonly typeName: string;
  readonly kind: TypeImplementationTargetKind;
  readonly methodName?: string;
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
        ...(declaration.methodName ? { methodName: declaration.methodName } : {}),
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
