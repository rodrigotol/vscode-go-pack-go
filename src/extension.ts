import * as vscode from 'vscode';

import { createTableTestCodeLensDescriptors, TableTestScenarioCommandArgument } from './testTableCodeLens';
import { detectTestTableScenarios, SourceRange } from './testTableDetector';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('go-pack-go.ping', () => {
      vscode.window.showInformationMessage('Go Pack Go is active.');
    }),
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

function toVsCodeCommandArgument(argument: TableTestScenarioCommandArgument): {
  readonly uri: vscode.Uri;
  readonly scenarioRange: vscode.Range;
  readonly testName: string;
  readonly tableName: string;
  readonly label?: string;
} {
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
