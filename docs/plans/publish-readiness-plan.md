# Publish Readiness Plan

## Objective

Prepare `rodrigotol.go-pack-go` for a reliable first Visual Studio Marketplace release.

The first release must package successfully, install and activate from a VSIX in a clean VS Code profile, run a meaningful automated test suite, accurately describe the extension to users, and have a repeatable release gate.

## Audit Snapshot

Audit performed on 2026-08-29.

### Resolved blockers

1. [x] `npm run package` produces a VSIX.

   The production entry point is now `./dist/extension.js`. `vscode:prepublish` builds the bundle and copies the required Tree-sitter WASM assets into `dist/`; VSCE packages those explicit runtime assets without scanning `node_modules`.

2. [x] `npm test` discovers and executes the unit tests.

   Tests compile to `out-test/`. The test runner explicitly discovers `*.test.js` files and exits with an error if it finds none.

Validated on 2026-08-29: `npm test` passed 14 test files, and `npm run package` created `go-pack-go-0.0.1.vsix`. Package inspection confirmed the manifest, README, license, icon, `extension/dist/extension.js`, and both required WASM assets are present; source, test output, and source maps are excluded.

### Confirmed strengths

- `npm run typecheck` passes with strict TypeScript settings.
- The extension has required base Marketplace fields: name, publisher, semantic version, VS Code engine range, description, icon, categories, keywords, repository, and a root license file.
- The icon is valid and high-resolution (`1254 x 1254`).
- The manifest declares `golang.go` as an extension dependency.
- The packaged `dist/` directory contains the required Tree-sitter WASM runtime assets.

### Gaps to address

- README documentation only describes three CodeLens areas and omits the implemented read/write references feature, setup requirements, commands, settings, and limitations.
- `package.json` lacks `license`, `homepage`, and `bugs` Marketplace metadata.
- No CI workflow exists.
- The manifest does not state behavior in untrusted or virtual workspaces, although commands can run Go processes and start debugging sessions.
- The untracked `Makefile` hard-codes `go-pack-go-0.0.1.vsix`, which will become stale after a version bump.

## Implementation Plan

### 1. Make packaging deterministic

Preferred approach: use a production-only `dist/` directory for the bundled extension.

1. [x] Change esbuild output from `out/extension.js` to `dist/extension.js` for production builds.
2. [x] Update `package.json` `main` to `./dist/extension.js`.
3. [x] Keep development and test output ignored, including `dist/` and `out-test/`.
4. [x] Update `.vscodeignore` to exclude development sources, tests, editor configuration, and non-runtime artifacts while preserving:
   - `dist/extension.js`;
   - `dist/tree-sitter.wasm`;
   - `dist/tree-sitter-go.wasm`.
5. [x] Add `bundle:production` and make `vscode:prepublish` invoke it.
6. [x] Add `@vscode/vsce` to `devDependencies` and invoke its local binary through the package script.
7. [x] Keep `*.vsix` ignored and inspect the generated package.

Alternative: retain `out/` and explicitly unignore `out/extension.js` in `.vscodeignore`. Do not use this alternative unless package inspection proves VSCE includes it consistently; separating production and test artifacts is clearer and safer.

Acceptance criteria:

```sh
npm ci
npm run package
vsce ls
unzip -l go-pack-go-*.vsix
```

The VSIX must contain the manifest, README, license, icon, `extension/dist/extension.js`, and required WASM assets. It must not include source TypeScript, tests, development configuration, or unrelated documentation/plans.

### 2. Repair the automated test workflow

1. [x] Add a dedicated TypeScript configuration for test compilation, emitting all source modules and `*.test.ts` files to ignored `out-test/`.
2. [x] Keep extension production bundling separate from test compilation.
3. [x] Update `test` to compile tests and invoke Node's test runner only against emitted test files.
4. [x] Add a guard that fails when no tests are discovered.
5. [x] Add a VS Code extension-host smoke test covering activation and the registered contributions.

Suggested scripts (exact names may vary):

```json
{
  "typecheck": "tsc --noEmit",
  "compile:tests": "tsc -p tsconfig.test.json",
  "test:unit": "node --test out-test/**/*.test.js",
  "test": "npm run typecheck && npm run compile:tests && npm run test:unit",
  "bundle:production": "node esbuild.js --production",
  "vscode:prepublish": "npm run bundle:production"
}
```

Implementation must confirm the selected Node version supports the final test-file pattern. If it does not, use an explicit file-discovery script or a Node-supported `--test` invocation rather than allowing an empty glob to succeed.

Acceptance criteria:

- [x] Test output names the compiled test files and reports more than zero tests.
- [x] Unit tests pass locally (14 test files on 2026-08-29).
- [x] Extension-host tests activate the packaged extension and check that its principal commands/providers are available.

### 3. Document the actual product

Rewrite `README.md` as the Marketplace page. It should contain:

1. A concise value proposition for Go developers.
2. A feature section for:
   - table-driven test CodeLens run/debug actions;
   - type/interface/method implementation CodeLens navigation;
   - `func main()` run/debug CodeLens actions;
   - read/write/other references panel and preview behavior.
3. Installation and prerequisites:
   - VS Code minimum version chosen by the manifest;
   - the Go extension (`golang.go`);
   - Go toolchain for run/test flows;
   - Delve for debug flows.
4. A commands and settings reference.
5. Usage screenshots or short GIFs, with accessible alt text.
6. Known limitations, including static analysis assumptions and workspace requirements.
7. Issue-reporting and support links.

Add `SUPPORT.md` if support instructions would be more useful as a separate Marketplace document.

Update `CHANGELOG.md` so the release section communicates user-facing additions and fixes rather than an internal PR-by-PR history.

Status: documentation, prerequisites, commands, settings, limitations, and support guidance were added on 2026-08-29. Capture clean-profile screenshots or GIFs of the shipped UI before public release; do not use mock visuals as product evidence.

### 4. Finish Marketplace metadata and contribution hygiene

Status: Marketplace metadata, categories, keywords, gallery banner, and GitHub Markdown mode were added on 2026-08-29. Table-test and implementation commands remain CodeLens-only because they require contextual editor arguments.

Update `package.json` with:

```json
{
  "license": "SEE LICENSE IN LICENSE.txt",
  "homepage": "https://github.com/rodrigotol/vscode-go-pack-go#readme",
  "bugs": {
    "url": "https://github.com/rodrigotol/vscode-go-pack-go/issues"
  },
  "galleryBanner": {
    "color": "<approved brand color>",
    "theme": "dark"
  }
}
```

Review the following before implementation:

- Add `Testing` and `Debuggers` categories only if desired for discoverability; retain `Programming Languages`.
- Expand keywords with user search terms such as `go test`, `table-driven tests`, `references`, `implementation`, and `delve`, staying below Marketplace's 30-keyword limit.
- Declare the table-test and type-implementation command IDs in `contributes.commands` if they should be discoverable in the Command Palette. Avoid adding noisy palette commands solely because they are invoked by CodeLens.
- Add `markdown: "github"` if Marketplace Markdown behavior should be explicit.

### 5. Decide and enforce workspace support policy

The extension executes `go` and starts Go debug configurations against workspace files. Before release, decide support policy for each environment and encode it in the manifest and runtime behavior.

| Environment | Decision needed | Likely implementation |
| --- | --- | --- |
| Untrusted workspace | Are run/debug actions permitted? | Prefer disabling execution actions and showing an actionable trust message; declare `capabilities.untrustedWorkspaces`. |
| Virtual workspace | Is file-system-backed Go execution supported? | Mark unsupported unless all features are intentionally implemented for virtual URIs. |
| Remote workspace | Should Go commands run where the workspace lives? | Verify with SSH/Dev Container, then declare `extensionKind` in the supported preference order. |
| Multi-root workspace | Which folder owns a file? | Test commands and launch configuration lookup for a file in each root. |

Do not claim support in the README or manifest until the corresponding test matrix passes.

### 6. Add CI and release controls

Create a GitHub Actions workflow with pull-request and main-branch jobs that run:

```sh
npm ci
npm run typecheck
npm test
npm run package
```

The workflow should additionally inspect the generated VSIX for the expected entry point and runtime WASM files.

Add a release workflow triggered by an approved version tag. It must:

1. run the full validation gate;
2. ensure the tag matches `package.json` version;
3. package the VSIX and attach it to the GitHub release;
4. publish only after validation succeeds;
5. store publishing credentials exclusively in GitHub secrets or use the supported Microsoft Entra identity flow.

Never commit a Marketplace PAT. Microsoft currently recommends Entra-based CI publishing; PAT publishing requires the Marketplace `Manage` scope.

### 7. Run the manual release acceptance matrix

Before the first public release, install the generated VSIX into a clean VS Code profile and test:

1. Activation after opening a Go file.
2. Each CodeLens flow on representative Go fixtures.
3. Table-test run and debug behavior.
4. Main run and debug behavior, both with and without matching `launch.json` configuration.
5. Type-implementation navigation.
6. Read/write references panel: result grouping, filters, preview, permanent open, no-result and error states.
7. Missing prerequisites: Go extension, Go binary, and Delve.
8. No-folder, multi-root, untrusted, virtual, and remote workspaces according to the policy in section 5.
9. Windows, macOS, and Linux if all are supported.

Record the tested VS Code, Go extension, Go, and Delve versions in the release issue or GitHub release notes.

## Release Sequence

1. Implement sections 1 and 2, then make packaging and tests pass locally.
2. Implement documentation and metadata from sections 3 and 4.
3. Decide workspace policy and implement/test section 5.
4. Add CI from section 6.
5. Produce a VSIX, complete section 7, and collect feedback through a pre-release if desired.
6. Bump from `0.0.1` only when the release contents and changelog are finalized, tag the release, then publish.

## Decisions Required Before Publishing

- Is the first public version a stable release or a Marketplace pre-release?
- What minimum VS Code version should be supported? The current manifest requires `^1.120.0`; lower it only after checking every API used by the extension.
- What workspace environments are officially supported?
- Should CodeLens-only commands appear in the Command Palette?
- Should the untracked `Makefile` be committed, and if so should it package/install the dynamically generated VSIX instead of the fixed `0.0.1` filename?

## Reference Material

- [VS Code Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VS Code Extension Manifest reference](https://code.visualstudio.com/api/references/extension-manifest)
- [VS Code Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VS Code Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
