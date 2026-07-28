import { describe, it, expect } from 'vitest';
import {
  buildSearchText,
  caGrantToOpportunity,
  caOpportunityToGrant,
  mapApplicantTypes,
  nullIfEmpty,
  nullIfNotUrl,
  normalizeStatus,
  parseAmountRange,
  parseFinancial,
  parseCaContact,
  parseMatchingFunds,
  portalIdToCgId,
  splitCaDateTime,
  splitList,
  statusToCaString,
  stripHtml,
} from '../../src/adapter';
import { ca1Fixture, ca2FixtureEdgeCases } from './fixtures';

const SYNCED_AT = '2026-06-25T00:00:00Z';

// =============================================================================
// Primitive helpers
// =============================================================================

describe('primitive helpers', () => {
  it('nullIfEmpty trims and treats empty as null', () => {
    expect(nullIfEmpty('  x ')).toBe('x');
    expect(nullIfEmpty('   ')).toBeNull();
    expect(nullIfEmpty(null)).toBeNull();
  });

  it('nullIfNotUrl keeps absolute URLs, nulls free-form text', () => {
    expect(nullIfNotUrl('https://ca.gov')).toBe('https://ca.gov');
    expect(nullIfNotUrl('TBD')).toBeNull();
    expect(nullIfNotUrl('not a url')).toBeNull();
  });

  it('stripHtml removes tags and decodes entities', () => {
    expect(stripHtml('a <a href="x">b</a> &amp; c')).toBe('a b & c');
  });

  it('splitList splits the source `;`-delimited columns', () => {
    expect(splitList('A; B ;; C')).toEqual(['A', 'B', 'C']);
    expect(splitList(null)).toEqual([]);
  });

  it('portalIdToCgId is deterministic', () => {
    expect(portalIdToCgId('ca-178419')).toBe(portalIdToCgId('ca-178419'));
    expect(portalIdToCgId('a')).not.toBe(portalIdToCgId('b'));
  });
});

// =============================================================================
// Financial parsing
// =============================================================================

describe('parseFinancial', () => {
  it('parses plain, dollar, million, and k forms', () => {
    expect(parseFinancial('$1,000,000')?.amount).toBe('1000000.00');
    expect(parseFinancial('500000')?.amount).toBe('500000.00');
    expect(parseFinancial('$2 million')?.amount).toBe('2000000.00');
    expect(parseFinancial('500k')?.amount).toBe('500000.00');
  });

  it('returns null for free-form values', () => {
    expect(parseFinancial('Varies')).toBeNull();
    expect(parseFinancial('')).toBeNull();
  });
});

describe('parseAmountRange', () => {
  it('parses a two-value range', () => {
    const r = parseAmountRange('Between $5,000 and $375,000');
    expect(r.min?.amount).toBe('5000.00');
    expect(r.max?.amount).toBe('375000.00');
  });

  it('treats a single "up to" value as a max', () => {
    const r = parseAmountRange('Up to $50,000');
    expect(r.min).toBeNull();
    expect(r.max?.amount).toBe('50000.00');
  });

  it('treats a single "at least" value as a min', () => {
    const r = parseAmountRange('At least $10,000');
    expect(r.min?.amount).toBe('10000.00');
    expect(r.max).toBeNull();
  });

  it('returns nulls when no dollar amount is present', () => {
    expect(parseAmountRange('Dependent on submissions')).toEqual({ min: null, max: null });
  });
});

// =============================================================================
// Matching funds
// =============================================================================

describe('parseMatchingFunds', () => {
  it('parses a percentage into isRequired + percentage (0–100)', () => {
    expect(parseMatchingFunds('35%')).toEqual({ isRequired: true, percentage: 35 });
    expect(parseMatchingFunds('100%')).toEqual({ isRequired: true, percentage: 100 });
  });

  it('treats 0% as not required', () => {
    expect(parseMatchingFunds('0%')).toEqual({ isRequired: false, percentage: 0 });
  });

  it('handles "Not Required"', () => {
    expect(parseMatchingFunds('Not Required')).toEqual({ isRequired: false, percentage: null });
  });

  it('returns null for empty/unrecognized', () => {
    expect(parseMatchingFunds('')).toBeNull();
    expect(parseMatchingFunds('maybe')).toBeNull();
  });
});

// =============================================================================
// Dates
// =============================================================================

describe('splitCaDateTime', () => {
  it('splits a space-separated datetime', () => {
    expect(splitCaDateTime('2026-08-03 17:00:00')).toEqual({
      date: '2026-08-03',
      time: '17:00:00',
    });
  });

  it('handles a date-only value', () => {
    expect(splitCaDateTime('2026-08-03')).toEqual({ date: '2026-08-03', time: null });
  });

  it('returns null for unparseable input', () => {
    expect(splitCaDateTime('not-a-date')).toBeNull();
    expect(splitCaDateTime('')).toBeNull();
  });
});

// =============================================================================
// Status
// =============================================================================

describe('status mapping', () => {
  it('maps the CA vocabulary to the CG enum', () => {
    expect(normalizeStatus('active')).toEqual({ value: 'open', customValue: null });
    expect(normalizeStatus('closed')).toEqual({ value: 'closed', customValue: null });
    expect(normalizeStatus('forecasted')).toEqual({ value: 'forecasted', customValue: null });
  });

  it('falls back to custom for unknown values', () => {
    expect(normalizeStatus('archived')).toEqual({ value: 'custom', customValue: 'archived' });
  });

  it('round-trips canonical labels', () => {
    expect(statusToCaString({ value: 'open' })).toBe('active');
    expect(statusToCaString({ value: 'custom', customValue: 'archived' })).toBe('archived');
  });
});

// =============================================================================
// Contact
// =============================================================================

describe('parseCaContact', () => {
  it('parses the structured key: value; format', () => {
    expect(
      parseCaContact('name: Katie Harrell; email: katie@bof.ca.gov; tel: 1-916-698-1035;'),
    ).toEqual({
      name: 'Katie Harrell',
      email: 'katie@bof.ca.gov',
      phone: '1-916-698-1035',
      description: null,
    });
  });

  it('preserves a bare value in description', () => {
    expect(parseCaContact('Grants Office')).toEqual({
      name: null,
      email: null,
      phone: null,
      description: 'Grants Office',
    });
  });

  it('returns null when empty', () => {
    expect(parseCaContact('')).toBeNull();
  });
});

// =============================================================================
// Applicant types → native acceptedApplicantTypes
// =============================================================================

describe('mapApplicantTypes', () => {
  it('maps confident labels to the standard enum, custom for the rest', () => {
    expect(mapApplicantTypes('Individual; Tribal Government; Business')).toEqual([
      { value: 'individual', customValue: null, description: null },
      { value: 'government_tribal', customValue: null, description: null },
      { value: 'custom', customValue: 'Business', description: null },
    ]);
  });
});

// =============================================================================
// Full transform
// =============================================================================

describe('caGrantToOpportunity (fully-populated fixture)', () => {
  const opp = caGrantToOpportunity(ca1Fixture, SYNCED_AT);

  it('maps the core fields', () => {
    expect(opp.id).toBe(portalIdToCgId('ca-178419'));
    expect(opp.title).toBe('Wood Products Innovation Grant');
    expect(opp.status.value).toBe('open');
    expect(opp.source).toBe('https://bof.ca.gov/grant-guidelines.pdf');
    expect(opp.description).toContain('sustainable forest restoration');
  });

  it('parses the funding range and available total', () => {
    expect(opp.funding?.minAwardAmount?.amount).toBe('5000.00');
    expect(opp.funding?.maxAwardAmount?.amount).toBe('375000.00');
    expect(opp.funding?.totalAmountAvailable?.amount).toBe('1000000.00');
  });

  it('splits the key dates', () => {
    const postDate = opp.keyDates?.postDate as { date?: string } | null | undefined;
    const closeDate = opp.keyDates?.closeDate as { date?: string } | null | undefined;
    expect(postDate?.date).toBe('2026-06-22');
    expect(closeDate?.date).toBe('2026-08-03');
  });

  it('uses native acceptedApplicantTypes', () => {
    const values = (opp.acceptedApplicantTypes ?? []).map((a) => a.value);
    expect(values).toContain('individual');
    expect(values).toContain('custom'); // Business / Nonprofit / Public Agency
  });

  it('folds matching funds into costSharing (Not Required + notes → details)', () => {
    const cs = opp.customFields?.['costSharing']?.value as {
      isRequired: boolean;
      percentage: number | null;
      details: string | null;
    };
    expect(cs.isRequired).toBe(false);
    expect(cs.percentage).toBeNull();
    expect(cs.details).toContain('Greater consideration');
  });

  it('uses cross-source shared keys (fundingSource, fundingInstrument, lastSyncedAt)', () => {
    expect(opp.customFields?.['fundingSource']?.value).toBe('State');
    expect(opp.customFields?.['fundingInstrument']?.value).toBe('Grant');
    expect(opp.customFields?.['lastSyncedAt']?.value).toBe(SYNCED_AT);
  });

  it('keeps CA-specific fields prefixed', () => {
    expect(opp.customFields?.['caPortalId']?.value).toBe('ca-178419');
    expect(opp.customFields?.['caCategories']?.value).toEqual(['Energy', 'Environment & Water']);
    expect(opp.customFields?.['caLoi']?.value).toBe(false);
    expect(opp.customFields?.['caEstAmountsRaw']?.value).toBe('Between $5,000 and $375,000');
  });
});

describe('caGrantToOpportunity (edge cases)', () => {
  const opp = caGrantToOpportunity(ca2FixtureEdgeCases, SYNCED_AT);

  it('maps forecasted status and falls back to Purpose for description', () => {
    expect(opp.status.value).toBe('forecasted');
    expect(opp.description).toBe('Fallback purpose used as description.');
  });

  it('records a percentage match in costSharing', () => {
    const cs = opp.customFields?.['costSharing']?.value as {
      isRequired: boolean;
      percentage: number;
    };
    expect(cs.isRequired).toBe(true);
    expect(cs.percentage).toBe(35);
  });

  it('drops a non-URL source and agency URL', () => {
    expect(opp.source).toBeNull();
    expect(opp.customFields?.['additionalInfo']).toBeUndefined();
  });

  it('omits keyDates when all dates are empty', () => {
    expect(opp.keyDates).toBeNull();
  });
});

// =============================================================================
// Round-trip
// =============================================================================

describe('caOpportunityToGrant (reverse, best-effort)', () => {
  const opp = caGrantToOpportunity(ca1Fixture, SYNCED_AT);
  const back = caOpportunityToGrant(opp);

  it('round-trips faithfully where a CG home exists', () => {
    expect(back.PortalID).toBe('ca-178419');
    expect(back.Title).toBe('Wood Products Innovation Grant');
    expect(back.Status).toBe('active');
    expect(back.Type).toBe('Grant');
    expect(back.FundingSource).toBe('State');
    expect(back.Categories).toBe('Energy; Environment & Water');
    expect(back.MatchingFunds).toBe('Not Required');
    expect(back.ApplicantType).toContain('Individual');
  });

  it('reconstructs the structured ContactInfo string', () => {
    expect(back.ContactInfo).toContain('name: Katie Harrell;');
    expect(back.ContactInfo).toContain('email: katie.harrell@bof.ca.gov;');
  });

  it('drops fields with no CommonGrants home (lossy by design)', () => {
    expect(back.Purpose).toBe(''); // folded into Description
  });
});

// =============================================================================
// Search text
// =============================================================================

describe('buildSearchText', () => {
  it('concatenates the searchable fields', () => {
    const text = buildSearchText(ca1Fixture);
    expect(text).toContain('Wood Products Innovation Grant');
    expect(text).toContain('Board of Forestry');
    expect(text).toContain('Energy');
  });
});
