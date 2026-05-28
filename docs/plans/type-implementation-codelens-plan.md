# Type Implementation CodeLens Plan

## Summary

Add a second Go CodeLens feature to the existing `go-pack-go` extension that places a `go to implementation` lens above every `struct` and `interface` type definition in Go files.

Detection will be AST-based using the existing Tree-sitter stack already in the repo. The new feature will be isolated from the table-test feature so the current test-table CodeLens behavior, commands, and tests remain unchanged.

## Key Changes

- Add a new pure detector module that parses Go source and returns declared types with:
  - type name
  - kind: `struct` or `interface`
  - declaration range
  - identifier position for command execution
- Detect only real type declarations backed by AST nodes:
  - `type Name struct { ... }`
  - `type Name interface { ... }`
  - generic forms such as `type Name[T any] struct { ... }`
- Ignore:
  - type aliases
  - non-struct/interface type specs
  - malformed source when the parse has syntax errors
- Extract shared Tree-sitter parser helpers from the current detector into a small shared module so both features use the same WASM/runtime initialization and range conversion logic.
- Add a new CodeLens descriptor/helper module for the type lenses. Each detected declaration gets one CodeLens anchored to the declaration start line.
- Register a second `CodeLensProvider` in `src/extension.ts` for all Go files, separate from the existing `_test.go` table-test provider.
- Add one new command, `go-pack-go.goToTypeImplementation`, that:
  - opens the target document
  - moves the cursor to the detected type identifier
  - executes VS Code’s built-in `editor.action.goToImplementation`
- Use the same CodeLens title for both structs and interfaces: `go to implementation`.

## Implementation Notes

- Keep the new feature in separate modules from the table-test modules; do not merge detectors or descriptor builders.
- Do not change the current table-test commands, ranges, titles, or file filters.
- Keep activation on `onLanguage:go`; no new dependency is needed beyond the existing `golang.go` dependency.
- Prefer pure-module boundaries similar to the current design:
  - detector module with no VS Code imports
  - descriptor/argument module with serializable command payloads
  - VS Code wiring in `extension.ts`
- Use AST as the source of truth. Do not add regex-based detection in v1.

## Test Plan

- Add detector unit tests covering:
  - plain struct declarations
  - plain interface declarations
  - mixed files with both kinds
  - generic struct/interface declarations
  - type aliases and other type specs being ignored
  - malformed/in-progress Go source returning no lenses
- Add CodeLens descriptor tests covering:
  - one descriptor per detected declaration
  - title always equals `go to implementation`
  - command id and serialized arguments are correct
  - lens range is anchored to the declaration start
- Keep all existing table-test tests running unchanged.
- Manually verify in the Extension Development Host:
  - interface and struct lenses appear in normal `.go` files
  - clicking the lens moves focus to the declaration and triggers VS Code’s implementation navigation
  - `_test.go` files still show the existing `run test` and `debug test` lenses exactly as before
  - unsaved edits refresh both providers correctly

## Assumptions

- The new plan file should be added as `docs/plans/type-implementation-codelens-plan.md`.
- The desired struct behavior is the same as interfaces: label and click action are both `go to implementation`.
- Actual navigation results come from VS Code plus the Go extension; this feature delegates to the editor action rather than reimplementing symbol resolution.
- “Test-table extension remains unaffected” means no user-visible regression and no command/provider coupling beyond optional shared parser utilities.

## Execution Breakdown

### Task 1. Create shared Tree-sitter utilities

Status: completed

- Extract parser/bootstrap helpers from `src/testTableDetector.ts` into a new shared module.
- Move shared types/helpers only: parser init, Go language loading, `rangeFromPoints`, and any generic AST helpers that are clearly reusable.
- Keep test-table behavior unchanged.
- Done when `testTableDetector.ts` builds against the shared module with no behavior change.

### Task 2. Add type-detection domain model

Status: completed

- Create a new pure module for type detection, for example `src/typeImplementationDetector.ts`.
- Define serializable types for:
  - detected declaration kind: `struct | interface`
  - type name
  - declaration range
  - identifier position or range
  - parse status fields matching the existing detector style
- Keep this module free of VS Code imports.
- Done when the module shape is stable and compiles.

### Task 3. Implement AST detection for struct and interface declarations

Status: completed

- Parse Go source using the shared Tree-sitter utilities.
- Detect only `type_spec` nodes whose underlying type is `struct_type` or `interface_type`.
- Support generic declarations like `type Name[T any] struct {}` and `type Name[T any] interface {}`.
- Ignore aliases and all other type forms.
- Return no results when syntax errors are present.
- Done when the detector returns the expected declarations from source text alone.

### Task 4. Add detector unit tests

Status: completed

- Create `src/typeImplementationDetector.test.ts`.
- Cover:
  - single struct
  - single interface
  - mixed declarations in one file
  - generic struct and interface
  - alias ignored
  - non-struct and non-interface specs ignored
  - malformed source returns no declarations
- Done when tests clearly lock the detector behavior.

### Task 5. Add CodeLens descriptor module

- Create a new helper module, for example `src/typeImplementationCodeLens.ts`.
- Define:
  - command id constant: `go-pack-go.goToTypeImplementation`
  - serializable command argument type
  - descriptor builder that maps detector results to one lens per declaration
- Lens title should always be `go to implementation`.
- Lens range should anchor at the declaration start line.
- Done when descriptor creation is pure and independent from VS Code.

### Task 6. Add descriptor unit tests

- Create `src/typeImplementationCodeLens.test.ts`.
- Verify:
  - one descriptor per detected declaration
  - title is always `go to implementation`
  - command id is correct
  - serialized URI and position payload are correct
  - range is anchored correctly
- Done when descriptor output is locked by tests.

### Task 7. Wire the new command into the extension

- Update `src/extension.ts`.
- Register `go-pack-go.goToTypeImplementation`.
- Command behavior:
  - validate argument
  - open target document
  - show editor
  - move selection or cursor to the type identifier
  - reveal the identifier
  - execute `editor.action.goToImplementation`
- Do not alter the existing table-test commands.
- Done when the command is registered and compiles.

### Task 8. Add a dedicated CodeLens provider for type declarations

- In `src/extension.ts`, register a second `CodeLensProvider`.
- Scope it to Go files generally, separate from the `_test.go`-only table-test provider.
- Provider behavior:
  - parse current document text
  - return no lenses on syntax error
  - map detector results through the new descriptor builder
- Done when both providers coexist without shared branching logic.

### Task 9. Protect test-table behavior

- Review `src/extension.ts`, `src/testTableDetector.ts`, and `src/testTableCodeLens.ts` for accidental behavior changes.
- Confirm:
  - `_test.go` filtering remains only for table-test lenses
  - existing command ids and titles stay unchanged
  - existing test imports and expectations still hold
- Done when no user-visible regression path is introduced.

### Task 10. Run the automated test suite

- Run the existing test command and fix any compile or test failures.
- Done when all old and new tests pass.

### Task 11. Perform manual verification

- In the Extension Development Host, verify:
  - struct and interface lenses appear in `.go` files
  - clicking the lens moves focus and triggers implementation navigation
  - `_test.go` files still show `run test` and `debug test`
  - unsaved edits refresh both providers correctly
- Done when all behaviors match the plan.

## Recommended Execution Order

1. Shared utilities
2. Detector model and implementation
3. Detector tests
4. Descriptor module
5. Descriptor tests
6. Extension command
7. Provider registration
8. Regression review
9. Full test run
10. Manual verification

## Suggested Agent Split

- Agent 1: shared Tree-sitter extraction and detector implementation
- Agent 2: detector tests and descriptor module/tests
- Agent 3: `src/extension.ts` wiring and final verification/fixes
