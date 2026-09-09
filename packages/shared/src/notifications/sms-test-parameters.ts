/** The same non-sensitive sample values are used by provider previews and self-tests. */
export function buildSmsTestParameters(variables: Record<string, string> = {}) {
  return Object.entries(variables).map(([internal, name]) => ({ name, value: `test-${internal}` }));
}
