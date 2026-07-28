import { z } from 'zod';

/**
 * Coerce `null` → `""` for CKAN text fields. California's Grants Portal is
 * published through a CKAN DataStore resource (`datastore_search`); almost
 * every column is typed `text` and missing values arrive as `null`
 * (e.g. `GrantID`, `Geography`, `FundingSource`, `EstAvailFunds`). The
 * transform layer already treats `""` as absent via `nullIfEmpty()`, so
 * coercing here keeps the pipeline uniform — identical convention to the PA
 * adapter's `paStr`.
 */
const waStr = z
  .string()
  .nullable()
  .transform((v) => v ?? '');

/**
 * Zod schema + TypeScript type for a raw California grant record as returned
 * by the CKAN DataStore.
 *
 * Observed shape from
 * `GET https://data.ca.gov/api/3/action/datastore_search?resource_id=111c8c88-…`
 * (probed 2026-06):
 *
 *   - `PortalID` is the stable business key — unique and non-null across all
 *     ~1,942 records. We use it as the source identifier (PA's `slug` analog).
 *   - `_id` is CKAN's internal row id (integer). It is NOT stable across a
 *     re-import of the resource, so we never key on it.
 *   - All other columns are free-form `text`; missing values are `null`.
 *   - Datetimes are space-separated, timezone-naive
 *     (`"2026-06-22 17:20:00"`) — NOT ISO 8601. The transform layer converts
 *     them (see `waDateToIso` / `splitWaDateTime`).
 *   - Several columns are `;`-delimited lists (`Categories`, `ApplicantType`).
 *   - `MatchingFunds` is a percentage string (`"35%"`) or `"Not Required"`.
 *   - `EstAmounts` is a free-form range (`"Between $5,000 and $375,000"`).
 *   - `ContactInfo` is a structured `key: value;` string
 *     (`"name: Jane; email: jane@ca.gov; tel: 1-916-…;"`).
 *
 * `.passthrough()` lets unknown columns through — CKAN resources can gain
 * columns and we shouldn't fail validation on forward-compatible additions.
 */
export const WaGrantSchema = z
  .object({
    // Internal CKAN row id — present but never used as a key.
    _id: z.number().int().optional(),

    // --- identity / lifecycle -------------------------------------------
    PortalID: z.string().min(1),
    GrantID: waStr,
    Status: waStr,
    LastUpdated: z.string(),
    ChangeNotes: waStr,

    // --- descriptive ----------------------------------------------------
    AgencyDept: waStr,
    Title: waStr,
    Type: waStr,
    LOI: waStr,
    Categories: waStr,
    CategorySuggestion: waStr,
    Purpose: waStr,
    Description: waStr,

    // --- eligibility ----------------------------------------------------
    ApplicantType: waStr,
    ApplicantTypeNotes: waStr,
    Geography: waStr,

    // --- funding --------------------------------------------------------
    FundingSource: waStr,
    FundingSourceNotes: waStr,
    MatchingFunds: waStr,
    MatchingFundsNotes: waStr,
    EstAvailFunds: waStr,
    EstAwards: waStr,
    EstAmounts: waStr,
    FundingMethod: waStr,
    FundingMethodNotes: waStr,

    // --- dates ----------------------------------------------------------
    OpenDate: waStr,
    ApplicationDeadline: waStr,
    AwardPeriod: waStr,
    ExpAwardDate: waStr,

    // --- application / links / contact ----------------------------------
    ElecSubmission: waStr,
    GrantURL: waStr,
    AgencyURL: waStr,
    AgencySubscribeURL: waStr,
    GrantEventsURL: waStr,
    ContactInfo: waStr,
    AwardStats: waStr,
  })
  .passthrough();

export type WaGrant = z.infer<typeof WaGrantSchema>;

/**
 * CKAN `datastore_search` response envelope. We only model the fields the
 * client reads; everything else (`fields`, `total_estimation_threshold`, …)
 * is ignored. The records array is parsed per-row by {@link WaGrantSchema}.
 */
export const CkanDatastoreResponseSchema = z.object({
  success: z.boolean(),
  result: z.object({
    records: z.array(WaGrantSchema),
    total: z.number().optional(),
    limit: z.number().optional(),
    _links: z
      .object({
        start: z.string().optional(),
        next: z.string().optional(),
      })
      .optional(),
  }),
});

export type CkanDatastoreResponse = z.infer<typeof CkanDatastoreResponseSchema>;
