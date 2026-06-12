// All-in cost (in basis points) from a Jupiter quote.
//
// Jupiter's /order response gives us `inAmount`, `outAmount`, `priceImpactPct`
// (as a decimal string like "0.0042"), and optional platform/router fees
// folded into the output amount. This computes a single bps figure suitable
// for a cost cap, mirroring the `--max-bps` gate in rwa_cli.
//
// We approximate "all-in cost" as: priceImpact + explicit platform fee bps.
// The slippage budget is enforced separately by the swap itself (the tx will
// revert if outAmount falls below the minimum at execution time). Quoting a
// route whose impact alone blows the cap means we're paying that cost up
// front — no point signing.

export interface QuoteForCost {
  /** Jupiter quote's priceImpactPct as a decimal string ("0.0042" = 42 bps). */
  priceImpactPct?: string | number;
  /** Optional explicit platform fee, in bps. Jupiter reports under platformFee.feeBps. */
  platformFeeBps?: number;
  /**
   * Optional "router fee" component if a backend surfaces it separately.
   * Default 0 — leave it out unless you know your backend reports this field.
   */
  routerFeeBps?: number;
}

export interface CostBreakdown {
  priceImpactBps: number;
  platformFeeBps: number;
  routerFeeBps: number;
  totalBps: number;
}

/** Compute the all-in cost of a quote in basis points. Never throws. */
export function allInCostBps(q: QuoteForCost): CostBreakdown {
  const impactDecimal = parseImpact(q.priceImpactPct);
  const priceImpactBps = Math.max(0, Math.round(impactDecimal * 10_000));
  const platformFeeBps = nonNegInt(q.platformFeeBps ?? 0);
  const routerFeeBps = nonNegInt(q.routerFeeBps ?? 0);

  return {
    priceImpactBps,
    platformFeeBps,
    routerFeeBps,
    totalBps: priceImpactBps + platformFeeBps + routerFeeBps,
  };
}

/**
 * Decision wrapper for the cost cap.
 *
 *   allInCostBps(q).totalBps <= maxBps   →   { ok: true }
 *   otherwise                            →   { ok: false, breakdown, maxBps }
 *
 * Pure function — no I/O, easy to test.
 */
export function passesCostCap(
  q: QuoteForCost,
  maxBps: number,
):
  | { ok: true; breakdown: CostBreakdown }
  | { ok: false; breakdown: CostBreakdown; maxBps: number } {
  const breakdown = allInCostBps(q);
  if (breakdown.totalBps <= maxBps) return { ok: true, breakdown };
  return { ok: false, breakdown, maxBps };
}

function parseImpact(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function nonNegInt(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
