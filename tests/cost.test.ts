import { describe, it, expect } from 'vitest';
import { allInCostBps, passesCostCap } from '../src/cost.js';

describe('allInCostBps', () => {
  it('treats missing impact as 0', () => {
    expect(allInCostBps({}).totalBps).toBe(0);
  });

  it('handles priceImpactPct as a decimal string', () => {
    // "0.0042" = 0.42% = 42 bps
    expect(allInCostBps({ priceImpactPct: '0.0042' }).priceImpactBps).toBe(42);
  });

  it('handles priceImpactPct as a number', () => {
    expect(allInCostBps({ priceImpactPct: 0.01 }).priceImpactBps).toBe(100);
  });

  it('rounds half-up at the bp boundary', () => {
    // 0.00425 -> 42.5 -> 43
    expect(allInCostBps({ priceImpactPct: '0.00425' }).priceImpactBps).toBe(43);
  });

  it('clamps negative or NaN impact to 0', () => {
    expect(allInCostBps({ priceImpactPct: '-0.01' }).priceImpactBps).toBe(0);
    expect(allInCostBps({ priceImpactPct: 'oops' }).priceImpactBps).toBe(0);
  });

  it('sums impact + platform + router fees', () => {
    const breakdown = allInCostBps({
      priceImpactPct: '0.001',     // 10 bps
      platformFeeBps: 25,
      routerFeeBps: 5,
    });
    expect(breakdown).toEqual({
      priceImpactBps: 10,
      platformFeeBps: 25,
      routerFeeBps: 5,
      totalBps: 40,
    });
  });
});

describe('passesCostCap', () => {
  it('accepts when total <= cap', () => {
    const res = passesCostCap({ priceImpactPct: '0.005' }, 60);   // 50 bps <= 60
    expect(res.ok).toBe(true);
  });

  it('accepts when total exactly equals cap', () => {
    const res = passesCostCap({ priceImpactPct: '0.005' }, 50);   // 50 == 50
    expect(res.ok).toBe(true);
  });

  it('rejects when total > cap and returns breakdown', () => {
    const res = passesCostCap({ priceImpactPct: '0.02' }, 100);   // 200 > 100
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.breakdown.totalBps).toBe(200);
      expect(res.maxBps).toBe(100);
    }
  });

  it('rejects when platform+impact combined exceeds the cap', () => {
    const res = passesCostCap(
      { priceImpactPct: '0.005', platformFeeBps: 30 },   // 50 + 30 = 80
      75,
    );
    expect(res.ok).toBe(false);
  });
});
