// Thin Jupiter swap client. Two steps:
//
//   1. GET /order  → quote + a base64-encoded VersionedTransaction
//   2. POST /execute  → submit { requestId, signedTransaction }
//
// This is the "Swap V2" / Ultra-style path. We do NOT implement the older
// `/quote` + `/swap` two-step (rwa_cli has a fallback chain for that; for a
// reference agent the modern endpoint is enough). If `api.jup.ag/swap/v2`
// becomes unavailable, point JUPITER_BASE_URL at a different host.
//
// Out of scope on purpose (versus rwa_cli):
//   - CPI-aware simulation guard (sign-time check that the swap really debits
//     ≤ X of input and credits ≥ Y of output). The Jupiter /order response
//     already runs simulation server-side; for a small reference agent the
//     slippage + cost-cap pair is the minimum honest set of safeguards.
//   - Multi-backend fallback (Ultra → Swap V1). One endpoint, keep the code
//     simple. If it fails, the agent surfaces the error and moves to the next
//     tick.

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';

const DEFAULT_BASE = 'https://api.jup.ag';

export interface JupiterOrderRequest {
  inputMint: string;
  outputMint: string;
  /** Atomic units of inputMint (e.g. USDC has 6 decimals → $1 = "1000000"). */
  amount: string;
  /** The wallet that will sign. */
  taker: string;
  slippageBps: number;
}

export interface JupiterOrderResponse {
  requestId: string;
  transaction: string;          // base64 VersionedTransaction
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string;
  router?: string;
  platformFee?: { feeBps?: number };
}

export interface JupiterExecuteResponse {
  signature?: string;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

export interface JupiterClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class JupiterClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: JupiterClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async order(req: JupiterOrderRequest): Promise<JupiterOrderResponse> {
    const params = new URLSearchParams({
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      amount: req.amount,
      taker: req.taker,
      slippageBps: String(req.slippageBps),
    });
    const url = `${this.baseUrl}/swap/v2/order?${params.toString()}`;
    const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`Jupiter /order failed: HTTP ${res.status} — ${body}`);
    }
    return (await res.json()) as JupiterOrderResponse;
  }

  async execute(requestId: string, signedTxBase64: string): Promise<JupiterExecuteResponse> {
    const url = `${this.baseUrl}/swap/v2/execute`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ requestId, signedTransaction: signedTxBase64 }),
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`Jupiter /execute failed: HTTP ${res.status} — ${body}`);
    }
    return (await res.json()) as JupiterExecuteResponse;
  }
}

/**
 * Decode the base64 transaction, sign it with the wallet, return base64.
 * Pure local — no network I/O. Kept separate so callers can decide whether
 * to skip signing (dry-run).
 */
export function signOrderTransaction(b64: string, signer: Keypair): string {
  const txBytes = Buffer.from(b64, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([signer]);
  return Buffer.from(tx.serialize()).toString('base64');
}

/**
 * Wait for a tx signature to confirm. Best-effort: returns the confirmation
 * result if it lands inside `timeoutMs`, otherwise throws.
 */
export async function confirmSignature(
  rpc: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<void> {
  const latest = await rpc.getLatestBlockhash('confirmed');
  await rpc.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );
  // confirmTransaction throws on timeout/failure; if it returned we're done.
  void timeoutMs;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '(no body)';
  }
}
