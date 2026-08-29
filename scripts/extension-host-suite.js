const assert = require('node:assert/strict');
const vscode = require('vscode');

const extensionId = 'rodrigotol.go-pack-go';
const registeredCommands = [
  'go-pack-go.runGoMain',
  'go-pack-go.debugGoMain',
  'go-pack-go.runTableTestScenario',
  'go-pack-go.debugTableTestScenario',
  'go-pack-go.goToTypeImplementation',
  'go-pack-go.findReferences',
  'go-pack-go.openReference',
  'go-pack-go.toggleWrite',
  'go-pack-go.toggleRead',
  'go-pack-go.toggleOther',
];

async function run() {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `Expected packaged extension ${extensionId} to be installed.`);

  await extension.activate();
  assert.equal(extension.isActive, true, 'The packaged extension did not activate.');

  const commands = await vscode.commands.getCommands(true);
  for (const command of registeredCommands) {
    assert.ok(commands.includes(command), `Expected command ${command} to be registered after activation.`);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, 'The extension-host fixture workspace was not opened.');
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspaceFolder.uri, 'smoke_test.go'),
  );
  const codeLenses = await vscode.commands.executeCommand(
    'vscode.executeCodeLensProvider',
    document.uri,
  );
  assert.ok(Array.isArray(codeLenses), 'Expected Go CodeLens providers to return an array.');

  const codeLensCommands = new Set(
    codeLenses.flatMap((codeLens) => codeLens.command?.command ? [codeLens.command.command] : []),
  );
  for (const command of [
    'go-pack-go.runTableTestScenario',
    'go-pack-go.debugTableTestScenario',
    'go-pack-go.goToTypeImplementation',
    'go-pack-go.runGoMain',
    'go-pack-go.debugGoMain',
  ]) {
    assert.ok(codeLensCommands.has(command), `Expected CodeLens command ${command} from the packaged extension.`);
  }
}

module.exports = { run };
