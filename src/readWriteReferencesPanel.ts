import * as vscode from 'vscode';

import {
  ReadWriteReferenceClassification,
  ReadWriteReferenceItem,
  ReadWriteReferencesResult,
} from './readWriteReferencesModel';

type ReadWriteReferencesPanelMessage =
  | {
      readonly type: 'setResult';
      readonly result: ReadWriteReferencesResult;
    }
  | {
      readonly type: 'clear';
    };

export interface ReadWriteReferencesPanelActionMessage {
  readonly type: 'revealReference' | 'openReference';
  readonly reference: ReadWriteReferenceItem;
}

export interface ReadWriteReferencesPanelRefreshMessage {
  readonly type: 'refreshCurrentSymbol';
}

export type ReadWriteReferencesPanelIncomingMessage =
  | ReadWriteReferencesPanelActionMessage
  | ReadWriteReferencesPanelRefreshMessage;

export interface ReadWriteReferencesPanelViewState {
  readonly result: ReadWriteReferencesResult | null;
  readonly showReads: boolean;
  readonly showWrites: boolean;
  readonly selectedReferenceKey?: string;
}

export class ReadWriteReferencesPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = getWebviewHtml(this.panel.webview);

    this.disposables.push(
      this.panel.onDidDispose(() => {
        this.dispose();
      }),
    );
  }

  static create(_extensionUri: vscode.Uri): ReadWriteReferencesPanel {
    const panel = vscode.window.createWebviewPanel(
      'goPackGoReadWriteReferences',
      'Read/Write References',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    const readWritePanel = new ReadWriteReferencesPanel(panel);
    readWritePanel.panel.iconPath = new vscode.ThemeIcon('references');
    readWritePanel.panel.title = 'Read/Write References';
    readWritePanel.panel.reveal(vscode.ViewColumn.Beside, false);

    return readWritePanel;
  }

  reveal(result: ReadWriteReferencesResult): void {
    this.panel.title = `Read/Write References: ${result.query.symbolLabel}`;
    this.panel.reveal(vscode.ViewColumn.Beside, false);
    void this.postMessage({
      type: 'setResult',
      result,
    });
  }

  clear(): void {
    this.panel.title = 'Read/Write References';
    void this.postMessage({ type: 'clear' });
  }

  onDidReceiveMessage(
    listener: (message: ReadWriteReferencesPanelIncomingMessage) => void,
    thisArg?: unknown,
  ): vscode.Disposable {
    return this.panel.webview.onDidReceiveMessage(listener, thisArg, this.disposables);
  }

  onDidDispose(listener: () => void, thisArg?: unknown): vscode.Disposable {
    return this.panel.onDidDispose(listener, thisArg, this.disposables);
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }

    if (this.panel.visible) {
      this.panel.dispose();
    }
  }

  private async postMessage(message: ReadWriteReferencesPanelMessage): Promise<void> {
    await this.panel.webview.postMessage(message);
  }
}

export function filterReferences(
  references: readonly ReadWriteReferenceItem[],
  filters: {
    readonly showReads: boolean;
    readonly showWrites: boolean;
  },
): readonly ReadWriteReferenceItem[] {
  return references.filter((reference) => matchesFilter(reference.classification, filters));
}

export function createInitialPanelViewState(): ReadWriteReferencesPanelViewState {
  return {
    result: null,
    showReads: true,
    showWrites: true,
    selectedReferenceKey: undefined,
  };
}

export function createSetResultPanelMessage(result: ReadWriteReferencesResult): ReadWriteReferencesPanelMessage {
  return {
    type: 'setResult',
    result,
  };
}

export function createClearPanelMessage(): ReadWriteReferencesPanelMessage {
  return {
    type: 'clear',
  };
}

export function applyPanelMessage(
  state: ReadWriteReferencesPanelViewState,
  message: ReadWriteReferencesPanelMessage,
): ReadWriteReferencesPanelViewState {
  if (message.type === 'clear') {
    return createInitialPanelViewState();
  }

  return {
    ...state,
    result: message.result,
    selectedReferenceKey: undefined,
  };
}

export function togglePanelFilter(
  state: ReadWriteReferencesPanelViewState,
  filter: 'reads' | 'writes',
): ReadWriteReferencesPanelViewState {
  if (filter === 'reads') {
    return {
      ...state,
      showReads: !state.showReads,
    };
  }

  return {
    ...state,
    showWrites: !state.showWrites,
  };
}

export function getFilteredPanelReferences(
  state: ReadWriteReferencesPanelViewState,
): readonly ReadWriteReferenceItem[] {
  if (!state.result) {
    return [];
  }

  return filterReferences(state.result.references, {
    showReads: state.showReads,
    showWrites: state.showWrites,
  });
}

export function selectPanelReference(
  state: ReadWriteReferencesPanelViewState,
  reference: ReadWriteReferenceItem,
): ReadWriteReferencesPanelViewState {
  return {
    ...state,
    selectedReferenceKey: createReferenceKey(reference),
  };
}

export function getSelectedPanelReference(
  state: ReadWriteReferencesPanelViewState,
): ReadWriteReferenceItem | undefined {
  const references = getFilteredPanelReferences(state);
  if (references.length === 0) {
    return undefined;
  }

  return references.find((reference) => createReferenceKey(reference) === state.selectedReferenceKey) ?? references[0];
}

export function createReferenceRevealMessage(
  reference: ReadWriteReferenceItem,
): ReadWriteReferencesPanelActionMessage {
  return {
    type: 'revealReference',
    reference,
  };
}

export function createReferenceOpenMessage(
  reference: ReadWriteReferenceItem,
): ReadWriteReferencesPanelActionMessage {
  return {
    type: 'openReference',
    reference,
  };
}

export function createRefreshCurrentSymbolMessage(): ReadWriteReferencesPanelRefreshMessage {
  return {
    type: 'refreshCurrentSymbol',
  };
}

export function createReferenceKey(reference: ReadWriteReferenceItem): string {
  return [
    reference.uri,
    reference.range.start.line,
    reference.range.start.character,
    reference.range.end.line,
    reference.range.end.character,
  ].join(':');
}

function matchesFilter(
  classification: ReadWriteReferenceClassification,
  filters: {
    readonly showReads: boolean;
    readonly showWrites: boolean;
  },
): boolean {
  if (classification === 'read') {
    return filters.showReads;
  }

  if (classification === 'write') {
    return filters.showWrites;
  }

  return filters.showReads || filters.showWrites;
}

function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = createNonce();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Read/Write References</title>
    <style>
      :root {
        color-scheme: light dark;
        --text-primary: var(--vscode-foreground);
        --text-secondary: color-mix(in srgb, var(--vscode-descriptionForeground) 80%, var(--vscode-foreground) 20%);
        --border-subtle: color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
        --selected-background: var(--vscode-list-activeSelectionBackground);
        --selected-foreground: var(--vscode-list-activeSelectionForeground);
        --hover-background: var(--vscode-list-hoverBackground);
        --white-accent: var(--vscode-terminal-ansiWhite);
        --filter-active-background: color-mix(in srgb, var(--vscode-foreground) 28%, transparent);
        --filter-inactive-foreground: color-mix(in srgb, var(--vscode-descriptionForeground) 85%, var(--vscode-foreground) 15%);
        --error-accent: var(--vscode-errorForeground);
        --font-family: var(--vscode-font-family);
        --font-mono: var(--vscode-editor-font-family);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background) 8%),
          var(--vscode-editor-background)
        );
        color: var(--text-primary);
        font-family: var(--font-family);
      }

      button {
        font: inherit;
      }

      .app {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 100vh;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--border-subtle);
        background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-sideBar-background) 10%);
      }

      .header-main {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .filters {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .filter-button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        border: 1px solid var(--border-subtle);
        background: transparent;
        color: var(--filter-inactive-foreground);
        cursor: pointer;
        font-size: 16px;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      }

      .filter-button:hover {
        background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
      }

      .filter-button.is-active {
        background: var(--filter-active-background);
        border-color: color-mix(in srgb, var(--vscode-foreground) 34%, transparent);
      }

      .filter-button.is-active.read {
        color: var(--white-accent);
      }

      .filter-button.is-active.write {
        color: var(--white-accent);
      }

      .count-pill {
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--border-subtle);
        background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-sideBar-background) 18%);
        font-size: 12px;
        white-space: nowrap;
      }

      .toolbar-button {
        appearance: none;
        border: 1px solid var(--border-subtle);
        background: transparent;
        color: var(--text-secondary);
        border-radius: 999px;
        padding: 7px 12px;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease;
      }

      .toolbar-button:hover {
        background: var(--hover-background);
        color: var(--text-primary);
      }

      .content {
        display: grid;
        grid-template-rows: minmax(160px, 0.7fr) minmax(320px, 1.3fr);
        min-height: 0;
      }

      .list-pane,
      .preview-pane {
        min-height: 0;
      }

      .list-pane {
        border-bottom: 1px solid var(--border-subtle);
        background: color-mix(in srgb, var(--vscode-sideBar-background) 52%, var(--vscode-editor-background) 48%);
      }

      .list {
        margin: 0;
        padding: 0;
        list-style: none;
        overflow: auto;
        height: 100%;
      }

      .reference-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 12px;
        border-left: 2px solid transparent;
        border-bottom: 2px solid color-mix(in srgb, var(--vscode-editor-background) 100%, transparent);
        cursor: pointer;
      }

      .reference-item:hover {
        background: var(--hover-background);
      }

      .reference-item.is-selected {
        background: var(--selected-background);
        color: var(--selected-foreground);
        border-left-color: color-mix(in srgb, var(--selected-foreground) 74%, transparent);
      }

      .reference-item.is-selected .reference-path,
      .reference-item.is-selected .reference-line {
        color: inherit;
      }

      .reference-main {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .kind-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        font-size: 14px;
        color: var(--text-secondary);
      }

      .kind-icon.read {
        color: var(--white-accent);
      }

      .kind-icon.write {
        color: var(--white-accent);
      }

      .kind-icon.read-write {
        color: var(--white-accent);
      }

      .reference-path {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--text-primary);
      }

      .reference-line {
        font-size: 11px;
        color: var(--text-secondary);
        white-space: nowrap;
      }

      .preview-pane {
        overflow: auto;
        background: color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-sideBar-background) 4%);
      }

      .preview-empty,
      .empty-state {
        display: grid;
        place-items: center;
        height: 100%;
        padding: 32px;
        color: var(--text-secondary);
        text-align: center;
      }

      .preview {
        padding: 10px 12px 12px;
      }

      .preview-code {
        margin: 0;
        border: 1px solid var(--border-subtle);
        border-radius: 10px;
        overflow: hidden;
        background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 90%, var(--vscode-editor-background) 10%);
      }

      .code-lines {
        margin: 0;
        padding: 10px 0;
      }

      .code-line {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.5;
      }

      .code-line.highlight {
        background: color-mix(in srgb, var(--vscode-editor-findMatchBackground) 45%, transparent);
      }

      .code-line-number {
        padding: 0 12px 0 0;
        text-align: right;
        color: var(--text-secondary);
        user-select: none;
        border-right: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
      }

      .code-line-text {
        padding: 0 14px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .preview-error {
        margin-top: 14px;
        padding: 12px 14px;
        border: 1px solid color-mix(in srgb, var(--error-accent) 55%, transparent);
        border-radius: 12px;
        color: var(--error-accent);
        background: color-mix(in srgb, var(--error-accent) 12%, transparent);
      }

      @media (max-width: 820px) {
        .header {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header class="header" id="header"></header>
      <div class="content">
        <section class="list-pane" aria-label="References list">
          <div id="list-root" class="empty-state">Waiting for references.</div>
        </section>
        <section class="preview-pane" aria-label="Reference preview">
          <div id="preview-root" class="preview-empty">Select a reference to inspect its preview.</div>
        </section>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const state = {
        result: null,
        showReads: true,
        showWrites: true,
        selectedUri: undefined,
        selectedRangeKey: undefined,
      };

      const headerRoot = document.getElementById('header');
      const listRoot = document.getElementById('list-root');
      const previewRoot = document.getElementById('preview-root');

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
          return;
        }

        if (message.type === 'clear') {
          state.result = null;
          state.selectedUri = undefined;
          state.selectedRangeKey = undefined;
          render();
          return;
        }

        if (message.type === 'setResult') {
          state.result = message.result;
          state.selectedUri = undefined;
          state.selectedRangeKey = undefined;
          render();
        }
      });

      document.addEventListener('keydown', (event) => {
        if (!state.result) {
          return;
        }

        const filtered = getFilteredReferences();
        if (filtered.length === 0) {
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          postReferenceMessage('openReference', filtered[getSelectedIndex(filtered)]);
          return;
        }

        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
          return;
        }

        event.preventDefault();
        const selectedIndex = getSelectedIndex(filtered);
        const nextIndex = event.key === 'ArrowDown'
          ? Math.min(filtered.length - 1, selectedIndex + 1)
          : Math.max(0, selectedIndex - 1);
        selectReference(filtered[nextIndex]);
      });

      function render() {
        renderHeader();
        renderList();
        renderPreview();
        vscode.setState(state);
      }

      function renderHeader() {
        const count = state.result ? state.result.references.length : 0;
        headerRoot.innerHTML = [
          '<div class="header-main">',
          '  <div class="filters" id="filters"></div>',
          '  <span class="count-pill">References: ' + count + '</span>',
          '</div>',
          '<button type="button" class="toolbar-button" id="refresh-button">Refresh</button>',
        ].join('');

        const filtersRoot = document.getElementById('filters');
        if (filtersRoot) {
          filtersRoot.innerHTML = '';
          filtersRoot.appendChild(createFilterButton(iconForClassification('read'), 'Reads', 'read', state.showReads, () => {
            state.showReads = !state.showReads;
            render();
          }));
          filtersRoot.appendChild(createFilterButton(iconForClassification('write'), 'Writes', 'write', state.showWrites, () => {
            state.showWrites = !state.showWrites;
            render();
          }));
        }

        const refreshButton = document.getElementById('refresh-button');
        refreshButton?.addEventListener('click', () => {
          vscode.postMessage({ type: 'refreshCurrentSymbol' });
        });
      }

      function renderList() {
        if (!state.result) {
          listRoot.className = 'empty-state';
          listRoot.textContent = 'Waiting for references.';
          return;
        }

        const references = getFilteredReferences();
        if (references.length === 0) {
          listRoot.className = 'empty-state';
          listRoot.textContent = 'No references match the active filters.';
          return;
        }

        ensureSelection(references);
        const list = document.createElement('ul');
        list.className = 'list';
        list.tabIndex = 0;

        for (const reference of references) {
          const item = document.createElement('li');
          item.className = 'reference-item';
          if (isSelected(reference)) {
            item.classList.add('is-selected');
          }

          item.tabIndex = -1;
          item.addEventListener('click', () => {
            selectReference(reference);
          });
          item.addEventListener('dblclick', () => {
            selectReference(reference);
            postReferenceMessage('openReference', reference);
          });

          const lineNumber = reference.preview?.lineNumber ?? reference.range.start.line + 1;
          const displayPath = reference.relativePath ?? formatUriLabel(reference.uri);
          item.innerHTML = [
            '<div class="reference-main">',
            '  <span class="kind-icon ' + reference.classification + '">' + escapeHtml(iconForClassification(reference.classification)) + '</span>',
            '  <div class="reference-path" title="' + escapeHtml(displayPath) + '">' + escapeHtml(displayPath) + '</div>',
            '</div>',
            '<div class="reference-line">' + lineNumber + '</div>',
          ].join('');
          list.appendChild(item);
        }

        listRoot.className = '';
        listRoot.replaceChildren(list);
      }

      function renderPreview() {
        if (!state.result) {
          previewRoot.className = 'preview-empty';
          previewRoot.textContent = 'Select a reference to inspect its preview.';
          return;
        }

        const references = getFilteredReferences();
        if (references.length === 0) {
          previewRoot.className = 'preview-empty';
          previewRoot.textContent = 'No preview is available because the current filters hide every reference.';
          return;
        }

        ensureSelection(references);
        const selectedReference = references[getSelectedIndex(references)];
        const preview = selectedReference.preview;

        if (!preview) {
          previewRoot.className = 'preview-empty';
          previewRoot.textContent = 'Preview data is unavailable for the selected reference.';
          return;
        }

        const codeLines = buildPreviewLines(preview).map((line) => [
          '<div class="code-line' + (line.highlight ? ' highlight' : '') + '">',
          '  <div class="code-line-number">' + line.lineNumber + '</div>',
          '  <div class="code-line-text">' + escapeHtml(line.text) + '</div>',
          '</div>',
        ].join('')).join('');

        previewRoot.className = 'preview';
        previewRoot.innerHTML = [
          '<div class="preview-code">',
          '  <div class="code-lines">' + codeLines + '</div>',
          '</div>',
          preview.errorMessage
            ? '<div class="preview-error">' + escapeHtml(preview.errorMessage) + '</div>'
            : '',
        ].join('');
      }

      function createFilterButton(label, tooltip, kind, isActive, onClick) {
        const button = document.createElement('button');
        button.className = 'filter-button ' + kind;
        if (isActive) {
          button.classList.add('is-active');
        }
        button.type = 'button';
        button.title = tooltip;
        button.setAttribute('aria-label', tooltip);
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
      }

      function getFilteredReferences() {
        if (!state.result) {
          return [];
        }

        return state.result.references.filter((reference) => {
          if (reference.classification === 'read') {
            return state.showReads;
          }

          if (reference.classification === 'write') {
            return state.showWrites;
          }

          return state.showReads || state.showWrites;
        });
      }

      function ensureSelection(references) {
        const selected = references.find((reference) => isSelected(reference));
        if (selected) {
          return;
        }

        selectReference(references[0], false);
      }

      function selectReference(reference, rerender = true) {
        state.selectedUri = reference.uri;
        state.selectedRangeKey = referenceKey(reference);
        if (rerender) {
          render();
        }
      }

      function getSelectedIndex(references) {
        const selectedIndex = references.findIndex((reference) => isSelected(reference));
        return selectedIndex >= 0 ? selectedIndex : 0;
      }

      function isSelected(reference) {
        return state.selectedUri === reference.uri && state.selectedRangeKey === referenceKey(reference);
      }

      function referenceKey(reference) {
        return [
          reference.uri,
          reference.range.start.line,
          reference.range.start.character,
          reference.range.end.line,
          reference.range.end.character,
        ].join(':');
      }

      function buildPreviewLines(preview) {
        const lines = preview.snippet.split('\\n');
        return lines.map((text, index) => {
          const lineNumber = preview.snippetRange.start.line + index + 1;
          return {
            lineNumber,
            text,
            highlight: lineNumber === preview.highlightLine + 1,
          };
        });
      }

      function iconForClassification(classification) {
        if (classification === 'read') {
          return '⌕';
        }

        if (classification === 'write') {
          return '✎';
        }

        return '⧓';
      }

      function formatUriLabel(uri) {
        try {
          const parsed = new URL(uri);
          return decodeURIComponent(parsed.pathname).replace(/^\\//, '');
        } catch {
          return uri;
        }
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function postReferenceMessage(type, reference) {
        vscode.postMessage({
          type,
          reference,
        });
      }

      const persistedState = vscode.getState();
      if (persistedState) {
        Object.assign(state, persistedState);
      }
      render();
    </script>
  </body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return nonce;
}
