import { describe, it, expect } from 'vitest';
import { XSTOCKS, USDC_MINT, resolveXStock } from '../src/mints.js';

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

describe('mints', () => {
  it('USDC mint matches Circle Solana mainnet', () => {
    expect(USDC_MINT).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('every xStock mint is a base58 Solana address', () => {
    for (const x of Object.values(XSTOCKS)) {
      expect(x.mint, `${x.symbol} mint shape`).toMatch(SOLANA_ADDR);
    }
  });

  it('every xStock mint carries the Backed "Xs" vanity prefix', () => {
    for (const x of Object.values(XSTOCKS)) {
      expect(x.mint.startsWith('Xs'), `${x.symbol} should start with "Xs"`).toBe(true);
    }
  });

  it('all mints are unique', () => {
    const mints = Object.values(XSTOCKS).map((x) => x.mint);
    expect(new Set(mints).size).toBe(mints.length);
  });

  it('resolveXStock returns the registered entry', () => {
    expect(resolveXStock('TSLAx').underlying).toBe('TSLA');
  });

  it('resolveXStock throws on unknown symbols (no silent fallthrough)', () => {
    expect(() => resolveXStock('DOGEx')).toThrow(/Unknown xStock symbol/);
  });
});
