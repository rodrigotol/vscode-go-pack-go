import * as path from 'path';
import * as vscode from 'vscode';

import { createGoMainLogger } from './goMainLogger';
import {
  debugGoMainCommand as debugGoMainRunnerCommand,
  runGoMainCommand as runGoMainRunnerCommand,
} from './goMainRunner';
import { SourceRange } from './goTreeSitter';
import { createGoTestRunPattern } from './goTestRun';
import {
  debugGoMainCommand,
  GoMainCodeLensCommandArgument,
  GoMainCodeLensProvider,
  runGoMainCommand,
} from './goMainCodeLens';
import {
  createTableTestCodeLensDescriptors,
  debugTableTestScenarioCommand,
  runTableTestScenarioCommand,
  TableTestScenarioCommandArgument,
} from './testTableCodeLens';
import { detectTestTableScenarios } from './testTableDetector';
import {
  createTypeImplementationCodeLensDescriptors,
  GoToTypeImplementationCommandArgument,
  goToTypeImplementationCommand,
} from './typeImplementationCodeLens';
import { detectTypeImplementations, TypeImplementationTargetKind } from './typeImplementationDetector';
import { FilterState } from './readWriteReferencesFilterState';
import { ReferencesTreeProvider } from './readWriteReferencesTreeProvider';
import { PreviewController } from './readWriteReferencesPreviewController';
import { ClassifiedReference, RefKind } from './readWriteReferencesTypes';
import { findClassifiedReferences } from './readWriteReferencesEngine';


const VIEW_ID = "go-pack-go.referencesView";

interface VsCodeTableTestScenarioCommandArgument {
  readonly uri: vscode.Uri;
  readonly scenarioRange: vscode.Range;
  readonly testName: string;
  readonly tableName: string;
  readonly label?: string;
}

interface VsCodeGoToTypeImplementationCommandArgument {
  readonly uri: vscode.Uri;
  readonly position: vscode.Position;
  readonly typeName: string;
  readonly kind: TypeImplementationTargetKind;
  readonly methodName?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const goMainLogger = createGoMainLogger();
  const goMainCodeLensProvider = new GoMainVsCodeCodeLensProvider();
  const goMainRefreshDisposable = registerGoMainCodeLensRefresh(context, goMainCodeLensProvider);
  const filterState = new FilterState();
  const treeProvider = new ReferencesTreeProvider(filterState);
  const previewController = new PreviewController();

  const DOUBLE_CLICK_MS = 250;
  let lastClick: { key: string; time: number } | undefined;

  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: treeProvider,
  });

  const treeVisibilitySub = treeView.onDidChangeVisibility((e) => {
    if (!e.visible) {
      void previewController.closePreviewTab();
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('go-pack-go.ping', () => {
      vscode.window.showInformationMessage('Go Pack Go is active.');
    }),
    vscode.commands.registerCommand(runGoMainCommand, (argument: GoMainCodeLensCommandArgument) =>
      runGoMainRunnerCommand(argument, {
        logger: goMainLogger,
        showErrorMessage: (message) => {
          goMainLogger.error(message);
          void vscode.window.showErrorMessage(message);
        },
      }),
    ),
    vscode.commands.registerCommand(debugGoMainCommand, (argument: GoMainCodeLensCommandArgument) =>
      debugGoMainRunnerCommand(argument, {
        logger: goMainLogger,
        showErrorMessage: (message) => {
          goMainLogger.error(message);
          void vscode.window.showErrorMessage(message);
        },
      }),
    ),
    vscode.commands.registerCommand(runTableTestScenarioCommand, (argument: VsCodeTableTestScenarioCommandArgument) =>
      runTableTestScenario(argument),
    ),
    vscode.commands.registerCommand(debugTableTestScenarioCommand, (argument: VsCodeTableTestScenarioCommandArgument) =>
      debugTableTestScenario(argument),
    ),
    vscode.commands.registerCommand(
      goToTypeImplementationCommand,
      (argument: VsCodeGoToTypeImplementationCommandArgument) => goToTypeImplementation(argument),
    ),
    vscode.languages.registerCodeLensProvider(
      { language: 'go', scheme: '*' },
      new TableTestCodeLensProvider(),
    ),
    vscode.languages.registerCodeLensProvider(
      { language: 'go', scheme: '*' },
      new TypeImplementationCodeLensProvider(),
    ),
    vscode.languages.registerCodeLensProvider(
      { language: 'go', scheme: '*' },
      goMainCodeLensProvider,
    ),
    goMainRefreshDisposable,
    
    // readWriteReferences extension
    filterState,
    treeProvider,
    previewController,
    treeView,
    treeVisibilitySub,
    vscode.commands.registerCommand("go-pack-go.findReferences", 
      () => runFindReferences(treeProvider, treeView, previewController)
    ),
    vscode.commands.registerCommand("go-pack-go.openReference", (ref: ClassifiedReference) => {
      const key = `${ref.uri.toString()}#${ref.range.start.line}:${ref.range.start.character}`;
      const now = Date.now();
      const isDouble = lastClick?.key === key && now - lastClick.time <= DOUBLE_CLICK_MS;
      lastClick = isDouble ? undefined : { key, time: now };

      return isDouble ? previewController.openPermanent(ref) : previewController.preview(ref);
    }),
    vscode.commands.registerCommand("go-pack-go.toggleWrite", () => filterState.toggle(RefKind.Write)),
    vscode.commands.registerCommand("go-pack-go.toggleRead", () => filterState.toggle(RefKind.Read)),
    vscode.commands.registerCommand("go-pack-go.toggleOther", () => filterState.toggle(RefKind.Other))
  );
}

export function deactivate(): void { }

class TableTestCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (!isGoTestDocument(document)) {
      return [];
    }

    const result = await detectTestTableScenarios(document.getText());
    if (token.isCancellationRequested || !result.parseSucceeded || result.hasSyntaxError) {
      return [];
    }

    return createTableTestCodeLensDescriptors(document.uri.toString(), result.scenarios).map((descriptor) => {
      const argument = toVsCodeCommandArgument(descriptor.arguments[0]);

      return new vscode.CodeLens(toVsCodeRange(descriptor.range), {
        title: descriptor.title,
        command: descriptor.command,
        arguments: [argument],
      });
    });
  }
}

class TypeImplementationCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (!isGoDocument(document)) {
      return [];
    }

    const result = await detectTypeImplementations(document.getText());
    if (token.isCancellationRequested || !result.parseSucceeded || result.hasSyntaxError) {
      return [];
    }

    const implementationTargets = result.declarations;
    const descriptors = createTypeImplementationCodeLensDescriptors(
      document.uri.toString(),
      implementationTargets,
    );

    return descriptors.map((descriptor) => {
      const argument = toVsCodeTypeImplementationCommandArgument(descriptor.arguments[0]);

      return new vscode.CodeLens(toVsCodeRange(descriptor.range), {
        title: descriptor.title,
        command: descriptor.command,
        arguments: [argument],
      });
    });
  }
}

class GoMainVsCodeCodeLensProvider implements vscode.CodeLensProvider {
  private readonly provider = new GoMainCodeLensProvider();
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor() {
    this.provider.onDidChangeCodeLenses(() => {
      this.changeEmitter.fire();
    });
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const descriptors = await this.provider.provideCodeLensDescriptors(document);

    return descriptors.map((descriptor) => new vscode.CodeLens(toVsCodeRange(descriptor.range), {
      title: descriptor.title,
      command: descriptor.command,
      arguments: [...descriptor.arguments],
    }));
  }

  invalidateDocument(documentUri: vscode.Uri): void {
    this.provider.invalidateDocument(documentUri);
  }

  refreshDocument(documentUri?: vscode.Uri): void {
    this.provider.refreshDocument(documentUri);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

function isGoDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'go';
}

function isGoTestDocument(document: vscode.TextDocument): boolean {
  return isGoDocument(document) && document.fileName.endsWith('_test.go');
}

async function runTableTestScenario(argument: VsCodeTableTestScenarioCommandArgument): Promise<void> {
  const context = await prepareScenarioCommand(argument);
  if (!context) {
    return;
  }

  const task = new vscode.Task(
    { type: 'go-pack-go', task: 'runTableTestScenario' },
    context.workspaceFolder ?? vscode.TaskScope.Workspace,
    `go test ${context.argument.testName}/${context.argument.label}`,
    'go-pack-go',
    new vscode.ShellExecution('go', ['test', '-run', context.runPattern], {
      cwd: path.dirname(context.argument.uri.fsPath),
    }),
    [],
  );

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: true,
  };

  await vscode.tasks.executeTask(task);
}

async function debugTableTestScenario(argument: VsCodeTableTestScenarioCommandArgument): Promise<void> {
  const context = await prepareScenarioCommand(argument);
  if (!context) {
    return;
  }

  const started = await vscode.debug.startDebugging(context.workspaceFolder, {
    name: `Debug ${context.argument.testName}/${context.argument.label}`,
    type: 'go',
    request: 'launch',
    mode: 'test',
    program: path.dirname(context.argument.uri.fsPath),
    args: ['-test.run', context.runPattern],
  });

  if (!started) {
    vscode.window.showErrorMessage('Unable to start Go debugger for the selected table test scenario.');
  }
}

async function prepareScenarioCommand(argument: VsCodeTableTestScenarioCommandArgument): Promise<{
  readonly argument: VsCodeTableTestScenarioCommandArgument;
  readonly runPattern: string;
  readonly workspaceFolder: vscode.WorkspaceFolder | undefined;
} | undefined> {
  if (!isScenarioCommandArgument(argument)) {
    vscode.window.showErrorMessage('Unable to run table test scenario because its location is unavailable.');
    return undefined;
  }

  if (!argument.label) {
    vscode.window.showErrorMessage('Unable to run table test scenario because its subtest name is not statically known.');
    return undefined;
  }

  const document = await vscode.workspace.openTextDocument(argument.uri);
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: false,
  });

  editor.selection = new vscode.Selection(argument.scenarioRange.start, argument.scenarioRange.end);
  editor.revealRange(argument.scenarioRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  return {
    argument,
    runPattern: createGoTestRunPattern(argument.testName, argument.label),
    workspaceFolder: vscode.workspace.getWorkspaceFolder(argument.uri),
  };
}

async function goToTypeImplementation(argument: VsCodeGoToTypeImplementationCommandArgument): Promise<void> {
  if (!isGoToTypeImplementationCommandArgument(argument)) {
    vscode.window.showErrorMessage('Unable to go to type implementation because its location is unavailable.');
    return;
  }

  const document = await vscode.workspace.openTextDocument(argument.uri);
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: false,
  });

  const selection = new vscode.Selection(argument.position, argument.position);
  editor.selection = selection;
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  await vscode.commands.executeCommand('editor.action.goToImplementation');
}

function isScenarioCommandArgument(value: unknown): value is VsCodeTableTestScenarioCommandArgument {
  const argument = value as Partial<VsCodeTableTestScenarioCommandArgument>;

  return argument.uri instanceof vscode.Uri && argument.scenarioRange instanceof vscode.Range;
}

function isGoToTypeImplementationCommandArgument(value: unknown): value is VsCodeGoToTypeImplementationCommandArgument {
  const argument = value as Partial<VsCodeGoToTypeImplementationCommandArgument>;

  return (
    argument.uri instanceof vscode.Uri &&
    argument.position instanceof vscode.Position &&
    typeof argument.typeName === 'string' &&
    isTypeImplementationTargetKind(argument.kind) &&
    hasValidMethodName(argument.kind, argument.methodName)
  );
}

function isTypeImplementationTargetKind(value: unknown): value is TypeImplementationTargetKind {
  return value === 'struct' || value === 'interface' || value === 'method' || value === 'interface-method';
}

function hasValidMethodName(
  kind: TypeImplementationTargetKind,
  methodName: unknown,
): methodName is string | undefined {
  if (kind === 'method' || kind === 'interface-method') {
    return typeof methodName === 'string';
  }

  return methodName === undefined;
}

function toVsCodeCommandArgument(argument: TableTestScenarioCommandArgument): VsCodeTableTestScenarioCommandArgument {
  return {
    uri: vscode.Uri.parse(argument.uri),
    scenarioRange: toVsCodeRange(argument.scenarioRange),
    testName: argument.testName,
    tableName: argument.tableName,
    label: argument.label,
  };
}

function toVsCodeTypeImplementationCommandArgument(
  argument: GoToTypeImplementationCommandArgument,
): VsCodeGoToTypeImplementationCommandArgument {
  return {
    uri: vscode.Uri.parse(argument.uri),
    position: toVsCodePosition(argument.position),
    typeName: argument.typeName,
    kind: argument.kind,
    methodName: argument.methodName,
  };
}

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

function toVsCodePosition(position: SourceRange['start']): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function registerGoMainCodeLensRefresh(
  context: vscode.ExtensionContext,
  provider: GoMainVsCodeCodeLensProvider,
): vscode.Disposable {
  const pendingRefreshes = new Map<string, NodeJS.Timeout>();
  const debounceDelayMs = 500;

  const scheduleRefresh = (document: vscode.TextDocument): void => {
    if (!isGoDocument(document)) {
      return;
    }

    const cacheKey = document.uri.toString();
    const pending = pendingRefreshes.get(cacheKey);
    if (pending) {
      clearTimeout(pending);
    }

    pendingRefreshes.set(cacheKey, setTimeout(() => {
      pendingRefreshes.delete(cacheKey);
      provider.invalidateDocument(document.uri);
      provider.refreshDocument(document.uri);
    }, debounceDelayMs));
  };

  const clearPendingRefresh = (document: vscode.TextDocument): void => {
    const cacheKey = document.uri.toString();
    const pending = pendingRefreshes.get(cacheKey);
    if (pending) {
      clearTimeout(pending);
      pendingRefreshes.delete(cacheKey);
    }
  };

  const flushAndDispose = (): void => {
    for (const timeout of pendingRefreshes.values()) {
      clearTimeout(timeout);
    }
    pendingRefreshes.clear();
    provider.dispose();
  };

  const subscriptions = [
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleRefresh(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      clearPendingRefresh(document);
      provider.invalidateDocument(document.uri);
      provider.refreshDocument(document.uri);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearPendingRefresh(document);
      provider.invalidateDocument(document.uri);
      provider.refreshDocument(document.uri);
    }),
    new vscode.Disposable(flushAndDispose),
  ];

  context.subscriptions.push(...subscriptions);
  return new vscode.Disposable(() => {
    for (const subscription of subscriptions) {
      subscription.dispose();
    }
  });
}

async function runFindReferences(
  treeProvider: ReferencesTreeProvider,
  treeView: vscode.TreeView<unknown>,
  preview: PreviewController
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Open a file and place the cursor on a symbol first.");
    return;
  }

  preview.setOriginColumn(editor.viewColumn);

  const uri = editor.document.uri;
  const position = editor.selection.active;
  const symbolLabel = editor.document.getText(
    editor.document.getWordRangeAtPosition(position)
  ) || "symbol";

  treeProvider.clear();
  treeView.message = `Searching for references to ${symbolLabel}"…`;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `Finding references to "${symbolLabel}"...`,
    },
    async (_progress, token) => {
      const references = await findClassifiedReferences(uri, position, token);
      treeProvider.setReferences(symbolLabel, references);

      if (references.length === 0) {
        treeView.message = `No references found for "${symbolLabel}".`;
        void vscode.window.showInformationMessage(`Go Pack Go: no references found for "${symbolLabel}".`);
        return;
      }

      treeView.message = treeProvider.summary() || undefined;
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
  );
}