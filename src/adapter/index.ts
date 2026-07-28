/**
 * Public surface of the FundHubWA adapter. Application code imports only this
 * module so the adapter can later be extracted into a standalone package.
 */
import type { WaGrant } from './waSource';

export const getSourceId = (grant: WaGrant): string => String(grant.id);

/** WordPress GMT timestamps sort lexicographically and are safe watermarks. */
export const getModifiedAt = (grant: WaGrant): string => `${grant.modified_gmt}Z`;

export {
  WaPlugin,
  WaOpportunitySchema,
  type WaOpportunity,
  type WaOpportunityInput,
} from './plugin';
export { WaSourceClient, WaApiError, isWashingtonStateGrant } from './WaSourceClient';
export {
  WaGrantSchema,
  WaAcfSchema,
  WaTermSchema,
  WordPressFundingPageSchema,
  type WaGrant,
  type WaTerm,
} from './waSource';
export {
  waGrantToOpportunity,
  waOpportunityToGrant,
  buildSearchText,
  portalIdToCgId,
  normalizeStatus,
  mapApplicantTypes,
  parseWaContact,
  parseFinancial,
  moneyToCents,
  waDate,
  taxonomies,
  stripHtml,
  nullIfEmpty,
  nullIfNotUrl,
} from './transform';
export {
  AgencyValueSchema,
  ContactInfoValueSchema,
  AdditionalInfoValueSchema,
  CostSharingValueSchema,
  WaStringListSchema,
  WaTaxonomiesValueSchema,
} from './fields';
