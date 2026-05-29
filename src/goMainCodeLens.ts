import { detectGoMainFunctions, GoMainFunction, GoMainRange } from './goMainDetector';

export const runGoMainCommand = 'go-pack-go.runGoMain';
export const debugGoMainCommand = 'go-pack-go.debugGoMain';
export const runGoMainTitle = '▶ run';
export const debugGoMainTitle = '𓆣 debug';

export interface GoMainCodeLensCommandArgument {
  readonly uri: string;
}

export interface GoMainCodeLensDescriptor {
  readonly range: GoMainRange;
  readonly title: string;
  readonly command: string;
  readonly arguments: readonly [GoMainCodeLensCommandArgument];
}

interface GoMainCodeLensDocument {
  readonly languageId: string;
  readonly isUntitled: boolean;
  readonly isDirty: boolean;
  readonly version: number;
  readonly uri: {
    toString(): string;
  };
  getText(): string;
}

interface GoMainCodeLensProviderDependencies {
  readonly detectMainFunctions?: (document: GoMainCodeLensDocument) => Promise<readonly GoMainFunction[]>;
}

interface CachedGoMainCodeLensDescriptors {
  readonly version: number;
  readonly descriptors: readonly GoMainCodeLensDescriptor[];
}

export interface GoMainCodeLensChangeEvent {
  readonly uri?: string;
}

export interface GoMainCodeLensListenerDisposable {
  dispose(): void;
}

export function createGoMainCodeLensDescriptors(
  uri: string,
  mainFunctions: readonly GoMainFunction[],
): GoMainCodeLensDescriptor[] {
  return mainFunctions.flatMap((mainFunction) => {
    const argument = createGoMainCodeLensCommandArgument(uri);
    const range = createCodeLensRange(mainFunction.range);

    return [
      {
        range,
        title: runGoMainTitle,
        command: runGoMainCommand,
        arguments: [argument],
      },
      {
        range,
        title: debugGoMainTitle,
        command: debugGoMainCommand,
        arguments: [argument],
      },
    ];
  });
}

export class GoMainCodeLensProvider {
  private readonly cache = new Map<string, CachedGoMainCodeLensDescriptors>();
  private readonly listeners = new Set<(event: GoMainCodeLensChangeEvent | undefined) => void>();
  private readonly detectMainFunctions: (document: GoMainCodeLensDocument) => Promise<readonly GoMainFunction[]>;

  constructor(dependencies: GoMainCodeLensProviderDependencies = {}) {
    this.detectMainFunctions = dependencies.detectMainFunctions ?? detectGoMainFunctions;
  }

  onDidChangeCodeLenses(
    listener: (event: GoMainCodeLensChangeEvent | undefined) => void,
  ): GoMainCodeLensListenerDisposable {
    this.listeners.add(listener);

    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async provideCodeLensDescriptors(document: GoMainCodeLensDocument): Promise<readonly GoMainCodeLensDescriptor[]> {
    const cacheKey = document.uri.toString();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.version === document.version) {
      return cached.descriptors;
    }

    const descriptors = createGoMainCodeLensDescriptors(
      cacheKey,
      await this.detectMainFunctions(document),
    );

    this.cache.set(cacheKey, {
      version: document.version,
      descriptors,
    });

    return descriptors;
  }

  invalidateDocument(documentUri: { toString(): string } | string): void {
    this.cache.delete(toUriString(documentUri));
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  refreshDocument(documentUri?: { toString(): string } | string): void {
    const event = documentUri ? { uri: toUriString(documentUri) } : undefined;

    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function createGoMainCodeLensCommandArgument(uri: string): GoMainCodeLensCommandArgument {
  return { uri };
}

function createCodeLensRange(range: GoMainRange): GoMainRange {
  return {
    start: range.start,
    end: range.start,
  };
}

function toUriString(documentUri: { toString(): string } | string): string {
  return typeof documentUri === 'string' ? documentUri : documentUri.toString();
}
