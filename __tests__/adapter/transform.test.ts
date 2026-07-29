import { describe, expect, it } from 'vitest';
import {
  buildSearchText,
  mapApplicantTypes,
  nullIfNotUrl,
  parseFinancial,
  portalIdToCgId,
  stripHtml,
  taxonomies,
  waDate,
  waGrantToOpportunity,
  waOpportunityToGrant,
} from '../../src/adapter';
import { waFixture } from './fixtures';

const SYNCED_AT = '2026-07-28T22:00:00Z';

describe('FundHubWA transform', () => {
  const opportunity = waGrantToOpportunity(waFixture, SYNCED_AT);

  it('maps native CommonGrants fields', () => {
    expect(opportunity.id).toBe(portalIdToCgId('2080'));
    expect(opportunity.title).toBe('Connecting Housing & Infrastructure Program');
    expect(opportunity.description).toBe('Supports affordable housing infrastructure.');
    expect(opportunity.status.value).toBe('open');
    expect(opportunity.funding?.totalAmountAvailable?.amount).toBe('31000000.00');
    expect(opportunity.funding?.minAwardAmount?.amount).toBe('1000000.00');
    expect(opportunity.funding?.maxAwardAmount?.amount).toBe('2000000.00');
    expect(opportunity.keyDates?.postDate).toMatchObject({ date: '2026-07-01' });
    expect(opportunity.keyDates?.closeDate).toMatchObject({
      date: '2026-09-30',
      time: '15:00:00',
    });
    expect(opportunity.customFields?.additionalInfo?.value).toMatchObject({
      url: 'https://example.wa.gov/apply',
    });
  });

  it('maps audiences and preserves every source taxonomy', () => {
    expect(mapApplicantTypes(waFixture).map((type) => type.value)).toEqual([
      'government_municipal',
      'organization',
    ]);
    expect(taxonomies(waFixture)).toMatchObject({
      'funding-type': ['Grant'],
      'funding-sector': ['Buildings & Infrastructure'],
      'funding-location': ['WA'],
    });
    expect(opportunity.customFields?.waTaxonomies?.value).toEqual(taxonomies(waFixture));
  });

  it('preserves source-specific content without putting HTML in native text', () => {
    expect(opportunity.customFields?.waEligibilityHtml?.value).toContain('<h4>');
    expect(opportunity.customFields?.waResourcesHtml?.value).toContain('<a href=');
    expect(opportunity.customFields?.waDescriptionHtml?.value).toContain('<strong>');
    expect(opportunity.customFields?.waTotalAmountRaw?.value).toBe('31,000,000');
    expect(opportunity.customFields?.waNumberOfAwardsRaw?.value).toBe('Multiple');
    expect(opportunity.customFields?.waCostShareRaw?.value).toBe('no');
    expect(opportunity.customFields?.waPreApplicationRaw?.value).toBe('no');
    expect(opportunity.customFields?.waApplicationLinkUrl?.value).toBe(
      'https://example.wa.gov/apply',
    );
    expect(opportunity.customFields?.waApplicationLinkTarget?.value).toBe('_blank');
  });

  it('provides a valid best-effort reverse transform', () => {
    const back = waOpportunityToGrant(opportunity);
    expect(back.id).toBe(2080);
    expect(back.acf.federal_or_state).toBe('state');
    expect(back.acf.eligibility).toBe(waFixture.acf.eligibility);
  });

  it('rejects malformed application URLs without losing the source page', () => {
    const malformed = structuredClone(waFixture);
    malformed.acf.application_link = {
      title: 'Apply Now',
      url: 'http://_blank',
      target: '_blank',
    };

    const mapped = waGrantToOpportunity(malformed, SYNCED_AT);

    expect(mapped.source).toBe(waFixture.link);
    expect(mapped.customFields?.additionalInfo).toBeUndefined();
  });

  it('builds useful source search text', () => {
    const text = buildSearchText(waFixture);
    expect(text).toContain('affordable housing');
    expect(text).toContain('WA Department of Commerce');
    expect(text).toContain('Buildings & Infrastructure');
  });
});

describe('normalization helpers', () => {
  it('parses source dates and money conservatively', () => {
    expect(waDate('20260930')).toBe('2026-09-30');
    expect(waDate('September 30')).toBeNull();
    expect(parseFinancial('31,000,000')?.amount).toBe('31000000.00');
    expect(parseFinancial('Varies')).toBeNull();
    expect(nullIfNotUrl('https://fundhub.wa.gov/funding/example/')).toBe(
      'https://fundhub.wa.gov/funding/example/',
    );
    for (const malformed of [
      'http://_blank',
      'http://-',
      'http://.',
      'http://a..b',
      'http://-example.com',
      'http://example-.com',
    ]) {
      expect(nullIfNotUrl(malformed)).toBeNull();
    }
  });

  it('turns HTML into readable text', () => {
    expect(stripHtml('<p>A &amp; B</p><ul><li>One</li></ul>')).toBe('A & B\n• One');
  });
});
