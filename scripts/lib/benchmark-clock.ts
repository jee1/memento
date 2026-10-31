// #1572: retain the reference date of the existing ranking baselines.
export const BENCHMARK_REFERENCE_TIME = '2026-10-22T12:00:00.000Z';

/** Standalone benchmark CLI only: seeding and ranking must share the same clock. */
export async function withBenchmarkClock<T>(run: () => Promise<T>): Promise<T> {
  const systemDate = globalThis.Date;
  const referenceMs = systemDate.parse(BENCHMARK_REFERENCE_TIME);
  globalThis.Date = new Proxy(systemDate, {
    apply: () => new systemDate(referenceMs).toString(),
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [referenceMs] : args, newTarget),
    get: (target, key, receiver) =>
      key === 'now' ? () => referenceMs : Reflect.get(target, key, receiver),
  });
  try {
    return await run();
  } finally {
    globalThis.Date = systemDate;
  }
}
