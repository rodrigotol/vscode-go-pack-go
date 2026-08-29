# Go Pack Go

Go Pack Go adds focused Go workflows to VS Code: run the exact test case you are reading, navigate from declarations to implementations, launch a `main` package, and inspect references by read/write intent.

## Features

### Run and debug table-test scenarios

In supported Go table tests, Go Pack Go places **run test** and **debug test** CodeLens actions above each detected scenario. Select one to run or debug that exact subtest rather than entering its name manually.

The detector follows `t.Run` calls inside `TestXxx` functions and supports common slice and map table literals, including named case types, keyed `name` fields, and statically known labels.

### Navigate type implementations

Go Pack Go adds a **go to implementation** CodeLens to Go structs, interfaces, receiver methods, and interface methods. It opens VS Code's standard implementation navigation, using the Go language tooling already available in your workspace.

### Run and debug `func main()`

Saved files in `package main` get **run** and **debug** CodeLens actions above each `func main()`.

- **Run** executes `go run` for the directory containing the selected file.
- **Debug** starts a Go launch configuration for that same directory.
- If a matching `.vscode/launch.json` configuration exists, its `env`, `buildFlags`, `args`, and `cwd` are used; it cannot redirect the program away from the selected main package.

### Review references by intent

Use **Go to References (Go Pack Go)** from the editor context menu to open the **Go Pack Go - References** panel. Results are grouped in one list and marked as write, read, or other usage.

- Use the panel title buttons to show or hide each kind of usage.
- Single-click a result to preview it beside the current editor.
- Double-click the same result to open it permanently in the original editor group.
- The temporary preview closes when the references panel is hidden.

## Installation and prerequisites

1. Install **Go Pack Go** from the Visual Studio Marketplace.
2. Use VS Code **1.120.0 or newer**.
3. Install the [Go extension](https://marketplace.visualstudio.com/items?itemName=golang.Go) (`golang.go`). It is declared as an extension dependency.
4. Install a Go toolchain to run table tests or `main` packages.
5. Install [Delve](https://github.com/go-delve/delve/tree/master/Documentation/installation) to debug table tests or `main` packages.

Open a Go file to activate the extension. For run/debug actions, open a saved Go file inside a file-backed workspace folder.

## Commands

| Command | Where it appears | Purpose |
| --- | --- | --- |
| `Go Pack Go: Run Go Main` | Command Palette and main-function CodeLens | Runs the selected `package main` directory with `go run`. |
| `Go Pack Go: Debug Go Main` | Command Palette and main-function CodeLens | Starts Go debugging for the selected `package main` directory. |
| `Go to References (Go Pack Go)` | Editor context menu | Finds references for the symbol under the cursor and opens the references panel when results exist. |
| `Toggle Write Usages` | References panel title | Shows or hides write usages. |
| `Toggle Read Usages` | References panel title | Shows or hides read usages. |
| `Toggle Other Usages` | References panel title | Shows or hides usages that cannot be classified as read or write. |

The table-test and implementation actions intentionally remain CodeLens-only. They need the declaration or scenario under the cursor, so standalone Command Palette entries would be misleading.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `goPackGo.enableDebugLogs` | `false` | Enables verbose output for the Go main runner. |

## Known limitations

- Table-test detection is static. It recognizes supported table literals connected to `t.Run`; dynamically generated case names, unrelated table-like values, and malformed or incomplete Go source do not receive CodeLens actions.
- Implementation navigation and reference results depend on VS Code's Go language providers. Install and configure the Go extension and its language tooling for your workspace.
- Reference classification uses document highlights. A provider can report an item as **other** when it does not expose a read/write highlight.
- Main-package actions require a saved Go file in `package main` within a workspace folder. Dirty, untitled, and non-main files do not receive those actions.
- This release has been verified for local, file-backed workspaces. Untrusted, virtual, remote, and multi-root workspace support is not yet declared; see the project issues for the current support policy.

## Visual guide

The extension's CodeLens and references-panel interactions are described above. Capture clean-profile screenshots or GIFs of the shipped UI before the public release; do not use mock visuals as product evidence.

## Support and feedback

Report a bug or request a feature in the [issue tracker](https://github.com/rodrigotol/vscode-go-pack-go/issues). Include your VS Code, Go extension, Go, and Delve versions, plus a minimal Go example when possible. See [SUPPORT.md](SUPPORT.md) for what to include.

## Development

```sh
npm test
npm run package
```

The package command creates a VSIX in the repository root. The extension-host smoke test runs against the contents of that packaged VSIX.
