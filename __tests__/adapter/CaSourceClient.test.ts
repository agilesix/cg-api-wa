import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CaApiError, CaSourceClient } from '../../src/adapter';
import { ca1Fixture } from './fixtures';

const ACTION = 'https://data.ca.gov/api/3/action';
const RESOURCE = '111c8c88-21f6-453c-ae2c-b4785a0624f5';

/** Build a CKAN `datastore_search` envelope Response. */
function ckan(records: unknown[], init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify({ success: true, result: { records } }), init);
}

describe('CaSourceClient', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  describe('getGrant', () => {
    it('fetches a single record by PortalID via a CKAN filter', async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValueOnce(ckan([ca1Fixture]));

      const client = new CaSourceClient(ACTION, RESOURCE);
      const result = await client.getGrant('ca-178419');

      expect(result?.PortalID).toBe('ca-178419');
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('/datastore_search');
      expect(url).toContain(`resource_id=${RESOURCE}`);
      // filters={"PortalID":"ca-178419"} URL-encoded
      expect(url).toContain(encodeURIComponent(JSON.stringify({ PortalID: 'ca-178419' })));
      expect(url).toContain('limit=1');
    });

    it('returns null when the filter matches no records', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(ckan([]));
      const client = new CaSourceClient(ACTION, RESOURCE);
      expect(await client.getGrant('missing')).toBeNull();
    });

    it('throws CaApiError on a non-2xx response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const client = new CaSourceClient(ACTION, RESOURCE);
      await expect(client.getGrant('ca-178419')).rejects.toBeInstanceOf(CaApiError);
    });

    it('throws CaApiError when the body reports success: false', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, result: { records: [] } }), { status: 200 }),
      );
      const client = new CaSourceClient(ACTION, RESOURCE);
      await expect(client.getGrant('ca-178419')).rejects.toBeInstanceOf(CaApiError);
    });

    it('normalizes trailing slashes on the base URL', async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValueOnce(ckan([ca1Fixture]));
      const client = new CaSourceClient(`${ACTION}///`, RESOURCE);
      await client.getGrant('ca-178419');
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url.startsWith(`${ACTION}/datastore_search`)).toBe(true);
    });
  });

  describe('listAll', () => {
    it('yields every record from a single (short) page', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        ckan([ca1Fixture, { ...ca1Fixture, PortalID: 'ca-2' }]),
      );

      const client = new CaSourceClient(ACTION, RESOURCE);
      const collected = [];
      for await (const g of client.listAll()) collected.push(g);

      expect(collected.map((g) => g.PortalID)).toEqual(['ca-178419', 'ca-2']);
      // sort=LastUpdated desc is requested
      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain(`sort=${encodeURIComponent('LastUpdated desc')}`);
    });

    it('early-stops at the `since` watermark (records are newest-first)', async () => {
      // Server returns newest-first; the watermark is the middle record.
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        ckan([
          { ...ca1Fixture, PortalID: 'newer', LastUpdated: '2026-06-22 17:23:55' },
          { ...ca1Fixture, PortalID: 'boundary', LastUpdated: '2026-06-20 10:00:00' },
          { ...ca1Fixture, PortalID: 'older', LastUpdated: '2026-06-01 08:00:00' },
        ]),
      );

      const client = new CaSourceClient(ACTION, RESOURCE);
      const collected = [];
      for await (const g of client.listAll({ since: '2026-06-20 10:00:00' })) collected.push(g);

      // `>=` boundary: 'newer' and 'boundary' are yielded; 'older' stops the scan.
      expect(collected.map((g) => g.PortalID)).toEqual(['newer', 'boundary']);
    });

    it('throws CaApiError on a non-2xx response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('boom', { status: 503 }));
      const client = new CaSourceClient(ACTION, RESOURCE);
      await expect(client.listAll().next()).rejects.toBeInstanceOf(CaApiError);
    });
  });
});
