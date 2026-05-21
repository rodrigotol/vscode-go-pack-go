import { SourceRange, TestTableScenario } from './testTableDetector';

export const runTableTestScenarioCommand = 'go-pack-go.runTableTestScenario';
export const debugTableTestScenarioCommand = 'go-pack-go.debugTableTestScenario';

export interface TableTestScenarioCommandArgument {
  readonly uri: string;
  readonly scenarioRange: SourceRange;
  readonly testName: string;
  readonly tableName: string;
  readonly label?: string;
}

export interface TableTestCodeLensDescriptor {
  readonly range: SourceRange;
  readonly title: string;
  readonly command: string;
  readonly arguments: readonly [TableTestScenarioCommandArgument];
}

export function createTableTestCodeLensDescriptors(
  uri: string,
  scenarios: readonly TestTableScenario[],
): TableTestCodeLensDescriptor[] {
  return scenarios.flatMap((scenario) => {
    const argument = createCommandArgument(uri, scenario);
    const range = createCodeLensRange(scenario.scenarioRange);

    return [
      {
        range,
        title: 'run test',
        command: runTableTestScenarioCommand,
        arguments: [argument],
      },
      {
        range,
        title: 'debug test',
        command: debugTableTestScenarioCommand,
        arguments: [argument],
      },
    ];
  });
}

function createCommandArgument(uri: string, scenario: TestTableScenario): TableTestScenarioCommandArgument {
  return {
    uri,
    scenarioRange: scenario.scenarioRange,
    testName: scenario.testName,
    tableName: scenario.tableName,
    label: scenario.label,
  };
}

function createCodeLensRange(range: SourceRange): SourceRange {
  return {
    start: range.start,
    end: range.start,
  };
}
