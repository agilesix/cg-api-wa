import { describe, it, expect } from 'vitest';
import { buildSearchText, getSourceId, waGrantToOpportunity } from '../../src/adapter';
import { storedFromCommon } from '../../src/storage';
import { waFixture } from '../adapter/fixtures';

/**
 * `storedFromCommon` is the generic projection from a CommonGrants opportunity
 * to the storage-tier `StoredOpportunity` row. Every column except `sourceId`
 * and `searchText` derives from the CG opportunity itself.
 */
describe('storedFromCommon', () => {
  const opp = waGrantToOpportunity(waFixture, '2026-07-28T00:00:00Z');
  const row = storedFromCommon(opp, {
    sourceId: getSourceId(waFixture),
    searchText: buildSearchText(waFixture),
    contentHash: 'deadbeef',
  });

  it('derives the denormalized columns from the CG opportunity + per-source metadata', () => {
    expect(row).toMatchObject({
      id: opp.id,
      sourceId: '2080',
      title: 'Connecting Housing & Infrastructure Program',
      status: 'open',
      minAwardAmountCents: 100_000_000, // $1,000,000
      maxAwardAmountCents: 200_000_000, // $2,000,000
      totalAmountAvailableCents: 3_100_000_000, // $31,000,000
      contentHash: 'deadbeef',
    });
    expect(row.searchText).toContain('affordable housing');
  });

  it('derives close/post dates from keyDates as calendar-date strings', () => {
    expect(row.postDate).toBe('2026-07-01');
    expect(row.closeDate).toBe('2026-09-30T15:00:00');
  });

  it('serializes the opportunity to rawJson, preserving the string date shape', () => {
    const parsed = JSON.parse(row.rawJson);
    expect(parsed.id).toBe(opp.id);
    expect(parsed.title).toBe(opp.title);
    expect(parsed.keyDates.closeDate.date).toBe('2026-09-30');
  });

  it('leaves money columns null when funding is absent', () => {
    const noFunding = waGrantToOpportunity(
      {
        ...waFixture,
        acf: { ...waFixture.acf, total_amount: '', award_start: '', ending_amount: '' },
      },
      '2026-07-28T00:00:00Z',
    );
    const r = storedFromCommon(noFunding, { sourceId: 'x', searchText: '', contentHash: 'h' });
    expect(r.minAwardAmountCents).toBeNull();
    expect(r.maxAwardAmountCents).toBeNull();
    expect(r.totalAmountAvailableCents).toBeNull();
  });
});
