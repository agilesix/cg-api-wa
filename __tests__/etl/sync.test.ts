import { describe, it, expect, beforeEach } from 'vitest';
import { runSync, type SyncDeps } from '../../src/etl';
import type {
  ISourceClient,
  IOppRepo,
  ISnapshotStore,
  PaginatedResult,
  OpportunitySearchParams,
  StoredOpportunity,
  SyncStats,
} from '../../src/core';

// -------------------------------------------------------------------------
// Fakes
// -------------------------------------------------------------------------

/**
 * A deliberately minimal in-memory implementation of `IOppRepo`
 * for ETL tests. Kept in the test file so `src/storage/` stays scoped to the
 * two tiers we actually ship (proxy, SQL). Memory tier is documented as a
 * future 1-file PORTING.md addition.
 */
class FakeRepo implements IOppRepo {
  readonly rows = new Map<string, StoredOpportunity>();
  readonly syncLogs: { startedAt: string; stats: SyncStats | null }[] = [];
  readonly upsertBatchCalls: number[] = [];

  async findById(id: string) {
    for (const row of this.rows.values()) if (row.id === id) return row;
    return null;
  }
  async findBySourceId(sourceId: string) {
    return this.rows.get(sourceId) ?? null;
  }
  async search(_params: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>> {
    return { items: [...this.rows.values()], total: this.rows.size };
  }
  async upsert(record: StoredOpportunity) {
    this.rows.set(record.sourceId, record);
  }
  async upsertBatch(records: StoredOpportunity[]) {
    this.upsertBatchCalls.push(records.length);
    for (const record of records) this.rows.set(record.sourceId, record);
  }
  async allHashesBySourceId() {
    return new Map([...this.rows.values()].map((r) => [r.sourceId, r.contentHash]));
  }
  async getLastSyncedAt() {
    const last = this.syncLogs.at(-1);
    return last?.stats?.completedAt ?? null;
  }
  watermark: string | null = null;
  async getWatermark() {
    return this.watermark;
  }
  async setWatermark(value: string) {
    this.watermark = value;
  }
  async logSyncStart() {
    const id = this.syncLogs.length;
    this.syncLogs.push({ startedAt: new Date().toISOString(), stats: null });
    return id;
  }
  async logSyncComplete(id: number, stats: SyncStats) {
    const log = this.syncLogs[id];
    if (log) log.stats = stats;
  }
}

class CapturingSnapshotStore implements ISnapshotStore {
  readonly writes: { key: string; value: string }[] = [];
  readonly putManyCalls: number[] = [];
  async put(key: string, value: string) {
    this.writes.push({ key, value });
  }
  async putMany(entries: Array<{ key: string; body: string }>) {
    this.putManyCalls.push(entries.length);
    for (const entry of entries) this.writes.push({ key: entry.key, value: entry.body });
  }
}

interface FakeSource {
  slug: string;
  title: string;
  status: string;
}

function buildClient(sources: FakeSource[]): ISourceClient<FakeSource> {
  return {
    async getGrant(slug: string) {
      return sources.find((s) => s.slug === slug) ?? null;
    },
    async *listAll() {
      for (const s of sources) yield s;
    },
  };
}

function toStored(src: FakeSource, contentHash: string): StoredOpportunity {
  return {
    id: `id-${src.slug}`,
    sourceId: src.slug,
    title: src.title,
    status: src.status,
    closeDate: null,
    postDate: null,
    minAwardAmountCents: null,
    maxAwardAmountCents: null,
    totalAmountAvailableCents: null,
    searchText: src.title,
    contentHash,
    lastModifiedAt: '2026-04-15T00:00:00Z',
    rawJson: JSON.stringify(src),
  };
}

function buildDeps(sources: FakeSource[]): {
  deps: SyncDeps<FakeSource>;
  repo: FakeRepo;
  snapshots: CapturingSnapshotStore;
} {
  const repo = new FakeRepo();
  const snapshots = new CapturingSnapshotStore();
  const deps: SyncDeps<FakeSource> = {
    client: buildClient(sources),
    repo,
    snapshots,
    toStored,
    getSourceId: (s) => s.slug,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { deps, repo, snapshots };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('runSync', () => {
  let sources: FakeSource[];

  beforeEach(() => {
    sources = [
      { slug: 's1', title: 'Agriculture', status: 'open' },
      { slug: 's2', title: 'Education', status: 'open' },
      { slug: 's3', title: 'Research', status: 'closed' },
    ];
  });

  it('inserts every record on first run', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    const stats = await runSync(deps);

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(3);
    expect(stats.recordsUpdated).toBe(0);
    expect(stats.recordsSkipped).toBe(0);
    expect(stats.errorMessage).toBeNull();
    expect(repo.rows.size).toBe(3);
    expect(snapshots.writes).toHaveLength(3);
  });

  it('hash-skips unchanged records on second run', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);
    const stats = await runSync(deps);

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(0);
    expect(stats.recordsUpdated).toBe(0);
    expect(stats.recordsSkipped).toBe(3);
    // Snapshots written on first run (3) stay; no new writes on second run.
    expect(repo.rows.size).toBe(3);
    expect(snapshots.writes).toHaveLength(3);
  });

  it('force=true re-upserts unchanged records (counted as updates, fresh snapshots)', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);
    const stats = await runSync(deps, { force: true });

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(0);
    expect(stats.recordsUpdated).toBe(3);
    expect(stats.recordsSkipped).toBe(0);
    expect(repo.rows.size).toBe(3);
    expect(snapshots.writes).toHaveLength(6);
  });

  it('marks changed records as updated and writes fresh snapshots', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);
    // Mutate one source record to trigger a hash change.
    sources[0]!.title = 'Agriculture (revised)';
    const stats = await runSync(deps);

    expect(stats.recordsFetched).toBe(3);
    expect(stats.recordsInserted).toBe(0);
    expect(stats.recordsUpdated).toBe(1);
    expect(stats.recordsSkipped).toBe(2);
    expect(repo.rows.get('s1')?.title).toBe('Agriculture (revised)');
    expect(snapshots.writes).toHaveLength(4);
  });

  it('writes snapshots under `<sourceId>/<iso-timestamp>.json`', async () => {
    const { deps, snapshots } = buildDeps(sources);
    await runSync(deps);
    for (const w of snapshots.writes) {
      expect(w.key).toMatch(/^s\d+\/\d{4}-\d{2}-\d{2}T[\d:.]+Z\.json$/);
    }
  });

  it('records a sync_log entry for the run', async () => {
    const { deps, repo } = buildDeps(sources);
    await runSync(deps);
    expect(repo.syncLogs).toHaveLength(1);
    expect(repo.syncLogs[0]?.stats?.recordsInserted).toBe(3);
    expect(await repo.getLastSyncedAt()).toBeTypeOf('string');
  });

  it('uses one upsertBatch + one putMany call per run (not N per-record awaits)', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);

    // Three records → one batch write, one snapshot batch.
    expect(repo.upsertBatchCalls).toEqual([3]);
    expect(snapshots.putManyCalls).toEqual([3]);
  });

  it('pre-fetches existing hashes once instead of per-record findBySourceId lookups', async () => {
    const { deps, repo, snapshots } = buildDeps(sources);
    await runSync(deps);

    // Second run: nothing changed, so toUpsert is empty and putMany is called
    // with an empty list. The hashmap pre-fetch is the only DB read.
    const stats = await runSync(deps);
    expect(stats.recordsSkipped).toBe(3);
    expect(repo.upsertBatchCalls).toEqual([3, 0]);
    expect(snapshots.putManyCalls).toEqual([3, 0]);
  });

  it('captures and rethrows errors; sync_log records the failure', async () => {
    const throwingClient: ISourceClient<FakeSource> = {
      async getGrant() {
        return null;
      },
      // eslint-disable-next-line require-yield
      async *listAll() {
        throw new Error('upstream fetch failed');
      },
    };
    const repo = new FakeRepo();
    const snapshots = new CapturingSnapshotStore();
    const deps: SyncDeps<FakeSource> = {
      client: throwingClient,
      repo,
      snapshots,
      toStored,
      getSourceId: (s) => s.slug,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };

    await expect(runSync(deps)).rejects.toThrow('upstream fetch failed');
    expect(repo.syncLogs).toHaveLength(1);
    expect(repo.syncLogs[0]?.stats?.errorMessage).toBe('upstream fetch failed');
  });
});

// -------------------------------------------------------------------------
// Incremental sync (watermark)
// -------------------------------------------------------------------------

interface ModSource extends FakeSource {
  modifiedAt: string;
}

describe('runSync incremental (getModifiedAt + watermark)', () => {
  /** A client that records the `since` it was asked for and filters accordingly. */
  function buildModClient(records: ModSource[]): {
    client: ISourceClient<ModSource>;
    sinceCalls: Array<string | null>;
  } {
    const sinceCalls: Array<string | null> = [];
    const client: ISourceClient<ModSource> = {
      async getGrant(slug) {
        return records.find((r) => r.slug === slug) ?? null;
      },
      async *listAll(opts) {
        const since = opts?.since ?? null;
        sinceCalls.push(since);
        // Newest-first, with the `>=` boundary the CA client uses.
        const sorted = [...records].sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
        for (const r of sorted) {
          if (since !== null && r.modifiedAt < since) return;
          yield r;
        }
      },
    };
    return { client, sinceCalls };
  }

  function modDeps(records: ModSource[]) {
    const repo = new FakeRepo();
    const snapshots = new CapturingSnapshotStore();
    const { client, sinceCalls } = buildModClient(records);
    const deps: SyncDeps<ModSource> = {
      client,
      repo,
      snapshots,
      toStored: (s, contentHash) => ({ ...toStored(s, contentHash) }),
      getSourceId: (s) => s.slug,
      getModifiedAt: (s) => s.modifiedAt,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
    return { deps, repo, sinceCalls };
  }

  it('passes since=null on the first run and records the max watermark', async () => {
    const records: ModSource[] = [
      { slug: 'a', title: 'A', status: 'open', modifiedAt: '2026-06-01 00:00:00' },
      { slug: 'b', title: 'B', status: 'open', modifiedAt: '2026-06-10 00:00:00' },
    ];
    const { deps, repo, sinceCalls } = modDeps(records);

    const stats = await runSync(deps);

    expect(sinceCalls).toEqual([null]);
    expect(stats.recordsInserted).toBe(2);
    expect(await repo.getWatermark()).toBe('2026-06-10 00:00:00');
  });

  it('on the next run fetches only the delta past the watermark', async () => {
    const records: ModSource[] = [
      { slug: 'a', title: 'A', status: 'open', modifiedAt: '2026-06-01 00:00:00' },
      { slug: 'b', title: 'B', status: 'open', modifiedAt: '2026-06-10 00:00:00' },
    ];
    const { deps, repo, sinceCalls } = modDeps(records);
    await runSync(deps); // seeds watermark = 2026-06-10

    // A new, newer record appears upstream.
    records.push({ slug: 'c', title: 'C', status: 'open', modifiedAt: '2026-06-20 00:00:00' });
    const stats = await runSync(deps);

    // Second run asked for since = prior watermark; boundary record 'b' is
    // re-fetched (>=) and hash-skipped, 'c' is new, 'a' never streamed.
    expect(sinceCalls[1]).toBe('2026-06-10 00:00:00');
    expect(stats.recordsFetched).toBe(2); // b (boundary) + c
    expect(stats.recordsInserted).toBe(1); // c
    expect(stats.recordsSkipped).toBe(1); // b unchanged
    expect(await repo.getWatermark()).toBe('2026-06-20 00:00:00');
  });

  it('force=true ignores the watermark and does a full scan', async () => {
    const records: ModSource[] = [
      { slug: 'a', title: 'A', status: 'open', modifiedAt: '2026-06-01 00:00:00' },
      { slug: 'b', title: 'B', status: 'open', modifiedAt: '2026-06-10 00:00:00' },
    ];
    const { deps, sinceCalls } = modDeps(records);
    await runSync(deps);
    await runSync(deps, { force: true });

    expect(sinceCalls[1]).toBeNull(); // forced run does not pass a watermark
  });
});
