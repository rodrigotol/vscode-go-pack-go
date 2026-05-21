import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('go-pack-go.ping', () => {
      vscode.window.showInformationMessage('Go Pack Go is active.');
    }),
  );
}

export function deactivate(): void {}
