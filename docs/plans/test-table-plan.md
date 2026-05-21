# Go Table Test CodeLens Plan

## Summary

Build the first feature into the current `go-pack-go` VS Code package: a Go table-test CodeLens provider that uses Tree-sitter, not regex, to detect table-test scenarios and delegates execution/debugging to the official Go extension commands.

The feature will add `run test` and `debug test` CodeLens entries above each detected table scenario in Go test files.

## Key Changes

- Convert the current extension-pack scaffold into an extension-capable package while keeping the existing pack identity.
- Add a TypeScript extension entrypoint, build/test tooling, and VS Code activation for Go test files.
- Add Tree-sitter Go parsing dependencies.
- Register a CodeLens provider for Go documents, limited to `_test.go` files.
- Add commands:
  - `go-pack-go.runTableTestScenario`
  - `go-pack-go.debugTableTestScenario`
- Each command will reveal/select the scenario range, then invoke the Go extension's existing test/debug-at-cursor command.
- Declare `golang.go` as an extension dependency or recommended dependency so delegation has a clear expectation.

## Implementation Steps

1. Extension scaffold - Done
   - Convert the current extension-pack package into an extension-capable VS Code package.
   - Add TypeScript build/test tooling, extension activation, and minimal `activate`/`deactivate` functions.
   - Keep the existing extension-pack identity and metadata intact.

2. Parser foundation - Done
   - Add Tree-sitter and Go grammar dependencies.
   - Create a pure detector module that accepts Go source text and returns scenario objects with:
     - test function name
     - table variable name
     - scenario label when known
     - scenario source range
     - loop/subtest source range
   - Keep this module independent from VS Code APIs.

## Parser Decision

- Use `web-tree-sitter` with the prebuilt `tree-sitter-go.wasm` grammar from `tree-sitter-wasms`.
- Do not use the native `tree-sitter` Node binding because it requires native build tooling on Windows and failed without the Windows SDK.
- The WASM Tree-sitter runtime keeps the extension easier to install and package across platforms.

3. Backward detection algorithm - Done
   - Find `TestXxx` functions.
   - Inside each test function, find `for ... range ...` loops that call `t.Run(...)`.
   - Resolve ranged identifiers back to in-function slice/map composite literals.
   - Support anonymous and named slice/map table literals.
   - Support positional, keyed, and multiline scenario entries.
   - Ignore literals not connected to a `t.Run` loop.

4. Detector unit tests - Done
   - Add fixture-based tests before wiring the detector into VS Code.
   - Cover supported table formats, ignored formats, incomplete syntax, and unrelated literals.

5. CodeLens integration - Done
   - Register a CodeLens provider for Go `_test.go` files.
   - Use detector results to place `run test` and `debug test` CodeLens entries above each scenario element.
   - Pass scenario range and document URI as command arguments.

6. Run/debug delegation
   - Add `go-pack-go.runTableTestScenario` and `go-pack-go.debugTableTestScenario`.
   - Each command reveals/selects the scenario range in the editor.
   - Delegate to the official Go extension's run/debug-at-cursor command.
   - Show a concise error if the Go extension command is unavailable.

7. VS Code integration tests and manual verification
   - Add extension tests for CodeLens count, placement, command arguments, and no-scenario behavior.
   - Manually verify CodeLens updates on unsaved edits and run/debug delegation works in the Extension Development Host.

## Detection Behavior

- Parse the current unsaved editor text with Tree-sitter.
- Detect table tests by working backward from subtest execution, not by scanning for every table-like literal.
- Inside Go test functions named `TestXxx`, find `for ... range ...` loops whose body calls `t.Run(...)`.
- Resolve the loop's ranged source back to an in-function table literal when the range expression is an identifier, such as `tests`.
- Treat each top-level element of the resolved table literal as a scenario and place CodeLens on that element, not on nested literals.
- Support v1 composite-literal table sources:
  - anonymous slice tables: `[]struct { ... }{ ... }`
  - anonymous map tables: `map[string]struct { ... }{ ... }`
  - named slice tables: `[]testCase{ ... }`
  - named map tables: `map[string]testCase{ ... }`
- Support v1 scenario entry styles:
  - positional entries: `{"positive numbers", 2, 3, 5}`
  - keyed entries: `{name: "positive numbers", a: 2, b: 3, expected: 5}`
  - multiline entries with nested values, such as `args: args{a: 2, b: 3}`
- Extract the scenario label when it is statically available:
  - map string key when `t.Run` uses the range key variable
  - keyed `name: "..."` field when `t.Run` uses a field such as `tt.name`
  - first string field in positional slice entries as a fallback
- Ignore non-test files, malformed/incomplete syntax that cannot be parsed confidently, and table-like literals not connected to a `t.Run` range loop.
- Leave inline range literals, package-level shared tables, appended/generated tables, and cross-function helper table sources out of v1.

## Run And Debug Behavior

- For `run test`, move the active selection/cursor to the detected scenario, then call the Go extension's run-test-at-cursor command.
- For `debug test`, move the active selection/cursor to the detected scenario, then call the Go extension's debug-test-at-cursor command.
- If the Go extension command is unavailable, show a concise error telling the user to install or enable the Go extension.
- Do not shell out to `go test` in v1.
- Do not implement VS Code Testing API integration in v1.

## Test Plan

- Unit-test Tree-sitter detection with fixture strings covering:
  - slice table tests
  - map table tests
  - named test-case types
  - named and positional struct entries
  - detection from `t.Run` range loops back to table declarations
  - comments and multiline entries
  - nested composite literals
  - ignored table-like literals that are not used by `t.Run`
  - non-test Go files
  - malformed/in-progress edits
- Add VS Code extension tests for:
  - CodeLens count and placement
  - CodeLens command arguments
  - graceful behavior when no scenarios exist
- Manually verify in Extension Development Host:
  - CodeLens appears above each scenario
  - `run test` delegates to the Go extension
  - `debug test` delegates to the Go extension
  - unsaved edits update CodeLens correctly

## Assumptions

- "AST" means structured syntax parsing with Tree-sitter, not regex and not necessarily Go standard library `go/ast`.
- The current package should remain the home for this first extension feature, rather than creating a separate repo.
- The official Go extension is the v1 execution/debug backend.
- Regex may only be used as an optional cheap prefilter, never as the source of truth for scenario detection.
- Public VS Code APIs used: CodeLens provider, commands, and extension testing APIs.
