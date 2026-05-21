export function createGoTestRunPattern(testName: string, subtestName: string): string {
  return `^${escapeRegExp(testName)}$/${createSubtestPattern(subtestName)}`;
}

function createSubtestPattern(subtestName: string): string {
  return subtestName
    .split('/')
    .map((segment) => `^${escapeRegExp(sanitizeSubtestNameSegment(segment))}$`)
    .join('/');
}

function sanitizeSubtestNameSegment(name: string): string {
  return name.replace(/\s+/g, '_');
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
