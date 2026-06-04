import * as path from 'path';

export interface GoMainLaunchConfiguration {
  readonly name?: string;
  readonly type: string;
  readonly request: string;
  readonly program?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly buildFlags?: string | readonly string[];
  readonly args?: readonly string[];
  readonly mode?: string;
  readonly console?: string;
  readonly showLog?: boolean;
}

export interface GoMainLaunchConfigurationMatch {
  readonly configuration: GoMainLaunchConfiguration;
  readonly launchJsonPath: string;
  readonly launchRootDir: string;
  readonly programDirectory: string;
}

export interface ResolvedGoMainLaunchConfigurationOptions {
  readonly env?: Record<string, string>;
  readonly buildFlags?: string | readonly string[];
  readonly args?: readonly string[];
  readonly cwd?: string;
}

interface GoMainLaunchJson {
  readonly configurations?: readonly unknown[];
}

interface GoMainLaunchConfigDependencies {
  readonly readFile?: (filePath: string) => Promise<string | undefined>;
}

interface GoMainLaunchVariableContext {
  readonly workspaceFolder: string;
  readonly workspaceRoot: string;
  readonly fileDirname: string;
}

export async function findMatchingGoLaunchConfiguration(
  filePath: string,
  workspaceFolderPath: string,
  dependencies: GoMainLaunchConfigDependencies = {},
): Promise<GoMainLaunchConfigurationMatch | undefined> {
  const clickedFilePath = path.resolve(filePath);
  const clickedFileDir = path.dirname(clickedFilePath);
  const workspaceRoot = path.resolve(workspaceFolderPath);

  for (const directory of collectSearchDirectories(clickedFileDir, workspaceRoot)) {
    const launchJsonPath = path.join(directory, '.vscode', 'launch.json');
    const launchJsonText = await readLaunchJsonFile(launchJsonPath, dependencies.readFile);
    if (!launchJsonText) {
      continue;
    }

    const launchRootDir = directory;
    for (const configuration of parseGoLaunchConfigurations(launchJsonText)) {
      const programDirectory = resolveLaunchProgramDirectory(configuration.program, {
        workspaceFolder: launchRootDir,
        workspaceRoot: launchRootDir,
        fileDirname: clickedFileDir,
      });

      if (programDirectory === clickedFileDir) {
        return {
          configuration,
          launchJsonPath,
          launchRootDir,
          programDirectory,
        };
      }
    }
  }

  return undefined;
}

export function parseGoLaunchConfigurations(launchJsonText: string): readonly GoMainLaunchConfiguration[] {
  const parsed = parseLaunchJsonText(launchJsonText);
  if (!parsed?.configurations?.length) {
    return [];
  }

  return parsed.configurations
    .map(asGoMainLaunchConfiguration)
    .filter((configuration): configuration is GoMainLaunchConfiguration => configuration !== undefined);
}

export function parseLaunchJsonText(launchJsonText: string): GoMainLaunchJson | undefined {
  const sanitized = stripJsonComments(launchJsonText).trim();
  if (!sanitized) {
    return undefined;
  }

  const parsed = JSON.parse(sanitized) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  return parsed as GoMainLaunchJson;
}

export function stripJsonComments(value: string): string {
  let output = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const next = value[index + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      } else if (current === '\n') {
        output += current;
      }
      continue;
    }

    if (inString) {
      output += current;

      if (escaping) {
        escaping = false;
      } else if (current === '\\') {
        escaping = true;
      } else if (current === '"') {
        inString = false;
      }

      continue;
    }

    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

export function extractResolvedLaunchConfigurationOptions(
  match: GoMainLaunchConfigurationMatch | undefined,
  filePath: string,
): ResolvedGoMainLaunchConfigurationOptions | undefined {
  if (!match) {
    return undefined;
  }

  const fileDirname = path.dirname(path.resolve(filePath));
  const variables = {
    workspaceFolder: match.launchRootDir,
    workspaceRoot: match.launchRootDir,
    fileDirname,
  };

  return {
    env: resolveLaunchEnv(match.configuration.env, variables),
    buildFlags: resolveLaunchBuildFlags(match.configuration.buildFlags, variables),
    args: resolveLaunchStringArray(match.configuration.args, variables),
    cwd: resolveLaunchPath(match.configuration.cwd, variables),
  };
}

export function resolveLaunchProgramDirectory(
  program: string | undefined,
  variables: GoMainLaunchVariableContext,
): string | undefined {
  const resolvedProgram = resolveLaunchPath(program, variables);
  if (!resolvedProgram) {
    return undefined;
  }

  if (resolvedProgram.toLowerCase().endsWith('.go')) {
    return path.dirname(resolvedProgram);
  }

  return resolvedProgram;
}

export function resolveLaunchPath(
  value: string | undefined,
  variables: GoMainLaunchVariableContext,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const substituted = resolveLaunchVariables(value, variables);
  return path.normalize(
    path.isAbsolute(substituted)
      ? substituted
      : path.resolve(variables.workspaceFolder, substituted),
  );
}

export function resolveLaunchVariables(value: string, variables: GoMainLaunchVariableContext): string {
  return value
    .replaceAll('${workspaceFolder}', variables.workspaceFolder)
    .replaceAll('${workspaceRoot}', variables.workspaceRoot)
    .replaceAll('${fileDirname}', variables.fileDirname);
}

function resolveLaunchEnv(
  env: Record<string, string> | undefined,
  variables: GoMainLaunchVariableContext,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, resolveLaunchVariables(value, variables)]),
  );
}

function resolveLaunchBuildFlags(
  buildFlags: string | readonly string[] | undefined,
  variables: GoMainLaunchVariableContext,
): string | readonly string[] | undefined {
  if (!buildFlags) {
    return undefined;
  }

  if (typeof buildFlags === 'string') {
    return resolveLaunchVariables(buildFlags, variables);
  }

  return buildFlags.map((value) => resolveLaunchVariables(value, variables));
}

function resolveLaunchStringArray(
  values: readonly string[] | undefined,
  variables: GoMainLaunchVariableContext,
): readonly string[] | undefined {
  if (!values) {
    return undefined;
  }

  return values.map((value) => resolveLaunchVariables(value, variables));
}

function asGoMainLaunchConfiguration(configuration: unknown): GoMainLaunchConfiguration | undefined {
  if (!configuration || typeof configuration !== 'object') {
    return undefined;
  }

  const candidate = configuration as Record<string, unknown>;
  if (candidate.type !== 'go' || candidate.request !== 'launch') {
    return undefined;
  }

  const env = asStringRecord(candidate.env);
  const buildFlags = asBuildFlags(candidate.buildFlags);
  const args = asStringArray(candidate.args);

  return {
    name: asOptionalString(candidate.name),
    type: 'go',
    request: 'launch',
    program: asOptionalString(candidate.program),
    cwd: asOptionalString(candidate.cwd),
    env,
    buildFlags,
    args,
    mode: asOptionalString(candidate.mode),
    console: asOptionalString(candidate.console),
    showLog: asOptionalBoolean(candidate.showLog),
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined;
  }

  return value;
}

function asBuildFlags(value: unknown): string | readonly string[] | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return asStringArray(value);
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const recordEntries = Object.entries(value);
  if (recordEntries.some(([, entryValue]) => typeof entryValue !== 'string')) {
    return undefined;
  }

  return Object.fromEntries(recordEntries) as Record<string, string>;
}

function collectSearchDirectories(clickedFileDir: string, workspaceRoot: string): readonly string[] {
  if (!isSameOrDescendantPath(clickedFileDir, workspaceRoot)) {
    return [clickedFileDir];
  }

  const directories: string[] = [];
  let current = clickedFileDir;

  while (true) {
    directories.push(current);

    if (current === workspaceRoot) {
      return directories;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return directories;
    }

    current = parent;
  }
}

async function readLaunchJsonFile(
  launchJsonPath: string,
  readFile: ((filePath: string) => Promise<string | undefined>) | undefined,
): Promise<string | undefined> {
  if (readFile) {
    return readFile(launchJsonPath);
  }

  const fs = await import('node:fs/promises');

  try {
    return await fs.readFile(launchJsonPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function isSameOrDescendantPath(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
