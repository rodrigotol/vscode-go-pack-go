import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';
import type * as vscode from 'vscode';

const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load;

const configurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

type InspectResult = {
  readonly globalValue?: string;
  readonly workspaceValue?: string;
  readonly workspaceFolderValue?: string;
};

let activeTextEditor: { readonly document: { readonly uri: ReturnType<typeof createUri> } } | undefined;
let workspaceFolderForResource: { readonly uri: ReturnType<typeof createUri> } | undefined;
let inspectResult: InspectResult | undefined;
const configurationUpdates: Array<{
  readonly resource?: string;
  readonly key: string;
  readonly value: string | undefined;
  readonly target: number;
}> = [];
const infoMessages: string[] = [];
const warningMessages: string[] = [];
const infoPrompts: Array<{
  readonly message: string;
  readonly items: readonly string[];
}> = [];
let nextPromptChoice: string | undefined;

moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
) {
  if (request === 'vscode') {
    return {
      window: {
        get activeTextEditor() {
          return activeTextEditor;
        },
        showInformationMessage: async (
          message: string,
          optionsOrItem?: { readonly modal?: boolean } | string,
          ...items: string[]
        ) => {
          if (typeof optionsOrItem === 'string') {
            infoMessages.push(message);
            return optionsOrItem;
          }

          if (items.length > 0) {
            infoPrompts.push({ message, items });
            return nextPromptChoice;
          }

          infoMessages.push(message);
          return undefined;
        },
        showWarningMessage: async (message: string) => {
          warningMessages.push(message);
          return undefined;
        },
      },
      workspace: {
        getConfiguration: (_section: string, resource?: ReturnType<typeof createUri>) => ({
          inspect: () => inspectResult,
          update: async (key: string, value: string | undefined, target: number) => {
            configurationUpdates.push({
              resource: resource?.toString(),
              key,
              value,
              target,
            });
          },
        }),
        getWorkspaceFolder: () => workspaceFolderForResource,
      },
      Uri: {
        parse: (value: string) => createUri(value),
      },
      ConfigurationTarget: configurationTarget,
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  AlternativeDefinitionFallbackManager,
  resolveAlternativeDefinitionSettingState,
  showSeparatedReferencesCommand,
} = require('./alternativeDefinitionFallback') as typeof import('./alternativeDefinitionFallback');

test('resolveAlternativeDefinitionSettingState prefers workspace folder values when available', () => {
  const result = resolveAlternativeDefinitionSettingState(
    {
      globalValue: 'global.command',
      workspaceValue: 'workspace.command',
      workspaceFolderValue: 'folder.command',
    } as InspectResult,
    'file:///workspace/folder',
  );

  assert.deepEqual(result, {
    currentCommand: 'folder.command',
    target: 'workspaceFolder',
    workspaceFolderUri: 'file:///workspace/folder',
  });
});

test('enableSeparatedReferencesFallback stores the previous command and updates the same target', async () => {
  resetState();
  const context = createExtensionContext();
  activeTextEditor = { document: { uri: createUri('file:///workspace/main.go') } };
  workspaceFolderForResource = { uri: createUri('file:///workspace') };
  inspectResult = {
    workspaceValue: 'editor.action.goToReferences',
  };
  nextPromptChoice = 'Enable';

  const manager = new AlternativeDefinitionFallbackManager(context);
  await manager.enableSeparatedReferencesFallback();

  assert.deepEqual(context.store.get('go-pack-go.previousAlternativeDefinitionCommand'), {
    previousCommand: 'editor.action.goToReferences',
    target: 'workspace',
    workspaceFolderUri: undefined,
  });
  assert.deepEqual(configurationUpdates, [
    {
      resource: undefined,
      key: 'gotoLocation.alternativeDefinitionCommand',
      value: showSeparatedReferencesCommand,
      target: configurationTarget.Workspace,
    },
  ]);
});

test('enableSeparatedReferencesFallback leaves settings unchanged when the user declines', async () => {
  resetState();
  const context = createExtensionContext();
  inspectResult = {
    globalValue: 'editor.action.peekDefinition',
  };
  nextPromptChoice = 'Not now';

  const manager = new AlternativeDefinitionFallbackManager(context);
  await manager.enableSeparatedReferencesFallback();

  assert.equal(context.store.size, 0);
  assert.deepEqual(configurationUpdates, []);
});

test('restorePreviousSeparatedReferencesFallback reapplies the stored command and clears state', async () => {
  resetState();
  const context = createExtensionContext([
    [
      'go-pack-go.previousAlternativeDefinitionCommand',
      {
        previousCommand: 'editor.action.goToReferences',
        target: 'workspaceFolder',
        workspaceFolderUri: 'file:///workspace/folder',
      },
    ],
  ]);

  const manager = new AlternativeDefinitionFallbackManager(context);
  await manager.restorePreviousSeparatedReferencesFallback();

  assert.deepEqual(configurationUpdates, [
    {
      resource: 'file:///workspace/folder',
      key: 'gotoLocation.alternativeDefinitionCommand',
      value: 'editor.action.goToReferences',
      target: configurationTarget.WorkspaceFolder,
    },
  ]);
  assert.equal(context.store.has('go-pack-go.previousAlternativeDefinitionCommand'), false);
});

function createExtensionContext(initialEntries: ReadonlyArray<readonly [string, unknown]> = []) {
  const store = new Map<string, unknown>(initialEntries);

  return {
    store,
    globalState: {
      get<T>(key: string) {
        return store.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        if (value === undefined) {
          store.delete(key);
          return;
        }

        store.set(key, value);
      },
    },
  } as unknown as {
    readonly store: Map<string, unknown>;
    readonly globalState: {
      get<T>(key: string): T | undefined;
      update(key: string, value: unknown): Promise<void>;
    };
  } & vscode.ExtensionContext;
}

function createUri(value: string) {
  return {
    scheme: 'file',
    authority: '',
    path: value.replace(/^file:\/\//, ''),
    query: '',
    fragment: '',
    fsPath: value.replace(/^file:\/\//, ''),
    toString() {
      return value;
    },
    with() {
      return createUri(value);
    },
    toJSON() {
      return value;
    },
  };
}

function resetState(): void {
  activeTextEditor = undefined;
  workspaceFolderForResource = undefined;
  inspectResult = undefined;
  configurationUpdates.length = 0;
  infoMessages.length = 0;
  warningMessages.length = 0;
  infoPrompts.length = 0;
  nextPromptChoice = undefined;
}
