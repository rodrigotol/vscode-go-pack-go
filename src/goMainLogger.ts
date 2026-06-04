export const goMainRunnerLogPrefix = '[Go Main Runner]';
export const goMainDebugLogsSetting = 'goPackGo.enableDebugLogs';

export interface GoMainLogger {
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createGoMainLogger(): GoMainLogger {
  return new VsCodeGoMainLogger();
}

class VsCodeGoMainLogger implements GoMainLogger {
  private readonly vscode = loadVsCode();
  private readonly outputChannel = this.vscode.window.createOutputChannel('Go Main Runner');

  debug(message: string): void {
    if (!this.isVerboseLoggingEnabled()) {
      return;
    }

    this.outputChannel.appendLine(formatGoMainLogMessage('debug', message));
  }

  warn(message: string): void {
    this.outputChannel.appendLine(formatGoMainLogMessage('warn', message));
  }

  error(message: string): void {
    this.outputChannel.appendLine(formatGoMainLogMessage('error', message));
  }

  private isVerboseLoggingEnabled(): boolean {
    return this.vscode.workspace.getConfiguration().get<boolean>(goMainDebugLogsSetting, false);
  }
}

function formatGoMainLogMessage(level: string, message: string): string {
  return `${goMainRunnerLogPrefix} ${level}: ${message}`;
}

function loadVsCode(): typeof import('vscode') {
  return require('vscode') as typeof import('vscode');
}
