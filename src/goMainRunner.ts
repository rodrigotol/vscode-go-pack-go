import * as path from 'path';

import type { GoMainCodeLensCommandArgument } from './goMainCodeLens';
import {
  extractResolvedLaunchConfigurationOptions,
  findMatchingGoLaunchConfiguration,
  GoMainLaunchConfigurationMatch,
  ResolvedGoMainLaunchConfigurationOptions,
} from './goMainLaunchConfig';
import type { GoMainLogger } from './goMainLogger';
import {
  GoMainExecutionContext,
  GoMainValidationDocument,
  GoMainValidationWorkspaceFolder,
  validateGoMainDocument,
} from './goMainValidation';

export type GoMainExecutionAction = 'run' | 'debug';

export interface PreparedGoMainExecution {
  readonly context: GoMainExecutionContext;
  readonly launchMatch: GoMainLaunchConfigurationMatch | undefined;
  readonly launchOptions: ResolvedGoMainLaunchConfigurationOptions | undefined;
  readonly resolvedCwd: string;
}

export interface GoMainRunTaskSpec {
  readonly definition: {
    readonly type: 'go-pack-go';
    readonly task: 'runGoMain';
    readonly target: string;
  };
  readonly workspaceFolder: GoMainValidationWorkspaceFolder;
  readonly name: string;
  readonly source: 'go-pack-go';
  readonly command: 'go';
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
}

export interface GoMainRunnerDependencies {
  readonly executeTask?: (spec: GoMainRunTaskSpec) => Promise<void>;
  readonly extractLaunchOptions?: (
    match: GoMainLaunchConfigurationMatch | undefined,
    filePath: string,
  ) => ResolvedGoMainLaunchConfigurationOptions | undefined;
  readonly findMatchingLaunchConfiguration?: (
    filePath: string,
    workspaceFolderPath: string,
  ) => Promise<GoMainLaunchConfigurationMatch | undefined>;
  readonly getWorkspaceFolder?: (
    uri: GoMainValidationDocument['uri'],
  ) => GoMainValidationWorkspaceFolder | undefined;
  readonly isPackageMain?: (document: Pick<GoMainValidationDocument, 'getText'>) => Promise<boolean>;
  readonly loadDocument?: (uri: string) => Promise<GoMainValidationDocument>;
  readonly logger?: GoMainLogger;
  readonly parseUri?: (value: string) => { readonly fsPath: string; toString(): string };
  readonly pathExists?: (targetPath: string) => Promise<boolean>;
  readonly showErrorMessage?: (message: string) => void;
  readonly showStatusMessage?: (message: string) => void;
  readonly startDebugging?: (
    workspaceFolder: GoMainValidationWorkspaceFolder,
    configuration: Record<string, unknown>,
  ) => Promise<boolean>;
  readonly ensureGoExtension?: () => Promise<boolean>;
}

interface DefaultGoMainLogger extends GoMainLogger {
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export async function runGoMainCommand(
  argument: GoMainCodeLensCommandArgument,
  dependencies: GoMainRunnerDependencies = {},
): Promise<void> {
  const prepared = await prepareGoMainExecution(argument, dependencies);
  if (!prepared) {
    return;
  }

  const taskSpec = createGoMainRunTaskSpec(prepared);
  await (dependencies.executeTask ?? defaultExecuteTask)(taskSpec);
  (dependencies.showStatusMessage ?? defaultShowStatusMessage)(createGoMainStatusMessage('run', prepared));
}

export async function debugGoMainCommand(
  argument: GoMainCodeLensCommandArgument,
  dependencies: GoMainRunnerDependencies = {},
): Promise<void> {
  const prepared = await prepareGoMainExecution(argument, dependencies);
  if (!prepared) {
    return;
  }

  const ensureGoExtension = dependencies.ensureGoExtension ?? defaultEnsureGoExtension;
  if (!(await ensureGoExtension())) {
    (dependencies.showErrorMessage ?? defaultShowErrorMessage)(
      'Unable to debug Go main because the Go extension (golang.go) is not installed.',
    );
    return;
  }

  const started = await (dependencies.startDebugging ?? defaultStartDebugging)(
    prepared.context.workspaceFolder,
    createGoMainDebugConfiguration(prepared),
  );

  if (!started) {
    (dependencies.showErrorMessage ?? defaultShowErrorMessage)(
      'Unable to start Go debugging for this main package. Confirm that the Go extension is installed and Delve is available.',
    );
    return;
  }

  (dependencies.showStatusMessage ?? defaultShowStatusMessage)(createGoMainStatusMessage('debug', prepared));
}

export async function prepareGoMainExecution(
  argument: GoMainCodeLensCommandArgument,
  dependencies: GoMainRunnerDependencies = {},
): Promise<PreparedGoMainExecution | undefined> {
  const logger = dependencies.logger ?? createNoopLogger();

  if (!argument?.uri || typeof argument.uri !== 'string') {
    (dependencies.showErrorMessage ?? defaultShowErrorMessage)(
      'Unable to run Go main because its location is unavailable.',
    );
    return undefined;
  }

  const uri = (dependencies.parseUri ?? defaultParseUri)(argument.uri);
  logger.debug(`Preparing execution for ${uri.fsPath}`);

  const document = await (dependencies.loadDocument ?? defaultLoadDocument)(argument.uri);
  const validation = await validateGoMainDocument(document, {
    getWorkspaceFolder: dependencies.getWorkspaceFolder ?? defaultGetWorkspaceFolder,
    isPackageMain: dependencies.isPackageMain,
    pathExists: dependencies.pathExists,
  });

  if (!validation.ok) {
    logger.warn(validation.errorMessage);
    (dependencies.showErrorMessage ?? defaultShowErrorMessage)(validation.errorMessage);
    return undefined;
  }

  const findMatch = dependencies.findMatchingLaunchConfiguration ?? findMatchingGoLaunchConfiguration;
  const launchMatch = await findMatch(validation.context.filePath, validation.context.workspaceFolderPath);
  const extractLaunchOptions = dependencies.extractLaunchOptions ?? extractResolvedLaunchConfigurationOptions;
  const launchOptions = extractLaunchOptions(launchMatch, validation.context.filePath);
  const resolvedCwd = launchOptions?.cwd ?? validation.context.mainDirectory;

  logger.debug(
    launchMatch
      ? `Matched launch config ${launchMatch.configuration.name ?? '<unnamed>'} for ${validation.context.mainDirectory}`
      : `No launch config matched ${validation.context.mainDirectory}`,
  );

  return {
    context: validation.context,
    launchMatch,
    launchOptions,
    resolvedCwd,
  };
}

export function createGoMainRunTaskSpec(prepared: PreparedGoMainExecution): GoMainRunTaskSpec {
  return {
    definition: {
      type: 'go-pack-go',
      task: 'runGoMain',
      target: prepared.context.mainDirectory,
    },
    workspaceFolder: prepared.context.workspaceFolder,
    name: `go run ${path.basename(prepared.context.mainDirectory)}`,
    source: 'go-pack-go',
    command: 'go',
    args: [
      'run',
      ...normalizeBuildFlags(prepared.launchOptions?.buildFlags),
      prepared.context.mainDirectory,
      ...(prepared.launchOptions?.args ?? []),
    ],
    cwd: prepared.resolvedCwd,
    env: prepared.launchOptions?.env,
  };
}

export function createGoMainDebugConfiguration(
  prepared: PreparedGoMainExecution,
): Record<string, unknown> {
  return {
    name: prepared.launchMatch?.configuration.name ?? `Debug ${path.basename(prepared.context.mainDirectory)}`,
    type: 'go',
    request: 'launch',
    mode: prepared.launchMatch?.configuration.mode ?? 'auto',
    program: prepared.context.mainDirectory,
    cwd: prepared.resolvedCwd,
    console: prepared.launchMatch?.configuration.console ?? 'debugConsole',
    showLog: prepared.launchMatch?.configuration.showLog ?? false,
    env: prepared.launchOptions?.env,
    buildFlags: prepared.launchOptions?.buildFlags,
    args: prepared.launchOptions?.args,
  };
}

export function createGoMainStatusMessage(
  action: GoMainExecutionAction,
  prepared: PreparedGoMainExecution,
): string {
  const verb = action === 'run' ? 'Running' : 'Debugging';
  const configSuffix = prepared.launchMatch
    ? `using launch config ${prepared.launchMatch.configuration.name ?? path.basename(prepared.launchMatch.launchJsonPath)}`
    : 'without a matching launch config';

  return `${verb} Go main in ${prepared.context.mainDirectory} ${configSuffix}.`;
}

function normalizeBuildFlags(buildFlags: string | readonly string[] | undefined): readonly string[] {
  if (!buildFlags) {
    return [];
  }

  return typeof buildFlags === 'string' ? splitCommandLine(buildFlags) : [...buildFlags];
}

function splitCommandLine(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"') {
      quote = '"';
      continue;
    }

    if (character === "'") {
      quote = "'";
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

async function defaultExecuteTask(spec: GoMainRunTaskSpec): Promise<void> {
  const vscode = loadVsCode();
  const task = new vscode.Task(
    spec.definition,
    spec.workspaceFolder as import('vscode').WorkspaceFolder,
    spec.name,
    spec.source,
    new vscode.ProcessExecution(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
    }),
    [],
  );

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    focus: false,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };

  await vscode.tasks.executeTask(task);
}

async function defaultStartDebugging(
  workspaceFolder: GoMainValidationWorkspaceFolder,
  configuration: Record<string, unknown>,
): Promise<boolean> {
  const vscode = loadVsCode();
  return vscode.debug.startDebugging(
    workspaceFolder as import('vscode').WorkspaceFolder,
    configuration as import('vscode').DebugConfiguration,
  );
}

async function defaultEnsureGoExtension(): Promise<boolean> {
  const vscode = loadVsCode();
  const extension = vscode.extensions.getExtension('golang.go');
  if (!extension) {
    return false;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  return true;
}

async function defaultLoadDocument(uri: string): Promise<GoMainValidationDocument> {
  const vscode = loadVsCode();
  return vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
}

function defaultGetWorkspaceFolder(
  uri: GoMainValidationDocument['uri'],
): GoMainValidationWorkspaceFolder | undefined {
  const vscode = loadVsCode();
  return vscode.workspace.getWorkspaceFolder(uri as import('vscode').Uri) as GoMainValidationWorkspaceFolder | undefined;
}

function defaultParseUri(value: string): { readonly fsPath: string; toString(): string } {
  const vscode = loadVsCode();
  return vscode.Uri.parse(value);
}

function defaultShowErrorMessage(message: string): void {
  const vscode = loadVsCode();
  void vscode.window.showErrorMessage(message);
}

function defaultShowStatusMessage(message: string): void {
  const vscode = loadVsCode();
  vscode.window.setStatusBarMessage(message, 5000);
}

function createNoopLogger(): DefaultGoMainLogger {
  return {
    debug() {},
    warn() {},
    error() {},
  };
}

function loadVsCode(): typeof import('vscode') {
  return require('vscode') as typeof import('vscode');
}
