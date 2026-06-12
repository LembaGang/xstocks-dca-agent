// CLI entry point. Reads .env, loads wallet, opens an RPC connection, runs
// the DCA loop until SIGINT/SIGTERM. There is intentionally no subcommand
// surface — this is a reference agent, not a CLI suite.

import { Connection } from '@solana/web3.js';
import { loadConfig } from './config.js';
import { loadWallet } from './wallet.js';
import { JupiterClient } from './jupiter.js';
import { runForever } from './agent.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const wallet = loadWallet(config.walletPath);
  const rpc = new Connection(config.rpcUrl, 'confirmed');
  const jupiter = new JupiterClient();

  const banner = {
    mode: config.dryRun ? 'DRY_RUN' : 'LIVE',
    symbol: config.dca.symbol.symbol,
    underlying: config.dca.symbol.underlying,
    mint: config.dca.symbol.mint,
    usdc_per_buy: config.dca.usdcPerBuy,
    interval_min: config.dca.intervalMinutes,
    mic: config.oracle.mic,
    ho_endpoint: config.oracle.apiKey ? '/v5/status' : '/v5/demo',
    soft_mode: config.oracle.softMode,
    max_cost_bps: config.maxCostBps,
    slippage_bps: config.slippageBps,
    wallet: wallet.publicKey.toBase58(),
    trade_log: config.tradeLogPath,
  };
  process.stdout.write(JSON.stringify({ event: 'start', ...banner }) + '\n');

  const abort = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      process.stdout.write(JSON.stringify({ event: 'stop', signal: sig }) + '\n');
      abort.abort();
    });
  }

  await runForever({ config, wallet, rpc, jupiter }, abort.signal);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
