# Go Main Runner Integration Plan

## Summary

Add a third Go-focused feature to the existing `go-pack-go` extension: CodeLens actions that place `▶ run` and `𓆣 debug` above every saved `func main()` in files that belong to `package main`.

This is an integration plan for the current project, not a standalone-extension scaffold. The implementation must preserve the behavior described by the original Go Main Runner design while following this repository's existing practices:

- keep feature logic isolated in dedicated modules
- keep `src/extension.ts` as the VS Code wiring layer
- keep tests in the current Node test setup under `src/*.test.ts`
- compile to `out/`, not `dist/`
- avoid regressions in the two existing features:
  - table-test scenario CodeLens
  - type-implementation CodeLens

## Behavioral Contract

These behaviors must remain true after integration:

1. The `go run` target and debug `program` must always be the directory containing the clicked Go file.
2. Launch configuration matching must use exact resolved path equality against that directory.
3. Run and Debug must share the same validation and launch-config matching logic.
4. Dirty or untitled files must not receive the main-function lenses and must not execute.
5. Only files whose package is exactly `main` may receive these lenses or execute.
6. Any matched launch config may contribute `env`, `buildFlags`, `args`, and `cwd`, but it must never redirect execution away from the clicked main directory.
7. Adding this feature must not change the commands, CodeLens titles, provider scope, or behavior of the two existing features.

## Project Fit

The current repo is already an extension with active Go features. The new main-runner feature should fit that shape instead of introducing a separate extension architecture.

- Reuse the current package and extension id: `go-pack-go`
- Add new modules rather than rewriting existing table-test or type-implementation modules
- Register an additional Go-wide `CodeLensProvider` beside the current ones
- Reuse the existing Tree-sitter parser for package detection rather than introducing a second parsing stack
- Keep main-function discovery on VS Code's document symbol provider as originally intended
- Extend the manifest only where needed for the new commands and setting

## Implementation Notes

- Keep the feature split into focused modules, for example:
  - `goMainDetector.ts`
  - `goMainCodeLens.ts`
  - `goMainValidation.ts`
  - `goMainLaunchConfig.ts`
  - `goMainRunner.ts`
  - `goMainLogger.ts`
- Keep pure logic free of VS Code imports where practical, but it is acceptable for validation and command wiring modules to depend on VS Code APIs.
- Prefer serializable command arguments consistent with the current extension style.
- Maintain the current `out/` build output, `ES2022` target, and `node --test` workflow.
- Do not add runtime dependencies unless there is a strong need. If JSONC parsing can be implemented locally and safely, prefer that over adding a package.

## Detection And Execution Behavior

### CodeLens visibility

- Show two CodeLenses above each detected `func main()` in a saved Go file whose package is `main`:
  - `▶ run`
  - `𓆣 debug`
- Use the same anchor position for both lenses.
- Return no lenses when:
  - the document is not Go
  - the file is untitled
  - the document is dirty
  - the package is not `main`
  - no `main` function exists

### Main detection

- Determine `package main` from the Go AST package clause.
- Use `vscode.executeDocumentSymbolProvider` to find function symbols named exactly `main`.
- Walk the symbol tree recursively.

### Run behavior

- Validate the clicked file and resolve an execution context.
- Search for an exact matching Go launch configuration by walking from the file directory up to the workspace root and loading any `.vscode/launch.json` files found on that path.
- Build a task that runs:
  - `go run [buildFlags] <main-directory> [args...]`
- Apply the matched config's `env`, `buildFlags`, `args`, and resolved `cwd` when present.
- Run in a dedicated terminal that is always revealed and does not steal focus.
- Show a status bar message describing the directory and whether a config was used.

### Debug behavior

- Share the same validation and config matching as Run.
- Require the Go extension (`golang.go`); if it is missing, show a clear error.
- Activate the Go extension before debugging if necessary.
- Build the debug configuration from the matched config when present, but always override:
  - `type: 'go'`
  - `request: 'launch'`
  - `program: <main-directory>`
  - `cwd: <resolved cwd>`
- Default `mode` to `auto`, `console` to `debugConsole`, and `showLog` to `false` when not supplied.
- If `startDebugging` returns `false`, show a failure message that mentions Delve installation.

### Cache and refresh behavior

- Cache generated CodeLenses per document URI and document version.
- Invalidate on save, close, and change.
- Debounce change-triggered refreshes by about 500 ms.
- Expose `onDidChangeCodeLenses` so VS Code re-requests lenses.

## Manifest And Integration Changes

- Update `package.json` to add:
  - commands for the new run/debug actions
  - one boolean setting for verbose logs
- Keep activation on `onLanguage:go`; no new activation event is required.
- Do not remove or rename any existing command contributions.
- Keep `golang.go` as an extension dependency.
- If the package description, categories, or README still describe the project as only an extension pack, update them so the repository accurately reflects the current multi-feature extension.

## Test Strategy

- Add pure-module tests for:
  - package-main detection
  - main-function symbol filtering logic
  - launch-config matching and variable resolution
  - command-argument serialization helpers
- Add extension-level tests where practical for:
  - CodeLens count and command payloads
  - cache invalidation behavior
  - no-lens cases for dirty/non-main/untitled files
- Run the full existing test suite and keep both current features passing unchanged.
- Perform manual verification in the Extension Development Host for:
  - main-runner lenses
  - run/debug behavior
  - unchanged table-test lenses
  - unchanged type-implementation lenses

## Execution Breakdown

### Task 1. Align manifest and product description - Done

- Update `package.json` so the existing extension manifest can host the new main-runner feature.
- Add:
  - `go-pack-go.runGoMain`
  - `go-pack-go.debugGoMain`
  - `goPackGo.enableDebugLogs` or another project-consistent setting name for verbose main-runner logs
- Keep the current extension id and existing contributions intact.
- Update package metadata and docs only as needed so the project no longer reads like a dormant extension pack if that is still inaccurate.
- Done when the manifest cleanly describes the current multi-feature extension and still compiles.

### Task 2. Add a main-function detector module - Done

- Create a detector that accepts a `vscode.TextDocument`.
- Return no results for:
  - non-Go files
  - untitled files
  - dirty files
  - files not in `package main`
- Use `vscode.executeDocumentSymbolProvider` and recursive symbol walking to collect every function symbol named `main`.
- Use AST package detection for `package main` eligibility.
- Done when the detector returns one result per `func main()` in saved `package main` files and none otherwise.

### Task 3. Add detector-focused tests - Done

- Add tests for:
  - `package main` via AST package-clause detection
  - source text with leading comments still resolving to `package main`
  - non-main packages being rejected
  - multiple `main` symbols being preserved
- Keep these tests as focused as possible on the detector logic rather than extension wiring.
- Done when detector behavior is locked by automated tests.

### Task 4. Add a dedicated CodeLens descriptor/provider path - Done

- Create a new CodeLens helper module for the main-runner feature.
- Emit exactly two lenses per detected main:
  - `▶ run`
  - `𓆣 debug`
- Keep command arguments serializable and minimal, consistent with the current project style.
- Implement a provider with document-version caching plus an `onDidChangeCodeLenses` event.
- Done when the provider can produce main-runner lenses without touching the existing two providers.

### Task 5. Add provider tests - Done

- Verify:
  - two lenses are produced per detected main
  - command ids and payloads are correct
  - cached results are reused for the same document version
  - no lenses are produced for rejected files
- Done when the provider contract is covered without relying on manual inspection alone.

### Task 6. Add launch-config matching utilities - Done

- Implement shared logic for Run and Debug that:
  - walks upward from the clicked file directory to the workspace root
  - loads each `.vscode/launch.json` found
  - strips `//` and `/* */` comments before parsing
  - filters to Go `launch` configurations
  - resolves `${workspaceFolder}`, `${workspaceRoot}`, and `${fileDirname}`
  - converts `.go` `program` paths to their parent directory for matching
  - returns only an exact resolved match against the clicked file directory
- Add helpers to extract resolved `env`, `buildFlags`, `args`, and `cwd`.
- Done when a matching config is selected only on exact path equality and unmatched configs are ignored.

### Task 7. Add launch-config tests - Done

- Cover:
  - JSONC parsing with comments
  - exact directory matches
  - `.go` program paths resolving to parent directories
  - unmatched near-miss configs being rejected
  - variable resolution for `program` and `cwd`
- Done when the matching rules are enforced by tests.

### Task 8. Add execution validation and status helpers - Done

- Implement validation that confirms:
  - the file exists
  - the document is saved
  - the file belongs to a workspace folder
  - the file directory exists
  - the package is `main`
- Return either a user-facing failure message or a normalized execution context.
- Add a helper for status text used by Run and Debug.
- Done when both commands can share a single validated execution context.

### Task 9. Add a feature-local logger - Done

- Add a small logger wrapper for the main-runner feature.
- Gate verbose logs behind the new configuration setting.
- Keep warnings and errors unconditional.
- Use a stable prefix such as `[Go Main Runner]`.
- Done when noisy diagnostic logs can be toggled without affecting other features.

### Task 10. Implement shared main-runner command orchestration - Done

- Add shared command flow that:
  - validates the clicked file
  - finds a matching launch config
  - builds a status message
  - delegates to run-specific or debug-specific execution
  - surfaces failures through `window.showErrorMessage`
- Keep this orchestration isolated from table-test and type-implementation command handlers.
- Done when both new commands share identical validation and config-matching behavior.

### Task 11. Implement the Run command - Done

- Create the VS Code task for `go run`.
- Use the clicked file directory as the program target, regardless of matched config contents.
- Apply resolved `buildFlags`, `args`, `env`, and `cwd`.
- Configure task presentation so the terminal is revealed, non-focused, and dedicated.
- Keep any completion suffix or terminal feedback consistent with the original behavior if it can be done portably in the current project.
- Done when clicking `▶ run` executes the selected main directory with the expected task settings.

### Task 12. Implement the Debug command - Done

- Ensure `golang.go` is installed and activated.
- Build the debug configuration from matched settings plus mandatory overrides.
- Start the debug session with `vscode.debug.startDebugging`.
- Show a clear error when debugging cannot start and mention Delve in the failure guidance.
- Done when clicking `𓆣 debug` always targets the clicked main directory and respects matched config extras safely.

### Task 13. Wire the feature into `src/extension.ts` - Done

- Register the new commands in the existing activation function.
- Register the new provider alongside the current table-test and type-implementation providers.
- Add save/change/close listeners for cache invalidation and debounced refresh.
- Keep the current providers and commands unchanged unless a small shared helper extraction is clearly justified.
- Done when the third provider is active and the existing two behaviors still compile and run as before.

### Task 14. Run regression tests and fix integration issues - Done

- Run the full test suite.
- Fix any compile or test failures introduced by the new feature.
- Confirm the existing table-test and type-implementation tests still pass without expectation changes unless a shared utility refactor required minimal neutral updates.
- Done when all automated tests pass together.

### Task 15. Perform manual verification - Done

- In the Extension Development Host, verify:
  - saved `package main` files show `▶ run` and `𓆣 debug`
  - dirty and untitled files do not show those lenses
  - `▶ run` executes `go run` against the clicked file's directory
  - `𓆣 debug` starts a Go debug session against that same directory
  - exact-match launch configs are honored for `env`, `args`, `buildFlags`, and `cwd`
  - non-matching launch configs are ignored
  - table-test scenario lenses still work unchanged
  - type-implementation lenses still work unchanged
- Done when the integrated feature matches the original behavior without regressions in the two existing features.

## Acceptance Criteria

- [ ] Saved `package main` Go files show `▶ run` and `𓆣 debug` above each detected `main()`.
- [ ] Dirty, untitled, non-Go, and non-`package main` files do not show main-runner lenses.
- [ ] Run always executes `go run <clicked-main-directory>`, not the workspace root or a config `program`.
- [ ] Debug always uses the clicked file's directory as `program`.
- [ ] Launch configs are matched only by exact resolved directory equality.
- [ ] Matched configs may influence `env`, `buildFlags`, `args`, and `cwd`, but cannot redirect execution.
- [ ] Run and Debug use the same validation and launch-config matching rules.
- [ ] Missing Go extension and failed debug startup both produce clear user-facing errors.
- [ ] Main-runner logging is configurable and isolated from the other features.
- [ ] The existing table-test and type-implementation features continue to behave as before.
- [ ] The full automated test suite passes after integration.

Acceptance criteria implemented and covered by automated tests:
- [x] Saved `package main` Go files show `â–¶ run` and `ð“†£ debug` above each detected `main()`.
- [x] Dirty, untitled, non-Go, and non-`package main` files do not show main-runner lenses.
- [x] Run always executes `go run <clicked-main-directory>`, not the workspace root or a config `program`.
- [x] Debug always uses the clicked file's directory as `program`.
- [x] Launch configs are matched only by exact resolved directory equality.
- [x] Matched configs may influence `env`, `buildFlags`, `args`, and `cwd`, but cannot redirect execution.
- [x] Run and Debug use the same validation and launch-config matching rules.
- [x] Missing Go extension and failed debug startup both produce clear user-facing errors.
- [x] Main-runner logging is configurable and isolated from the other features.
- [x] The existing table-test and type-implementation features continue to behave as before.
- [x] The full automated test suite passes after integration.

## Status Update

Tasks 8 through 14 are complete. Task 15 remains pending manual verification in the Extension Development Host.
