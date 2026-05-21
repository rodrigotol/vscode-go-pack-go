import * as vscode from 'vscode';

import {
  createTableTestCodeLensDescriptors,
  debugTableTestScenarioCommand,
  runTableTestScenarioCommand,
  TableTestScenarioCommandArgument,
} from './testTableCodeLens';
import { detectTestTableScenarios, SourceRange } from './testTableDetector';

const goRunSubtestAtCursorCommand = 'go.subtest.cursor';
const goDebugSubtestAtCursorCommand = 'go.debug.subtest.cursor';

interface VsCodeTableTestScenarioCommandArgument {
  readonly uri: vscode.Uri;
  readonly scenarioRange: vscode.Range;
  readonly testName: string;
  readonly tableName: string;
  readonly label?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('go-pack-go.ping', () => {
      vscode.window.showInformationMessage('Go Pack Go is active.');
    }),
    vscode.commands.registerCommand(runTableTestScenarioCommand, (argument: VsCodeTableTestScenarioCommandArgument) =>
      delegateScenarioToGoExtension(argument, goRunSubtestAtCursorCommand),
    ),
    vscode.commands.registerCommand(debugTableTestScenarioCommand, (argument: VsCodeTableTestScenarioCommandArgument) =>
      delegateScenarioToGoExtension(argument, goDebugSubtestAtCursorCommand),
    ),
    vscode.languages.registerCodeLensProvider(
      { language: 'go', scheme: '*' },
      new TableTestCodeLensProvider(),
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

function isGoTestDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'go' && document.fileName.endsWith('_test.go');
}

async function delegateScenarioToGoExtension(
  argument: VsCodeTableTestScenarioCommandArgument,
  goCommand: string,
): Promise<void> {
  if (!isScenarioCommandArgument(argument)) {
    vscode.window.showErrorMessage('Unable to run table test scenario because its location is unavailable.');
    return;
  }

  const document = await vscode.workspace.openTextDocument(argument.uri);
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: false,
  });

  editor.selection = new vscode.Selection(argument.scenarioRange.start, argument.scenarioRange.end);
  editor.revealRange(argument.scenarioRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(goCommand)) {
    vscode.window.showErrorMessage('Install or enable the Go extension to run and debug table test scenarios.');
    return;
  }

  await vscode.commands.executeCommand(goCommand);
}

function isScenarioCommandArgument(value: unknown): value is VsCodeTableTestScenarioCommandArgument {
  const argument = value as Partial<VsCodeTableTestScenarioCommandArgument>;

  return argument.uri instanceof vscode.Uri && argument.scenarioRange instanceof vscode.Range;
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

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}
