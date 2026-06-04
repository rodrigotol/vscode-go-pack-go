# Read/Write References Panel Plan

## Summary

Add a third Go navigation feature to the existing `go-pack-go` extension: a custom references experience that separates read references from write references for the symbol under the cursor.

The feature will not attempt to modify VS Code's native `Go to References` popup. Instead, it will add a new command that opens a custom panel-style references UI with:

- a references list
- a code preview area
- two visual filters: `Reads` and `Writes`

Reference discovery will be delegated to the existing Go language stack through VS Code's reference provider pipeline. Read/write separation will be computed by this extension from `DocumentHighlightKind` when available, with a conservative `read-write` fallback for references the provider does not classify explicitly.

## Key Changes

- Add a new command, for example `go-pack-go.showSeparatedReferences`.
- Reuse the Go extension and `gopls` indirectly through `vscode.executeReferenceProvider` to fetch references for the symbol at the active cursor position.
- Add a read/write classification layer that returns whether the matched usage is:
  - `read`
  - `write`
  - `read-write`
- Prefer `vscode.executeDocumentHighlights` and `DocumentHighlightKind` as the source of explicit classification.
- Treat references without an explicit `Read` or `Write` classification as `read-write` so they remain visible in both filters.
- Add a references aggregation module that:
  - resolves reference locations to document snippets
  - classifies each reference
  - groups items into read/write buckets for presentation
- Add a custom panel UI hosted by the extension that shows:
  - current symbol summary
  - read/write filter controls
  - grouped reference list
  - preview of the selected reference with the target line highlighted
- Add commands for list interaction:
  - open selected reference
  - reveal selected reference in the editor
  - refresh results for the current symbol
- Keep the existing table-test and type-implementation features unchanged.

## UI And Behavior

### Entry Point

- The feature is exposed by a new explicit command rather than replacing `editor.action.goToReferences`.
- v1 may optionally contribute the command to the editor context menu for Go files, but must not override the native references action or keybinding.
- v1 should support use as the alternate definition fallback command through the user setting `editor.gotoLocation.alternativeDefinitionCommand`.
- The extension must not silently rewrite user settings.
- The extension should offer an explicit confirmation flow that, when accepted by the user, updates:
  - `"editor.gotoLocation.alternativeDefinitionCommand": "go-pack-go.showSeparatedReferences"`
- The extension should remember the previous fallback command before changing it so the user can restore it later.
- The command runs only when:
  - the active editor is a Go file
  - there is a symbol-like token under the cursor

### Panel Layout

- Open results in a custom panel attached to the workbench, not a new editor tab.
- The panel must contain three regions:
  - header with symbol name and counts
  - filter row with `Reads` and `Writes`
  - split content area with references list on one side and preview on the other
- The list must visually distinguish the selected item and the reference kind.
- The preview must show:
  - file path
  - line number
  - a small code excerpt around the reference
  - highlight for the matched occurrence line

### Filtering

- Default filter shows both `Reads` and `Writes`.
- Clicking `Reads` hides write-only results.
- Clicking `Writes` hides read-only results.
- `read-write` results appear in both views.
- `read-write` results must be visually marked as mixed or unclassified.

### Navigation

- Selecting a list item updates the preview immediately.
- Single-click or keyboard focus on a list item reveals the location in the active editor without stealing focus from the panel.
- Open action on a list item jumps to the file and position in the main editor.
- The panel stays open until the user closes it or runs the command again for another symbol.
- When invoked through `editor.gotoLocation.alternativeDefinitionCommand`, the command must behave the same as direct invocation and use the active editor selection as the query position.

### Failure And Empty States

- If the cursor is not on a symbol, show a concise error.
- If no references are found, show an empty state in the panel rather than failing silently.
- If references are found but classification is unavailable for some items, still show them as `read-write`.
- If a referenced document cannot be opened, keep the item in the list and show a preview error for that item only.
- If the user declines the fallback-setting confirmation, the feature must continue working via direct command invocation with no repeated nagging in the same session.

## Classification Strategy

### Reference Discovery

- Use `vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position)` as the source of truth for reference locations.
- Do not implement a custom `ReferenceProvider` in v1.
- Do not attempt workspace-wide symbol resolution with Tree-sitter alone.

### Read/Write Classification

- Classification is local to each returned reference location.
- For each reference location:
  - first query `vscode.commands.executeCommand('vscode.executeDocumentHighlights', uri, position)`
  - if a matching highlight is found with kind `Read` or `Write`, use that as the classification source of truth
  - if matching highlights are conflicting, overlapping, or otherwise not uniquely classifiable, mark the reference as `read-write`
  - if no matching highlight exists, or the provider returns only plain text highlights, mark the reference as `read-write`

### Highlight-First Rules

- A matching `DocumentHighlightKind.Read` maps to `read`.
- A matching `DocumentHighlightKind.Write` maps to `write`.
- If the provider returns overlapping or conflicting highlight kinds for the same range, classify as `read-write`.
- If the provider returns `Text` only, classify as `read-write`.
- If the provider returns no usable matching highlight for the reference location, classify as `read-write`.

### Scope Limits

- v1 relies entirely on language-provider highlights for explicit read/write detection.
- v1 does not infer semantic side effects or perform fallback syntactic classification.
- v1 does not attempt AST analysis, alias tracking, SSA, or full type-checking for reference classification.
- v1 does not claim Goland-level precision for complex mutation flows.
- The extension should prefer `read-write` over making a confident wrong classification or hiding a potentially important reference.

## Implementation Changes

### Shared Domain Model

- Add a serializable references domain model with:
  - symbol label
  - source query location
  - reference URI
  - reference range
  - classification kind
  - preview snippet metadata
- Keep this module free of VS Code UI types where practical, mirroring the current detector pattern.

### Highlight Resolver Module

- Add a VS Code-facing module, for example `src/readWriteReferenceHighlights.ts`.
- Responsibilities:
  - call `vscode.executeDocumentHighlights`
  - match the returned highlight to a specific reference range or position
  - map `DocumentHighlightKind` into the extension's classification model
  - return `read-write` when the provider result is absent, plain-text only, conflicting, or ambiguous

### Aggregation Module

- Add a coordinator module that:
  - invokes `vscode.executeReferenceProvider`
  - attempts highlight-based classification per reference
  - loads each referenced document
  - builds preview excerpts
  - returns grouped UI-ready data
- Keep cancellation support so repeated invocations do not race stale results into the panel.

### Panel UI

- Add a webview-backed panel or panel-hosted webview for the custom references experience.
- The webview owns:
  - rendering
  - filter state
  - keyboard selection state
  - preview updates from extension-host messages
- Theme the UI using VS Code theme tokens rather than hardcoded colors.
- Match the density and navigation feel of references/peek UI, but do not copy internal VS Code markup.

### Extension Wiring

- Update `src/extension.ts` to register:
  - the new top-level command
  - panel lifecycle management
  - message handlers for open/reveal/filter actions
- Add commands for fallback setting management:
  - enable this extension as `editor.gotoLocation.alternativeDefinitionCommand`
  - restore the previous fallback command when known
- Validate invocation with no explicit arguments so the command works both from the Command Palette and from `editor.gotoLocation.alternativeDefinitionCommand`.
- Keep existing CodeLens provider registration untouched.

### Package Contributions

- Update `package.json` with:
  - the new command contribution
  - optional editor/context menu entry for Go files
  - activation remains `onLanguage:go`; no extra language dependency is needed beyond `golang.go`
- Add helper command contributions for:
  - enabling this extension as the alternate definition fallback
  - restoring the previous alternate definition fallback

## Test Plan

- Add highlight resolver tests covering:
  - mapping `DocumentHighlightKind.Read` to `read`
  - mapping `DocumentHighlightKind.Write` to `write`
  - plain-text-only highlight results mapping to `read-write`
  - no-highlight results mapping to `read-write`
  - conflicting highlight matches mapping to `read-write`
- Add aggregation tests covering:
  - mixed read/write results
  - `read-write` fallback on unclassified references
  - preview excerpt generation
  - empty reference result handling
- Add panel message/serialization tests covering:
  - initial payload shape
  - filter state transitions
  - open/reveal command payloads
  - count updates for reads and writes
- Manually verify in Extension Development Host:
  - command opens the panel from a Go symbol
  - command works when invoked indirectly through `editor.gotoLocation.alternativeDefinitionCommand`
  - accepting the confirmation updates the fallback setting correctly
  - declining the confirmation leaves user settings unchanged
  - restoring the previous fallback command works when previous state is known
  - list renders references from multiple files
  - `Reads` and `Writes` filters update the list correctly
  - selecting a result updates the preview
  - opening a result navigates to the right file and position
  - unsaved edits in an open document are reflected when references are recomputed
  - existing table-test and implementation CodeLens features remain unchanged

## Execution Breakdown

### Task 1. Add the references domain model

Status: Done

- Create a serializable domain model for:
  - query symbol metadata
  - reference location
  - classification kind: `read | write | read-write`
  - preview snippet metadata
- Keep the module free of VS Code UI classes where practical.
- Done when the model compiles and is suitable for both extension-host logic and webview payloads.

### Task 2. Implement highlight-based classification

Status: Done

- Create `src/readWriteReferenceHighlights.ts` or equivalent.
- Call `vscode.executeDocumentHighlights` for a given reference location.
- Match the returned highlight to the exact location or nearest compatible range.
- Map:
  - `Read` => `read`
  - `Write` => `write`
  - conflicting, missing, or `Text` => `read-write`
- Done when the module returns stable classification results from provider output only.

### Task 3. Build the references aggregation pipeline

Status: Done

- Create an aggregation module that:
  - resolves the current symbol from the active editor and selection
  - invokes `vscode.executeReferenceProvider`
  - classifies each reference through the highlight resolver
  - loads preview snippets for each result
  - produces grouped, UI-ready data
- Add cancellation/version guards so repeated invocations do not publish stale results.
- Done when one call returns the complete panel payload for a symbol.

### Task 4. Add unit tests for highlight classification

Status: Done

- Add tests for:
  - `Read` mapping
  - `Write` mapping
  - `Text` mapping to `read-write`
  - no-highlight mapping to `read-write`
  - conflicting highlight mapping to `read-write`
- Done when classification behavior is locked by tests.

### Task 5. Add unit tests for aggregation and preview building

Status: Done

- Add tests for:
  - mixed read/write/read-write results
  - preview excerpt generation
  - empty reference results
  - cancellation or stale-result protection
- Done when the aggregation payload shape and fallback behavior are locked.

### Task 6. Implement the panel webview UI

Status: Done

- Add a webview-backed panel with:
  - symbol header and counts
  - `Reads` and `Writes` filters
  - references list
  - preview pane
- Ensure `read-write` entries remain visible in both filters and are visually marked as mixed.
- Use VS Code theme tokens and keyboard-friendly interactions.
- Done when the panel can render a mock payload correctly and respond to selection/filter changes.

### Task 7. Wire extension commands and panel messaging

Status: Done

- Register `go-pack-go.showSeparatedReferences`.
- Accept invocation without explicit arguments so the command works from:
  - Command Palette
  - editor context menu
  - `editor.gotoLocation.alternativeDefinitionCommand`
- Add message handlers for:
  - reveal reference
  - open reference
  - refresh current symbol
- Keep existing commands unchanged.
- Done when the command opens the panel and drives real data end to end.

### Task 8. Implement fallback-setting opt-in and restore flow

Status: Done

- Add an explicit confirmation flow before changing `editor.gotoLocation.alternativeDefinitionCommand`.
- When accepted:
  - capture and persist the previous fallback command value
  - update the setting to `go-pack-go.showSeparatedReferences`
- When declined:
  - leave settings unchanged
  - suppress repeated prompting for the same session or until a later explicit trigger
- Add a restore command that reapplies the previous fallback command when one was captured.
- Done when fallback-setting changes are fully opt-in, reversible, and do not require manual JSON editing.

### Task 9. Add package contributions for commands and fallback helpers

Status: pending

- Update `package.json` with:
  - the main command contribution
  - optional editor/context menu contribution
  - helper commands for enabling and restoring the alternate definition fallback
- Done when the feature surface is discoverable through VS Code command/menu contributions.

### Task 10. Add UI serialization and interaction tests

Status: pending

- Add tests for:
  - initial panel payload
  - filter toggling
  - selection-driven preview updates
  - open/reveal action payloads
- Done when panel state transitions are stable and command payloads are verified.

### Task 11. Add tests for fallback-setting management

Status: pending

- Add tests for:
  - confirmation accepted updates the setting target correctly
  - previous fallback command is stored before overwrite
  - decline path leaves configuration unchanged
  - restore command reapplies the captured previous value
- Done when the opt-in configuration flow is locked by tests.

### Task 12. Run the automated test suite

Status: pending

- Run the existing test command.
- Fix any compile or regression failures.
- Done when all old and new tests pass together.

### Task 13. Perform manual verification

Status: pending

- In the Extension Development Host, verify:
  - direct command invocation works on Go symbols
  - the panel shows references and preview correctly
  - `Reads` and `Writes` filters behave as specified
  - `read-write` fallback entries remain visible in both filters
  - the command works as the configured `editor.gotoLocation.alternativeDefinitionCommand`
  - existing table-test and implementation CodeLens features remain unchanged
- Done when the end-to-end behavior matches the plan.

## Suggested Agent Split

- Agent 1: domain model, highlight resolver, and aggregation pipeline
- Agent 2: tests for classification, aggregation, and payload serialization
- Agent 3: webview panel UI and command wiring
- Agent 4: fallback-setting opt-in/restore flow, package contributions, and final regression review

## Assumptions

- The new plan file should live at `docs/plans/read-write-references-panel-plan.md`.
- The official Go extension plus `gopls` remain the source of truth for finding references.
- The official Go extension plus `gopls` are also expected to provide useful `document highlights` for many in-file read/write classifications, but the extension must tolerate missing or incomplete highlight kinds.
- The feature will be presented as a new command, not as a modification of VS Code's native references popup.
- The extension may update `editor.gotoLocation.alternativeDefinitionCommand` only after explicit user confirmation.
- The extension can persist the previous fallback command value so the user can restore it later.
- A workbench panel with custom preview is an acceptable v1 replacement for the native over-editor peek widget.
- `read-write` is the conservative fallback classification whenever `document highlights` do not safely classify a reference as `read` or `write`.
