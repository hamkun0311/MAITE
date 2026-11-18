export function responseTimings(headers: Record<string, string>) {
  const start = performance.now(); const values: string[] = [];
  return async function measure<T>(name: string, run: () => PromiseLike<T>): Promise<T> {
    const began = performance.now();
    try { return await run(); }
    finally {
      values.push(`${name};dur=${(performance.now() - began).toFixed(1)}`);
      headers["Server-Timing"] = [...values, `total;dur=${(performance.now() - start).toFixed(1)}`].join(", ");
    }
  };
}
