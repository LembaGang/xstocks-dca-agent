// Halt-gate: the load-bearing line of this agent.
//
// xStocks are SPL tokens that trade 24/7 on Solana, but the underlying US
// equities have real market hours and real halts. An autonomous DCA loop with
// no awareness of the underlying session will happily fill TSLAx into a thin
// overnight book at a 10% premium/discount. The Headless Oracle attestation
// is the only credible source of underlying session state available to an
// on-chain consumer.
//
// What this gate catches:
//   - Weekends, after-hours, US market holidays (full-exchange CLOSED).
//   - Exchange-wide halts the oracle has observed (status = HALTED).
//   - Stale / unsigned / tampered receipts (verify() fails).
//
// What this gate does NOT catch:
//   - Single-name halts on an individual ticker (e.g. a TSLA LULD pause while
//     the rest of NYSE is open). HO's MIC-level attestation reports the
//     exchange status; it does not report per-symbol halts. An agent that DCAs
//     a single name through a single-name halt window will still fill. Treat
//     this as a known limitation; do not let comments or logs imply otherwise.
//
// Endpoint choice:
//   - With HEADLESS_ORACLE_API_KEY set → /v5/status (production path, your
//     plan's rate limits).
//   - Without a key → /v5/demo (keyless, public, identical signed-receipt shape).
//
// Failure policy (fail-closed by default):
//   - status !== "OPEN"               → BLOCK
//   - verify() returns valid:false    → BLOCK
//   - fetch / network error           → BLOCK (or PASS if softMode=true)
//   - receipt MIC ≠ requested MIC     → BLOCK
//
// Soft mode exists for development. Never enable it in production unattended;
// it converts a hard safety check into best-effort.

import { verify as defaultVerify } from '@headlessoracle/verify';

type VerifyFn = (
  receipt: Record<string, unknown>,
) => Promise<{ valid: boolean; reason?: string }>;

export type GateDecision =
  | { allow: true; downgraded: false; receipt: SignedReceipt }
  | { allow: true; downgraded: true; reason: 'NETWORK_ERROR'; detail: string }
  | { allow: false; reason: GateBlockReason; detail: string };

export type GateBlockReason =
  | 'NETWORK_ERROR'         // fetch threw or non-2xx (only in strict mode)
  | 'INVALID_SIGNATURE'     // verify() returned valid:false
  | 'MIC_MISMATCH'          // signed receipt's MIC ≠ requested MIC
  | 'NOT_OPEN'              // status is CLOSED / HALTED / PRE_OPEN / etc.
  | 'MALFORMED_RESPONSE';   // server returned junk

export interface SignedReceipt {
  // The HO endpoints decorate the signed bytes with metadata. The wrapper
  // looks like `{ receipt: {...}, discovery_url: "...", extensions: {...} }`.
  // Whether the wrapper is present or not, the signed fields are at the top
  // level; `extractReceipt` normalizes both shapes.
  mic: string;
  status: 'OPEN' | 'CLOSED' | 'HALTED' | string;
  issued_at: string;
  expires_at: string;
  signature: string;
  public_key_id: string;
  [key: string]: unknown;
}

export interface HaltGateOptions {
  mic: string;
  apiKey?: string;
  softMode?: boolean;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Override for tests. */
  baseUrl?: string;
  /** Override for tests — defaults to @headlessoracle/verify's `verify`. */
  verifyImpl?: VerifyFn;
}

const DEFAULT_BASE_URL = 'https://headlessoracle.com';

/** Pick the endpoint path based on whether a key is present. */
export function chooseEndpoint(apiKey: string | undefined, mic: string): string {
  const path = apiKey ? '/v5/status' : '/v5/demo';
  return `${path}?mic=${encodeURIComponent(mic)}`;
}

/** Pull the signed receipt out of either the wrapped or bare response shape. */
export function extractReceipt(body: unknown): SignedReceipt | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  // Wrapped shape: { receipt: {...}, discovery_url, ... }
  if (obj.receipt && typeof obj.receipt === 'object') {
    return obj.receipt as SignedReceipt;
  }
  // Bare shape: the signed fields are at the top level.
  if (
    typeof obj.signature === 'string' &&
    typeof obj.public_key_id === 'string' &&
    typeof obj.expires_at === 'string' &&
    typeof obj.issued_at === 'string'
  ) {
    return obj as SignedReceipt;
  }
  return null;
}

/**
 * Verify the underlying market is OPEN per signed receipt.
 * Fail-closed unless softMode is on AND the failure is a network error.
 */
export async function verifyMarketOpen(opts: HaltGateOptions): Promise<GateDecision> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const url = baseUrl + chooseEndpoint(opts.apiKey, opts.mic);

  let body: unknown;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.apiKey) headers['X-Oracle-Key'] = opts.apiKey;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      return decideOnNetworkFailure(opts, `HTTP ${res.status} from ${url}`);
    }
    body = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return decideOnNetworkFailure(opts, `fetch failed: ${msg}`);
  }

  const receipt = extractReceipt(body);
  if (!receipt) {
    // Malformed responses are never soft-passed — we have nothing to verify.
    return { allow: false, reason: 'MALFORMED_RESPONSE', detail: 'no signed receipt in response body' };
  }

  const verifyFn = opts.verifyImpl ?? (defaultVerify as VerifyFn);
  const v = await verifyFn(receipt as unknown as Record<string, unknown>);
  if (!v.valid) {
    return {
      allow: false,
      reason: 'INVALID_SIGNATURE',
      detail: `verify() reason=${v.reason ?? 'unknown'}`,
    };
  }

  if (typeof receipt.mic === 'string' && receipt.mic !== opts.mic) {
    return {
      allow: false,
      reason: 'MIC_MISMATCH',
      detail: `requested ${opts.mic}, receipt is for ${receipt.mic}`,
    };
  }

  if (receipt.status !== 'OPEN') {
    return {
      allow: false,
      reason: 'NOT_OPEN',
      detail: `status=${receipt.status}`,
    };
  }

  return { allow: true, downgraded: false, receipt };
}

function decideOnNetworkFailure(opts: HaltGateOptions, detail: string): GateDecision {
  // Soft mode forgives transport errors but never signed-rejection states.
  // Mirrors rwa_cli: a missing oracle is treatable as best-effort during
  // dev / outage; a signed CLOSED or HALTED is non-negotiable. The
  // downgraded=true flag is propagated into the trade log so the receipt-id
  // column is honestly empty for soft-passed ticks.
  if (opts.softMode) {
    return { allow: true, downgraded: true, reason: 'NETWORK_ERROR', detail };
  }
  return { allow: false, reason: 'NETWORK_ERROR', detail };
}
