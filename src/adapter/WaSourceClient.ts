import type { ISourceClient } from '../core';
import {
  WaGrantSchema,
  WaTermSchema,
  WordPressFundingPageSchema,
  type WaGrant,
  type WaTerm,
} from './waSource';

export class WaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`FundHubWA API returned ${status}: ${body.slice(0, 200)}`);
    this.name = 'WaApiError';
  }
}

const PAGE_SIZE = 100;
const TAXONOMIES = [
  'funding-type',
  'funding-audience',
  'funding-sector',
  'funding-disbursement-method',
  'funding-activity',
  'funding-location',
] as const;
type Taxonomy = (typeof TAXONOMIES)[number];

const FIELDS = [
  'id',
  'date_gmt',
  'modified_gmt',
  'slug',
  'link',
  'title',
  'acf',
  'funding-type',
  'funding-audience',
  'funding-sector',
  'funding-disbursement-method',
  'funding-activity',
  'funding-location',
].join(',');

/**
 * Public WordPress REST client for FundHubWA. Only state records are yielded;
 * federal records are already available through the federal CommonGrants
 * implementation and would otherwise be duplicated.
 */
export class WaSourceClient implements ISourceClient<WaGrant> {
  private readonly collectionUrl: string;
  private readonly baseUrl: string;
  private termLookupPromise?: Promise<Map<number, WaTerm>>;

  constructor(baseUrl: string, resourceId: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.collectionUrl = `${this.baseUrl}/${resourceId}`;
  }

  async getGrant(sourceId: string): Promise<WaGrant | null> {
    if (!/^\d+$/.test(sourceId)) return null;
    const response = await fetch(`${this.collectionUrl}/${sourceId}?${this.commonParams()}`, {
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new WaApiError(response.status, await response.text());
    const grant = await this.withTerms(WaGrantSchema.parse(await response.json()));
    return isWashingtonStateGrant(grant) ? grant : null;
  }

  async *listAll(opts: { since?: string | null } = {}): AsyncGenerator<WaGrant> {
    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        page: String(page),
        orderby: 'modified',
        order: 'desc',
        _fields: FIELDS,
      });
      if (opts.since) params.set('modified_after', toWordPressAfter(opts.since));

      const response = await fetch(`${this.collectionUrl}?${params}`, {
        headers: { accept: 'application/json' },
      });
      // WordPress reports an out-of-range page as 400. We normally stop from
      // X-WP-TotalPages first, but this makes pagination resilient to churn.
      if (response.status === 400 && page > 1) {
        const body = await response.text();
        if (isOutOfRangePage(body)) return;
        throw new WaApiError(response.status, body);
      }
      if (!response.ok) throw new WaApiError(response.status, await response.text());

      const records = WordPressFundingPageSchema.parse(await response.json());
      for (const record of records) {
        const grant = await this.withTerms(record);
        if (isWashingtonStateGrant(grant)) yield grant;
      }

      const totalPages = Number(response.headers.get('x-wp-totalpages'));
      if (
        records.length < PAGE_SIZE ||
        (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages)
      ) {
        return;
      }
    }
  }

  private commonParams(): string {
    return new URLSearchParams({ _fields: FIELDS }).toString();
  }

  private async withTerms(grant: WaGrant): Promise<WaGrant> {
    const lookup = await this.termLookup();
    return {
      ...grant,
      _embedded: {
        'wp:term': TAXONOMIES.map((taxonomy) =>
          (grant[taxonomy] ?? []).flatMap((id) => {
            const term = lookup.get(id);
            return term ? [term] : [];
          }),
        ),
      },
    };
  }

  /**
   * Resolve taxonomy ids once per client. This avoids `_embed=wp:term`, which
   * repeats roughly 70 KB of Yoast metadata on a typical post.
   */
  private termLookup(): Promise<Map<number, WaTerm>> {
    this.termLookupPromise ??= Promise.all(
      TAXONOMIES.map(async (taxonomy) => {
        const params = new URLSearchParams({
          per_page: '100',
          _fields: 'id,name,slug,taxonomy',
        });
        const response = await fetch(`${this.baseUrl}/${taxonomy}?${params}`, {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new WaApiError(response.status, await response.text());
        return zodTerms(await response.json(), taxonomy);
      }),
    ).then((groups) => new Map(groups.flat().map((term) => [term.id, term] as const)));
    return this.termLookupPromise;
  }
}

export function isWashingtonStateGrant(grant: WaGrant): boolean {
  return grant.acf.federal_or_state.trim().toLowerCase() === 'state';
}

function toWordPressAfter(value: string): string {
  const iso = value.endsWith('Z') ? value : `${value}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return value;
  // WordPress `modified_after` is exclusive and FundHub timestamps have
  // one-second precision. Re-read the previous second so records sharing the
  // watermark second cannot be missed; content hashes make the overlap cheap.
  date.setUTCSeconds(date.getUTCSeconds() - 1);
  return date.toISOString();
}

function zodTerms(value: unknown, taxonomy: Taxonomy): WaTerm[] {
  const terms = Array.isArray(value) ? value : [];
  return terms.map((term) => WaTermSchema.parse({ ...(term as object), taxonomy }));
}

function isOutOfRangePage(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return parsed.code === 'rest_post_invalid_page_number';
  } catch {
    return false;
  }
}
