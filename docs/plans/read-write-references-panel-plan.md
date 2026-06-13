# Build Tasks — Enhanced "Go to References" Extension
A reproducible, ordered task list to rebuild this VS Code extension from an
empty folder, capturing every tech choice and decision (and the gotchas we hit).
---
## Goal
Replace the native "Go to References" experience with a custom panel that:
- lists references in a **flat list** (no tree nesting),
- shows per-reference **Read / Write / Other** indicators,
- filters by those three kinds,
- previews the selected reference in a **real, fully-interactive editor** beside
 the origin file (full file, native hovers/go-to-def), without ever closing the
 tab the action was triggered from:
 - **single click** → transient preview beside (focus stays in the list),
 - **double click** → open permanently in the main column + close the side preview,
 - **panel hidden/closed** → the side preview is closed automatically.
Triggered initially from a new **editor context-menu** entry.
---
## Tech choices (decided)
| Area | Choice | Why |
|------|--------|-----|
| Language | TypeScript, strict | Standard for VS Code extensions; catches API misuse. |
| Bundler | esbuild (`node esbuild.js`) | Fast, simple, single-file `out/extension.js`. |
| List UI | **Native `TreeView` rendered flat** (not a webview, not a tree) | Free keyboard nav / type-ahead / theming / a11y; lowest effort & risk. Webview only buys cosmetics at high cost. |
| Preview | **Real editor** in `ViewColumn.Beside`, `preview:true`, `preserveFocus:true` | A real `TextEditor` keeps full language-server interactivity; can't be embedded in a webview/panel anyway. |
| Classification | **Language-server driven** via `documentHighlight` kinds; no heuristics | Accurate where the server is strong (gopls); no fragile source parsing. |
| Buckets | **Read / Write / Other** (no "mixed") | 100% read-or-write is impossible (declarations, type/func/package uses are neither); "Other" is the honest home. |
| Languages | **Go-first** (gopls), engine generic | Matches the JetBrains GoLand reference; engine still works best-effort elsewhere. |
| Dock | Bottom **Panel** view container | Natural home for "find usages" results (like Search/Problems). |
### Key decisions & rationale
- **List is decoupled from engine + preview.** `referenceEngine`, `classification`,
 and `previewController` know nothing about the UI, so the list surface can be
 swapped (e.g. to a webview later) without touching them.
- **Origin tab is never disturbed.** Preview opens in a *separate* editor group as a
 single reused preview tab; focus stays in the list so arrow keys keep navigating.
- **Kind icons use the default text color** (no red/write, green/read tint — explicit
 user preference). Kinds are distinguished by codicon shape + a `<kind> ·` label.
- **Classification precedence:** when several highlights overlap one reference, keep
 the strongest signal **Write > Read > Other** (the highlight command merges all
 providers, so a generic `Text` highlight must not mask a real `Write`).

### ⚠️ Gotchas we hit (do not repeat)
1. **The highlight command is `vscode.executeDocumentHighlights` — NOT
  `vscode.executeDocumentHighlightProvider`.** It breaks the `...Provider` naming
  convention every other command follows. Using the wrong name throws
  "command not found"; if you swallow that in a try/catch you silently get zero
  highlights and everything falls to "Other". This was the main bug.
2. **`@types/vscode` lags the app.** Latest published was `1.120.0` while the app was
  `1.123.x`. Pin `@types/vscode` and `engines.vscode` to `^1.120.0` (the newer app
  still satisfies it). `npm i @types/vscode@^1.123` fails with ETARGET.
3. **`executeReferenceProvider` returns NO read/write data** — that only exists in
  `documentHighlight`. Hence the two-call design.
4. gopls *does* classify composite-literal struct field keys (`T{field: v}`) as
  **Write** — verified over LSP. If you see them as "Other", the bug is yours, not
  gopls's.
---
## Tasks
### Task 1 — Scaffold config
- Update: `package.json` — manifest (see Task 6 for `contributes`); scripts `compile`
 (`node esbuild.js`), `watch`, `typecheck` (`tsc --noEmit`); devDeps
 `typescript@^5.6`, `esbuild@^0.28`, `@types/node@^22`, `@types/vscode@^1.120`;
 `engines.vscode: ^1.120.0`; `main: ./out/extension.js`.
- `.gitignore` (`node_modules/`, `out/`, `*.vsix`), `.vscodeignore`.
- `.vscode/launch.json` (`extensionHost`, `--extensionDevelopmentPath=${workspaceFolder}`,
 `preLaunchTask: npm: compile`) and `.vscode/tasks.json` (npm compile/watch).
Create:
- `tsconfig.json` — `module commonjs`, `target ES2022`, `strict`, `outDir out`,
 `rootDir src`.
- `esbuild.js` — bundle `src/extension.ts` → `out/extension.js`, `external: ["vscode"]`,
 `platform node`, `format cjs`, `sourcemap`, `--watch` support.
Verify: `npm install` succeeds.
### Task 2 — Types (`src/readWriteReferencesTypes.ts`)
- `enum RefKind { Write="write", Read="read", Other="other" }`.
- `interface ClassifiedReference { uri; range; kind; lineText }`.
- `KIND_ORDER = [Write, Read, Other]`; `kindLabel(kind)`.
### Task 3 — Classification (`src/readWriteReferencesClassification.ts`)
- `highlightKindToRefKind(DocumentHighlightKind?)`: `Write`→Write, `Read`→Read,
 everything else (incl. `Text`/undefined) → Other.
- `classifyByHighlights(range, highlights)`: among all highlights overlapping the
 reference (`hl.range.contains(range.start) || range.contains(hl.range.start)`),
 return the **highest-precedence** kind (Write > Read > Other). Default Other.

### Task 4 — Reference engine (`src/readWriteReferencesEngine.ts`)
- `findClassifiedReferences(uri, position, token)`:
 1. `executeCommand("vscode.executeReferenceProvider", uri, position)` → `Location[]`.
 2. Group by file.
 3. Per file: `highlightsAt(fileUri, firstRef.range.start)` →
    `executeCommand("vscode.executeDocumentHighlights", fileUri, position)`.
    **(correct command name!)**
 4. Classify each reference via `classifyByHighlights`. **Fallback:** any reference
    still `Other` → re-query `highlightsAt` anchored on its *own* start position and
    reclassify (covers partial/empty per-file sets).
 5. Read `lineText` via `workspace.openTextDocument` + `doc.lineAt(...).text.trim()`.
- `highlightsAt` makes a **single** call (no retry loop) and **logs — does not
 swallow — errors** via `src/log.ts`. Swallowing a failure here once hid the
 wrong-command-name bug (see Gotcha #1); always surface it.
- `src/log.ts`: a minimal Output channel ("Enhanced References"). It is **not**
 auto-revealed on each run. Used only for an activation line and highlight errors.
 (Verbose per-reference/per-attempt diagnostics were used during development and
 then removed — do not ship them.)
### Task 5 — UI layer
- `src/readWriteReferencesFilterState.ts` — visibility per `RefKind`; `toggle(kind)` flips a bool, sets
 context keys `enhancedReferences.show{Write,Read,Other}`, fires `onDidChange`.
- `src/readWriteReferencesTreeProvider.ts` — **flat** `TreeDataProvider<ClassifiedReference>`:
 - `getChildren(undefined)` → references filtered by `filter.isVisible(kind)`,
   sorted by file then position; `getChildren(ref)` → `[]`.
 - `getTreeItem(ref)`: `iconPath = KIND_ICON[kind]` (plain `ThemeIcon`, **no color**:
   `pencil`=write, `eye`=read, `circle-outline`=other); label = `ref.lineText`;
   `description = "<kind> · relPath:line"`; `command = openReference` with the ref.
 - `setReferences(symbolLabel, refs)`, `clear()`, `summary()` →
   e.g. `calculator — 3 (W1 R1 O1)`.

### Task 6 - preview Contoller
- `src/readWriteReferencesPreviewController.ts` — owns the preview lifecycle. State: `previewUri`
 (current side preview), `originColumn` (the "main" column, set per search).
 Methods:
 - `setOriginColumn(column)` — remember `editor.viewColumn` from the search.
 - `preview(ref)` (single click): `showTextDocument(doc, { viewColumn: Beside,
   preview: true, preserveFocus: true, selection: ref.range })`; record `previewUri`.
 - `openPermanent(ref)` (double click): `showTextDocument(doc, { viewColumn:
   originColumn, preview: false, preserveFocus: false, selection: ref.range })`,
   then `closePreviewTab()`. Opens a real tab in the main column and removes the
   side preview (the emptied beside group auto-collapses).
 - `closePreviewTab()` — scan `vscode.window.tabGroups.all`; close the tab whose
   `input instanceof TabInputText` matches `previewUri` **and** `tab.isPreview` is
   true (never close a tab the user promoted to permanent). Clears `previewUri`.
 - Both open paths call `revealRange(range, InCenterIfOutsideViewport)` +
   `setDecorations`. The decoration type (created once, disposed on deactivate):
   `backgroundColor: ThemeColor("editor.findMatchHighlightBackground")`,
   `borderRadius: "2px"`,
   `overviewRulerColor: ThemeColor("editorOverviewRuler.findMatchForeground")`,
   `overviewRulerLane: OverviewRulerLane.Center`.

### Task 7 — Manifest `contributes`
- `activationEvents: []` — activation is auto-derived from the contributed command;
 no explicit event needed.
- `commands`: `findReferences` ("Find References (Enhanced)"), `openReference`,
 and `toggleWrite/Read/Other` each with a codicon (`$(pencil)`, `$(eye)`,
 `$(symbol-misc)`). NOTE: the toggle buttons do **not** swap icons to show on/off
 state — `FilterState` sets context keys, but the manifest has no `when`-gated
 alternate icons, so there's no visual toggled state. (Intentional v1 simplicity;
 add alternate icons later if wanted.)
- `menus.editor/context`: `findReferences`, `when: editorTextFocus`, `group: navigation@99`.
- `viewsContainers.panel`: container `enhancedReferences` (icon `$(references)`).
- `views.enhancedReferences`: one view `enhancedReferences.referencesView`, `type: "tree"`.
- `menus.view/title`: `toggleWrite` (`navigation@1`), `toggleRead` (`@2`),
 `toggleOther` (`@3`), all `when: view == enhancedReferences.referencesView`.
### Task 8 — Wire it (`src/extension.ts`)
- `activate`: create the Output channel eagerly; `FilterState`, `ReferencesTreeProvider`,
 `PreviewController`; `createTreeView(VIEW_ID, { treeDataProvider })`; register all
 commands; push everything to `context.subscriptions`.
- **Close preview on panel hide:** `treeView.onDidChangeVisibility(e => { if
 (!e.visible) preview.closePreviewTab(); })`. CAVEAT: this fires whenever the view
 is hidden — including switching to another panel tab (Terminal/Problems/Output),
 not strictly a full panel close; the preview closes in those cases too. (If too
 aggressive, debounce it or tie the preview to the search session instead.)
- **Emulated double-click** (TreeView fires only single clicks). Keep
 `lastClick = { key, time }` in closure scope; `DOUBLE_CLICK_MS = 250`. In the
 `openReference` handler build `key = uri#line:char`; if the same key was clicked
 within the window → `preview.openPermanent(ref)` (and reset `lastClick`), else
 `preview.preview(ref)` (and record `lastClick`).
- `findReferences` handler:
 - if no active editor → `showInformationMessage("… open a file and place the cursor
   on a symbol first.")` and return;
 - `preview.setOriginColumn(editor.viewColumn)` — the column a double-click opens into;
 - read `document.uri`, `selection.active`, and the word at cursor (fallback
   `"symbol"`) for the label;
 - **Loading state (avoids the panel flashing while results load):** before
   searching, `treeProvider.clear()` and set
   `treeView.message = 'Searching for references to "…"…'` so an already-open
   panel shows a clean header instead of stale rows.
 - run the search under `withProgress` with **`location: ProgressLocation.Window`**
   (status bar) — NOT `{ viewId }`. Using the view location reveals a closed panel
   mid-load and looks glitchy; the status bar doesn't.
 - call the engine; `setReferences(label, refs)`;
 - if `refs.length === 0` → set `treeView.message = 'No references found for "…".'`
   and `showInformationMessage(...)`, then return (do **not** reveal the panel);
 - else set `treeView.message = summary() || undefined` and **only then** reveal the
   panel with `${VIEW_ID}.focus` — so the panel never appears half-loaded.
- `deactivate` is a no-op (all disposables are in `context.subscriptions`).

### Task 9 — Build & verify
- `npm run typecheck` (clean) and `npm run compile` (produces `out/extension.js`).
- **F5** → Extension Development Host. Open a Go workspace (gopls installed).
- Right-click a struct field used for reads and writes → **Find References (Enhanced)**.
- Confirm: flat list with kind icons; a composite-literal key (`field: v`) shows
 **Write**, a selector read (`x.field`) shows **Read**, the declaration shows **Other**.
- Single-click rows: preview opens **beside**, origin tab stays open, the **same
 preview tab is reused**, focus stays in the list. Preview is a real editor
 (hover/go-to-def work).
- **Double-click a row** (within 250 ms): it opens as a permanent tab in the main
 column and the side preview tab disappears.
- **Close the references panel:** the side preview tab is closed automatically.
- Toggle each filter in the view title.
- **Reload after each rebuild with Cmd+R in the dev host** — otherwise the old bundle runs.
---
## Out of scope (v1)
- Webview / GoLand pixel-match list (swap only the list surface later if wanted).
- "Mixed" bucket / heuristic classification.
- Per-language tuning beyond Go.
- Marketplace packaging (`vsce package` flow).

