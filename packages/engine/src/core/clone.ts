/** Deep clone of plain-JSON state (no Map/Set/class instances by design). */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
