import { v5 as uuidv5 } from 'uuid';
import type { WaOpportunityInput } from './plugin';
import type { WaGrant, WaTerm } from './waSource';

type CustomField = NonNullable<WaOpportunityInput['customFields']>[string];
type ApplicantType = NonNullable<WaOpportunityInput['acceptedApplicantTypes']>[number];
type OtherDate = NonNullable<NonNullable<WaOpportunityInput['keyDates']>['otherDates']>[string];
type Money = { amount: string; currency: 'USD' };

const WA_NAMESPACE = uuidv5('wa.fundhub.commongrants.api', uuidv5.DNS);

export function portalIdToCgId(sourceId: string): string {
  return uuidv5(sourceId, WA_NAMESPACE);
}

export function nullIfEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

export function nullIfNotUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
    const hasValidHostname = url.hostname
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    return isHttp && hasValidHostname ? value : null;
  } catch {
    return null;
  }
}

export function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const decoded = decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|li|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return decoded || null;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

export function parseFinancial(value: string | null): Money | null {
  if (!value) return null;
  const normalized = value.replace(/[$,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? { amount: amount.toFixed(2), currency: 'USD' } : null;
}

export function moneyToCents(value: { amount: string } | null | undefined): number | null {
  if (!value) return null;
  const dollars = Number(value.amount);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

export function waDate(value: string | null | undefined): string | null {
  const raw = nullIfEmpty(value);
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function gmtDateTime(value: string): string {
  return `${value.replace(/Z$/, '')}Z`;
}

export function normalizeStatus(raw: string): {
  value: 'open' | 'closed' | 'custom';
  customValue: string | null;
} {
  const status = raw.trim().toLowerCase();
  if (status === 'active') return { value: 'open', customValue: null };
  if (status === 'closed' || status === 'expired') {
    return { value: 'closed', customValue: status === 'expired' ? 'expired' : null };
  }
  return { value: 'custom', customValue: raw || null };
}

export function parseWaContact(raw: string | null): {
  name: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
} | null {
  const plain = stripHtml(raw);
  if (!plain) return null;
  const email = plain.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? null;
  const phone = plain.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)?.[0] ?? null;
  const namePart = plain
    .split(/,|\bemail\s*:|\bphone\s*:/i)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  return {
    name: namePart || null,
    email,
    phone,
    description: plain,
  };
}

const AUDIENCE_MAP: Record<string, ApplicantType['value']> = {
  businesses: 'organization',
  individuals: 'individual',
  'local government': 'government_municipal',
  nonprofits: 'non_profit_with_501c3',
  'state agencies': 'government_state',
  tribes: 'government_tribal',
};

function terms(grant: WaGrant): WaTerm[] {
  return grant._embedded?.['wp:term']?.flat() ?? [];
}

export function taxonomies(grant: WaGrant): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const term of terms(grant)) {
    (grouped[term.taxonomy] ??= []).push(decodeEntities(term.name));
  }
  return grouped;
}

export function mapApplicantTypes(grant: WaGrant): ApplicantType[] {
  const audiences = taxonomies(grant)['funding-audience'] ?? [];
  return audiences.map((label) => {
    const value = AUDIENCE_MAP[label.toLowerCase()];
    return value
      ? { value, customValue: null, description: null }
      : { value: 'custom', customValue: label, description: null };
  });
}

function putString(fields: Record<string, CustomField>, key: string, value: string | null): void {
  if (value !== null) fields[key] = { name: key, fieldType: 'string', value };
}

function singleDate(name: string, date: string, time: string | null = null): OtherDate {
  return { name, eventType: 'singleDate', date, time };
}

export function waGrantToOpportunity(grant: WaGrant, syncedAt: string): WaOpportunityInput {
  const acf = grant.acf;
  const status = normalizeStatus(acf.funding_status);
  const taxonomyValues = taxonomies(grant);
  const instrument = taxonomyValues['funding-type']?.join('; ') ?? null;
  const total = parseFinancial(nullIfEmpty(acf.total_amount));
  const min = parseFinancial(nullIfEmpty(acf.award_start));
  const max = parseFinancial(nullIfEmpty(acf.ending_amount));
  const estimatedCount = /^\d+$/.test(acf.number_of_awards.trim())
    ? Number(acf.number_of_awards)
    : null;

  const postDate = waDate(acf.fund_published_date);
  const closeDate = waDate(acf.application_close_date);
  const otherDates: Record<string, OtherDate> = {};
  const applicationOpen = waDate(acf.application_open_date ?? acf.open_date);
  const expiry = waDate(acf.expiry_date);
  const performanceStart = waDate(acf.period_of_performance_start);
  const performanceEnd = waDate(acf.period_of_performance_end);
  if (applicationOpen)
    otherDates.applicationOpen = singleDate('Application opens', applicationOpen);
  if (expiry) otherDates.expiry = singleDate('Opportunity expires', expiry);
  if (performanceStart && performanceEnd) {
    otherDates.periodOfPerformance = {
      name: 'Period of performance',
      eventType: 'dateRange',
      startDate: performanceStart,
      startTime: null,
      endDate: performanceEnd,
      endTime: null,
    };
  } else if (performanceStart) {
    otherDates.periodOfPerformanceStart = singleDate(
      'Period of performance starts',
      performanceStart,
    );
  } else if (performanceEnd) {
    otherDates.periodOfPerformanceEnd = singleDate('Period of performance ends', performanceEnd);
  }

  const customFields: Record<string, CustomField> = {};
  const sourceAgency = nullIfEmpty(acf.source);
  if (sourceAgency) {
    customFields.agency = {
      name: 'agency',
      fieldType: 'object',
      value: { code: null, name: sourceAgency, parentName: null, parentCode: null },
    };
  }
  const contact = parseWaContact(nullIfEmpty(acf.contact));
  if (contact) {
    customFields.contactInfo = { name: 'contactInfo', fieldType: 'object', value: contact };
  }
  const appLink = typeof acf.application_link === 'object' ? acf.application_link : null;
  const appUrl = nullIfNotUrl(nullIfEmpty(appLink?.url));
  if (appUrl) {
    customFields.additionalInfo = {
      name: 'additionalInfo',
      fieldType: 'object',
      value: { url: appUrl, description: nullIfEmpty(appLink?.title) ?? 'Application' },
    };
  }
  const costShare = nullIfEmpty(acf.cost_share);
  if (costShare) {
    putString(customFields, 'waCostShareRaw', costShare);
    customFields.costSharing = {
      name: 'costSharing',
      fieldType: 'object',
      value: {
        isRequired: /^yes$/i.test(costShare) ? true : /^no$/i.test(costShare) ? false : null,
        percentage: null,
        details: null,
      },
    };
  }

  putString(customFields, 'fundingSource', 'State');
  putString(customFields, 'fundingInstrument', instrument);
  putString(customFields, 'waWordPressId', String(grant.id));
  putString(customFields, 'waSlug', grant.slug);
  putString(customFields, 'waInternalReferenceId', nullIfEmpty(acf.internal_reference_id));
  putString(customFields, 'waExternalReferenceId', nullIfEmpty(acf.external_reference_id));
  customFields.waFeatured = {
    name: 'waFeatured',
    fieldType: 'boolean',
    value: acf.featured_funding,
  };
  const preApplication = nullIfEmpty(acf.pre_application);
  putString(customFields, 'waPreApplicationRaw', preApplication);
  if (preApplication && /^(yes|no)$/i.test(preApplication)) {
    customFields.waPreApplicationRequired = {
      name: 'waPreApplicationRequired',
      fieldType: 'boolean',
      value: /^yes$/i.test(preApplication),
    };
  }
  if (appLink) {
    putString(customFields, 'waApplicationLinkTitle', nullIfEmpty(appLink.title));
    putString(customFields, 'waApplicationLinkUrl', nullIfEmpty(appLink.url));
    putString(customFields, 'waApplicationLinkTarget', nullIfEmpty(appLink.target));
  } else {
    putString(
      customFields,
      'waApplicationLinkRaw',
      typeof acf.application_link === 'string' ? nullIfEmpty(acf.application_link) : null,
    );
  }
  putString(customFields, 'waEligibilityHtml', nullIfEmpty(acf.eligibility));
  putString(customFields, 'waRequirements', nullIfEmpty(acf.requirements));
  putString(customFields, 'waContactHtml', nullIfEmpty(acf.contact));
  putString(
    customFields,
    'waTechnicalAssistanceContact',
    nullIfEmpty(acf.technical_assistance_contact),
  );
  putString(customFields, 'waResourcesHtml', nullIfEmpty(acf.resources));
  if (Object.keys(taxonomyValues).length) {
    customFields.waTaxonomies = {
      name: 'waTaxonomies',
      fieldType: 'object',
      value: taxonomyValues,
    };
  }
  customFields.waScore = { name: 'waScore', fieldType: 'number', value: acf.score };
  putString(customFields, 'waScoreReason', nullIfEmpty(acf.score_reason));
  putString(customFields, 'waNumberOfAwardsRaw', nullIfEmpty(acf.number_of_awards));
  putString(customFields, 'waTotalAmountRaw', nullIfEmpty(acf.total_amount));
  putString(customFields, 'waMinAwardAmountRaw', nullIfEmpty(acf.award_start));
  putString(customFields, 'waMaxAwardAmountRaw', nullIfEmpty(acf.ending_amount));
  putString(customFields, 'waDisbursementNotes', nullIfEmpty(acf.disbursement_notes));
  putString(customFields, 'waApplicationCloseTime', nullIfEmpty(acf.application_close_time));
  if (/<[^>]+>/.test(acf.description)) {
    putString(customFields, 'waDescriptionHtml', nullIfEmpty(acf.description));
  }
  customFields.lastSyncedAt = {
    name: 'lastSyncedAt',
    fieldType: 'string',
    value: syncedAt,
  };

  const fundingDetails = [nullIfEmpty(acf.disbursement_notes), nullIfEmpty(acf.number_of_awards)]
    .filter(Boolean)
    .join(' — ');

  return {
    id: portalIdToCgId(String(grant.id)),
    title: stripHtml(grant.title.rendered) ?? grant.title.rendered,
    description: stripHtml(nullIfEmpty(acf.description)) ?? '',
    status: { ...status, description: null },
    source: nullIfNotUrl(grant.link),
    funding:
      total || min || max || estimatedCount !== null || fundingDetails
        ? {
            details: fundingDetails || null,
            totalAmountAvailable: total,
            minAwardAmount: min,
            maxAwardAmount: max,
            minAwardCount: null,
            maxAwardCount: null,
            estimatedAwardCount: estimatedCount,
          }
        : null,
    keyDates:
      postDate || closeDate || Object.keys(otherDates).length
        ? {
            postDate: postDate ? singleDate('Published', postDate) : null,
            closeDate: closeDate
              ? singleDate(
                  'Application closes',
                  closeDate,
                  normalizeTime(acf.application_close_time),
                )
              : null,
            otherDates: Object.keys(otherDates).length ? otherDates : null,
          }
        : null,
    acceptedApplicantTypes: mapApplicantTypes(grant),
    customFields,
    createdAt: gmtDateTime(grant.date_gmt),
    lastModifiedAt: gmtDateTime(grant.modified_gmt),
  };
}

function normalizeTime(value: string | null | undefined): string | null {
  const raw = nullIfEmpty(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]?.padStart(2, '0')}:${match[2]}:00` : null;
}

function cfValue(opp: WaOpportunityInput, key: string): unknown {
  return opp.customFields?.[key]?.value;
}

function cfString(opp: WaOpportunityInput, key: string): string {
  const value = cfValue(opp, key);
  return typeof value === 'string' ? value : '';
}

/**
 * Best-effort reverse mapping required by the SDK plugin contract. FundHubWA
 * is read-only, so this exists for validation and round-trip diagnostics, not
 * for writes to WordPress.
 */
export function waOpportunityToGrant(opp: WaOpportunityInput): WaGrant {
  const sourceId = Number(cfString(opp, 'waWordPressId')) || 0;
  const status =
    opp.status.value === 'open'
      ? 'active'
      : opp.status.customValue === 'expired'
        ? 'expired'
        : opp.status.value;
  const agency = cfValue(opp, 'agency') as { name?: unknown } | undefined;
  const additional = cfValue(opp, 'additionalInfo') as
    | { url?: unknown; description?: unknown }
    | undefined;
  const tax = cfValue(opp, 'waTaxonomies');
  const taxonomies = tax && typeof tax === 'object' ? (tax as Record<string, string[]>) : {};

  return {
    id: sourceId,
    date_gmt: isoWithoutZone(opp.createdAt),
    modified_gmt: isoWithoutZone(opp.lastModifiedAt),
    slug: cfString(opp, 'waSlug'),
    link: opp.source ?? '',
    title: { rendered: opp.title },
    acf: {
      funding_status: status,
      featured_funding: cfValue(opp, 'waFeatured') === true,
      internal_reference_id: cfString(opp, 'waInternalReferenceId'),
      external_reference_id: cfString(opp, 'waExternalReferenceId'),
      application_open_date: null,
      application_close_date: null,
      application_close_time: cfString(opp, 'waApplicationCloseTime'),
      expiry_date: null,
      period_of_performance_start: null,
      period_of_performance_end: null,
      fund_published_date: null,
      open_date: null,
      federal_or_state: 'state',
      source: typeof agency?.name === 'string' ? agency.name : '',
      total_amount: cfString(opp, 'waTotalAmountRaw'),
      number_of_awards: cfString(opp, 'waNumberOfAwardsRaw'),
      award_start: cfString(opp, 'waMinAwardAmountRaw'),
      ending_amount: cfString(opp, 'waMaxAwardAmountRaw'),
      disbursement_notes: cfString(opp, 'waDisbursementNotes'),
      cost_share: cfString(opp, 'waCostShareRaw'),
      description: cfString(opp, 'waDescriptionHtml') || opp.description,
      pre_application:
        cfString(opp, 'waPreApplicationRaw') ||
        (cfValue(opp, 'waPreApplicationRequired') === true ? 'yes' : 'no'),
      eligibility: cfString(opp, 'waEligibilityHtml'),
      requirements: cfString(opp, 'waRequirements'),
      application_link: cfString(opp, 'waApplicationLinkRaw')
        ? cfString(opp, 'waApplicationLinkRaw')
        : typeof additional?.url === 'string' || cfString(opp, 'waApplicationLinkUrl')
          ? {
              url:
                cfString(opp, 'waApplicationLinkUrl') ||
                (typeof additional?.url === 'string' ? additional.url : ''),
              title:
                cfString(opp, 'waApplicationLinkTitle') ||
                (typeof additional?.description === 'string'
                  ? additional.description
                  : 'Application'),
              target: cfString(opp, 'waApplicationLinkTarget'),
            }
          : '',
      contact: cfString(opp, 'waContactHtml'),
      technical_assistance_contact: cfString(opp, 'waTechnicalAssistanceContact'),
      resources: cfString(opp, 'waResourcesHtml'),
      score: typeof cfValue(opp, 'waScore') === 'number' ? (cfValue(opp, 'waScore') as number) : 0,
      score_reason: cfString(opp, 'waScoreReason'),
    },
    _embedded: {
      'wp:term': Object.entries(taxonomies).map(([taxonomy, names]) =>
        names.map((name, index) => ({
          id: index,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          taxonomy,
        })),
      ),
    },
  };
}

function isoWithoutZone(value: unknown): string {
  if (value instanceof Date) return value.toISOString().replace(/Z$/, '');
  return String(value ?? '').replace(/Z$/, '');
}

export function buildSearchText(grant: WaGrant): string {
  const acf = grant.acf;
  return [
    stripHtml(grant.title.rendered),
    stripHtml(acf.description),
    stripHtml(acf.eligibility),
    acf.requirements,
    acf.source,
    ...Object.values(taxonomies(grant)).flat(),
  ]
    .filter(Boolean)
    .join(' ');
}
