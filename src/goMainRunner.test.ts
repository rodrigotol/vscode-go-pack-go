import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  createGoMainDebugConfiguration,
  createGoMainRunTaskSpec,
  createGoMainStatusMessage,
  debugGoMainCommand,
  prepareGoMainExecution,
  runGoMainCommand,
} from './goMainRunner';

test('prepareGoMainExecution resolves a shared validated execution context and matching launch config', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');
  const workspaceFolderPath = createAbsolutePath('workspace');

  const prepared = await prepareGoMainExecution(
    { uri: 'file:///workspace/cmd/app/main.go' },
    {
      parseUri: () => ({ fsPath: filePath, toString: () => 'file:///workspace/cmd/app/main.go' }),
      loadDocument: async () => createDocument(filePath),
      pathExists: async () => true,
      getWorkspaceFolder: () => ({ uri: { fsPath: workspaceFolderPath }, name: 'workspace' }),
      isPackageMain: async () => true,
      findMatchingLaunchConfiguration: async () => ({
        configuration: {
          name: 'App Main',
          type: 'go',
          request: 'launch',
          program: '${workspaceFolder}/cmd/app',
          cwd: '${workspaceFolder}/tmp',
          env: { APP_ENV: 'dev' },
          buildFlags: '-tags=integration',
          args: ['--port', '8080'],
          mode: 'debug',
          console: 'integratedTerminal',
          showLog: true,
        },
        launchJsonPath: path.join(workspaceFolderPath, '.vscode', 'launch.json'),
        launchRootDir: workspaceFolderPath,
        programDirectory: path.join(workspaceFolderPath, 'cmd', 'app'),
      }),
    },
  );

  assert.equal(prepared?.context.filePath, filePath);
  assert.equal(prepared?.resolvedCwd, path.join(workspaceFolderPath, 'tmp'));
  assert.deepEqual(prepared?.launchOptions, {
    cwd: path.join(workspaceFolderPath, 'tmp'),
    env: { APP_ENV: 'dev' },
    buildFlags: '-tags=integration',
    args: ['--port', '8080'],
  });
});

test('runGoMainCommand builds go run against the clicked main directory', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');
  const workspaceFolderPath = createAbsolutePath('workspace');
  let executedTask: ReturnType<typeof createGoMainRunTaskSpec> | undefined;
  const statusMessages: string[] = [];

  await runGoMainCommand(
    { uri: 'file:///workspace/cmd/app/main.go' },
    {
      parseUri: () => ({ fsPath: filePath, toString: () => 'file:///workspace/cmd/app/main.go' }),
      loadDocument: async () => createDocument(filePath),
      pathExists: async () => true,
      getWorkspaceFolder: () => ({ uri: { fsPath: workspaceFolderPath }, name: 'workspace' }),
      isPackageMain: async () => true,
      findMatchingLaunchConfiguration: async () => ({
        configuration: {
          name: 'App Main',
          type: 'go',
          request: 'launch',
          program: '${workspaceFolder}/somewhere-else',
        },
        launchJsonPath: path.join(workspaceFolderPath, '.vscode', 'launch.json'),
        launchRootDir: workspaceFolderPath,
        programDirectory: path.join(workspaceFolderPath, 'cmd', 'app'),
      }),
      extractLaunchOptions: () => ({
        cwd: path.join(workspaceFolderPath, 'tmp'),
        env: { APP_ENV: 'dev' },
        buildFlags: '-tags=integration -count=1',
        args: ['--port', '8080'],
      }),
      executeTask: async (spec) => {
        executedTask = spec;
      },
      showStatusMessage: (message) => {
        statusMessages.push(message);
      },
    },
  );

  assert.deepEqual(executedTask, {
    definition: {
      type: 'go-pack-go',
      task: 'runGoMain',
      target: path.join(workspaceFolderPath, 'cmd', 'app'),
    },
    workspaceFolder: {
      uri: { fsPath: workspaceFolderPath },
      name: 'workspace',
    },
    name: 'go run app',
    source: 'go-pack-go',
    command: 'go',
    args: ['run', '-tags=integration', '-count=1', path.join(workspaceFolderPath, 'cmd', 'app'), '--port', '8080'],
    cwd: path.join(workspaceFolderPath, 'tmp'),
    env: { APP_ENV: 'dev' },
  });
  assert.match(statusMessages[0], /Running Go main/);
  assert.match(statusMessages[0], /App Main/);
});

test('debugGoMainCommand reports a missing Go extension before starting debug', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');
  const workspaceFolderPath = createAbsolutePath('workspace');
  const errors: string[] = [];
  let started = false;

  await debugGoMainCommand(
    { uri: 'file:///workspace/cmd/app/main.go' },
    {
      parseUri: () => ({ fsPath: filePath, toString: () => 'file:///workspace/cmd/app/main.go' }),
      loadDocument: async () => createDocument(filePath),
      pathExists: async () => true,
      getWorkspaceFolder: () => ({ uri: { fsPath: workspaceFolderPath }, name: 'workspace' }),
      isPackageMain: async () => true,
      ensureGoExtension: async () => false,
      startDebugging: async () => {
        started = true;
        return true;
      },
      showErrorMessage: (message) => {
        errors.push(message);
      },
    },
  );

  assert.equal(started, false);
  assert.equal(
    errors[0],
    'Unable to debug Go main because the Go extension (golang.go) is not installed.',
  );
});

test('debugGoMainCommand reports Delve guidance when debugging fails to start', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');
  const workspaceFolderPath = createAbsolutePath('workspace');
  const errors: string[] = [];

  await debugGoMainCommand(
    { uri: 'file:///workspace/cmd/app/main.go' },
    {
      parseUri: () => ({ fsPath: filePath, toString: () => 'file:///workspace/cmd/app/main.go' }),
      loadDocument: async () => createDocument(filePath),
      pathExists: async () => true,
      getWorkspaceFolder: () => ({ uri: { fsPath: workspaceFolderPath }, name: 'workspace' }),
      isPackageMain: async () => true,
      ensureGoExtension: async () => true,
      startDebugging: async () => false,
      showErrorMessage: (message) => {
        errors.push(message);
      },
    },
  );

  assert.equal(
    errors[0],
    'Unable to start Go debugging for this main package. Confirm that the Go extension is installed and Delve is available.',
  );
});

test('createGoMainDebugConfiguration always targets the clicked main directory', () => {
  const workspaceFolderPath = createAbsolutePath('workspace');
  const mainDirectory = path.join(workspaceFolderPath, 'cmd', 'app');

  const configuration = createGoMainDebugConfiguration({
    context: {
      document: createDocument(path.join(mainDirectory, 'main.go')),
      filePath: path.join(mainDirectory, 'main.go'),
      mainDirectory,
      workspaceFolder: { uri: { fsPath: workspaceFolderPath }, name: 'workspace' },
      workspaceFolderPath,
    },
    launchMatch: {
      configuration: {
        name: 'App Main',
        type: 'go',
        request: 'launch',
        program: '${workspaceFolder}/different',
        cwd: '${workspaceFolder}/tmp',
        mode: 'test',
        console: 'integratedTerminal',
        showLog: true,
      },
      launchJsonPath: path.join(workspaceFolderPath, '.vscode', 'launch.json'),
      launchRootDir: workspaceFolderPath,
      programDirectory: mainDirectory,
    },
    launchOptions: {
      cwd: path.join(workspaceFolderPath, 'tmp'),
      env: { APP_ENV: 'dev' },
      buildFlags: ['-tags=integration'],
      args: ['--port', '8080'],
    },
    resolvedCwd: path.join(workspaceFolderPath, 'tmp'),
  });

  assert.deepEqual(configuration, {
    name: 'App Main',
    type: 'go',
    request: 'launch',
    mode: 'test',
    program: mainDirectory,
    cwd: path.join(workspaceFolderPath, 'tmp'),
    console: 'integratedTerminal',
    showLog: true,
    env: { APP_ENV: 'dev' },
    buildFlags: ['-tags=integration'],
    args: ['--port', '8080'],
  });
});

test('createGoMainStatusMessage reports whether a launch config was used', () => {
  const workspaceFolderPath = createAbsolutePath('workspace');
  const mainDirectory = path.join(workspaceFolderPath, 'cmd', 'app');

  const withConfig = createGoMainStatusMessage('debug', {
    context: {
      document: createDocument(path.join(mainDirectory, 'main.go')),
      filePath: path.join(mainDirectory, 'main.go'),
      mainDirectory,
      workspaceFolder: { uri: { fsPath: workspaceFolderPath }, name: 'workspace' },
      workspaceFolderPath,
    },
    launchMatch: {
      configuration: {
        name: 'App Main',
        type: 'go',
        request: 'launch',
      },
      launchJsonPath: path.join(workspaceFolderPath, '.vscode', 'launch.json'),
      launchRootDir: workspaceFolderPath,
      programDirectory: mainDirectory,
    },
    launchOptions: undefined,
    resolvedCwd: mainDirectory,
  });

  const withoutConfig = createGoMainStatusMessage('run', {
    context: {
      document: createDocument(path.join(mainDirectory, 'main.go')),
      filePath: path.join(mainDirectory, 'main.go'),
      mainDirectory,
      workspaceFolder: { uri: { fsPath: workspaceFolderPath }, name: 'workspace' },
      workspaceFolderPath,
    },
    launchMatch: undefined,
    launchOptions: undefined,
    resolvedCwd: mainDirectory,
  });

  assert.match(withConfig, /Debugging Go main/);
  assert.match(withConfig, /App Main/);
  assert.match(withoutConfig, /without a matching launch config/);
});

function createDocument(filePath: string) {
  return {
    languageId: 'go',
    isUntitled: false,
    isDirty: false,
    uri: {
      fsPath: filePath,
    },
    getText() {
      return 'package main\n\nfunc main() {}\n';
    },
  };
}

function createAbsolutePath(...segments: string[]): string {
  return path.resolve(path.sep, ...segments);
}
