import assert from 'node:assert/strict';
import * as path from 'path';
import { test } from 'node:test';

import {
  extractResolvedLaunchConfigurationOptions,
  findMatchingGoLaunchConfiguration,
  parseGoLaunchConfigurations,
  stripJsonComments,
} from './goMainLaunchConfig';

test('parses Go launch configurations from JSONC launch.json content', () => {
  const launchConfigurations = parseGoLaunchConfigurations(`{
    // keep this config
    "configurations": [
      {
        "name": "Go Main",
        "type": "go",
        "request": "launch",
        "program": "\${workspaceFolder}/cmd/app"
      },
      /* ignore non-Go configs */
      {
        "name": "Node",
        "type": "node",
        "request": "launch",
        "program": "\${workspaceFolder}/index.js"
      }
    ]
  }`);

  assert.deepEqual(launchConfigurations, [
    {
      name: 'Go Main',
      type: 'go',
      request: 'launch',
      program: '${workspaceFolder}/cmd/app',
      cwd: undefined,
      env: undefined,
      buildFlags: undefined,
      args: undefined,
    },
  ]);
});

test('finds an exact directory match while walking upward to the workspace root', async () => {
  const workspaceRoot = createAbsolutePath('workspace');
  const filePath = path.join(workspaceRoot, 'cmd', 'app', 'main.go');

  const match = await findMatchingGoLaunchConfiguration(filePath, workspaceRoot, {
    readFile: async (fileToRead) => {
      if (fileToRead === path.join(workspaceRoot, '.vscode', 'launch.json')) {
        return `{
          "configurations": [
            {
              "name": "Go Main",
              "type": "go",
              "request": "launch",
              "program": "\${workspaceFolder}/cmd/app"
            }
          ]
        }`;
      }

      return undefined;
    },
  });

  assert.equal(match?.configuration.name, 'Go Main');
  assert.equal(match?.programDirectory, path.join(workspaceRoot, 'cmd', 'app'));
  assert.equal(match?.launchJsonPath, path.join(workspaceRoot, '.vscode', 'launch.json'));
});

test('matches .go program paths against their parent directory', async () => {
  const workspaceRoot = createAbsolutePath('workspace');
  const filePath = path.join(workspaceRoot, 'cmd', 'app', 'main.go');

  const match = await findMatchingGoLaunchConfiguration(filePath, workspaceRoot, {
    readFile: async (fileToRead) => {
      if (fileToRead === path.join(workspaceRoot, '.vscode', 'launch.json')) {
        return `{
          "configurations": [
            {
              "name": "Go File",
              "type": "go",
              "request": "launch",
              "program": "\${workspaceFolder}/cmd/app/main.go"
            }
          ]
        }`;
      }

      return undefined;
    },
  });

  assert.equal(match?.configuration.name, 'Go File');
  assert.equal(match?.programDirectory, path.join(workspaceRoot, 'cmd', 'app'));
});

test('rejects near-miss program directories that are not exact matches', async () => {
  const workspaceRoot = createAbsolutePath('workspace');
  const filePath = path.join(workspaceRoot, 'cmd', 'app', 'main.go');

  const match = await findMatchingGoLaunchConfiguration(filePath, workspaceRoot, {
    readFile: async (fileToRead) => {
      if (fileToRead === path.join(workspaceRoot, '.vscode', 'launch.json')) {
        return `{
          "configurations": [
            {
              "name": "Near Miss",
              "type": "go",
              "request": "launch",
              "program": "\${workspaceFolder}/cmd"
            }
          ]
        }`;
      }

      return undefined;
    },
  });

  assert.equal(match, undefined);
});

test('resolves variables for program, cwd, env, args, and buildFlags from the matched config', async () => {
  const workspaceRoot = createAbsolutePath('workspace');
  const filePath = path.join(workspaceRoot, 'cmd', 'app', 'main.go');

  const match = await findMatchingGoLaunchConfiguration(filePath, workspaceRoot, {
    readFile: async (fileToRead) => {
      if (fileToRead === path.join(workspaceRoot, '.vscode', 'launch.json')) {
        return `{
          "configurations": [
            {
              "name": "Resolved Config",
              "type": "go",
              "request": "launch",
              "program": "\${workspaceRoot}/cmd/app/main.go",
              "cwd": "\${fileDirname}/tmp",
              "env": {
                "APP_ROOT": "\${workspaceFolder}",
                "MAIN_DIR": "\${fileDirname}"
              },
              "args": ["--from", "\${workspaceRoot}"],
              "buildFlags": "-tags=\${workspaceFolder}"
            }
          ]
        }`;
      }

      return undefined;
    },
  });

  const options = extractResolvedLaunchConfigurationOptions(match, filePath);

  assert.equal(match?.programDirectory, path.join(workspaceRoot, 'cmd', 'app'));
  assert.deepEqual(options, {
    cwd: path.join(workspaceRoot, 'cmd', 'app', 'tmp'),
    env: {
      APP_ROOT: workspaceRoot,
      MAIN_DIR: path.join(workspaceRoot, 'cmd', 'app'),
    },
    args: ['--from', workspaceRoot],
    buildFlags: `-tags=${workspaceRoot}`,
  });
});

test('strips comments without removing comment markers inside strings', () => {
  const stripped = stripJsonComments(`{
    "url": "https://example.com//still-a-string",
    // remove me
    "nested": "/* also still a string */"
  }`);

  assert.match(stripped, /https:\/\/example\.com\/\/still-a-string/);
  assert.match(stripped, /\/\* also still a string \*\//);
  assert.doesNotMatch(stripped, /remove me/);
});

function createAbsolutePath(...segments: string[]): string {
  return path.resolve(path.sep, ...segments);
}
