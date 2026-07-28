import { z } from 'zod';
import {
  definePlugin,
  type ToCommon,
  type FromCommon,
  type TransformResult,
} from '@common-grants/sdk/extensions';
import {
  AdditionalInfoValueSchema,
  AgencyValueSchema,
  WaStringListSchema,
  ContactInfoValueSchema,
  CostSharingValueSchema,
} from './fields';
import { WaGrantSchema, type WaGrant } from './waSource';
import { waGrantToOpportunity, waOpportunityToGrant } from './transform';

/**
 * CA custom-field specifications, hoisted to a `const` so the same object can
 * be passed to `definePlugin()` **and** referenced by the `ToCommon` /
 * `FromCommon` helper types below. `as const` keeps the `fieldType` literals
 * narrow (per the SDK extensions guide).
 *
 * Extends the base CG `Opportunity` schema with:
 *
 *   - Ecosystem-shared fields (`agency`, `contactInfo`, `additionalInfo`,
 *     `costSharing`) whose value schemas are identical to the grants.gov / PA
 *     plugins — values under these keys are interoperable across plugins per
 *     https://commongrants.org/custom-fields/.
 *   - CA-specific fields (`caPortalId`, `caCategories`, `caFundingSource`,
 *     etc.) for data that has no ecosystem equivalent. The `ca` prefix marks
 *     the namespace; migrate to a shared key if/when one lands upstream.
 */
const waCustomFields = {
  // --- shared with grants.gov / PA -------------------------------------
  agency: {
    fieldType: 'object',
    value: AgencyValueSchema,
    description: 'Information about the agency offering this opportunity',
  },
  contactInfo: {
    fieldType: 'object',
    value: ContactInfoValueSchema,
    description: 'Contact information (name, email, phone, description) for this resource',
  },
  additionalInfo: {
    fieldType: 'object',
    value: AdditionalInfoValueSchema,
    description: 'URL and description for additional information about the opportunity',
  },
  costSharing: {
    fieldType: 'object',
    value: CostSharingValueSchema,
    description: 'Cost sharing or matching requirement for the opportunity',
  },

  // --- cross-source shared (unprefixed; defined identically in the PA plugin)
  // Open-ended labels whose meaning is equivalent across state sources, so the
  // key is shared rather than `pa*`/`ca*`-prefixed. Candidates to upstream into
  // the commongrants.org custom-field catalog.
  fundingSource: {
    fieldType: 'string',
    description:
      'Where the funding originates (e.g. "State", "Federal", "Federal and State", "Other")',
  },
  fundingInstrument: {
    fieldType: 'string',
    description: 'The funding instrument type (e.g. "Grant", "Loan")',
  },
  lastSyncedAt: {
    fieldType: 'string',
    value: z.string().datetime(),
    description: 'ISO 8601 datetime when this record was last ingested from its source system',
  },

  // --- CA-specific -----------------------------------------------------
  caPortalId: {
    fieldType: 'string',
    description: "California's Grants Portal identifier (the stable source key)",
  },
  caGrantId: {
    fieldType: 'string',
    description: "California's internal grant identifier, when assigned (often absent)",
  },
  caCategories: {
    fieldType: 'array',
    value: WaStringListSchema,
    description: "California's category taxonomy (the source `Categories` list, split)",
  },
  caLoi: {
    fieldType: 'boolean',
    description: 'Whether a Letter of Intent (LOI) is required before applying',
  },
  caApplicantTypeNotes: {
    fieldType: 'string',
    description:
      'Free-text notes clarifying applicant eligibility (the standard applicant types are on the native `acceptedApplicantTypes` field)',
  },
  caGeography: {
    fieldType: 'string',
    description: 'Geographic scope or restrictions for the opportunity',
  },
  caFundingSourceNotes: {
    fieldType: 'string',
    description: 'Free-text notes about the funding source',
  },
  caFundingMethod: {
    fieldType: 'string',
    description: 'How funds are disbursed (e.g. "Reimbursement(s)", "Advance(s)")',
  },
  caFundingMethodNotes: {
    fieldType: 'string',
    description: 'Free-text notes about the funding method',
  },
  caEstAwards: {
    fieldType: 'string',
    description: 'CA estimate of the number of awards (free-form text)',
  },
  caEstAmountsRaw: {
    fieldType: 'string',
    description:
      'Original `EstAmounts` range string preserved verbatim (the numeric range is also exposed via `funding.min/maxAwardAmount` when parseable)',
  },
  caRawEstAvailFunds: {
    fieldType: 'string',
    description:
      'Original `EstAvailFunds` string preserved when the value could not be parsed into a numeric amount',
  },
  caAwardPeriod: {
    fieldType: 'string',
    description: 'CA award/performance period (free-form, e.g. "Expires 3/31/29")',
  },
  caExpAwardDate: {
    fieldType: 'string',
    description: 'CA expected award date (free-form, e.g. "November 2026")',
  },
  caElecSubmission: {
    fieldType: 'string',
    description: 'Electronic submission instructions / address',
  },
  caAwardStats: {
    fieldType: 'string',
    description: 'CA statistics about prior awards, when published',
  },
  caCategorySuggestion: {
    fieldType: 'string',
    description: 'Suggested category provided by the source, when present',
  },
  caChangeNotes: {
    fieldType: 'string',
    description: 'CA-provided notes describing the latest change to the record',
  },
  caSubscribeUrl: {
    fieldType: 'string',
    description: 'URL to subscribe to updates from the issuing agency',
  },
  caGrantEventsUrl: {
    fieldType: 'string',
    description: 'URL for grant-related events (webinars, info sessions)',
  },
} as const;

/**
 * Type parameters shared by the `toCommon` / `fromCommon` helper annotations.
 * Type-level inputs only; no runtime schema is referenced here, which keeps
 * this module free of a `plugin ⇄ transform` import cycle.
 */
type WaTransform = {
  model: 'Opportunity';
  sourceSchema: typeof WaGrantSchema;
  customFields: typeof waCustomFields;
};

/**
 * Source → CommonGrants. A thin wrapper over the pure `waGrantToOpportunity`
 * mapper. **No validation here on purpose:** `definePlugin()` wraps this
 * callable with `commonSchema` validation, folding any Zod issues into
 * `TransformResult.errors`.
 */
const toCommon: ToCommon<WaTransform> = (source) =>
  ({
    result: waGrantToOpportunity(source, new Date().toISOString()) as unknown as WaOpportunity,
    errors: [],
  }) satisfies TransformResult<WaOpportunity>;

/**
 * CommonGrants → source (best-effort, lossy — see `waOpportunityToGrant`).
 * As with `toCommon`, `definePlugin()` wraps this with `sourceSchema`
 * validation, so no explicit parse is needed here.
 */
const fromCommon: FromCommon<WaTransform> = (common) =>
  ({
    result: waOpportunityToGrant(common as unknown as WaOpportunityInput),
    errors: [],
  }) satisfies TransformResult<WaGrant>;

/**
 * The California CommonGrants plugin. v0.5.0 `definePlugin()` owns the schema
 * extension **and** the bidirectional transforms + source schema (see ADR 005).
 */
export const WaPlugin = definePlugin({
  meta: {
    name: 'wa-grants',
    version: '0.1.0',
    sourceSystem: 'wa-fundhub',
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

/** The CG Opportunity Zod schema extended with CA custom fields. */
export const WaOpportunitySchema = WaPlugin.schemas.Opportunity.commonSchema;

/** Inferred TypeScript type for a CA-flavored Opportunity (output shape — dates as `Date`). */
export type WaOpportunity = z.infer<typeof WaOpportunitySchema>;

/**
 * The **input** type of the CA-extended Opportunity schema — the plain JSON
 * shape before Zod applies its `.transform()` steps (dates as strings). The
 * pure mappers in `./transform` produce and consume this shape.
 */
export type WaOpportunityInput = z.input<typeof WaOpportunitySchema>;
