// Centralized config loader. All env reads live here so the rest of the agent
// reads from a typed Config object, not process.env scattered through the code.

import 'dotenv/config';
import { resolveXStock, type XStock } from './mints.js';

export interface Config {
  walletPath: string;
  rpcUrl: string;
  dca: {
    symbol: XStock;
    usdcPerBuy: number;        // human-readable USDC (e.g. 10 = $10)
    intervalMinutes: number;
  };
  slippageBps: number;
  maxCostBps: number;
  oracle: {
    mic: string;
    apiKey?: string;
    softMode: boolean;
  };
  dryRun: boolean;
  tradeLogPath: string;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${key}. See .env.example.`);
  }
  return v.trim();
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Env ${key} must be an integer; got ${JSON.stringify(v)}.`);
  }
  return n;
}

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Env ${key} must be a non-negative number; got ${JSON.stringify(v)}.`);
  }
  return n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export function loadConfig(): Config {
  return {
    walletPath: requireEnv('WALLET_PATH'),
    rpcUrl: requireEnv('SOLANA_RPC_URL'),
    dca: {
      symbol: resolveXStock(requireEnv('DCA_SYMBOL')),
      usdcPerBuy: envNumber('DCA_USDC_PER_BUY', 0),
      intervalMinutes: envInt('DCA_INTERVAL_MINUTES', 30),
    },
    slippageBps: envInt('SLIPPAGE_BPS', 100),
    maxCostBps: envInt('MAX_COST_BPS', 150),
    oracle: {
      mic: process.env.HEADLESS_ORACLE_MIC?.trim() || 'XNYS',
      apiKey: process.env.HEADLESS_ORACLE_API_KEY?.trim() || undefined,
      softMode: envBool('HEADLESS_ORACLE_SOFT_MODE', false),
    },
    dryRun: envBool('DRY_RUN', false),
    tradeLogPath: process.env.TRADE_LOG_PATH?.trim() || './trade_log.jsonl',
  };
}
