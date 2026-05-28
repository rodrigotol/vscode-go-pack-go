import Parser = require('web-tree-sitter');
import { findFirstNamedChild, parseGoSource, rangeFromPoints, SourceRange } from './goTreeSitter';

type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

export interface TestTableScenario {
  readonly testName: string;
  readonly tableName: string;
  readonly label?: string;
  readonly scenarioRange: SourceRange;
  readonly loopRange: SourceRange;
}

export interface DetectTestTableScenariosResult {
  readonly scenarios: TestTableScenario[];
  readonly parseSucceeded: boolean;
  readonly hasSyntaxError: boolean;
}

interface TableDeclaration {
  readonly name: string;
  readonly literal: SyntaxNode;
  readonly value: SyntaxNode;
}

interface RangeLoop {
  readonly node: SyntaxNode;
  readonly tableName: string;
  readonly keyVariable?: string;
  readonly valueVariable?: string;
  readonly labelSource?: LabelSource;
}

interface LabelSource {
  readonly kind: 'mapKey' | 'field';
  readonly fieldName?: string;
}

export async function detectTestTableScenarios(source: string): Promise<DetectTestTableScenariosResult> {
  let tree: Tree;
  try {
    tree = await parseGoSource(source);
  } catch {
    return {
      scenarios: [],
      parseSucceeded: false,
      hasSyntaxError: true,
    };
  }

  try {
    const hasSyntaxError = tree.rootNode.hasError();

    return {
      scenarios: hasSyntaxError ? [] : findScenarios(tree.rootNode),
      parseSucceeded: true,
      hasSyntaxError,
    };
  } finally {
    tree.delete();
  }
}

function findScenarios(rootNode: SyntaxNode): TestTableScenario[] {
  const scenarios: TestTableScenario[] = [];

  for (const testFunction of rootNode.descendantsOfType('function_declaration')) {
    const testName = getFunctionName(testFunction);
    if (!testName || !isGoTestFunctionName(testName)) {
      continue;
    }

    const body = testFunction.childForFieldName('body') ?? findFirstNamedChild(testFunction, 'block');
    if (!body) {
      continue;
    }

    const testParameterName = getFirstParameterName(testFunction);
    const tableDeclarations = findTableDeclarations(body);

    for (const loop of findRangeLoops(body, testParameterName)) {
      const tableDeclaration = findNearestTableDeclaration(tableDeclarations, loop.tableName, loop.node.startIndex);
      if (!tableDeclaration) {
        continue;
      }

      for (const entry of getTopLevelLiteralEntries(tableDeclaration.value)) {
        scenarios.push({
          testName,
          tableName: tableDeclaration.name,
          label: getScenarioLabel(entry, loop),
          scenarioRange: rangeFromPoints(entry.startPosition, entry.endPosition),
          loopRange: rangeFromPoints(loop.node.startPosition, loop.node.endPosition),
        });
      }
    }
  }

  return scenarios;
}

function getFunctionName(functionDeclaration: SyntaxNode): string | undefined {
  return findFirstNamedChild(functionDeclaration, 'identifier')?.text;
}

function isGoTestFunctionName(name: string): boolean {
  return /^Test($|[A-Z0-9_])/.test(name);
}

function getFirstParameterName(functionDeclaration: SyntaxNode): string | undefined {
  const parameters = findFirstNamedChild(functionDeclaration, 'parameter_list');
  const firstDeclaration = parameters?.namedChildren.find((child) => child.type === 'parameter_declaration');

  return firstDeclaration?.namedChildren.find((child) => child.type === 'identifier')?.text;
}

function findTableDeclarations(body: SyntaxNode): TableDeclaration[] {
  const declarations: TableDeclaration[] = [];

  for (const declaration of body.descendantsOfType(['short_var_declaration', 'var_spec'])) {
    const names = getDeclarationNames(declaration);
    const values = getDeclarationValues(declaration);
    const pairCount = Math.min(names.length, values.length);

    for (let index = 0; index < pairCount; index += 1) {
      const literal = values[index];
      if (isSupportedTableLiteral(literal)) {
        const value = findFirstNamedChild(literal, 'literal_value');
        if (value) {
          declarations.push({
            name: names[index].text,
            literal,
            value,
          });
        }
      }
    }
  }

  return declarations;
}

function getDeclarationNames(declaration: SyntaxNode): SyntaxNode[] {
  if (declaration.type === 'short_var_declaration') {
    return getExpressionListChildren(declaration.namedChildren[0]).filter((child) => child.type === 'identifier');
  }

  return declaration.namedChildren.filter((child) => child.type === 'identifier');
}

function getDeclarationValues(declaration: SyntaxNode): SyntaxNode[] {
  const expressionLists = declaration.namedChildren.filter((child) => child.type === 'expression_list');
  const valueList = declaration.type === 'short_var_declaration' ? expressionLists[1] : expressionLists[0];

  return getExpressionListChildren(valueList);
}

function getExpressionListChildren(expressionList: SyntaxNode | undefined): SyntaxNode[] {
  return expressionList?.namedChildren ?? [];
}

function isSupportedTableLiteral(node: SyntaxNode): boolean {
  if (node.type !== 'composite_literal') {
    return false;
  }

  const typeNode = node.namedChildren.find((child) => child.type !== 'literal_value');
  return typeNode?.type === 'slice_type' || typeNode?.type === 'map_type';
}

function findRangeLoops(body: SyntaxNode, testParameterName: string | undefined): RangeLoop[] {
  const loops: RangeLoop[] = [];

  for (const forStatement of body.descendantsOfType('for_statement')) {
    const rangeClause = findFirstNamedChild(forStatement, 'range_clause');
    const loopBody = findFirstNamedChild(forStatement, 'block');
    if (!rangeClause || !loopBody) {
      continue;
    }

    const rangedIdentifier = getRangedIdentifier(rangeClause);
    if (!rangedIdentifier) {
      continue;
    }

    const variables = getRangeVariables(rangeClause);
    const labelSource = findRunLabelSource(loopBody, testParameterName, variables.keyVariable, variables.valueVariable);
    if (!labelSource) {
      continue;
    }

    loops.push({
      node: forStatement,
      tableName: rangedIdentifier,
      keyVariable: variables.keyVariable,
      valueVariable: variables.valueVariable,
      labelSource,
    });
  }

  return loops;
}

function getRangedIdentifier(rangeClause: SyntaxNode): string | undefined {
  const lastNamedChild = rangeClause.namedChildren[rangeClause.namedChildren.length - 1];
  return lastNamedChild?.type === 'identifier' ? lastNamedChild.text : undefined;
}

function getRangeVariables(rangeClause: SyntaxNode): { keyVariable?: string; valueVariable?: string } {
  const expressionList = rangeClause.namedChildren.find((child) => child.type === 'expression_list');
  const identifiers = expressionList?.namedChildren.filter((child) => child.type === 'identifier') ?? [];

  return {
    keyVariable: identifiers[0]?.text !== '_' ? identifiers[0]?.text : undefined,
    valueVariable: identifiers[1]?.text !== '_' ? identifiers[1]?.text : undefined,
  };
}

function findRunLabelSource(
  loopBody: SyntaxNode,
  testParameterName: string | undefined,
  keyVariable: string | undefined,
  valueVariable: string | undefined,
): LabelSource | undefined {
  for (const call of loopBody.descendantsOfType('call_expression')) {
    if (!isTestRunCall(call, testParameterName)) {
      continue;
    }

    const firstArgument = getCallArguments(call)[0];
    if (!firstArgument) {
      continue;
    }

    if (keyVariable && firstArgument.type === 'identifier' && firstArgument.text === keyVariable) {
      return { kind: 'mapKey' };
    }

    const selectedField = getSelectorParts(firstArgument);
    if (selectedField && valueVariable && selectedField.base === valueVariable) {
      return {
        kind: 'field',
        fieldName: selectedField.field,
      };
    }

    if (valueVariable) {
      return { kind: 'field' };
    }
  }

  return undefined;
}

function isTestRunCall(call: SyntaxNode, testParameterName: string | undefined): boolean {
  const functionNode = call.namedChildren[0];
  const selector = functionNode ? getSelectorParts(functionNode) : undefined;

  if (!selector || selector.field !== 'Run') {
    return false;
  }

  return !testParameterName || selector.base === testParameterName;
}

function getCallArguments(call: SyntaxNode): SyntaxNode[] {
  const argumentList = findFirstNamedChild(call, 'argument_list');
  return argumentList?.namedChildren ?? [];
}

function getSelectorParts(node: SyntaxNode): { base: string; field: string } | undefined {
  if (node.type !== 'selector_expression') {
    return undefined;
  }

  const base = node.namedChildren[0];
  const field = node.namedChildren[1];
  if (!base || !field) {
    return undefined;
  }

  return {
    base: base.text,
    field: field.text,
  };
}

function findNearestTableDeclaration(
  declarations: TableDeclaration[],
  tableName: string,
  beforeIndex: number,
): TableDeclaration | undefined {
  return declarations
    .filter((declaration) => declaration.name === tableName && declaration.literal.startIndex < beforeIndex)
    .sort((left, right) => right.literal.startIndex - left.literal.startIndex)[0];
}

function getTopLevelLiteralEntries(literalValue: SyntaxNode): SyntaxNode[] {
  return literalValue.namedChildren.filter((child) => {
    if (child.type !== 'literal_element' && child.type !== 'keyed_element') {
      return false;
    }

    return child.parent?.id === literalValue.id;
  });
}

function getScenarioLabel(entry: SyntaxNode, loop: RangeLoop): string | undefined {
  if (loop.labelSource?.kind === 'mapKey') {
    return decodeStaticStringLiteral(entry.namedChildren[0]);
  }

  if (loop.labelSource?.kind === 'field' && loop.labelSource.fieldName) {
    const keyedLabel = findKeyedStringField(entry, loop.labelSource.fieldName);
    if (keyedLabel) {
      return keyedLabel;
    }
  }

  return findFirstStaticStringLiteral(entry);
}

function findKeyedStringField(entry: SyntaxNode, fieldName: string): string | undefined {
  const value = entry.type === 'keyed_element' ? entry.namedChildren[1] : entry;
  const literalValue = value?.type === 'literal_value' ? value : findFirstNamedChild(value, 'literal_value');

  for (const keyedElement of literalValue?.namedChildren ?? []) {
    if (keyedElement.type !== 'keyed_element') {
      continue;
    }

    const key = keyedElement.namedChildren[0];
    const valueNode = keyedElement.namedChildren[1];
    if (key?.text === fieldName) {
      return decodeStaticStringLiteral(valueNode);
    }
  }

  return undefined;
}

function findFirstStaticStringLiteral(node: SyntaxNode): string | undefined {
  if (isStringLiteralNode(node)) {
    return decodeStaticStringLiteral(node);
  }

  for (const child of node.namedChildren) {
    const label = findFirstStaticStringLiteral(child);
    if (label) {
      return label;
    }
  }

  return undefined;
}

function decodeStaticStringLiteral(node: SyntaxNode | undefined): string | undefined {
  const stringNode = node && (isStringLiteralNode(node) ? node : node.namedChildren.find(isStringLiteralNode));
  if (!stringNode) {
    return undefined;
  }

  try {
    return JSON.parse(stringNode.text) as string;
  } catch {
    return stringNode.text.slice(1, -1);
  }
}

function isStringLiteralNode(node: SyntaxNode): boolean {
  return node.type === 'interpreted_string_literal' || node.type === 'raw_string_literal';
}

