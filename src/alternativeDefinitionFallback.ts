import * as vscode from 'vscode';

export const showSeparatedReferencesCommand = 'go-pack-go.showSeparatedReferences';
export const enableSeparatedReferencesAlternativeDefinitionCommand =
  'go-pack-go.enableSeparatedReferencesAlternativeDefinitionFallback';
export const restoreSeparatedReferencesAlternativeDefinitionCommand =
  'go-pack-go.restoreSeparatedReferencesAlternativeDefinitionFallback';

const editorConfigurationSection = 'editor';
const alternativeDefinitionSettingKey = 'gotoLocation.alternativeDefinitionCommand';
const storedPreviousAlternativeDefinitionStateKey =
  'go-pack-go.previousAlternativeDefinitionCommand';

type AlternativeDefinitionSettingTarget = 'global' | 'workspace' | 'workspaceFolder';

interface StoredAlternativeDefinitionState {
  readonly previousCommand?: string;
  readonly target: AlternativeDefinitionSettingTarget;
  readonly workspaceFolderUri?: string;
}

interface AlternativeDefinitionSettingState {
  readonly currentCommand?: string;
  readonly target: AlternativeDefinitionSettingTarget;
  readonly workspaceFolderUri?: string;
}

interface InspectedAlternativeDefinitionSetting {
  readonly globalValue?: string;
  readonly workspaceValue?: string;
  readonly workspaceFolderValue?: string;
}

export function resolveAlternativeDefinitionSettingState(
  inspection: InspectedAlternativeDefinitionSetting | undefined,
  workspaceFolderUri?: string,
): AlternativeDefinitionSettingState {
  if (workspaceFolderUri && typeof inspection?.workspaceFolderValue === 'string') {
    return {
      currentCommand: inspection.workspaceFolderValue,
      target: 'workspaceFolder',
      workspaceFolderUri,
    };
  }

  if (typeof inspection?.workspaceValue === 'string') {
    return {
      currentCommand: inspection.workspaceValue,
      target: 'workspace',
    };
  }

  if (typeof inspection?.globalValue === 'string') {
    return {
      currentCommand: inspection.globalValue,
      target: 'global',
    };
  }

  return {
    currentCommand: undefined,
    target: 'global',
  };
}

export class AlternativeDefinitionFallbackManager {
  private declinedThisSession = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async enableSeparatedReferencesFallback(options: { readonly forcePrompt?: boolean } = {}): Promise<void> {
    const forcePrompt = options.forcePrompt ?? true;
    if (!forcePrompt && this.declinedThisSession) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const activeResource = activeEditor?.document.uri;
    const workspaceFolder = activeResource ? vscode.workspace.getWorkspaceFolder(activeResource) : undefined;
    const inspection = vscode.workspace
      .getConfiguration(editorConfigurationSection, activeResource)
      .inspect<string>(alternativeDefinitionSettingKey);
    const currentSetting = resolveAlternativeDefinitionSettingState(inspection, workspaceFolder?.uri.toString());

    if (currentSetting.currentCommand === showSeparatedReferencesCommand) {
      void vscode.window.showInformationMessage(
        'Go Pack Go is already configured as the alternate definition fallback command.',
      );
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      'Set Go Pack Go as editor.gotoLocation.alternativeDefinitionCommand for read/write references fallback?',
      { modal: true },
      'Enable',
      'Not now',
    );

    if (choice !== 'Enable') {
      this.declinedThisSession = true;
      return;
    }

    await this.context.globalState.update(storedPreviousAlternativeDefinitionStateKey, {
      previousCommand: currentSetting.currentCommand,
      target: currentSetting.target,
      workspaceFolderUri: currentSetting.workspaceFolderUri,
    } satisfies StoredAlternativeDefinitionState);

    await this.updateAlternativeDefinitionCommand(
      currentSetting.target,
      showSeparatedReferencesCommand,
      currentSetting.workspaceFolderUri,
    );

    this.declinedThisSession = false;
    void vscode.window.showInformationMessage(
      'Go Pack Go is now configured as the alternate definition fallback command.',
    );
  }

  async restorePreviousSeparatedReferencesFallback(): Promise<void> {
    const previousState = this.context.globalState.get<StoredAlternativeDefinitionState>(
      storedPreviousAlternativeDefinitionStateKey,
    );

    if (!previousState) {
      void vscode.window.showInformationMessage(
        'No previous alternate definition fallback command is stored for Go Pack Go.',
      );
      return;
    }

    if (previousState.target === 'workspaceFolder' && !previousState.workspaceFolderUri) {
      void vscode.window.showWarningMessage(
        'Unable to restore the previous alternate definition fallback because the workspace folder is unavailable.',
      );
      return;
    }

    await this.updateAlternativeDefinitionCommand(
      previousState.target,
      previousState.previousCommand,
      previousState.workspaceFolderUri,
    );
    await this.context.globalState.update(storedPreviousAlternativeDefinitionStateKey, undefined);

    const message = previousState.previousCommand
      ? 'Restored the previous alternate definition fallback command.'
      : 'Cleared the alternate definition fallback command set by Go Pack Go.';
    void vscode.window.showInformationMessage(message);
  }

  private async updateAlternativeDefinitionCommand(
    target: AlternativeDefinitionSettingTarget,
    value: string | undefined,
    workspaceFolderUri?: string,
  ): Promise<void> {
    const resource = workspaceFolderUri ? vscode.Uri.parse(workspaceFolderUri) : undefined;
    const configuration = vscode.workspace.getConfiguration(editorConfigurationSection, resource);

    await configuration.update(
      alternativeDefinitionSettingKey,
      value,
      toConfigurationTarget(target),
    );
  }
}

function toConfigurationTarget(target: AlternativeDefinitionSettingTarget): vscode.ConfigurationTarget {
  switch (target) {
    case 'workspace':
      return vscode.ConfigurationTarget.Workspace;
    case 'workspaceFolder':
      return vscode.ConfigurationTarget.WorkspaceFolder;
    case 'global':
    default:
      return vscode.ConfigurationTarget.Global;
  }
}
