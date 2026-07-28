import { v5 as uuidv5 } from 'uuid';
import type { CaGrant } from './caSource';
import type { CaOpportunityInput } from './plugin';

/**
 * Pure mapping logic between raw California grant records (CKAN DataStore) and
 * the CommonGrants `Opportunity` shape. No I/O, no DB, no Workers types, and —
 * importantly — **no schema dependency**: validation lives in the plugin's
 * `toCommon` / `fromCommon` wrappers (`./plugin`), which fold any Zod issues
 * into the SDK's `TransformResult.errors`. Keeping this module schema-free
 * avoids a circular import (`plugin` → `transform` for the builders;
 * `transform` → `plugin` only for the input *type*, erased at runtime).
 */

/** Element type of `CaOpportunityInput.keyDates.otherDates`. */
type OtherDateInput = NonNullable<
  NonNullable<CaOpportunityInput['keyDates']>['otherDates']
>[string];

/** Element type of `CaOpportunityInput.customFields`. */
type CustomFieldInput = NonNullable<CaOpportunityInput['customFields']>[string];

/** A parsed CG `Money`-shaped value. */
type Money = { amount: string; currency: 'USD' };

// =============================================================================
// UUID v5 namespace
// =============================================================================

/**
 * Deterministic namespace for CA CommonGrants UUIDs. Derived once from the DNS
 * namespace + `"ca.commongrants.api"` so it is stable forever without a
 * hardcoded magic UUID literal. A given CA `PortalID` always maps to the same
 * CG id.
 */
const CA_NAMESPACE = uuidv5('ca.commongrants.api', uuidv5.DNS);

/** Map a CA portal id to a deterministic CommonGrants UUID. */
export function portalIdToCgId(portalId: string): string {
  return uuidv5(portalId, CA_NAMESPACE);
}

// =============================================================================
// Primitive normalization helpers
// =============================================================================

/** Trim + treat `""` as `null`. */
export function nullIfEmpty(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Like `nullIfEmpty`, but additionally returns null when the value isn't a
 * parseable absolute URL. Use for fields the CommonGrants schema validates
 * with `.url()` (e.g. `Opportunity.source`) so free-form values like `"TBD"`
 * don't slip through and break downstream Zod parsing.
 */
export function nullIfNotUrl(s: string | null): string | null {
  if (!s) return null;
  try {
    new URL(s);
    return s;
  } catch {
    return null;
  }
}

/**
 * Best-effort strip of HTML tags. CA's `Description` / `Purpose` occasionally
 * carry simple markup; this produces clean plain text. Not a security
 * sanitizer — do not rely on it for XSS protection.
 */
export function stripHtml(s: string | null): string | null {
  if (!s) return null;
  const plain = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain === '' ? null : plain;
}

/** Split a CA `;`-delimited list column into a trimmed, non-empty array. */
export function splitList(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// =============================================================================
// Financial parsing
// =============================================================================

const money = (n: number): Money => ({ amount: n.toFixed(2), currency: 'USD' });

/** Convert a parsed `Money` to integer cents. Null in, null out. */
export function moneyToCents(m: { amount: string } | null | undefined): number | null {
  if (!m) return null;
  const dollars = Number(m.amount);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Parse a single CA financial string into a `Money`, or null. Handles
 * `"$500,000"`, `"$2 million"`, `"500k"`, plain integers. Returns null for
 * empty/free-form values (`"Varies"`, `"Dependent on submissions"`).
 */
export function parseFinancial(raw: string | null): Money | null {
  if (!raw) return null;
  const match = raw.match(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(million|thousand|m|k)?/i);
  if (!match) return null;
  let n = Number((match[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (unit.startsWith('m')) n *= 1_000_000;
  else if (unit.startsWith('k') || unit.startsWith('thousand')) n *= 1_000;
  return money(n);
}

/**
 * Parse CA's free-form `EstAmounts` into a `{ min, max }` award range.
 *
 * Observed formats:
 *   - `"Between $5,000 and $375,000"` → min 5,000 / max 375,000
 *   - `"$5,000 - $375,000"` / `"$5,000 to $375,000"` → range
 *   - `"$50,000"` / `"Up to $100,000"` → single value → `max`
 *   - `"At least $10,000"` / `"Minimum $10,000"` → single value → `min`
 *   - `"Varies"`, `"Dependent on …"` → `{ null, null }`
 *
 * Requires a `$` so bare numbers in prose aren't mistaken for amounts. The raw
 * string is always preserved by the caller in `caEstAmountsRaw`, so a missed
 * parse loses nothing.
 */
export function parseAmountRange(raw: string | null): { min: Money | null; max: Money | null } {
  if (!raw) return { min: null, max: null };
  const matches = [...raw.matchAll(/\$\s*([\d][\d,]*(?:\.\d+)?)\s*(million|thousand|m|k)?/gi)];
  const amounts = matches
    .map((m) => {
      let n = Number((m[1] ?? '').replace(/,/g, ''));
      const unit = (m[2] ?? '').toLowerCase();
      if (unit.startsWith('m')) n *= 1_000_000;
      else if (unit.startsWith('k') || unit.startsWith('thousand')) n *= 1_000;
      return n;
    })
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (amounts.length === 0) return { min: null, max: null };

  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);

  if (amounts.length === 1) {
    // A single amount: decide whether it's a floor or a ceiling from context.
    if (/\b(min|minimum|at least|starting|no less than)\b/i.test(raw)) {
      return { min: money(lo), max: null };
    }
    return { min: null, max: money(hi) };
  }
  return { min: money(lo), max: money(hi) };
}

// =============================================================================
// Matching-funds parsing
// =============================================================================

/**
 * Parse CA's `MatchingFunds` column. Values are a percentage (`"35%"`,
 * `"0%"`, `"100%"`) or the literal `"Not Required"`.
 *
 * Returns `isRequired` plus the match `percentage` (0–100) for the standard
 * `costSharing` field. `"0%"` is treated as not required. Returns null for
 * empty/unrecognized input.
 */
export function parseMatchingFunds(
  raw: string | null,
): { isRequired: boolean; percentage: number | null } | null {
  const s = nullIfEmpty(raw);
  if (s === null) return null;
  if (/not\s*required/i.test(s)) return { isRequired: false, percentage: null };
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    const percentage = Number(pct[1]);
    if (Number.isFinite(percentage) && percentage >= 0) {
      return { isRequired: percentage > 0, percentage };
    }
  }
  return null;
}

/** Inverse: a 0–100 percentage back to CA's `"NN%"` string. */
function percentToCaPercent(percentage: unknown): string {
  if (typeof percentage !== 'number' || !Number.isFinite(percentage)) return '';
  return `${Math.round(percentage)}%`;
}

// =============================================================================
// Date / time handling
// =============================================================================

/**
 * Split a CA datetime (`"2026-06-22 17:20:00"`, timezone-naive) into the
 * `{ date, time }` pair the CG `SingleDateEventSchema` expects. Tolerates a
 * date-only value (`time` → null) and ISO-style `T` separators. Returns null
 * for empty/unparseable input.
 */
export function splitCaDateTime(raw: string | null): { date: string; time: string | null } | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?)?/);
  if (!match) return null;
  return { date: match[1] as string, time: match[2] ?? null };
}

/**
 * Convert a CA datetime into an ISO 8601 UTC string for the CG
 * `createdAt` / `lastModifiedAt` fields (which require a full datetime).
 *
 * CA timestamps carry no timezone; we treat them as UTC and append `Z`. This
 * is a deterministic, sortable normalization — the incremental-sync watermark
 * compares CA's *raw* `LastUpdated` string (not this value), so the UTC
 * assumption never affects change detection. Returns `""` when unparseable.
 */
export function caDateToIso(raw: string | null): string {
  const parts = splitCaDateTime(raw);
  if (!parts) return '';
  return `${parts.date}T${parts.time ?? '00:00:00'}Z`;
}

// =============================================================================
// Status mapping
// =============================================================================

const STATUS_MAP: Record<string, 'forecasted' | 'open' | 'closed'> = {
  active: 'open',
  closed: 'closed',
  forecasted: 'forecasted',
};

/** Canonical CA label for each mapped CG status (used by `fromCommon`). */
const STATUS_REVERSE_MAP: Record<'forecasted' | 'open' | 'closed', string> = {
  open: 'active',
  closed: 'closed',
  forecasted: 'forecasted',
};

/**
 * Map CA's `Status` (`active` | `closed` | `forecasted`) to the CG `OppStatus`
 * enum. Unknown values fall back to `custom` with the original string in
 * `customValue`.
 */
export function normalizeStatus(raw: string | null): {
  value: 'forecasted' | 'open' | 'closed' | 'custom';
  customValue: string | null;
} {
  const norm = (raw ?? '').trim().toLowerCase();
  const mapped = STATUS_MAP[norm];
  if (mapped) return { value: mapped, customValue: null };
  if (norm === '') return { value: 'custom', customValue: null };
  return { value: 'custom', customValue: raw };
}

/** Inverse of `normalizeStatus`. Lossy for mapped statuses (canonical label). */
export function statusToCaString(status: {
  value: 'forecasted' | 'open' | 'closed' | 'custom';
  customValue?: string | null;
}): string {
  if (status.value === 'custom') return status.customValue ?? '';
  return STATUS_REVERSE_MAP[status.value];
}

// =============================================================================
// Applicant-type mapping (native `acceptedApplicantTypes`)
// =============================================================================

/** Element type of the native `acceptedApplicantTypes` array. */
type ApplicantTypeInput = NonNullable<CaOpportunityInput['acceptedApplicantTypes']>[number];
type ApplicantTypeValue = ApplicantTypeInput['value'];

/**
 * CA applicant-type label → CommonGrants `ApplicantTypeOptionsEnum`, for the
 * confident matches only. CA's labels are coarser than the standard enum
 * (e.g. "Business" doesn't say small-vs-large; "Nonprofit" doesn't say 501c3;
 * "Public Agency" doesn't say which level of government), so anything not
 * listed here is emitted as `custom` with the original label preserved.
 */
const CA_APPLICANT_TYPE_MAP: Record<string, ApplicantTypeValue> = {
  individual: 'individual',
  'tribal government': 'government_tribal',
};

/** Reverse map for reconstructing CA labels from mapped enum values. */
const CA_APPLICANT_TYPE_REVERSE: Partial<Record<ApplicantTypeValue, string>> = {
  individual: 'Individual',
  government_tribal: 'Tribal Government',
};

/**
 * Map CA's `;`-delimited `ApplicantType` list onto the native
 * `acceptedApplicantTypes` field. Confident matches use the standard enum;
 * everything else becomes `custom` with the original label in `customValue`,
 * so no information is lost.
 */
export function mapApplicantTypes(raw: string | null): ApplicantTypeInput[] {
  return splitList(raw).map((label) => {
    const mapped = CA_APPLICANT_TYPE_MAP[label.toLowerCase()];
    return mapped
      ? { value: mapped, customValue: null, description: null }
      : { value: 'custom', customValue: label, description: null };
  });
}

/** Reverse of `mapApplicantTypes`: reconstruct CA's `;`-delimited string. */
function applicantTypesToCaString(types: unknown): string {
  if (!Array.isArray(types)) return '';
  return types
    .map((t) => {
      const v = (t ?? {}) as { value?: unknown; customValue?: unknown };
      if (v.value === 'custom') return typeof v.customValue === 'string' ? v.customValue : '';
      return CA_APPLICANT_TYPE_REVERSE[v.value as ApplicantTypeValue] ?? String(v.value ?? '');
    })
    .filter((s) => s.length > 0)
    .join('; ');
}

// =============================================================================
// Contact parsing
// =============================================================================

/**
 * Parse CA's structured `ContactInfo` string into a CG contact.
 *
 * Format: semicolon-delimited `key: value` pairs, e.g.
 *   `"name: Katie Harrell; email: katie.harrell@bof.ca.gov; tel: 1-916-…;"`
 *
 * Recognizes `name`, `email`, and `tel`/`phone` keys (case-insensitive); any
 * unrecognized pairs are preserved in `description` so nothing is lost.
 */
export function parseCaContact(raw: string | null): {
  name: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
} | null {
  const s = nullIfEmpty(raw);
  if (s === null) return null;

  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  const extra: string[] = [];

  for (const part of s.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) {
      extra.push(trimmed);
      continue;
    }
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const value = trimmed.slice(sep + 1).trim();
    if (!value) continue;
    if (key === 'name' && name === null) name = value;
    else if (key === 'email' && email === null) email = value;
    else if ((key === 'tel' || key === 'phone' || key === 'telephone') && phone === null)
      phone = value;
    else extra.push(`${key}: ${value}`);
  }

  if (name === null && email === null && phone === null && extra.length === 0) return null;
  return { name, email, phone, description: extra.length ? extra.join('; ') : null };
}

// =============================================================================
// Core transform: CaGrant → CaOpportunity (input shape)
// =============================================================================

/**
 * Convert a raw CA grant record into a CommonGrants `Opportunity` with CA
 * custom fields attached. Pure function — no I/O, no DB, no Workers types,
 * **no validation**.
 *
 * Returns the **input** shape (strings everywhere, no `Date` objects) so the
 * result serializes directly to JSON; the CG date schemas accept string input
 * and normalize to `Date` internally. Validation against the extended schema
 * is performed by the plugin's `toCommon` wrapper (see `./plugin`).
 *
 * `syncedAt` is the ISO timestamp of the current ETL run, stored in the
 * `caLastSyncedAt` custom field.
 */
export function caGrantToOpportunity(ca: CaGrant, syncedAt: string): CaOpportunityInput {
  const status = normalizeStatus(ca.Status);

  // Funding: parse the EstAmounts range + the EstAvailFunds total.
  const { min: minAward, max: maxAward } = parseAmountRange(nullIfEmpty(ca.EstAmounts));
  const totalAvailable = parseFinancial(nullIfEmpty(ca.EstAvailFunds));
  const hasFunding = minAward !== null || maxAward !== null || totalAvailable !== null;

  // Dates.
  const openDateSplit = splitCaDateTime(nullIfEmpty(ca.OpenDate));
  const closeDateSplit = splitCaDateTime(nullIfEmpty(ca.ApplicationDeadline));
  const expAwardDate = nullIfEmpty(ca.ExpAwardDate);
  const awardPeriod = nullIfEmpty(ca.AwardPeriod);

  const otherDates: Record<string, OtherDateInput> = {};
  if (expAwardDate) {
    // ExpAwardDate is free-form ("November 2026") → an `other` event with details.
    otherDates['expectedAwardDate'] = {
      name: 'Expected Award Date',
      eventType: 'other',
      details: expAwardDate,
    };
  }
  if (awardPeriod) {
    // AwardPeriod is free-form ("Expires 3/31/29") → an `other` event.
    otherDates['awardPeriod'] = {
      name: 'Award Period',
      eventType: 'other',
      details: awardPeriod,
    };
  }

  const hasKeyDates =
    openDateSplit !== null || closeDateSplit !== null || Object.keys(otherDates).length > 0;

  // Matching funds → the standard costSharing field (isRequired + percentage +
  // details). CA's free-text MatchingFundsNotes folds into costSharing.details.
  const matching = parseMatchingFunds(ca.MatchingFunds);
  const matchingNotes = nullIfEmpty(ca.MatchingFundsNotes);

  // Agency: CA exposes only a department name (no short code).
  const agencyName = nullIfEmpty(ca.AgencyDept);
  const agencyUrl = nullIfNotUrl(nullIfEmpty(ca.AgencyURL));

  // Contact.
  const contact = parseCaContact(ca.ContactInfo);

  // Applicant eligibility → native `acceptedApplicantTypes`.
  const acceptedApplicantTypes = mapApplicantTypes(nullIfEmpty(ca.ApplicantType));

  // Description: prefer the long Description, fall back to the short Purpose.
  const description =
    stripHtml(nullIfEmpty(ca.Description)) ?? stripHtml(nullIfEmpty(ca.Purpose)) ?? '';

  // ---- custom fields -----------------------------------------------------
  const customFields: Record<string, CustomFieldInput> = {};
  const putStr = (key: string, raw: string | null) => {
    const v = nullIfEmpty(raw);
    if (v !== null) customFields[key] = { name: key, fieldType: 'string', value: v };
  };

  // Always: the source key + sync timestamp.
  customFields['caPortalId'] = { name: 'caPortalId', fieldType: 'string', value: ca.PortalID };

  if (agencyName !== null) {
    customFields['agency'] = {
      name: 'agency',
      fieldType: 'object',
      value: { code: null, name: agencyName, parentName: null, parentCode: null },
    };
  }

  if (contact !== null) {
    customFields['contactInfo'] = { name: 'contactInfo', fieldType: 'object', value: contact };
  }

  if (agencyUrl !== null) {
    customFields['additionalInfo'] = {
      name: 'additionalInfo',
      fieldType: 'object',
      value: { url: agencyUrl, description: 'Issuing agency homepage' },
    };
  }

  if (matching !== null || matchingNotes !== null) {
    customFields['costSharing'] = {
      name: 'costSharing',
      fieldType: 'object',
      value: {
        isRequired: matching?.isRequired ?? null,
        percentage: matching?.percentage ?? null,
        details: matchingNotes,
      },
    };
  }

  putStr('caGrantId', ca.GrantID);
  putStr('fundingInstrument', ca.Type);

  const categories = splitList(nullIfEmpty(ca.Categories));
  if (categories.length > 0) {
    customFields['caCategories'] = { name: 'caCategories', fieldType: 'array', value: categories };
  }

  const loi = nullIfEmpty(ca.LOI);
  if (loi !== null && /^(yes|no)$/i.test(loi)) {
    customFields['caLoi'] = { name: 'caLoi', fieldType: 'boolean', value: /^yes$/i.test(loi) };
  }

  putStr('caApplicantTypeNotes', ca.ApplicantTypeNotes);
  putStr('caGeography', ca.Geography);
  putStr('fundingSource', ca.FundingSource);
  putStr('caFundingSourceNotes', ca.FundingSourceNotes);
  putStr('caFundingMethod', ca.FundingMethod);
  putStr('caFundingMethodNotes', ca.FundingMethodNotes);
  putStr('caEstAwards', ca.EstAwards);

  // Preserve the raw range string so a partial/failed numeric parse loses nothing.
  putStr('caEstAmountsRaw', ca.EstAmounts);
  // Preserve EstAvailFunds text only when it couldn't be parsed numerically.
  const rawAvail = nullIfEmpty(ca.EstAvailFunds);
  if (rawAvail !== null && totalAvailable === null) putStr('caRawEstAvailFunds', rawAvail);

  putStr('caAwardPeriod', ca.AwardPeriod);
  putStr('caExpAwardDate', ca.ExpAwardDate);
  putStr('caElecSubmission', ca.ElecSubmission);
  putStr('caAwardStats', ca.AwardStats);
  putStr('caCategorySuggestion', ca.CategorySuggestion);

  // ChangeNotes is often the placeholder "N/A" — drop those.
  const changeNotes = nullIfEmpty(ca.ChangeNotes);
  if (changeNotes !== null && changeNotes.toUpperCase() !== 'N/A') {
    putStr('caChangeNotes', changeNotes);
  }

  const subscribeUrl = nullIfNotUrl(nullIfEmpty(ca.AgencySubscribeURL));
  if (subscribeUrl !== null) putStr('caSubscribeUrl', subscribeUrl);
  const eventsUrl = nullIfNotUrl(nullIfEmpty(ca.GrantEventsURL));
  if (eventsUrl !== null) putStr('caGrantEventsUrl', eventsUrl);

  customFields['lastSyncedAt'] = {
    name: 'lastSyncedAt',
    fieldType: 'string',
    value: syncedAt,
  };

  // Source URL: CA's GrantURL is usually absolute but occasionally free-form.
  const source = nullIfNotUrl(nullIfEmpty(ca.GrantURL));

  const lastModifiedAt = caDateToIso(ca.LastUpdated);

  const opp: CaOpportunityInput = {
    id: portalIdToCgId(ca.PortalID),
    title: nullIfEmpty(ca.Title) ?? '',
    description,
    status: {
      value: status.value,
      customValue: status.customValue,
      description: null,
    },
    source,
    funding: hasFunding
      ? {
          details: null,
          totalAmountAvailable: totalAvailable,
          minAwardAmount: minAward,
          maxAwardAmount: maxAward,
          minAwardCount: null,
          maxAwardCount: null,
          estimatedAwardCount: null,
        }
      : null,
    keyDates: hasKeyDates
      ? {
          postDate: openDateSplit
            ? {
                name: 'Open Date',
                eventType: 'singleDate',
                date: openDateSplit.date,
                time: openDateSplit.time,
              }
            : null,
          closeDate: closeDateSplit
            ? {
                name: 'Application Deadline',
                eventType: 'singleDate',
                date: closeDateSplit.date,
                time: closeDateSplit.time,
              }
            : null,
          otherDates: Object.keys(otherDates).length > 0 ? otherDates : null,
        }
      : null,
    acceptedApplicantTypes: acceptedApplicantTypes.length > 0 ? acceptedApplicantTypes : null,
    customFields,
    createdAt: lastModifiedAt,
    lastModifiedAt,
  };

  return opp;
}

// =============================================================================
// Reverse transform: CaOpportunity → CaGrant (best-effort)
// =============================================================================

/** Read a custom-field value off a CG opportunity, or `undefined` if absent. */
function cfValue(opp: CaOpportunityInput, key: string): unknown {
  return opp.customFields?.[key]?.value;
}

/** Coerce a custom-field value to a non-empty string, else `""` (CA's empty shape). */
function cfString(opp: CaOpportunityInput, key: string): string {
  const v = cfValue(opp, key);
  return typeof v === 'string' ? v : '';
}

/** Join a custom-field string array back into CA's `;`-delimited form. */
function cfList(opp: CaOpportunityInput, key: string): string {
  const v = cfValue(opp, key);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('; ') : '';
}

/**
 * Reverse of `caGrantToOpportunity`: reconstruct a raw `CaGrant` from a CG
 * opportunity. Pure, no validation.
 *
 * **Best-effort and lossy by design.** Fields with no CommonGrants home are
 * preserved in `ca*` custom fields and round-trip faithfully; values folded
 * into shared fields are reconstructed canonically and may lose original
 * phrasing:
 *
 *   - `Purpose` (folded into `description` behind `Description`) → `""`
 *   - `Description` loses original HTML (only the stripped text survives)
 *   - a mapped `status` loses its original casing (canonical label returned)
 *   - `EstAmounts` is reconstructed from the preserved raw string, not the
 *     parsed numeric range
 *
 * These drops are asserted in the adapter test suite so the round-trip
 * contract stays explicit.
 */
export function caOpportunityToGrant(opp: CaOpportunityInput): CaGrant {
  const keyDates = opp.keyDates ?? null;

  const agency = cfValue(opp, 'agency') as { name?: unknown } | undefined;
  const additionalInfo = cfValue(opp, 'additionalInfo') as { url?: unknown } | undefined;
  const contact = cfValue(opp, 'contactInfo') as
    | { name?: unknown; email?: unknown; phone?: unknown; description?: unknown }
    | undefined;
  const costSharing = cfValue(opp, 'costSharing') as
    | { isRequired?: unknown; percentage?: unknown; details?: unknown }
    | undefined;
  const loi = cfValue(opp, 'caLoi');

  // Reassemble CA's structured ContactInfo string from the parsed contact.
  const contactInfo =
    contact != null
      ? [
          typeof contact.name === 'string' && contact.name ? `name: ${contact.name}` : null,
          typeof contact.email === 'string' && contact.email ? `email: ${contact.email}` : null,
          typeof contact.phone === 'string' && contact.phone ? `tel: ${contact.phone}` : null,
        ]
          .filter((p): p is string => p !== null)
          .map((p) => `${p};`)
          .join(' ')
      : '';

  const matchingFunds =
    typeof costSharing?.percentage === 'number'
      ? percentToCaPercent(costSharing.percentage)
      : costSharing?.isRequired === false
        ? 'Not Required'
        : '';

  return {
    PortalID: cfString(opp, 'caPortalId'),
    GrantID: cfString(opp, 'caGrantId'),
    Status: statusToCaString(opp.status),
    LastUpdated: isoToCaDate(opp.lastModifiedAt),
    ChangeNotes: cfString(opp, 'caChangeNotes'),
    AgencyDept: typeof agency?.name === 'string' ? agency.name : '',
    Title: opp.title,
    Type: cfString(opp, 'fundingInstrument'),
    LOI: typeof loi === 'boolean' ? (loi ? 'Yes' : 'No') : '',
    Categories: cfList(opp, 'caCategories'),
    CategorySuggestion: cfString(opp, 'caCategorySuggestion'),
    Purpose: '',
    Description: opp.description,
    ApplicantType: applicantTypesToCaString(opp.acceptedApplicantTypes),
    ApplicantTypeNotes: cfString(opp, 'caApplicantTypeNotes'),
    Geography: cfString(opp, 'caGeography'),
    FundingSource: cfString(opp, 'fundingSource'),
    FundingSourceNotes: cfString(opp, 'caFundingSourceNotes'),
    MatchingFunds: matchingFunds,
    MatchingFundsNotes: typeof costSharing?.details === 'string' ? costSharing.details : '',
    EstAvailFunds:
      moneyToCaString(opp.funding?.totalAmountAvailable) ?? cfString(opp, 'caRawEstAvailFunds'),
    EstAwards: cfString(opp, 'caEstAwards'),
    EstAmounts: cfString(opp, 'caEstAmountsRaw'),
    FundingMethod: cfString(opp, 'caFundingMethod'),
    FundingMethodNotes: cfString(opp, 'caFundingMethodNotes'),
    OpenDate: eventToCaDate(keyDates?.postDate),
    ApplicationDeadline: eventToCaDate(keyDates?.closeDate),
    AwardPeriod: cfString(opp, 'caAwardPeriod'),
    ExpAwardDate: cfString(opp, 'caExpAwardDate'),
    ElecSubmission: cfString(opp, 'caElecSubmission'),
    GrantURL: isoSource(opp.source) ?? '',
    AgencyURL: typeof additionalInfo?.url === 'string' ? additionalInfo.url : '',
    AgencySubscribeURL: cfString(opp, 'caSubscribeUrl'),
    GrantEventsURL: cfString(opp, 'caGrantEventsUrl'),
    ContactInfo: contactInfo,
    AwardStats: cfString(opp, 'caAwardStats'),
  };
}

/** Convert a CG `Money` value back to CA's plain dollar string, or null. */
function moneyToCaString(m: { amount?: unknown } | null | undefined): string | null {
  if (!m || typeof m.amount !== 'string') return null;
  const n = Number(m.amount);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : `$${m.amount}`;
}

/** A CG single-date event → CA's `"YYYY-MM-DD HH:MM:SS"` string (or `""`). */
function eventToCaDate(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const e = event as { eventType?: unknown; date?: unknown; time?: unknown };
  if (e.eventType !== 'singleDate') return '';
  const date = e.date instanceof Date ? e.date.toISOString().slice(0, 10) : e.date;
  if (typeof date !== 'string') return '';
  return typeof e.time === 'string' && e.time ? `${date} ${e.time}` : date;
}

/** Convert a CG ISO datetime back to CA's space-separated `"YYYY-MM-DD HH:MM:SS"`. */
function isoToCaDate(v: unknown): string {
  const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : '';
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
}

/** Coerce `source` (string | Date | null) to a string URL or null. */
function isoSource(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// =============================================================================
// Search-text helper — used by the SQL tier for FTS indexing
// =============================================================================

/** Concatenate searchable text fields into a single string for FTS indexing. */
export function buildSearchText(ca: CaGrant): string {
  const parts: string[] = [
    ca.Title,
    stripHtml(ca.Description) ?? '',
    stripHtml(ca.Purpose) ?? '',
    ca.AgencyDept,
    ca.Categories,
    ca.Type,
    ca.FundingSource,
  ];
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ');
}
