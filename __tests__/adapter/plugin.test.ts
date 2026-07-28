import { describe, expect, it } from 'vitest';
import {
  AgencyValueSchema,
  ContactInfoValueSchema,
  WaOpportunitySchema,
  WaPlugin,
} from '../../src/adapter';
import { waFixture } from './fixtures';

describe('WaPlugin', () => {
  it('validates a live-shaped FundHubWA record', () => {
    const { result, errors } = WaPlugin.schemas.Opportunity.toCommon(waFixture);
    expect(errors).toEqual([]);
    expect(result.customFields?.waWordPressId?.value).toBe('2080');
  });

  it('keeps shared field value schemas compatible', () => {
    const opportunity = WaOpportunitySchema.parse(
      WaPlugin.schemas.Opportunity.toCommon(waFixture).result,
    );
    expect(() => AgencyValueSchema.parse(opportunity.customFields?.agency?.value)).not.toThrow();
    expect(() =>
      ContactInfoValueSchema.parse(opportunity.customFields?.contactInfo?.value),
    ).not.toThrow();
  });
});
