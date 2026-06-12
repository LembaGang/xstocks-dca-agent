// Halt-gate behavior matrix. Tests are hermetic: fetch + verify are both
// injected, so we never touch the network and never depend on a live HO key.

import { describe, it, expect } from 'vitest';
import {
  verifyMarketOpen,
  chooseEndpoint,
  extractReceipt,
  type SignedReceipt,
} from '../src/halt-gate.js';

const openReceipt: SignedReceipt = {
  mic: 'XNYS',
  status: 'OPEN',
  issued_at: '2026-06-08T15:00:00Z',
  expires_at: '2026-06-08T15:01:00Z',
  signature: 'aa'.repeat(64),
  public_key_id: 'key_2026_v1',
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const ok = async () => ({ valid: true } as const);
const bad = async () => ({ valid: false, reason: 'INVALID_SIGNATURE' as const });

describe('chooseEndpoint', () => {
  it('uses /v5/demo when no key', () => {
    expect(chooseEndpoint(undefined, 'XNYS')).toBe('/v5/demo?mic=XNYS');
  });
  it('uses /v5/status when key is provided', () => {
    expect(chooseEndpoint('ho_live_abc', 'XNAS')).toBe('/v5/status?mic=XNAS');
  });
  it('URL-encodes the MIC', () => {
    expect(chooseEndpoint(undefined, 'X NYS')).toBe('/v5/demo?mic=X%20NYS');
  });
});

describe('extractReceipt', () => {
  it('returns the bare receipt when fields are at top level', () => {
    expect(extractReceipt(openReceipt)).toEqual(openReceipt);
  });
  it('unwraps the { receipt: {...} } shape', () => {
    expect(extractReceipt({ receipt: openReceipt, discovery_url: 'x' })).toEqual(openReceipt);
  });
  it('returns null on junk', () => {
    expect(extractReceipt(null)).toBeNull();
    expect(extractReceipt('hi')).toBeNull();
    expect(extractReceipt({ mic: 'XNYS' })).toBeNull();
  });
});

describe('verifyMarketOpen — strict mode (default)', () => {
  it('returns allow=true when receipt is OPEN, MIC matches, signature valid', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch(openReceipt),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(true);
    if (result.allow) expect(result.downgraded).toBe(false);
  });

  it('blocks when status is CLOSED', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch({ ...openReceipt, status: 'CLOSED' }),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NOT_OPEN');
  });

  it('blocks when status is HALTED', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch({ ...openReceipt, status: 'HALTED' }),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NOT_OPEN');
  });

  it('blocks on unknown / non-OPEN status (PRE_OPEN, AFTER_HOURS, etc.)', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch({ ...openReceipt, status: 'PRE_OPEN' }),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NOT_OPEN');
  });

  it('blocks on signature failure even when status is OPEN', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch(openReceipt),
      verifyImpl: bad,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('INVALID_SIGNATURE');
  });

  it('blocks on MIC mismatch — receipt for XNAS while we asked for XNYS', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch({ ...openReceipt, mic: 'XNAS' }),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('MIC_MISMATCH');
  });

  it('blocks on malformed body (no signed receipt anywhere)', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch({ status: 'OPEN', mic: 'XNYS' }), // missing signature/public_key_id
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('MALFORMED_RESPONSE');
  });

  it('blocks on HTTP error', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: fakeFetch({ error: 'rate_limited' }, 429),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NETWORK_ERROR');
  });

  it('blocks on fetch throwing (network unreachable)', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch,
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NETWORK_ERROR');
  });
});

describe('verifyMarketOpen — soft mode', () => {
  it('passes through network errors with downgraded=true', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      softMode: true,
      fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch,
      verifyImpl: ok,
    });
    expect(result.allow).toBe(true);
    if (result.allow) expect(result.downgraded).toBe(true);
  });

  it('passes through HTTP errors with downgraded=true', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      softMode: true,
      fetchImpl: fakeFetch({ error: 'down' }, 503),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(true);
    if (result.allow) expect(result.downgraded).toBe(true);
  });

  it('still BLOCKS on signed CLOSED (soft mode never forgives signed rejection)', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      softMode: true,
      fetchImpl: fakeFetch({ ...openReceipt, status: 'CLOSED' }),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NOT_OPEN');
  });

  it('still BLOCKS on signed HALTED', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      softMode: true,
      fetchImpl: fakeFetch({ ...openReceipt, status: 'HALTED' }),
      verifyImpl: ok,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('NOT_OPEN');
  });

  it('still BLOCKS on bad signature', async () => {
    const result = await verifyMarketOpen({
      mic: 'XNYS',
      softMode: true,
      fetchImpl: fakeFetch(openReceipt),
      verifyImpl: bad,
    });
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.reason).toBe('INVALID_SIGNATURE');
  });
});

describe('verifyMarketOpen — endpoint selection', () => {
  it('sends X-Oracle-Key header when apiKey is provided', async () => {
    let capturedHeaders: Headers | undefined;
    const captured: typeof fetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify(openReceipt), { status: 200 });
    }) as unknown as typeof fetch;

    await verifyMarketOpen({
      mic: 'XNYS',
      apiKey: 'ho_live_abcd',
      fetchImpl: captured,
      verifyImpl: ok,
    });

    expect(capturedHeaders?.get('X-Oracle-Key')).toBe('ho_live_abcd');
  });

  it('does NOT send X-Oracle-Key when apiKey is omitted (demo path)', async () => {
    let capturedHeaders: Headers | undefined;
    const captured: typeof fetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify(openReceipt), { status: 200 });
    }) as unknown as typeof fetch;

    await verifyMarketOpen({
      mic: 'XNYS',
      fetchImpl: captured,
      verifyImpl: ok,
    });

    expect(capturedHeaders?.get('X-Oracle-Key')).toBeNull();
  });

  it('hits the URL constructed by chooseEndpoint', async () => {
    let capturedUrl = '';
    const captured: typeof fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify(openReceipt), { status: 200 });
    }) as unknown as typeof fetch;

    await verifyMarketOpen({
      mic: 'XNYS',
      apiKey: 'ho_live_xyz',
      baseUrl: 'https://headlessoracle.test',
      fetchImpl: captured,
      verifyImpl: ok,
    });

    expect(capturedUrl).toBe('https://headlessoracle.test/v5/status?mic=XNYS');
  });
});
