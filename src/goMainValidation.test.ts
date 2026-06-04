import assert from 'node:assert/strict';
import * as path from 'path';
import { test } from 'node:test';

import { validateGoMainDocument } from './goMainValidation';

test('rejects dirty and untitled files', async () => {
  const dirtyResult = await validateGoMainDocument(createDocument({ isDirty: true }));
  const untitledResult = await validateGoMainDocument(createDocument({ isUntitled: true }));

  assert.equal(dirtyResult.ok, false);
  assert.equal(untitledResult.ok, false);
});

test('rejects files outside the workspace', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');

  const result = await validateGoMainDocument(createDocument({ filePath }), {
    pathExists: async () => true,
    getWorkspaceFolder: () => undefined,
    isPackageMain: async () => true,
  });

  assert.deepEqual(result, {
    ok: false,
    errorMessage: 'Open the Go file from a workspace folder before running or debugging its main function.',
  });
});

test('rejects files that are not in package main', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');

  const result = await validateGoMainDocument(createDocument({ filePath }), {
    pathExists: async () => true,
    getWorkspaceFolder: (uri) => ({ uri: { fsPath: path.dirname(path.dirname(uri.fsPath)) } }),
    isPackageMain: async () => false,
  });

  assert.deepEqual(result, {
    ok: false,
    errorMessage: 'Go main runner is only available for files in package main.',
  });
});

test('returns normalized execution context for a saved package main file', async () => {
  const filePath = createAbsolutePath('workspace', 'cmd', 'app', 'main.go');
  const workspaceFolderPath = createAbsolutePath('workspace');
  const document = createDocument({ filePath });

  const result = await validateGoMainDocument(document, {
    pathExists: async () => true,
    getWorkspaceFolder: () => ({ uri: { fsPath: workspaceFolderPath }, name: 'workspace' }),
    isPackageMain: async () => true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.context.filePath, filePath);
  assert.equal(result.context.mainDirectory, path.dirname(filePath));
  assert.equal(result.context.workspaceFolderPath, workspaceFolderPath);
  assert.equal(result.context.document, document);
});

function createDocument(
  overrides: Partial<{
    languageId: string;
    isUntitled: boolean;
    isDirty: boolean;
    filePath: string;
    text: string;
  }> = {},
) {
  const filePath = overrides.filePath ?? createAbsolutePath('workspace', 'main.go');

  return {
    languageId: overrides.languageId ?? 'go',
    isUntitled: overrides.isUntitled ?? false,
    isDirty: overrides.isDirty ?? false,
    uri: {
      fsPath: filePath,
    },
    getText() {
      return overrides.text ?? 'package main\n\nfunc main() {}\n';
    },
  };
}

function createAbsolutePath(...segments: string[]): string {
  return path.resolve(path.sep, ...segments);
}
