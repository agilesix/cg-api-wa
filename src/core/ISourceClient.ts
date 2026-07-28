/**
 * An adapter-supplied client for a source grants system.
 *
 * Each adapter (e.g. `@common-grants/cg-pa`, `@common-grants/cg-grants-gov`)
 * provides its own `ISourceClient` implementation. The `TSource` generic is
 * the adapter's raw record type — `IOppRepo` and the ETL are
 * agnostic to it.
 *
 * For tier 0 (proxy) deployments this is the primary data source, hit on
 * every request. For DB-backed tiers it is only used by the scheduled ETL.
 * Deployments that populate the database directly (e.g. an internal host
 * that writes from their warehouse) may omit the client entirely.
 */
export interface ISourceClient<TSource = unknown> {
  /**
   * Fetch a single record by its source-system identifier (e.g. PA slug,
   * grants.gov opportunity number). Returns `null` if the source reports
   * 404 or equivalent.
   */
  getGrant(sourceId: string): Promise<TSource | null>;

  /**
   * Iterate records from the source. Implementations may page internally;
   * callers treat it as a single stream. The ETL consumes this generator once
   * per sync run.
   *
   * `opts.since` is an optional incremental-sync watermark: when provided, the
   * implementation should yield only records modified at or after it (compared
   * in the source's own last-modified representation). Sources that can't
   * filter incrementally may ignore it and yield everything — correctness is
   * unaffected because the ETL still de-dupes via content hashing.
   */
  listAll(opts?: { since?: string | null }): AsyncIterable<TSource>;
}
