// Verified xStock SPL token mints on Solana mainnet.
//
// Source of truth: each mint cross-checked against multiple authoritative
// references (Solscan token pages, Solflare token directory, Phantom token
// pages, CoinMarketCap/CoinGecko listing pages) on 2026-06-08; re-verified
// on-chain on 2026-06-12 via the Token-2022 tokenMetadata extension (each
// embedded symbol matches the entry below; each metadata URI is hosted at
// xstocks-metadata.backed.fi). All mints carry Backed Finance's vanity "Xs"
// address prefix. Verify on-chain before trusting them in production — token
// registries can drift and rogue lookalikes exist.
//
// xStocks are issued by Backed Finance (Swiss-regulated) under a 1:1 share-
// backed model. Each token tracks a single US-listed underlying.
//
// USDC is the canonical Circle mint on Solana mainnet.

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface XStock {
  symbol: string;       // e.g. "TSLAx"
  underlying: string;   // e.g. "TSLA" — the US ticker the receipt should gate against
  mint: string;         // SPL mint address
  decimals: number;     // SPL decimals — xStocks publish 8 across the board
}

export const XSTOCKS: Record<string, XStock> = {
  TSLAx: {
    symbol: 'TSLAx',
    underlying: 'TSLA',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    decimals: 8,
  },
  NVDAx: {
    symbol: 'NVDAx',
    underlying: 'NVDA',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    decimals: 8,
  },
  AAPLx: {
    symbol: 'AAPLx',
    underlying: 'AAPL',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    decimals: 8,
  },
  SPYx: {
    symbol: 'SPYx',
    underlying: 'SPY',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    decimals: 8,
  },
  MSTRx: {
    symbol: 'MSTRx',
    underlying: 'MSTR',
    mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ',
    decimals: 8,
  },
  MSFTx: {
    symbol: 'MSFTx',
    underlying: 'MSFT',
    mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
    decimals: 8,
  },
};

export function resolveXStock(symbol: string): XStock {
  const x = XSTOCKS[symbol];
  if (!x) {
    throw new Error(
      `Unknown xStock symbol "${symbol}". Supported: ${Object.keys(XSTOCKS).join(', ')}.`,
    );
  }
  return x;
}
