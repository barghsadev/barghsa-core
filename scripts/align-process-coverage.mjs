/**
 * Compilers can map different end columns for the same original branch.
 * Align only unique identities with identical type/start and ordered arm starts.
 * Unknown or ambiguous mappings keep separate counters and receive no borrowed hits.
 */
export function alignProcessBranches(reference, incoming) {
  const result = structuredClone(incoming);
  function identity(branch) {
    const start = branch?.loc?.start;
    if (!Number.isInteger(start?.line) || !Number.isInteger(start?.column)) return null;
    if (typeof branch.type !== 'string' || !Array.isArray(branch.locations)) return null;
    const arms = [];
    for (const location of branch.locations) {
      const point = location?.start;
      if (point && point.line === undefined && point.column === undefined) arms.push(null);
      else if (Number.isInteger(point?.line) && Number.isInteger(point?.column))
        arms.push([point.line, point.column]);
      else return null;
    }
    return JSON.stringify([branch.type, start.line, start.column, arms]);
  }
  function index(branches) {
    const entries = new Map();
    for (const [key, branch] of Object.entries(branches)) {
      const id = identity(branch);
      if (id === null) continue;
      const keys = entries.get(id) ?? [];
      keys.push(key);
      entries.set(id, keys);
    }
    return entries;
  }
  const previous = index(reference.branchMap);
  const next = index(result.branchMap);
  for (const [id, keys] of next) {
    const candidates = previous.get(id);
    if (keys.length !== 1 || candidates?.length !== 1) continue;
    const key = keys[0],
      oldKey = candidates[0];
    if (result.b[key]?.length !== reference.b[oldKey]?.length) continue;
    result.branchMap[key] = structuredClone(reference.branchMap[oldKey]);
  }
  return result;
}
