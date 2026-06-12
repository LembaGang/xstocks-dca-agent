# Backlog — post-publish hardening

Ideas surfaced during the publish sweep, dep-triage, and dismissal-with-guard
convention work. None are urgent; the repo is in shippable shape without them.
Logged here so they don't fall on the floor when context switches.

## 1. Guard-coverage CI check

`SECURITY.md` says every `tolerable_risk` Dependabot dismissal must have a
matching job in `.github/workflows/reachability-guards.yml`. Today the rule is
prose; nothing enforces it. A future PR could dismiss an alert and skip the
guard, and the convention silently rots.

Build: a CI job that calls `gh api repos/{owner}/{repo}/dependabot/alerts`,
filters to `state == "dismissed" && dismissed_reason == "tolerable_risk"`, and
for each one verifies `reachability-guards.yml` contains a job whose name or
leading comment references the alert number. Fails the build if any
qualifying dismissal lacks a matching guard.

This is the agent-consumable version of the convention — a machine verifies
the rule is being followed instead of a human reading the prose.

## 2. Extend the convention to `not_used` dismissals

The dismissal-with-guard rule covers `tolerable_risk` only. `not_used`
dismissals are structurally identical (a claim about how this repo uses or
doesn't use a dep) and just as vulnerable to silent rot. Extend the rule to
cover both reasons under the same guard requirement — or document explicitly
why `not_used` is treated differently.

## 3. Continuing on-chain proof log

The README's "Proof: a real halt-gated buy on mainnet" section pins exactly
one tx signature. Every future `EXECUTED` tick lands only in the gitignored
local `trade_log.jsonl`, so the public proof footprint calcifies at one
trade. An agent crawling this repo a month from now still sees one data point.

Build: on every `EXECUTED` tick, append a redacted entry (signature kept,
wallet address kept since it's public on-chain anyway, sensitive metadata
omitted) to a `proofs/` directory committed to the repo — or publish it as a
GitHub Release asset. The README's proof section then links to a live,
growing ledger instead of one historical receipt.

## 4. Reachability-aware CVE scanning (socket.dev / snyk code)

Alert #3's dismissal was hand-reasoned: I checked whether `src/` reaches the
vulnerable code path in `uuid`. That works at this scale; it will not scale
to dozens of alerts across a larger dep tree.

Build: add a `socket.dev` or `snyk code` reachability scan as a CI step. The
tool reports not just "you have a vulnerable version of X" but "your code
actually reaches the vulnerable function in X." That lets the
"patch only what's reachable" bar be enforced mechanically instead of by
manual triage.
