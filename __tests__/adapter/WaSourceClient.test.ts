import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaApiError, WaSourceClient } from '../../src/adapter';
import { federalFixture, waFixture } from './fixtures';

const BASE = 'https://fundhub.wa.gov/wp-json/wp/v2';

describe('WaSourceClient', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('gets a state record by WordPress id with embedded terms', async () => {
    mockWordPress(waFixture);
    const result = await new WaSourceClient(BASE, 'funding').getGrant('2080');
    expect(result?.id).toBe(2080);
    expect(fetchUrls().some((url) => url.includes('/funding/2080?'))).toBe(true);
    expect(fetchUrls().some((url) => url.includes('/funding-type?'))).toBe(true);
  });

  it('does not expose federal or non-numeric records', async () => {
    mockWordPress(federalFixture);
    const client = new WaSourceClient(BASE, 'funding');
    await expect(client.getGrant('2081')).resolves.toBeNull();
    await expect(client.getGrant('not-an-id')).resolves.toBeNull();
  });

  it('paginates and yields only state records', async () => {
    const headers = { 'x-wp-totalpages': '1' };
    mockWordPress([waFixture, federalFixture], headers);
    const records = [];
    for await (const grant of new WaSourceClient(BASE, 'funding').listAll()) records.push(grant);
    expect(records.map((grant) => grant.id)).toEqual([2080]);
  });

  it('passes the incremental watermark as modified_after', async () => {
    mockWordPress([waFixture], { 'x-wp-totalpages': '1' });
    const client = new WaSourceClient(BASE, 'funding');
    for await (const _grant of client.listAll({ since: '2026-07-28T20:34:40Z' })) {
      // consume
    }
    expect(
      fetchUrls().some((url) => url.includes('modified_after=2026-07-28T20%3A34%3A39.000Z')),
    ).toBe(true);
  });

  it('only treats WordPress out-of-range errors as the end of pagination', async () => {
    const fullPage = Array.from({ length: 100 }, (_, id) => ({ ...waFixture, id: id + 1 }));
    mockFundingPages([
      Response.json(fullPage),
      Response.json(
        { code: 'rest_post_invalid_page_number', message: 'The page number is too large.' },
        { status: 400 },
      ),
    ]);
    const records = [];
    for await (const grant of new WaSourceClient(BASE, 'funding').listAll()) records.push(grant);
    expect(records).toHaveLength(100);

    vi.mocked(fetch).mockReset();
    mockFundingPages([
      Response.json(fullPage),
      Response.json({ code: 'bad_request' }, { status: 400 }),
    ]);
    const iterator = new WaSourceClient(BASE, 'funding').listAll();
    for (let index = 0; index < 100; index += 1) await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(WaApiError);
  });

  it('returns null for 404 and throws typed errors otherwise', async () => {
    const client = new WaSourceClient(BASE, 'funding');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('missing', { status: 404 }));
    await expect(client.getGrant('9999')).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 503 }));
    await expect(client.getGrant('2080')).rejects.toBeInstanceOf(WaApiError);
  });
});

function fetchUrls(): string[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => String(url));
}

function mockWordPress(funding: unknown, headers: Record<string, string> = {}): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (/\/funding-(?:type|audience|sector|disbursement-method|activity|location)\?/.test(url)) {
      return Response.json([]);
    }
    return Response.json(funding, { headers });
  });
}

function mockFundingPages(pages: Response[]): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (/\/funding-(?:type|audience|sector|disbursement-method|activity|location)\?/.test(url)) {
      return Response.json([]);
    }
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    return pages[page - 1] ?? pages.at(-1)!;
  });
}
