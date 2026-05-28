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

Status: completed

- Create a new helper module, for example `src/typeImplementationCodeLens.ts`.
- Define:
  - command id constant: `go-pack-go.goToTypeImplementation`
  - serializable command argument type
  - descriptor builder that maps detector results to one lens per declaration
- Lens title should always be `go to implementation`.
- Lens range should anchor at the declaration start line.
- Done when descriptor creation is pure and independent from VS Code.

### Task 6. Add descriptor unit tests

Status: completed

- Create `src/typeImplementationCodeLens.test.ts`.
- Verify:
  - one descriptor per detected declaration
  - title is always `go to implementation`
  - command id is correct
  - serialized URI and position payload are correct
  - range is anchored correctly
- Done when descriptor output is locked by tests.

### Task 7. Wire the new command into the extension

Status: completed

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

Status: completed

- In `src/extension.ts`, register a second `CodeLensProvider`.
- Scope it to Go files generally, separate from the `_test.go`-only table-test provider.
- Provider behavior:
  - parse current document text
  - return no lenses on syntax error
  - map detector results through the new descriptor builder
- Done when both providers coexist without shared branching logic.

### Task 9. Protect test-table behavior

Status: completed

- Review `src/extension.ts`, `src/testTableDetector.ts`, and `src/testTableCodeLens.ts` for accidental behavior changes.
- Confirm:
  - `_test.go` filtering remains only for table-test lenses
  - existing command ids and titles stay unchanged
  - existing test imports and expectations still hold
- Done when no user-visible regression path is introduced.

### Task 10. Run the automated test suite

Status: completed

- Run the existing test command and fix any compile or test failures.
- Done when all old and new tests pass.

### Task 11. Perform manual verification

Status: completed

- In the Extension Development Host, verify:
  - struct and interface lenses appear in `.go` files
  - clicking the lens moves focus and triggers implementation navigation
  - `_test.go` files still show `run test` and `debug test`
  - unsaved edits refresh both providers correctly
- Done when all behaviors match the plan.

### Task 12. Broaden the detector domain model for method targets

Status: completed

- Update `src/typeImplementationDetector.ts` so the returned domain model can represent additional implementation targets beyond type declarations.
- Extend the declaration kind union to include `method` and `interface-method`.
- Add any additional serializable fields needed to keep method and interface-method targets consistent with the existing type declaration payload shape.
- Keep the detector module free of VS Code imports.
- Done when the detector contract can represent structs, interfaces, receiver methods, and interface methods without breaking the existing type-declaration behavior.

### Task 13. Implement AST detection for method implementations and interface methods

Status: completed

- Extend the existing Tree-sitter traversal in `src/typeImplementationDetector.ts`.
- Detect `method_declaration` nodes and capture the method `field_identifier` position for command execution.
- Detect `method_spec` nodes inside `interface_type` nodes and capture the method `field_identifier` position for command execution.
- Ignore top-level `function_declaration` nodes with no receiver.
- Ignore embedded interface members such as `io.Reader` that are not explicit method definitions.
- Continue returning no declarations when syntax errors are present.
- Done when the detector returns the new method-related targets alongside the existing struct and interface declarations.

### Task 14. Expand detector unit tests for the new method cases

Status: completed

- Update `src/typeImplementationDetector.test.ts`.
- Add coverage for:
  - value-receiver method implementations
  - pointer-receiver method implementations
  - interface method definitions
  - mixed files containing structs, interfaces, methods, and top-level functions
  - embedded interface members being ignored
  - top-level functions being ignored
- Keep the existing struct/interface assertions unchanged unless the broadened detector result shape requires minimal expectation updates.
- Done when detector tests lock the behavior for all newly supported method-related targets.

### Task 15. Broaden the CodeLens descriptor module for the new target kinds

Status: completed

- Update `src/typeImplementationCodeLens.ts` so descriptor creation works for `method` and `interface-method` targets in addition to the existing type declarations.
- Keep the command id as `go-pack-go.goToTypeImplementation`.
- Keep the title as `go to implementation` for all supported target kinds.
- Ensure the lens range stays anchored at the detected target start line, including method declarations and interface method signatures.
- Done when descriptor generation remains pure and produces one CodeLens per supported target.

### Task 16. Expand descriptor unit tests for method and interface-method lenses

Status: completed

- Update `src/typeImplementationCodeLens.test.ts`.
- Verify:
  - one descriptor is created per detected method-related target
  - serialized arguments contain the correct URI, position, and target kind for methods and interface methods
  - receiver method lenses anchor to the `func` line
  - interface method lenses anchor to the interface method signature line
- Keep the existing assertions for struct/interface descriptor behavior intact.
- Done when descriptor tests lock the new lens placement and payload behavior.

### Task 17. Update the implementation command wiring for all supported targets

Status: completed

- Update `src/extension.ts`.
- Broaden the command argument model and validation for `go-pack-go.goToTypeImplementation` so it accepts the new method-related target kinds.
- Keep the command behavior unchanged:
  - open the target document
  - move the cursor to the detected identifier
  - reveal the identifier
  - execute `editor.action.goToImplementation`
- Do not alter the table-test commands.
- Done when the existing implementation command works for struct, interface, method, and interface-method lenses.

### Task 18. Update the Go-wide implementation CodeLens provider

Status: completed

- Update the existing implementation `CodeLensProvider` in `src/extension.ts`.
- Keep the current provider split between:
  - `_test.go` table-test lenses
  - Go-wide implementation lenses
- Ensure the implementation provider maps the broadened detector results through the updated descriptor builder.
- Continue returning no lenses on parse failure or syntax error.
- Done when the provider surfaces method and interface-method lenses without affecting the table-test provider.

### Task 19. Perform regression review for the extended implementation feature

Status: completed

- Review `src/extension.ts`, `src/typeImplementationDetector.ts`, and `src/typeImplementationCodeLens.ts` for unintended regressions in the original struct/interface behavior.
- Confirm:
  - existing struct and interface lenses still appear as before
  - top-level functions still do not receive this lens
  - `_test.go` filtering remains only for table-test lenses
  - existing table-test command ids and titles remain unchanged
- Done when no user-visible regression path is introduced by the method-related extension.

### Task 20. Run the automated test suite after the method-related changes

Status: completed

- Run the existing test command and fix any compile or test failures introduced by Tasks 12-19.
- Done when all old and new tests pass together.

### Task 21. Perform manual verification for method and interface-method lenses

Status: completed

- In the Extension Development Host, verify:
  - struct and interface lenses still appear in `.go` files
  - receiver method lenses appear above method implementations
  - interface method lenses appear above explicit interface method signatures
  - top-level functions do not receive this lens
  - clicking any of the new lenses moves focus to the symbol and triggers implementation navigation
  - `_test.go` files still show `run test` and `debug test`
  - unsaved edits refresh both providers correctly
- Done when all extended behaviors match the expected implementation.

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
11. Broaden detector domain model for method targets
12. Implement method and interface-method AST detection
13. Expand detector tests
14. Broaden descriptor module
15. Expand descriptor tests
16. Update implementation command wiring
17. Update implementation provider
18. Perform regression review for the extended implementation feature
19. Run the full test suite again
20. Perform extended manual verification

## Suggested Agent Split

- Agent 1: shared Tree-sitter extraction and detector implementation
- Agent 2: detector tests and descriptor module/tests
- Agent 3: `src/extension.ts` wiring and final verification/fixes
