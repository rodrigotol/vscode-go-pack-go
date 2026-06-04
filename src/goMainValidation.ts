import * as path from 'path';

import { isPackageMainDocument } from './goMainDetector';

export interface GoMainValidationDocument {
  readonly languageId: string;
  readonly isUntitled: boolean;
  readonly isDirty: boolean;
  readonly uri: {
    readonly fsPath: string;
  };
  getText(): string;
}

export interface GoMainValidationWorkspaceFolder {
  readonly uri: {
    readonly fsPath: string;
  };
  readonly name?: string;
}

export interface GoMainExecutionContext {
  readonly document: GoMainValidationDocument;
  readonly filePath: string;
  readonly mainDirectory: string;
  readonly workspaceFolder: GoMainValidationWorkspaceFolder;
  readonly workspaceFolderPath: string;
}

export interface GoMainValidationSuccess {
  readonly ok: true;
  readonly context: GoMainExecutionContext;
}

export interface GoMainValidationFailure {
  readonly ok: false;
  readonly errorMessage: string;
}

export type GoMainValidationResult = GoMainValidationSuccess | GoMainValidationFailure;

interface GoMainValidationDependencies {
  readonly getWorkspaceFolder?: (
    uri: GoMainValidationDocument['uri'],
  ) => GoMainValidationWorkspaceFolder | undefined;
  readonly isPackageMain?: (document: Pick<GoMainValidationDocument, 'getText'>) => Promise<boolean>;
  readonly pathExists?: (targetPath: string) => Promise<boolean>;
}

export async function validateGoMainDocument(
  document: GoMainValidationDocument,
  dependencies: GoMainValidationDependencies = {},
): Promise<GoMainValidationResult> {
  if (document.languageId !== 'go') {
    return {
      ok: false,
      errorMessage: 'Unable to run Go main because the selected file is not a Go source file.',
    };
  }

  if (document.isUntitled || document.isDirty) {
    return {
      ok: false,
      errorMessage: 'Save the Go file before running or debugging its main function.',
    };
  }

  const filePath = path.resolve(document.uri.fsPath);
  const pathExists = dependencies.pathExists ?? defaultPathExists;

  if (!(await pathExists(filePath))) {
    return {
      ok: false,
      errorMessage: 'Unable to run Go main because the selected file no longer exists on disk.',
    };
  }

  const getWorkspaceFolder = dependencies.getWorkspaceFolder ?? (() => undefined);
  const workspaceFolder = getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return {
      ok: false,
      errorMessage: 'Open the Go file from a workspace folder before running or debugging its main function.',
    };
  }

  const mainDirectory = path.dirname(filePath);
  if (!(await pathExists(mainDirectory))) {
    return {
      ok: false,
      errorMessage: 'Unable to run Go main because its directory does not exist on disk.',
    };
  }

  const isPackageMain = dependencies.isPackageMain ?? isPackageMainDocument;
  if (!(await isPackageMain(document))) {
    return {
      ok: false,
      errorMessage: 'Go main runner is only available for files in package main.',
    };
  }

  return {
    ok: true,
    context: {
      document,
      filePath,
      mainDirectory,
      workspaceFolder,
      workspaceFolderPath: path.resolve(workspaceFolder.uri.fsPath),
    },
  };
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  const fs = await import('node:fs/promises');

  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
