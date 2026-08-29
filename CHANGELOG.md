# Changelog

All notable changes to Go Pack Go are documented here.

## 0.0.1

Initial public release.

### Added

- CodeLens actions to run or debug individually detected scenarios in supported Go table tests.
- CodeLens navigation from Go structs, interfaces, methods, and interface methods to their implementations.
- CodeLens actions to run or debug saved `func main()` entry points in `package main`, with exact matching of nearby Go launch configurations.
- A references panel that classifies results as write, read, or other, with filtering and preview/permanent-open behavior.
- Packaged Tree-sitter runtime assets and an extension-host smoke test for the published VSIX.

### Requirements

- VS Code 1.120.0 or later, the Go extension, a Go toolchain for execution, and Delve for debugging.
