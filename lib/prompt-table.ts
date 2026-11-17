// Lossless prompt representation: field names occur once, not once per row.
// Only use for model inputs; persisted state and API output schemas stay intact.
export function promptTable<T, K extends keyof T>(items: readonly T[], columns: readonly K[]) {
  // Preserve new/optional fields if a future schema evolves before this list.
  if (items.some(item => Object.keys(item as object).length !== columns.length ||
    columns.some(column => !Object.hasOwn(item as object, column) || item[column] === undefined))) return items;
  const table = { columns, rows: items.map(item => columns.map(column => item[column])) };
  // Tiny collections can be shorter as objects. Never enlarge those inputs.
  return JSON.stringify(table).length < JSON.stringify(items).length ? table : items;
}
