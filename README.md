# xstocks-dca-agent

A small, **reference** TypeScript agent that DCAs into Kraken/Backed xStocks on
Solana via Jupiter — **only when the underlying US market is verifiably open**,
per a [Headless Oracle](https://headlessoracle.com) Ed25519-signed market-state
receipt.

This is a teaching artifact. It is intentionally small, intentionally
opinionated, and intentionally honest about what it does and does not protect
you from. Read the limitations section before running it with real funds.

---

## Why this exists

xStocks (TSLAx, NVDAx, AAPLx, SPYx, MSTRx, MSFTx, …) are SPL tokens on Solana,
backed 1:1 by real US equity shares held in regulated Swiss custody. The
on-chain side trades 24/7. The underlying equity does not — NYSE/Nasdaq have
real sessions, real holidays, and real halts.

An autonomous DCA loop with no awareness of the underlying session will happily
fill TSLAx into a thin overnight book during a TSLA halt at a 10% discount,
because nothing on Solana knows that the real TSLA is paused.

The Headless Oracle gate is the only credible source of underlying session
state available to an on-chain consumer. This agent verifies a signed receipt
before every swap and refuses if the market is not OPEN.

---

## What the halt-gate catches

✅ **Weekends and overnights** — `status: "CLOSED"` outside session hours.
✅ **US market holidays** — Christmas, July 4th, Thanksgiving, … all surface as `CLOSED`.
✅ **Exchange-wide halts** — `status: "HALTED"` when HO has observed an exchange halt.
✅ **Stale, unsigned, or tampered receipts** — the Ed25519 signature is verified locally.
✅ **MIC mismatch** — the receipt's MIC must match the one we asked for.

## What the halt-gate does NOT catch

❌ **Single-name halts on an individual ticker.** HO's attestation is
   **exchange-level** (MIC: XNYS, XNAS, etc.). If TSLA is in a LULD pause but
   the rest of NYSE is open, the receipt is still `OPEN` and this agent will
   still execute a TSLAx buy. **An exchange-level gate is not equivalent to a
   per-symbol halt gate.** If you trade single names, treat that as a known
   gap; do not assume the gate protects you.

❌ **Off-chain hedging risk.** The fact that the underlying market is open does
   not guarantee the xStock pool will execute at fair value. AMM/RFQ
   liquidity providers can still quote wide or refuse. The cost-bps cap
   (`MAX_COST_BPS`) is the only protection against that — set it carefully.

❌ **Smart-contract / custody risk.** xStocks are 1:1 backed by shares in
   custody at Backed Finance under Swiss regulation. This agent does not
   evaluate that custody risk; that's an issuer-level concern.

❌ **Slippage between sign and execute.** The agent enforces a slippage budget
   via `SLIPPAGE_BPS` and the on-chain swap will revert if the floor is
   breached. It does not implement sign-time CPI simulation (the `rwa_cli`
   Rust agent does — out of scope here).

---

## The loop (per tick)

```
1. Local calendar precheck                  — cheap, no network. Skip if it's
                                              obviously a weekend.
2. HO halt-gate                             — GET /v5/demo or /v5/status, then
   ↳ verify signature locally                  verify() locally. Fail-closed.
   ↳ check MIC matches
   ↳ check status === "OPEN"
3. Jupiter /order USDC → xStock             — quote with SLIPPAGE_BPS budget.
4. Cost-bps cap check                       — refuse routes whose
                                              priceImpact + fees exceed
                                              MAX_COST_BPS.
5. Sign + Jupiter /execute                  — VersionedTransaction signed by
                                              the configured wallet.
6. Confirm on-chain                         — wait for `confirmed` commitment.
7. Append to trade_log.jsonl                — one line per tick, executed or
                                              not, with HO receipt id.
```

Any step's failure is recorded in the trade log and the loop sleeps until the
next interval. **There is no retry within a tick.** A halted market is not
something to retry around.

---

## Setup

Requires Node ≥ 20.

```bash
cp .env.example .env
# Edit .env — at minimum:
#   - WALLET_PATH:    path to a Solana keypair JSON (Solana CLI / Phantom export shape)
#   - SOLANA_RPC_URL: a real RPC provider (Helius/QuickNode/Triton); the public
#                     endpoint is heavily rate-limited
#   - DCA_SYMBOL, DCA_USDC_PER_BUY, DCA_INTERVAL_MINUTES

npm install
npm run build
npm test                          # 45 unit tests, all hermetic
npm start                         # runs the loop
```

Or for development without a build step:

```bash
npm run dev
```

Stop with Ctrl-C — both SIGINT and SIGTERM trigger a clean shutdown between
ticks.

### Dry-run first

Set `DRY_RUN=true` for the first few ticks. The agent will run the full
quote + gate + cap pipeline, log a `DRY_RUN` status, and skip the sign /
`/execute` / confirm steps. **Do this with real env, real wallet pubkey, real
RPC.** The signed-receipt verification is exercised in dry-run mode too.

---

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `WALLET_PATH` | required | JSON array of 64 bytes — Solana CLI keypair format |
| `SOLANA_RPC_URL` | required | Don't use the public mainnet endpoint for a real loop |
| `DCA_SYMBOL` | required | One of `TSLAx`, `NVDAx`, `AAPLx`, `SPYx`, `MSTRx`, `MSFTx` |
| `DCA_USDC_PER_BUY` | required | Human-readable USDC (e.g. `10` = $10) |
| `DCA_INTERVAL_MINUTES` | `30` | Cadence between ticks |
| `SLIPPAGE_BPS` | `100` | 100 bps = 1% |
| `MAX_COST_BPS` | `150` | All-in cost cap (impact + fees) |
| `HEADLESS_ORACLE_MIC` | `XNYS` | NYSE; use `XNAS` for Nasdaq-listed underlyings |
| `HEADLESS_ORACLE_API_KEY` | — | When set: `/v5/status`. When unset: `/v5/demo` (keyless, rate-limited, identical receipt shape) |
| `HEADLESS_ORACLE_SOFT_MODE` | `false` | If `true`, network errors PASS with `downgraded: true` in the log. Never use unattended in production |
| `DRY_RUN` | `false` | If `true`, skip sign + execute |
| `TRADE_LOG_PATH` | `./trade_log.jsonl` | Append-only |

---

## Trade log

One JSONL line per tick. The status enum:

| Status | Meaning |
|--------|---------|
| `EXECUTED` | Swap signed, submitted, and confirmed. `signature` present. |
| `DRY_RUN` | Quote + gate + cap passed, no signing attempted. |
| `SKIPPED_LOCAL` | Local calendar precheck declined (e.g. weekend). |
| `BLOCKED_BY_GATE` | HO returned non-OPEN, bad sig, MIC mismatch, or (in strict mode) network error. |
| `BLOCKED_BY_COST` | Quoted all-in cost exceeded `MAX_COST_BPS`. |
| `ERRORED` | Unexpected failure during `/order`, `/execute`, or confirmation. |

When `ho_downgraded: true` is set, the agent proceeded under soft mode without
a verifiable signed receipt. This is recorded so post-hoc audits can tell
real-attestation ticks apart from soft-passed ones.

---

## Mint registry

Mints used by this agent (verified 2026-06-08 against Solscan + Solflare +
exchange listing pages; all carry Backed's vanity `Xs` prefix):

| Symbol | Underlying | Mint |
|--------|------------|------|
| TSLAx  | TSLA | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` |
| NVDAx  | NVDA | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` |
| AAPLx  | AAPL | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` |
| SPYx   | SPY  | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` |
| MSTRx  | MSTR | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` |
| MSFTx  | MSFT | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` |

USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Circle, Solana mainnet).

**Verify on-chain before trusting these in production.** Token registries
drift; rogue lookalikes exist.

---

## Safety

This is a reference implementation that trades real funds when run with a real
wallet against mainnet. It is small enough to audit in one sitting (~900 LoC
src, ~400 LoC tests). **Read it. Run it on a small amount first. Use a
dedicated agent wallet, not your primary.** All wallet/key handling is local —
nothing leaves the machine except the Jupiter and HO HTTPS calls, which carry
no secret material.

The `.env` and `wallet.json` files are gitignored. Do not commit them. Use
0600 file permissions for the wallet.

---

## Acknowledgements

Built as a reference consumer of [Headless Oracle](https://headlessoracle.com),
which provides the signed market-state attestation that makes this whole
pattern possible. The HO SDK is `@headlessoracle/verify` on npm.

The Jupiter integration shape and the soft/strict halt-gate policy mirror the
Rust `rwa_cli` agent (Ondo Global Markets rail). xStocks are issued by
[Backed Finance](https://backed.fi).

## License

MIT.
