import * as vscode from 'vscode';

import {
  ReadWriteReferenceClassification,
  ReadWriteReferenceItem,
  ReadWriteReferencePreview,
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

  static create(extensionUri: vscode.Uri): ReadWriteReferencesPanel {
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
    readWritePanel.panel.reveal(vscode.ViewColumn.Beside, true);

    return readWritePanel;
  }

  reveal(result: ReadWriteReferencesResult): void {
    this.panel.title = `Read/Write References: ${result.query.symbolLabel}`;
    this.panel.reveal(vscode.ViewColumn.Beside, true);
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
        --panel-border: var(--vscode-panel-border);
        --panel-background: var(--vscode-editor-background);
        --surface-background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-sideBar-background) 10%);
        --surface-muted: color-mix(in srgb, var(--vscode-editor-background) 78%, var(--vscode-sideBar-background) 22%);
        --text-primary: var(--vscode-foreground);
        --text-secondary: var(--vscode-descriptionForeground);
        --text-accent: var(--vscode-textLink-foreground);
        --border-subtle: color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
        --selected-background: var(--vscode-list-activeSelectionBackground);
        --selected-foreground: var(--vscode-list-activeSelectionForeground);
        --hover-background: var(--vscode-list-hoverBackground);
        --button-background: var(--vscode-button-secondaryBackground);
        --button-foreground: var(--vscode-button-secondaryForeground);
        --button-hover-background: var(--vscode-button-secondaryHoverBackground);
        --button-active-background: color-mix(in srgb, var(--vscode-button-background) 82%, transparent);
        --button-active-foreground: var(--vscode-button-foreground);
        --read-accent: var(--vscode-testing-iconPassed);
        --write-accent: var(--vscode-testing-iconFailed);
        --mixed-accent: var(--vscode-terminal-ansiYellow);
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
        background:
          radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-textLink-foreground) 16%, transparent), transparent 28%),
          linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background) 8%), var(--vscode-editor-background));
        color: var(--text-primary);
        font-family: var(--font-family);
      }

      button,
      input,
      textarea,
      select {
        font: inherit;
      }

      .app {
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        min-height: 100vh;
      }

      .header {
        padding: 18px 20px 14px;
        border-bottom: 1px solid var(--border-subtle);
        background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-sideBar-background) 16%);
      }

      .eyebrow {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--text-secondary);
      }

      .title-row {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
      }

      .title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
      }

      .subtitle {
        margin-top: 6px;
        color: var(--text-secondary);
        font-size: 12px;
      }

      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: end;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: end;
        margin-top: 10px;
      }

      .count-pill {
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--surface-muted);
        border: 1px solid var(--border-subtle);
        font-size: 12px;
        white-space: nowrap;
      }

      .filters {
        display: flex;
        gap: 10px;
        padding: 14px 20px;
        border-bottom: 1px solid var(--border-subtle);
        background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
      }

      .filter-button {
        appearance: none;
        border: 1px solid var(--border-subtle);
        background: var(--button-background);
        color: var(--button-foreground);
        border-radius: 999px;
        padding: 8px 14px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      }

      .filter-button:hover {
        background: var(--button-hover-background);
      }

      .filter-button.is-active {
        background: var(--button-active-background);
        color: var(--button-active-foreground);
        border-color: color-mix(in srgb, var(--vscode-button-background) 55%, transparent);
        transform: translateY(-1px);
      }

      .toolbar-button {
        appearance: none;
        border: 1px solid var(--border-subtle);
        background: transparent;
        color: var(--text-secondary);
        border-radius: 999px;
        padding: 7px 12px;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
      }

      .toolbar-button:hover {
        background: var(--hover-background);
        color: var(--text-primary);
      }

      .content {
        display: grid;
        grid-template-columns: minmax(280px, 0.95fr) minmax(340px, 1.05fr);
        min-height: 0;
      }

      .list-pane,
      .preview-pane {
        min-height: 0;
      }

      .list-pane {
        border-right: 1px solid var(--border-subtle);
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
        padding: 14px 16px 14px 18px;
        border-left: 3px solid transparent;
        border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent);
        cursor: pointer;
      }

      .reference-item:hover {
        background: var(--hover-background);
      }

      .reference-item.is-selected {
        background: var(--selected-background);
        color: var(--selected-foreground);
        border-left-color: var(--text-accent);
      }

      .reference-item.is-selected .reference-meta,
      .reference-item.is-selected .reference-path,
      .reference-item.is-selected .reference-snippet {
        color: inherit;
      }

      .reference-topline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .reference-path {
        font-size: 12px;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .reference-meta {
        margin-top: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--text-secondary);
      }

      .reference-snippet {
        margin-top: 8px;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .kind-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .kind-badge.read {
        color: var(--read-accent);
      }

      .kind-badge.write {
        color: var(--write-accent);
      }

      .kind-badge.read-write {
        color: var(--mixed-accent);
      }

      .preview-pane {
        overflow: auto;
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-sideBar-background) 6%), var(--vscode-editor-background));
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
        padding: 18px 20px 20px;
      }

      .preview-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }

      .preview-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .preview-title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }

      .preview-subtitle {
        margin-top: 6px;
        font-size: 12px;
        color: var(--text-secondary);
      }

      .preview-code {
        margin: 0;
        border: 1px solid var(--border-subtle);
        border-radius: 14px;
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
        gap: 0;
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
        .content {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(220px, 0.9fr) minmax(260px, 1.1fr);
        }

        .list-pane {
          border-right: none;
          border-bottom: 1px solid var(--border-subtle);
        }

        .title-row {
          align-items: start;
          flex-direction: column;
        }

        .counts {
          justify-content: start;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header class="header" id="header"></header>
      <div class="filters" id="filters"></div>
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
      const filtersRoot = document.getElementById('filters');
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

        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
          if (event.key === 'Enter') {
            event.preventDefault();
            postReferenceMessage('openReference', filtered[getSelectedIndex(filtered)]);
          }
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
        renderFilters();
        renderList();
        renderPreview();
        vscode.setState(state);
      }

      function renderHeader() {
        if (!state.result) {
          headerRoot.innerHTML = [
            '<p class="eyebrow">Go Pack Go</p>',
            '<div class="title-row">',
            '  <div>',
            '    <h1 class="title">Read/Write References</h1>',
            '    <div class="subtitle">Run the command on a Go symbol to inspect separated references.</div>',
            '  </div>',
            '</div>',
          ].join('');
          return;
        }

        const { query, counts, references } = state.result;
        headerRoot.innerHTML = [
          '<p class="eyebrow">Go Pack Go</p>',
          '<div class="title-row">',
          '  <div>',
            '    <h1 class="title">' + escapeHtml(query.symbolLabel) + '</h1>',
          '    <div class="subtitle">' + escapeHtml(formatUriLabel(query.uri)) + ' • ' + references.length + ' references</div>',
          '  </div>',
          '  <div>',
          '    <div class="counts">',
          '      <span class="count-pill">Reads ' + counts.read + '</span>',
          '      <span class="count-pill">Writes ' + counts.write + '</span>',
          '      <span class="count-pill">Mixed ' + counts.readWrite + '</span>',
          '    </div>',
          '    <div class="header-actions">',
          '      <button type="button" class="toolbar-button" id="refresh-button">Refresh</button>',
          '    </div>',
          '  </div>',
          '</div>',
        ].join('');

        const refreshButton = document.getElementById('refresh-button');
        refreshButton?.addEventListener('click', () => {
          vscode.postMessage({ type: 'refreshCurrentSymbol' });
        });
      }

      function renderFilters() {
        filtersRoot.innerHTML = '';
        filtersRoot.appendChild(createFilterButton('Reads', state.showReads, () => {
          state.showReads = !state.showReads;
          render();
        }));
        filtersRoot.appendChild(createFilterButton('Writes', state.showWrites, () => {
          state.showWrites = !state.showWrites;
          render();
        }));
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

          item.dataset.key = referenceKey(reference);
          item.tabIndex = -1;
          item.addEventListener('click', () => {
            selectReference(reference);
          });
          item.addEventListener('dblclick', () => {
            selectReference(reference);
            postReferenceMessage('openReference', reference);
          });

          const kindClass = reference.classification;
          item.innerHTML = [
            '<div class="reference-topline">',
            '  <div class="reference-path" title="' + escapeHtml(formatUriLabel(reference.uri)) + '">' + escapeHtml(formatUriLabel(reference.uri)) + '</div>',
            '  <span class="kind-badge ' + kindClass + '">' + escapeHtml(formatClassification(reference.classification)) + '</span>',
            '</div>',
            '<div class="reference-meta">Line ' + (reference.preview?.lineNumber ?? reference.range.start.line + 1) + '</div>',
            '<div class="reference-snippet">' + escapeHtml(firstPreviewLine(reference.preview)) + '</div>',
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
          '<div class="preview-header">',
          '  <div>',
          '    <h2 class="preview-title">' + escapeHtml(formatUriLabel(selectedReference.uri)) + '</h2>',
          '    <div class="preview-subtitle">Line ' + preview.lineNumber + ' • ' + escapeHtml(formatClassification(selectedReference.classification)) + '</div>',
          '  </div>',
          '  <div class="preview-actions">',
          '    <button type="button" class="toolbar-button" id="open-button">Open</button>',
          '    <span class="kind-badge ' + selectedReference.classification + '">' + escapeHtml(formatClassification(selectedReference.classification)) + '</span>',
          '  </div>',
          '</div>',
          '<div class="preview-code">',
          '  <div class="code-lines">' + codeLines + '</div>',
          '</div>',
          preview.errorMessage
            ? '<div class="preview-error">' + escapeHtml(preview.errorMessage) + '</div>'
            : '',
        ].join('');

        const openButton = document.getElementById('open-button');
        openButton?.addEventListener('click', () => {
          postReferenceMessage('openReference', selectedReference);
        });
      }

      function createFilterButton(label, isActive, onClick) {
        const button = document.createElement('button');
        button.className = 'filter-button';
        if (isActive) {
          button.classList.add('is-active');
        }
        button.type = 'button';
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
        postReferenceMessage('revealReference', reference);
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

      function firstPreviewLine(preview) {
        if (!preview || !preview.snippet) {
          return preview?.errorMessage ?? 'Preview unavailable';
        }

        const lines = preview.snippet.split('\\n');
        const index = Math.max(0, preview.highlightLine - preview.snippetRange.start.line);
        return lines[index] ?? lines[0] ?? 'Preview unavailable';
      }

      function formatClassification(classification) {
        if (classification === 'read-write') {
          return 'Mixed';
        }

        return classification.charAt(0).toUpperCase() + classification.slice(1);
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

