// The DCA loop.
//
// Per tick:
//   1. Local calendar precheck (cheap, no network).
//   2. HO halt-gate (signed receipt, fail-closed).
//   3. Jupiter /order quote for USDC → xStock.
//   4. Cost-bps cap check.
//   5. Sign + /execute.   (dry-run: stop here.)
//   6. Append to trade log.
//
// Errors at any step are recorded to the log; the loop continues. The agent
// does not retry within a tick — it waits for the next interval. This is
// deliberate: a halted market is a feature, not a bug to retry around.

import { Connection, Keypair } from '@solana/web3.js';
import { type Config } from './config.js';
import { localSession } from './calendar.js';
import { verifyMarketOpen, type GateDecision } from './halt-gate.js';
import { JupiterClient, signOrderTransaction, confirmSignature } from './jupiter.js';
import { passesCostCap } from './cost.js';
import { appendLogEntry, type LogEntry, type LogStatus } from './trade-log.js';
import { USDC_MINT } from './mints.js';

const USDC_DECIMALS = 6;

export interface AgentDeps {
  config: Config;
  wallet: Keypair;
  rpc: Connection;
  jupiter: JupiterClient;
  /** Override clock for tests. */
  now?: () => Date;
}

export async function runTick(deps: AgentDeps): Promise<LogEntry> {
  const { config, wallet, rpc, jupiter } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const ts = now.toISOString();
  const mic = config.oracle.mic;
  const symbol = config.dca.symbol.symbol;

  // 1. Cheap local precheck. The HO gate is the source of truth — this is
  // just a friendly early-exit on obvious nights/weekends.
  if (localSession(now) === 'WEEKEND') {
    return logged(config.tradeLogPath, {
      ts, symbol, status: 'SKIPPED_LOCAL', mic,
      reason: 'local calendar: weekend',
    });
  }

  // 2. Halt-gate.
  const decision = await verifyMarketOpen({
    mic,
    apiKey: config.oracle.apiKey,
    softMode: config.oracle.softMode,
  });

  if (!decision.allow) {
    return logged(config.tradeLogPath, {
      ts, symbol, status: 'BLOCKED_BY_GATE', mic,
      reason: `${decision.reason}: ${decision.detail}`,
    });
  }

  const receiptId = receiptIdOf(decision);
  const downgraded = decision.downgraded === true;

  // 3. Quote.
  const amountAtomic = humanToAtomic(config.dca.usdcPerBuy, USDC_DECIMALS);
  let order;
  try {
    order = await jupiter.order({
      inputMint: USDC_MINT,
      outputMint: config.dca.symbol.mint,
      amount: amountAtomic,
      taker: wallet.publicKey.toBase58(),
      slippageBps: config.slippageBps,
    });
  } catch (err) {
    return logged(config.tradeLogPath, {
      ts, symbol, status: 'ERRORED', mic,
      ho_receipt_id: receiptId, ho_downgraded: downgraded,
      reason: 'jupiter /order failed', error: String(err),
    });
  }

  // 4. Cost-bps cap. Refuse routes that bleed too much spread + fees, even
  // when slippage tolerance alone would let them through.
  const cap = passesCostCap(
    {
      priceImpactPct: order.priceImpactPct,
      platformFeeBps: order.platformFee?.feeBps,
    },
    config.maxCostBps,
  );
  if (!cap.ok) {
    return logged(config.tradeLogPath, {
      ts, symbol, status: 'BLOCKED_BY_COST', mic,
      ho_receipt_id: receiptId, ho_downgraded: downgraded,
      reason: `all-in cost ${cap.breakdown.totalBps} bps > cap ${cap.maxBps} bps`,
      cost_bps: cap.breakdown.totalBps,
      in_amount: order.inAmount, out_amount: order.outAmount,
      router: order.router,
    });
  }

  // 5. Dry-run stop point.
  if (config.dryRun) {
    return logged(config.tradeLogPath, {
      ts, symbol, status: 'DRY_RUN', mic,
      ho_receipt_id: receiptId, ho_downgraded: downgraded,
      in_amount: order.inAmount, out_amount: order.outAmount,
      router: order.router, cost_bps: cap.breakdown.totalBps,
    });
  }

  // 5b. Sign + execute.
  const signedB64 = signOrderTransaction(order.transaction, wallet);
  let executeResult;
  try {
    executeResult = await jupiter.execute(order.requestId, signedB64);
  } catch (err) {
    return logged(config.tradeLogPath, {
      ts, symbol, status: 'ERRORED', mic,
      ho_receipt_id: receiptId, ho_downgraded: downgraded,
      reason: 'jupiter /execute failed', error: String(err),
      in_amount: order.inAmount, out_amount: order.outAmount,
      router: order.router, cost_bps: cap.breakdown.totalBps,
    });
  }

  const sig = executeResult.signature;
  if (sig) {
    try {
      await confirmSignature(rpc, sig);
    } catch (err) {
      return logged(config.tradeLogPath, {
        ts, symbol, status: 'ERRORED', mic,
        ho_receipt_id: receiptId, ho_downgraded: downgraded,
        signature: sig,
        reason: 'tx submitted but confirmation timed out / failed',
        error: String(err),
        in_amount: order.inAmount, out_amount: order.outAmount,
        router: order.router, cost_bps: cap.breakdown.totalBps,
      });
    }
  }

  return logged(config.tradeLogPath, {
    ts, symbol, status: 'EXECUTED', mic,
    ho_receipt_id: receiptId, ho_downgraded: downgraded,
    signature: sig,
    in_amount: order.inAmount, out_amount: order.outAmount,
    router: order.router, cost_bps: cap.breakdown.totalBps,
  });
}

function logged(path: string, entry: LogEntry): LogEntry {
  appendLogEntry(path, entry);
  return entry;
}

function receiptIdOf(decision: Extract<GateDecision, { allow: true }>): string | undefined {
  if (!decision.downgraded) {
    const r = decision.receipt as Record<string, unknown>;
    // HO receipts publish a stable id under `id` or `receipt_id` depending
    // on endpoint version; fall back to public_key_id + issued_at if neither.
    if (typeof r.id === 'string') return r.id;
    if (typeof r.receipt_id === 'string') return r.receipt_id;
    return `${String(r.public_key_id)}@${String(r.issued_at)}`;
  }
  return undefined;
}

/** Convert a human-readable token amount to atomic units. */
function humanToAtomic(amount: number, decimals: number): string {
  if (amount <= 0 || !Number.isFinite(amount)) {
    throw new Error(`Invalid amount ${amount}`);
  }
  // Use string arithmetic to avoid float drift on common decimals (e.g. 6, 8).
  const [whole, frac = ''] = amount.toString().split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = (whole === '0' ? '' : whole) + padded;
  const trimmed = combined.replace(/^0+/, '') || '0';
  return trimmed;
}

export function _humanToAtomic(amount: number, decimals: number): string {
  return humanToAtomic(amount, decimals);
}

export async function runForever(deps: AgentDeps, abortSignal?: AbortSignal): Promise<void> {
  const intervalMs = deps.config.dca.intervalMinutes * 60_000;
  // First tick immediately, then on the interval. Aborts cleanly between ticks.
  while (true) {
    if (abortSignal?.aborted) return;
    try {
      const entry = await runTick(deps);
      logTickToStdout(entry);
    } catch (err) {
      // runTick is supposed to absorb its own errors into the log. Any
      // exception here is a bug — surface it but keep looping.
      console.error('[agent] unexpected tick error:', err);
    }
    await sleep(intervalMs, abortSignal);
  }
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    abortSignal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function logTickToStdout(entry: LogEntry): void {
  // One-line, JSON. The trade log is the structured record; stdout is for
  // operators tailing the process.
  process.stdout.write(JSON.stringify(entry) + '\n');
}

/** Re-exported for use as a status enum in CLI help text. */
export type { LogStatus };
