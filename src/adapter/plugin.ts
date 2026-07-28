import { z } from 'zod';
import {
  definePlugin,
  type FromCommon,
  type ToCommon,
  type TransformResult,
} from '@common-grants/sdk/extensions';
import {
  AdditionalInfoValueSchema,
  AgencyValueSchema,
  ContactInfoValueSchema,
  CostSharingValueSchema,
  WaTaxonomiesValueSchema,
} from './fields';
import { WaGrantSchema, type WaGrant } from './waSource';
import { waGrantToOpportunity, waOpportunityToGrant } from './transform';

const waCustomFields = {
  agency: {
    fieldType: 'object',
    value: AgencyValueSchema,
    description: 'Information about the agency offering this opportunity',
  },
  contactInfo: {
    fieldType: 'object',
    value: ContactInfoValueSchema,
    description: 'Contact information for this opportunity',
  },
  additionalInfo: {
    fieldType: 'object',
    value: AdditionalInfoValueSchema,
    description: 'Application URL and label supplied by FundHubWA',
  },
  costSharing: {
    fieldType: 'object',
    value: CostSharingValueSchema,
    description: 'Cost sharing or matching requirement',
  },
  fundingSource: {
    fieldType: 'string',
    description: 'Where the funding originates',
  },
  fundingInstrument: {
    fieldType: 'string',
    description: 'Funding instrument type',
  },
  lastSyncedAt: {
    fieldType: 'string',
    value: z.string().datetime(),
    description: 'ISO 8601 datetime when this record was ingested',
  },
  waWordPressId: { fieldType: 'string', description: 'FundHubWA WordPress record id' },
  waSlug: { fieldType: 'string', description: 'FundHubWA WordPress slug' },
  waInternalReferenceId: {
    fieldType: 'string',
    description: 'FundHubWA internal reference id',
  },
  waExternalReferenceId: {
    fieldType: 'string',
    description: 'Reference id from the originating system',
  },
  waFeatured: { fieldType: 'boolean', description: 'Whether FundHubWA features the record' },
  waPreApplicationRequired: {
    fieldType: 'boolean',
    description: 'Whether a pre-application is required',
  },
  waPreApplicationRaw: {
    fieldType: 'string',
    description: 'Original FundHubWA pre-application value',
  },
  waCostShareRaw: {
    fieldType: 'string',
    description: 'Original FundHubWA cost-sharing value',
  },
  waApplicationLinkTitle: {
    fieldType: 'string',
    description: 'Original FundHubWA application-link label',
  },
  waApplicationLinkUrl: {
    fieldType: 'string',
    description: 'Original FundHubWA application-link URL',
  },
  waApplicationLinkTarget: {
    fieldType: 'string',
    description: 'Original FundHubWA application-link target',
  },
  waApplicationLinkRaw: {
    fieldType: 'string',
    description: 'Original string-form FundHubWA application link',
  },
  waEligibilityHtml: {
    fieldType: 'string',
    description: 'Original FundHubWA eligibility content, including HTML',
  },
  waRequirements: { fieldType: 'string', description: 'Application requirements' },
  waContactHtml: {
    fieldType: 'string',
    description: 'Original FundHubWA contact content, including HTML',
  },
  waTechnicalAssistanceContact: {
    fieldType: 'string',
    description: 'Technical assistance contact supplied by FundHubWA',
  },
  waResourcesHtml: {
    fieldType: 'string',
    description: 'Original FundHubWA resources list, including HTML links',
  },
  waTaxonomies: {
    fieldType: 'object',
    value: WaTaxonomiesValueSchema,
    description: 'FundHubWA taxonomy labels grouped by taxonomy',
  },
  waScore: { fieldType: 'number', description: 'FundHubWA curation score' },
  waScoreReason: { fieldType: 'string', description: 'FundHubWA curation score rationale' },
  waNumberOfAwardsRaw: {
    fieldType: 'string',
    description: 'Original free-text number-of-awards value',
  },
  waTotalAmountRaw: { fieldType: 'string', description: 'Original total funding value' },
  waMinAwardAmountRaw: { fieldType: 'string', description: 'Original minimum award value' },
  waMaxAwardAmountRaw: { fieldType: 'string', description: 'Original maximum award value' },
  waDisbursementNotes: { fieldType: 'string', description: 'FundHubWA disbursement notes' },
  waApplicationCloseTime: {
    fieldType: 'string',
    description: 'Original application close time',
  },
  waDescriptionHtml: {
    fieldType: 'string',
    description: 'Original description when it contains HTML',
  },
} as const;

type WaTransform = {
  model: 'Opportunity';
  sourceSchema: typeof WaGrantSchema;
  customFields: typeof waCustomFields;
};

const toCommon: ToCommon<WaTransform> = (source) =>
  ({
    result: waGrantToOpportunity(source, new Date().toISOString()) as unknown as WaOpportunity,
    errors: [],
  }) satisfies TransformResult<WaOpportunity>;

const fromCommon: FromCommon<WaTransform> = (common) =>
  ({
    result: waOpportunityToGrant(common as unknown as WaOpportunityInput),
    errors: [],
  }) satisfies TransformResult<WaGrant>;

export const WaPlugin = definePlugin({
  meta: {
    name: 'wa-fundhub',
    version: '0.1.0',
    sourceSystem: 'fundhub-wa-wordpress',
    capabilities: ['customFields', 'transforms'],
  },
  schemas: {
    Opportunity: {
      customFields: waCustomFields,
      sourceSchema: WaGrantSchema,
      toCommon,
      fromCommon,
    },
  },
} as const);

export const WaOpportunitySchema = WaPlugin.schemas.Opportunity.commonSchema;
export type WaOpportunity = z.infer<typeof WaOpportunitySchema>;
export type WaOpportunityInput = z.input<typeof WaOpportunitySchema>;
