import { describe, it, expect } from 'vitest';
import {
  AdditionalInfoValueSchema,
  AgencyValueSchema,
  ContactInfoValueSchema,
  CostSharingValueSchema,
  CaOpportunitySchema,
  CaPlugin,
  caGrantToOpportunity,
} from '../../src/adapter';
import { ca1Fixture } from './fixtures';

/**
 * The shared custom-field value schemas in `src/adapter/fields.ts` are mirrored
 * verbatim from the grants.gov plugin (and `costSharing` matches its
 * `CustomCostSharing` value: `{ isRequired, percentage, details }`). This file
 * guards against drift: an opportunity populated with the shared fields
 * (`agency`, `contactInfo`, `additionalInfo`, `costSharing`) must validate under
 * `CaOpportunitySchema`, and each shared value must validate under its mirrored
 * value schema.
 *
 * NOTE: The live cross-parse against `@common-grants/cg-grants-gov` is paused
 * until a 0.5.0-compatible release ships (common-grants/ts-cg-grants-gov). The
 * field keys and value shapes here are kept aligned with that plugin so the
 * cross-parse can be restored cheaply.
 */
describe('shared-field alignment (mirrored from grants.gov)', () => {
  const opp = caGrantToOpportunity(ca1Fixture, '2026-06-25T00:00:00Z');

  const sharedOnly = {
    id: opp.id,
    title: opp.title,
    description: opp.description,
    status: opp.status,
    source: opp.source,
    createdAt: opp.createdAt,
    lastModifiedAt: opp.lastModifiedAt,
    customFields: {
      agency: opp.customFields?.['agency'],
      contactInfo: opp.customFields?.['contactInfo'],
      additionalInfo: opp.customFields?.['additionalInfo'],
      costSharing: opp.customFields?.['costSharing'],
    },
  };

  it('a shared-only opportunity validates under CaOpportunitySchema', () => {
    expect(() => CaOpportunitySchema.parse(sharedOnly)).not.toThrow();
  });

  it('each shared custom-field value validates under its mirrored value schema', () => {
    expect(() => AgencyValueSchema.parse(opp.customFields?.['agency']?.value)).not.toThrow();
    expect(() =>
      ContactInfoValueSchema.parse(opp.customFields?.['contactInfo']?.value),
    ).not.toThrow();
    expect(() =>
      AdditionalInfoValueSchema.parse(opp.customFields?.['additionalInfo']?.value),
    ).not.toThrow();
    expect(() =>
      CostSharingValueSchema.parse(opp.customFields?.['costSharing']?.value),
    ).not.toThrow();
  });

  it('parsing preserves the shared custom-field values unchanged', () => {
    const parsed = CaOpportunitySchema.parse(sharedOnly);
    expect(parsed.customFields?.['agency']?.value).toEqual({
      code: null,
      name: 'Board of Forestry',
      parentName: null,
      parentCode: null,
    });
    expect(parsed.customFields?.['contactInfo']?.value).toMatchObject({
      name: 'Katie Harrell',
      email: 'katie.harrell@bof.ca.gov',
      phone: '1-916-698-1035',
    });
    // ca1Fixture: MatchingFunds 'Not Required' + a notes string → details.
    expect(parsed.customFields?.['costSharing']?.value).toMatchObject({
      isRequired: false,
      percentage: null,
    });
  });
});

/**
 * The plugin registers bidirectional transforms via `definePlugin()`. The SDK
 * wraps these callables with schema validation, so `toCommon` surfaces invalid
 * output through `TransformResult.errors` rather than throwing.
 */
describe('CaPlugin.toCommon', () => {
  it('returns the transformed opportunity with no errors for a valid record', () => {
    const { result, errors } = CaPlugin.schemas.Opportunity.toCommon(ca1Fixture);
    expect(errors).toEqual([]);
    expect(result.id).toBe(caGrantToOpportunity(ca1Fixture, '2026-06-25T00:00:00Z').id);
    expect(result.customFields?.['caPortalId']?.value).toBe('ca-178419');
  });

  it('reports validation errors (does not throw) when the output is invalid', () => {
    // `LastUpdated` drives `lastModifiedAt`, which the SDK validates as a UTC
    // datetime — an unparseable value reliably trips validation.
    const bad: typeof ca1Fixture = {
      ...ca1Fixture,
      PortalID: 'ca-bad-modified',
      LastUpdated: 'not-a-datetime',
    };
    const { errors } = CaPlugin.schemas.Opportunity.toCommon(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => (e.path ?? '').includes('lastModifiedAt'))).toBe(true);
  });
});
