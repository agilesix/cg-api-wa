import { describe, it, expect } from 'vitest';
import { buildSearchText, getSourceId, waGrantToOpportunity } from '../../src/adapter';
import { storedFromCommon } from '../../src/storage';
import { ca1Fixture } from '../adapter/fixtures';

/**
 * `storedFromCommon` is the generic projection from a CommonGrants opportunity
 * to the storage-tier `StoredOpportunity` row. Every column except `sourceId`
 * and `searchText` derives from the CG opportunity itself.
 */
describe('storedFromCommon', () => {
  const opp = waGrantToOpportunity(ca1Fixture, '2026-06-25T00:00:00Z');
  const row = storedFromCommon(opp, {
    sourceId: getSourceId(ca1Fixture),
    searchText: buildSearchText(ca1Fixture),
    contentHash: 'deadbeef',
  });

  it('derives the denormalized columns from the CG opportunity + per-source metadata', () => {
    expect(row).toMatchObject({
      id: opp.id,
      sourceId: 'ca-178419',
      title: 'Wood Products Innovation Grant',
      status: 'open',
      minAwardAmountCents: 500_000, // $5,000
      maxAwardAmountCents: 37_500_000, // $375,000
      totalAmountAvailableCents: 100_000_000, // $1,000,000
      contentHash: 'deadbeef',
    });
    expect(row.searchText).toContain('Forestry');
  });

  it('derives close/post dates from keyDates as calendar-date strings', () => {
    expect(row.postDate).toBe('2026-06-22T17:20:00');
    expect(row.closeDate).toBe('2026-08-03T17:00:00');
  });

  it('serializes the opportunity to rawJson, preserving the string date shape', () => {
    const parsed = JSON.parse(row.rawJson);
    expect(parsed.id).toBe(opp.id);
    expect(parsed.title).toBe(opp.title);
    expect(parsed.keyDates.closeDate.date).toBe('2026-08-03');
  });

  it('leaves money columns null when funding is absent', () => {
    const noFunding = waGrantToOpportunity(
      { ...ca1Fixture, EstAmounts: '', EstAvailFunds: '' },
      '2026-06-25T00:00:00Z',
    );
    const r = storedFromCommon(noFunding, { sourceId: 'x', searchText: '', contentHash: 'h' });
    expect(r.minAwardAmountCents).toBeNull();
    expect(r.maxAwardAmountCents).toBeNull();
    expect(r.totalAmountAvailableCents).toBeNull();
  });
});
