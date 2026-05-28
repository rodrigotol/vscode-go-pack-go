import { SourcePosition, SourceRange } from './goTreeSitter';
import { TypeImplementationDeclaration, TypeImplementationTargetKind } from './typeImplementationDetector';

export const goToTypeImplementationCommand = 'go-pack-go.goToTypeImplementation';
export const goToTypeImplementationTitle = 'go to implementation';

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
  targets: readonly TypeImplementationDeclaration[],
): TypeImplementationCodeLensDescriptor[] {
  return targets.map((target) => createTypeImplementationCodeLensDescriptor(uri, target));
}

function createTypeImplementationCodeLensDescriptor(
  uri: string,
  target: TypeImplementationDeclaration,
): TypeImplementationCodeLensDescriptor {
  return {
    range: createCodeLensRange(target.declarationRange),
    title: goToTypeImplementationTitle,
    command: goToTypeImplementationCommand,
    arguments: [
      {
        uri,
        position: target.identifierPosition,
        typeName: target.typeName,
        kind: target.kind,
        ...(target.methodName ? { methodName: target.methodName } : {}),
      },
    ],
  };
}

function createCodeLensRange(range: SourceRange): SourceRange {
  return {
    start: range.start,
    end: range.start,
  };
}
