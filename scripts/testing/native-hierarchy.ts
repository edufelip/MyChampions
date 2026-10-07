/** Maestro may append a CLI notification after its JSON hierarchy. */
export function parseNativeHierarchy(log: string): unknown {
  const start = log.search(/^\s*\{/m);
  if (start < 0) throw new Error('Native hierarchy JSON is absent');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < log.length; index++) {
    const char = log[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0)
      return JSON.parse(log.slice(start, index + 1)) as unknown;
  }
  throw new Error('Native hierarchy JSON is incomplete');
}

export function nativeHierarchyHasAttribute(
  tree: unknown,
  attribute: string,
  value: string,
): boolean {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return false;
  const node = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    node.attributes?.[attribute] === value ||
    Boolean(
      Array.isArray(node.children) &&
      node.children.some((child) => nativeHierarchyHasAttribute(child, attribute, value)),
    )
  );
}
