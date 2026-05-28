import * as path from 'path';
import * as vscode from 'vscode';

import { SourceRange } from './goTreeSitter';
import { createGoTestRunPattern } from './goTestRun';
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
  context.subscriptions.push(
    vscode.commands.registerCommand('go-pack-go.ping', () => {
      vscode.window.showInformationMessage('Go Pack Go is active.');
    }),
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

    return createTypeImplementationCodeLensDescriptors(document.uri.toString(), result.declarations).map(
      (descriptor) => {
        const argument = toVsCodeTypeImplementationCommandArgument(descriptor.arguments[0]);

        return new vscode.CodeLens(toVsCodeRange(descriptor.range), {
          title: descriptor.title,
          command: descriptor.command,
          arguments: [argument],
        });
      },
    );
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

  return argument.uri instanceof vscode.Uri && argument.position instanceof vscode.Position;
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
