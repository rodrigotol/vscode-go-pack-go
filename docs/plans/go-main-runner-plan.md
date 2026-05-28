# Go Main Runner — Extension Description & Recreation Guide
​
This document describes the behavior of the **Go Main Runner** VS Code extension and provides a task-by-task plan to recreate it from scratch. It is structured so that another AI agent can rebuild the extension faithfully without copying source files. Focus is on **observable behavior, decisions, and edge cases** — naming of files, classes, and methods is left to the implementer.
​
---
​
## 1. What the Extension Does
​
Go Main Runner is a Visual Studio Code extension that adds **CodeLens "Run" and "Debug" buttons above every `main()` function in Go files belonging to `package main`**. Clicking the buttons executes (or debugs) that specific `main` in a safe, predictable way — using the *exact* directory of the file as the program target, and optionally honoring matching configurations from `.vscode/launch.json`.
​
The product is intentionally minimal: zero configuration required, no fuzzy heuristics, no surprises. Its core promise is that **the main function you click is the main function that runs**, even in repositories with many `cmd/<service>/main.go` entry points.
​
### Target users
Go developers working in monorepos with multiple binaries (e.g. `cmd/api`, `cmd/worker`, `cmd/migrator`) who want one-click execution without authoring task definitions per binary.
​
### Activation
The extension activates when a Go language file is opened (`onLanguage:go`). It depends on the official Go extension (`golang.go`) being installed for the debug path; the run path works without it as long as `go` is available in the user's PATH.
​
---
​
## 2. User-Visible Behavior
​
### 2.1 CodeLens appearance
- Above every `func main()` declaration in a saved Go file whose package clause is `package main`, two CodeLenses appear side-by-side:
 - `▶ Run`
 - `�� Debug` (the gopher hieroglyph character)
- The two lenses share the same anchor position (start of the `main` function declaration line).
- A short tooltip is shown on hover ("Run this main function", "Debug this main function").
​
### 2.2 When CodeLens does NOT appear
- File is not a Go file.
- File's package is not `main` (e.g., `package foo` — no lens, even if a function named `main` exists).
- File has never been saved (untitled buffer).
- File has unsaved changes (dirty).
- No function named `main` exists in the file.
​
### 2.3 Clicking Run
1. Extension validates the file is saved and in `package main`.
2. Extension searches for a launch configuration in `.vscode/launch.json` that **exactly** matches the directory containing the file. Search walks from the file's directory up to the workspace root, accumulating configurations from any `.vscode/launch.json` found along the way.
3. If a matching Go launch config is found, its `env`, `buildFlags`, `args`, and `cwd` are applied.
4. A VS Code **Task** is created using a shell execution of:
  ```
  go run [buildFlags] <absolute-path-to-main-directory> ["arg1" "arg2" ...]
  ```
5. The task is followed by a shell suffix that prints `✅ Execution completed successfully` on exit code 0, or `❌ Execution failed` otherwise.
6. The task runs in a **dedicated** terminal panel that is always revealed but does not steal focus.
7. The working directory (`cwd`) defaults to the workspace root, OR to the matched config's `cwd` if one is set.
8. A status bar message displays for ~5 seconds telling the user which directory is being run and whether a config was used.
​
### 2.4 Clicking Debug
1. Same validation as Run.
2. Same config-matching logic as Run.
3. If the Go extension is not installed → show an error message instructing the user to install it. Abort.
4. If the Go extension is installed but not active → activate it and wait.
5. A debug configuration object is built. Behavior:
  - **If a config matched**: spread the matched config into the debug session, then **forcibly override** `program` to be the file's directory, and override `cwd` to the resolved workspace root (or the config's `cwd` if specified). Set `type: 'go'`, `request: 'launch'`, `mode: matchedConfig.mode || 'auto'`, `console: 'debugConsole'`.
  - **If no config matched**: emit a minimal configuration with `type: 'go'`, `request: 'launch'`, `mode: 'auto'`, `program` = file's directory, `cwd` = workspace root, `console: 'debugConsole'`, `showLog: false`.
6. Call `vscode.debug.startDebugging`. If it returns `false`, show an error suggesting the user install `delve` (`go install github.com/go-delve/delve/cmd/dlv@latest`).

### 2.5 Status / feedback
- A status bar message of the form `Running main in: <cwd> (using config '<name>')` or `Running main in: <cwd> (using default settings)` is shown.
- Debug-mode prints a corresponding `Debugging main in: ...` message into the Debug Console.
- All other diagnostic logging goes to the developer console, but **only if** the user has enabled the `goMainRunner.enableDebugLogs` setting. Errors and warnings are always logged regardless of that setting.
​
### 2.6 Caching & refresh behavior
- CodeLenses are cached per document URI with the document's `version` as the cache key.
- Cache is invalidated when:
 - The document is saved.
 - The document is closed.
 - The document is modified (debounced ~500 ms before refresh fires).
- The provider exposes an `onDidChangeCodeLenses` event so VS Code re-queries it after a refresh.
​
---
​
## 3. Safety Philosophy (Critical Behavioral Contract)
​
These rules are non-negotiable and must be preserved by any reimplementation. They are why the extension exists.
​
1. **The program path passed to `go run` and to the debugger is ALWAYS the directory containing the clicked `main.go` file** — not the workspace root, not the cwd, not a config's `program` field. The user clicked *this* main; *this* directory is what runs.
2. **Launch configs are matched only by exact path equality** between the resolved `program` field of a Go launch config and the clicked file's directory. There is no fuzzy matching, no prefix matching, no "best guess".
3. **A non-matching launch config is treated as if it did not exist**, regardless of how visually similar it looks. Default settings are used instead.
4. **Run and Debug share the same matching logic** so that what runs and what debugs are identical.
5. **Files must be saved before execution.** Untitled or dirty files refuse to run with a clear error message.
6. **Files must declare `package main`.** Anything else refuses to run.
7. The user is told (status bar / debug console) which config — if any — is being used, before execution begins.
​
---
​
## 4. Architecture / Component Responsibilities
​
Recreate the extension as the following logical components. Names are illustrative — pick whatever you like.
​
### Component A — Activation entrypoint
- Registers the CodeLens provider for Go file-scheme documents.
- Registers two commands (run, debug).
- Wires document save / change / close listeners that invalidate the CodeLens cache and trigger refresh.
- Disposes the provider on deactivation.
​
### Component B — Main function detector
- Given a Go document, returns the positions of every `func main()` in it.
- **Must use VS Code's built-in Document Symbol Provider** (`vscode.executeDocumentSymbolProvider`) — this delegates to `gopls`, so the extension doesn't ship its own Go parser.
- Recursively walks the symbol tree (functions can be nested in other symbols) and collects all symbols whose `kind` is Function and whose name is exactly `main`.
- Returns nothing if the file is unsaved/untitled or the package isn't `main`.
- Determines `package main` by scanning the **first 20 lines** of the file, skipping `//`/`/*` comment lines, finding the first `package <name>` line, and comparing the name. (Don't lean on regex over the whole file — first-line scan is faster and good enough.)
​
### Component C — CodeLens provider
- For each detected main function, emits two CodeLenses (Run + Debug) anchored at the function's start position.
- Each lens carries a command id and a single argument: the file's URI.
- Caches results by document URI + document version. Returns the cached array if the version is unchanged.
​
### Component D — Launch config matcher
- Loads every `launch.json` between the clicked file's directory and the workspace root (i.e. ascend from the file's directory, stopping at workspace root, reading each `.vscode/launch.json` found).
- Parses JSON **with comments stripped** (single-line `//...` and block `/* ... */`) — VS Code's launch.json is JSONC, not strict JSON. Don't crash on comments.
- Filters to configurations where `type === 'go'` and `request === 'launch'`.
- Resolves variables in each config's `program` field:
 - `${workspaceFolder}` and `${workspaceRoot}` → workspace root.
 - `${fileDirname}` → the clicked file's directory.
 - The result is normalized via `path.resolve`.
 - If the resolved path ends in `.go`, replace it with its parent directory (so `${workspaceFolder}/cmd/api/main.go` and `${workspaceFolder}/cmd/api` both match).
- Returns the first config whose resolved `program` is **strictly equal** to the clicked file's directory. No match → return null.
- Exposes helpers to extract `env`, `buildFlags`, `args`, and `cwd` from a (possibly null) config, with sensible defaults (empty / workspace root).
​
### Component E — Execution validator
- Given a file URI, validates: file exists on disk, document is saved (not dirty, not untitled), file is in a workspace folder, file's directory exists, and the document declares `package main`.
- Returns either a validation failure with a human-readable error, or an execution context object containing: main file path, main file directory, default working directory (workspace root), and the workspace folder.
- Provides a helper to generate the human-readable status string ("Running main in X (using config 'Y')" / "(using default settings)").
​
### Component F — Run command
- On invocation, runs validation (Component E), config matching (Component D), then constructs a shell-mode VS Code Task:
 - Command: `go run [buildFlags] <main-directory> ["arg" ...]; if [ $? -eq 0 ]; then echo "✅ Execution completed successfully"; else echo "❌ Execution failed"; fi`
 - Environment: a merge of `process.env` over the config's `env`.
 - cwd: the matched config's `cwd` (with variable resolution) or workspace root.
- Task presentation: always reveal, do not focus, dedicated panel, no reuse message, no clearing.
- Task is non-background.
​
### Component G — Debug command
- On invocation, runs validation + config matching as above.
- Verifies the Go extension (`golang.go`) is installed and active.
- Constructs the debug configuration as described in section 2.4.
- Starts the debug session and reports failure if the API returns false.
​
### Component H — Logger
- A central wrapper that reads `goMainRunner.enableDebugLogs` from VS Code configuration on each call.
- `log()` is silent when the setting is false; `error()` and `warn()` are always loud.
- All output is prefixed with `[Go Main Runner]`.
​
---
​
## 5. Configuration Schema
​
The extension contributes exactly one user setting:
​
| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `goMainRunner.enableDebugLogs` | boolean | `false` | When true, verbose diagnostic logs are emitted to the developer console. |
​
The extension contributes exactly two commands:
​
| Command id | Title |
|------------|-------|
| `<extension-prefix>.run` | Run Go Main |
| `<extension-prefix>.debug` | Debug Go Main |
​
The extension contributes nothing else — no views, no keybindings, no menu items, no language contributions.
​
---
​
## 6. Packaging
​
- TypeScript, strict mode, target ES2020, CommonJS modules.
- Output directory `dist/`, source under `src/`.
- Zero runtime dependencies. Dev dependencies: `@types/vscode`, `@types/node`, `typescript`, `eslint`, TypeScript ESLint plugin/parser.
- `vscode:prepublish` script runs `npm run compile`.
- Packaged via `vsce package` into a single `.vsix`.
- Engine requirement: VS Code `^1.75.0`.
- Categories: `Programming Languages`, `Debuggers`. Keywords include `go`, `golang`, `run`, `debug`, `codelens`.
- Icon: PNG file shipped at project root, referenced from `package.json`.
​
---
​
## 7. Edge Cases & Decisions That Are Easy To Get Wrong
​
These are the subtle behavioral details that distinguish a correct implementation from a near-miss.
​
1. **Multiple `main` functions in one file** — VS Code allows odd files; the detector returns one entry per match and the provider emits a Run+Debug lens pair for each. (Go itself rejects this at build time, but the extension doesn't second-guess gopls.)
2. **`main` functions nested inside other symbols** — symbols are walked recursively, not just the top level.
3. **`launch.json` with comments** — stripped before parsing. Without stripping, JSON.parse throws and the extension would silently lose all configs.
4. **`launch.json` with `program` pointing at `main.go` rather than its directory** — handled: if the resolved path ends in `.go`, parent directory is used for comparison.
5. **Multiple `.vscode/launch.json` files between the file and the workspace root** — all are loaded and merged into the candidate pool. This supports monorepos with per-subproject launch files.
6. **Config matches a different directory than the clicked file** — even with matching `type`/`request`/`name`, the config is rejected unless the resolved `program` equals the file's directory exactly. This is the core safety rule.
7. **Workspace root not detected** — file outside any workspace folder fails validation with a clear error.
8. **Document save invalidates cache and refresh fires immediately**, but document changes use a 500 ms debounce so typing doesn't thrash gopls.
9. **Cache key is document URI + version** — two open files with the same URI can never collide because URIs are unique; same URI at the same version means same content.
10. **Status bar message uses workspace root in the description, but the actual `go run` argument is always the main file's directory.** These are different paths and both must appear correctly.
11. **Run uses Tasks API, Debug uses Debug API.** They are not interchangeable — Run goes to a terminal, Debug goes to a debug session, both must behave identically with respect to config matching.
12. **`process.env` is merged UNDER the config's `env`** (config takes precedence) and the result is passed as the shell environment. Don't reverse this order.
13. **Variable resolution** is intentionally minimal — only `${workspaceFolder}`, `${workspaceRoot}`, `${fileDirname}` are substituted. Other VS Code variables (`${file}`, `${env:FOO}`, etc.) are not supported.
14. **Debug always overrides `program` and `cwd`** even when spreading a matched config — the user's config can't accidentally redirect execution somewhere else.
​
---
​
## 8. Task List to Recreate the Extension
​
Work through these tasks in order. Each task ends with a verifiable outcome.
​
### Task 1 — Project scaffold
Create a new VS Code extension project in TypeScript: `package.json`, `tsconfig.json`, `.eslintrc.json`, `.vscodeignore`, `.gitignore`, `src/` directory, and a minimal `extension.ts` exporting `activate`/`deactivate`. Configure as described in section 6.
**Done when:** `npm run compile` produces `dist/extension.js` with no errors.
​
### Task 2 — Manifest contributions
Declare the activation event `onLanguage:go`, two commands (run + debug), and the one boolean setting `goMainRunner.enableDebugLogs`. Add display name, description, version `0.1.0`, categories, keywords, and icon reference.
**Done when:** Loading the extension in an Extension Development Host shows the commands in the command palette and the setting under "Go Main Runner".
​
### Task 3 — Logger
Implement a logger that reads `goMainRunner.enableDebugLogs` from configuration on every call. `log()` is gated by the setting; `error()` and `warn()` are unconditional. Prefix all messages with `[Go Main Runner]`.
**Done when:** Toggling the setting changes whether `Logger.log(...)` output appears in the Extension Host console.
​
### Task 4 — Main function detector
Implement a component that, given a `TextDocument`:
- Returns `[]` if the doc is unsaved/dirty/non-Go.
- Returns `[]` if the package clause (first 20 non-comment lines) is not `main`.
- Otherwise calls `vscode.executeDocumentSymbolProvider`, walks the symbol tree recursively, and returns the positions of every function named `main`.
​
**Done when:** A unit-style smoke test against a fixture file with `package main { func main() {...} }` returns one position; a fixture with `package foo` returns none.
​
### Task 5 — CodeLens provider
Implement a `CodeLensProvider` that uses the detector to emit a Run lens and a Debug lens at each main's position, each lens carrying the document URI as its sole command argument. Cache by `(uri, document.version)`. Expose an `onDidChangeCodeLenses` event emitter and a `refresh()` method that fires it. Expose a `clearCache(document)` method.
**Done when:** Opening a saved `main.go` shows `▶ Run` and `�� Debug` above the function. Modifying the file and saving causes the lenses to refresh.
​
### Task 6 — Activation wiring
In `activate(context)`: instantiate the provider, register it for `{ language: 'go', scheme: 'file' }`, register the two command handlers (stubs for now), subscribe to `onDidSaveTextDocument` (clear cache + refresh immediately), `onDidChangeTextDocument` (clear cache + debounce 500 ms before refresh), and `onDidCloseTextDocument` (clear cache). Push every disposable into `context.subscriptions`. In `deactivate`, dispose the provider.
**Done when:** Save/change/close events update or clear lenses correctly with no event listener leaks.
​
### Task 7 — Execution validator
Implement a validator that, given a file URI:
- Loads the document; returns failure if dirty or untitled.
- Returns failure if the file doesn't exist on disk.
- Returns failure if the package isn't `main` (re-check; do not trust the lens).
- Returns failure if not inside any workspace folder.
- Returns failure if `path.dirname(filePath)` doesn't exist.
- Returns success with an execution context: main file path, main file directory, default working directory (workspace root), the workspace folder object, and a slot for a matched config (initially null).
​
Also provide a function that formats a human-readable status string given a context and a mode (`run` | `debug`).
**Done when:** Each failure mode is reachable and produces a clear error string.
​
### Task 8 — Launch config matcher
Implement the matcher from section 4 Component D:
- Walk upwards from the file's directory to the workspace root, reading every `.vscode/launch.json` found.
- Strip `//` and `/* */` comments before `JSON.parse`.
- Collect all configurations with `type === 'go'` and `request === 'launch'`.
- For each, resolve `${workspaceFolder}`, `${workspaceRoot}`, `${fileDirname}` in `program`; `path.resolve` the result; if it ends in `.go`, take its `dirname`.
- Return the first config whose resolved program **strictly equals** the file's directory. Else null.
- Provide helper extractors for `env` (merged on top of `process.env`), `buildFlags` (string, empty if missing), `args` (array, empty if missing), `cwd` (with `${workspaceFolder}`/`${workspaceRoot}` resolution, falling back to a provided default).
​
**Done when:** Given a launch.json with three configs, only the one whose `program` matches the file's directory is returned; a `main.go` in an unmatched directory yields null.
​
### Task 9 — Shared command base
Factor out the shared command logic so Run and Debug both: validate (Task 7), search for a config (Task 8), verify the config (if any) actually matches, log + show the status bar message, then delegate to a mode-specific executor. Errors anywhere in the pipeline are caught and shown via `window.showErrorMessage`.
**Done when:** A failure in validation produces an error toast; a successful pass through reaches the mode-specific executor.
​
### Task 10 — Run command implementation
Implement the Run executor as described in section 2.3:
- Build a shell command: `go run [buildFlags] <main-directory> ["arg" ...]` followed by the success/failure echo suffix.
- Merge environment (config `env` over `process.env`).
- Resolve `cwd` (config `cwd` or workspace root).
- Create a `vscode.Task` with a `ShellExecution`, scope = workspace folder, source = `go-main-runner`, type = `shell`.
- Presentation: reveal Always, focus false, panel Dedicated, no reuse message, no clear, non-background.
- Run via `vscode.tasks.executeTask`.
​
**Done when:** Clicking Run executes the `go run` command in a dedicated terminal, prints the success/failure marker, and uses the matched config's env/args/buildFlags when present.
​
### Task 11 — Debug command implementation
Implement the Debug executor as described in section 2.4:
- Verify `golang.go` extension is installed; if not, error and abort.
- Activate it if not active.
- Build the debug config: spread a matched config if present, then forcibly set `type`, `request`, `mode` (default `auto`), `program` (the file's directory), `cwd` (resolved), `console` (default `debugConsole`), `showLog` (default false). If no matched config, build a minimal debug config with the same fields.
- Call `vscode.debug.startDebugging(workspaceFolder, debugConfig)`.
- If it returns false, show an error mentioning delve installation.
​
**Done when:** Clicking Debug starts a Go debug session with `program` pointing at the file's directory regardless of what the matched config's `program` was.
​
### Task 12 — Manual test suite
Create test fixtures: a simple single-file main; a multi-file main package (main + helper); two cmd/<service> mains with matching configs in a sibling `.vscode/launch.json`; an extra main that has no matching config; and a non-`package main` file.
Walk through each fixture and verify the behavior described in section 2 and the safety checklist in section 3.
**Done when:** Every scenario produces the expected status bar message, terminal output, and (for debug) debug session.
​
### Task 13 — Package & install
Add `vsce` as a global tool, run `vsce package`, install the resulting `.vsix` into VS Code or Cursor, reload, and confirm the extension activates on opening a `.go` file. Confirm the developer-console activation log appears (with debug logs enabled).
**Done when:** A fresh VS Code window with no other configuration sees the lenses appear on a `main.go` and can both run and debug it.
​
---
​
## 9. Acceptance Criteria (Definition of Done)
​
The recreation is complete when **all** of the following are true:
​
- [ ] CodeLens `▶ Run` / `𓆣 Debug` appears above every `main()` in saved `package main` Go files.
- [ ] No CodeLens appears on dirty, untitled, or non-`package main` files.
- [ ] Clicking Run launches `go run <main-dir>` in a dedicated terminal with the success/failure echo suffix.
- [ ] Clicking Debug starts a Go debug session whose `program` is the file's directory, regardless of any launch config's `program` value.
- [ ] An exact-match launch config (resolved `program` equals file's directory) is honored — env, args, buildFlags, cwd all applied.
- [ ] A non-matching launch config is ignored entirely; defaults are used.
- [ ] A status bar message announces the directory and which config (or "default settings") will be used.
- [ ] The single setting `goMainRunner.enableDebugLogs` toggles verbose logging on/off.
- [ ] No runtime dependencies are added beyond the VS Code API.
- [ ] CodeLens cache invalidates on save, change (debounced), and close.
- [ ] The extension activates only on Go files.
- [ ] The debug path produces a clear error if the Go extension is missing, and a clear error if `startDebugging` returns false.

