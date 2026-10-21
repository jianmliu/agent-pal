/** Compare trusted checkpoint JSON values without assigning meaning to object key order.
 * JSON.stringify retains its primitive, optional undefined, and array semantics. */
export function sameJsonValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item);
  return canonical(left) === canonical(right);
}
