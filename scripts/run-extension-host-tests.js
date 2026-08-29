const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { runTests, runVSCodeCommand } = require('@vscode/test-electron');

async function main() {
  const repositoryRoot = resolve(__dirname, '..');
  const manifest = require(join(repositoryRoot, 'package.json'));
  const vsixPath = join(repositoryRoot, `${manifest.name}-${manifest.version}.vsix`);

  if (!existsSync(vsixPath)) {
    throw new Error(`Expected packaged extension at ${vsixPath}. Run npm run package first.`);
  }

  const extractionDirectory = mkdtempSync(join(tmpdir(), 'go-pack-go-extension-host-'));
  try {
    execFileSync('unzip', ['-q', vsixPath, '-d', extractionDirectory], { stdio: 'inherit' });

    // This mirrors Marketplace installation: VS Code will not activate an extension
    // whose declared extension dependency is unavailable.
    await runVSCodeCommand(['--install-extension', 'golang.go'], {
      extensionDevelopmentPath: join(extractionDirectory, 'extension'),
    });

    await runTests({
      extensionDevelopmentPath: join(extractionDirectory, 'extension'),
      extensionTestsPath: join(repositoryRoot, 'scripts', 'extension-host-suite.js'),
      launchArgs: [
        `--folder-uri=${pathToFileURL(join(repositoryRoot, 'scripts', 'fixtures', 'extension-host')).toString()}`,
      ],
      // The VS Code CLI sets this only for its child Node process. Remove an inherited
      // value so Electron starts the workbench instead of treating its flags as Node flags.
      extensionTestsEnv: { ELECTRON_RUN_AS_NODE: undefined },
    });
  } finally {
    rmSync(extractionDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Extension-host smoke test failed.');
  console.error(error);
  process.exitCode = 1;
});
