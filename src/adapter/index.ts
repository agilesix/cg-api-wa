/**
 * Public surface of the CA adapter (future `@common-grants/cg-ca`).
 *
 * This is the only module that routes, services, ETL, and `src/cg.config.ts`
 * should import from. Deep imports into `./plugin`, `./fields`, etc. are
 * forbidden by lint zones to keep the future package extraction cheap.
 *
 * As of the SDK v0.5.0 architecture there is no bespoke `IAdapter` seam: the
 * `CaPlugin` (`@common-grants/sdk` `definePlugin()`) owns the schema,
 * `sourceSchema`, and the bidirectional `toCommon` / `fromCommon` transforms.
 * The only pieces that live outside the plugin are the operational hooks the
 * SQL tier needs — `getSourceId`, `getModifiedAt`, and `buildSearchText` —
 * plus the HTTP client. See ADR 003 / 005 for the rationale.
 */

import type { CaGrant } from './caSource';

/** Source-system identifier extractor — the per-source key used for upsert/snapshot keying. */
export const getSourceId = (grant: CaGrant): string => grant.PortalID;

/**
 * Source last-modified extractor — the per-source field the incremental ETL
 * uses to advance its high-watermark. CA's `LastUpdated` is a lexicographically
 * sortable `"YYYY-MM-DD HH:MM:SS"` string, compared verbatim (no normalization).
 */
export const getModifiedAt = (grant: CaGrant): string => grant.LastUpdated;

// Plugin + schema + types
export {
  CaPlugin,
  CaOpportunitySchema,
  type CaOpportunity,
  type CaOpportunityInput,
} from './plugin';

// HTTP client
export { CaSourceClient, CaApiError } from './CaSourceClient';

// Raw source schema + type (useful for fixtures / tests downstream)
export { CaGrantSchema, CkanDatastoreResponseSchema, type CaGrant } from './caSource';

// Pure transform functions (exported so the ETL/tests can use them directly)
export {
  caGrantToOpportunity,
  caOpportunityToGrant,
  buildSearchText,
  portalIdToCgId,
  // Lower-level helpers are exported for testability / advanced use.
  normalizeStatus,
  statusToCaString,
  mapApplicantTypes,
  parseCaContact,
  parseAmountRange,
  parseFinancial,
  parseMatchingFunds,
  moneyToCents,
  splitList,
  splitCaDateTime,
  caDateToIso,
  stripHtml,
  nullIfEmpty,
  nullIfNotUrl,
} from './transform';

// Value schemas for custom-field values
export {
  AgencyValueSchema,
  ContactInfoValueSchema,
  AdditionalInfoValueSchema,
  CostSharingValueSchema,
  CaStringListSchema,
} from './fields';
