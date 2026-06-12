// One-shot live tick. Calls runTick exactly once and exits.
// Intentionally bypasses runForever — no interval, no scheduler, no second tick.
const { Connection } = require('@solana/web3.js');
const { loadConfig } = require('./dist/config.js');
const { loadWallet } = require('./dist/wallet.js');
const { JupiterClient } = require('./dist/jupiter.js');
const { runTick } = require('./dist/agent.js');

(async () => {
  const config = loadConfig();
  if (config.dryRun) {
    console.error('REFUSING: DRY_RUN is still true in .env. This script is for the live tick.');
    process.exit(2);
  }
  const wallet = loadWallet(config.walletPath);
  const rpc = new Connection(config.rpcUrl, 'confirmed');
  const jupiter = new JupiterClient();

  const banner = {
    event: 'start',
    mode: 'LIVE',
    symbol: config.dca.symbol.symbol,
    mint: config.dca.symbol.mint,
    usdc_per_buy: config.dca.usdcPerBuy,
    mic: config.oracle.mic,
    ho_endpoint: config.oracle.apiKey ? '/v5/status' : '/v5/demo',
    soft_mode: config.oracle.softMode,
    slippage_bps: config.slippageBps,
    max_cost_bps: config.maxCostBps,
    wallet: wallet.publicKey.toBase58(),
    rpc_host: new URL(config.rpcUrl).host,
    one_shot: true,
  };
  process.stdout.write(JSON.stringify(banner) + '\n');

  const entry = await runTick({ config, wallet, rpc, jupiter });
  process.stdout.write(JSON.stringify(entry) + '\n');
  // Explicit exit so any lingering RPC sockets do not keep the process alive.
  process.exit(entry.status === 'EXECUTED' ? 0 : 1);
})().catch((err) => {
  process.stderr.write(`fatal: ${err && err.stack || err}\n`);
  process.exit(1);
});
