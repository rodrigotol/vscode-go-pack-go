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
import { ReadWriteReferencesAggregator } from './readWriteReferencesAggregator';
import {
  ReadWriteReferencesPanel,
  ReadWriteReferencesPanelIncomingMessage,
} from './readWriteReferencesPanel';
import {
  createTypeImplementationCodeLensDescriptors,
  GoToTypeImplementationCommandArgument,
  goToTypeImplementationCommand,
} from './typeImplementationCodeLens';
import { detectTypeImplementations, TypeImplementationTargetKind } from './typeImplementationDetector';
import { ReadWriteReferenceItem, ReadWriteReferencesResult } from './readWriteReferencesModel';

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

const showSeparatedReferencesCommand = 'go-pack-go.showSeparatedReferences';

export function activate(context: vscode.ExtensionContext): void {
  const goMainLogger = createGoMainLogger();
  const goMainCodeLensProvider = new GoMainVsCodeCodeLensProvider();
  const goMainRefreshDisposable = registerGoMainCodeLensRefresh(context, goMainCodeLensProvider);
  const readWriteReferencesController = new ReadWriteReferencesController(context.extensionUri);

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
    vscode.commands.registerCommand(showSeparatedReferencesCommand, () =>
      readWriteReferencesController.showForActiveEditor(),
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
    readWriteReferencesController,
  );
}

export function deactivate(): void {}

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

class ReadWriteReferencesController implements vscode.Disposable {
  private readonly aggregator = new ReadWriteReferencesAggregator();
  private panel: ReadWriteReferencesPanel | undefined;
  private currentResult: ReadWriteReferencesResult | undefined;
  private currentRequest: vscode.CancellationTokenSource | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async showForActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isGoDocument(editor.document)) {
      void vscode.window.showErrorMessage('Read/write references are only available for Go files.');
      return;
    }

    await this.showForDocument(editor.document, editor.selection.active);
  }

  dispose(): void {
    this.currentRequest?.dispose();
    this.currentRequest = undefined;
    this.currentResult = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private getOrCreatePanel(): ReadWriteReferencesPanel {
    if (this.panel) {
      return this.panel;
    }

    this.panel = ReadWriteReferencesPanel.create(this.extensionUri);
    this.panel.onDidReceiveMessage((message) => {
      void this.handlePanelMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentResult = undefined;
    });

    return this.panel;
  }

  private async handlePanelMessage(message: ReadWriteReferencesPanelIncomingMessage): Promise<void> {
    if (message.type === 'refreshCurrentSymbol') {
      await this.refreshCurrentSymbol();
      return;
    }

    if (!isReadWriteReferenceItem(message.reference)) {
      return;
    }

    if (message.type === 'revealReference') {
      await revealReferenceInEditor(message.reference);
      return;
    }

    if (message.type === 'openReference') {
      await openReferenceInEditor(message.reference);
    }
  }

  private async refreshCurrentSymbol(): Promise<void> {
    if (!this.currentResult) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(this.currentResult.query.uri));
    await this.showForDocument(document, toVsCodePosition(this.currentResult.query.position));
  }

  private async showForDocument(document: vscode.TextDocument, position: vscode.Position): Promise<void> {
    const panel = this.getOrCreatePanel();
    const tokenSource = this.beginRequest();

    const result = await this.aggregator.build(document, position, tokenSource.token);
    if (tokenSource.token.isCancellationRequested) {
      return;
    }

    if (!result) {
      panel.clear();
      void vscode.window.showErrorMessage('Place the cursor on a Go symbol to show read/write references.');
      return;
    }

    this.currentResult = result;
    panel.reveal(result);
  }

  private beginRequest(): vscode.CancellationTokenSource {
    this.currentRequest?.cancel();
    this.currentRequest?.dispose();
    this.currentRequest = new vscode.CancellationTokenSource();
    return this.currentRequest;
  }
}

async function revealReferenceInEditor(reference: ReadWriteReferenceItem): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(reference.uri));
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: true,
    preview: true,
  });
  const range = toVsCodeRange(reference.range);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function openReferenceInEditor(reference: ReadWriteReferenceItem): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(reference.uri));
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: false,
  });
  const range = toVsCodeRange(reference.range);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function isReadWriteReferenceItem(value: unknown): value is ReadWriteReferenceItem {
  const reference = value as Partial<ReadWriteReferenceItem>;

  return (
    typeof reference.uri === 'string' &&
    isSourceRange(reference.range) &&
    (reference.classification === 'read' ||
      reference.classification === 'write' ||
      reference.classification === 'read-write')
  );
}

function isSourceRange(value: unknown): value is SourceRange {
  const range = value as Partial<SourceRange>;

  return isSourcePosition(range.start) && isSourcePosition(range.end);
}

function isSourcePosition(value: unknown): value is SourceRange['start'] {
  const position = value as Partial<SourceRange['start']>;

  return typeof position.line === 'number' && typeof position.character === 'number';
}
