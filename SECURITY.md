# Security policy

## Reporting a vulnerability

Open a private security advisory via this repo's **Security → Report a
vulnerability** flow on GitHub. Do not file public issues for security reports.

## Dependabot dismissals require a reachability guard

This repo enforces a strict convention for dismissing Dependabot alerts as
`tolerable_risk`: a dismissal is only valid if **both** of the following hold.

1. **The dismissal comment names the reachability invariant.** The comment
   must state, in plain words, the assumption about how this code is used or
   what it imports that makes the vulnerable path unreachable in this repo.
   "Not exploitable here" is not a valid comment — name the specific
   invariant the unreachability depends on.

2. **A CI job enforces that invariant.** A corresponding job lives in
   [`.github/workflows/reachability-guards.yml`](.github/workflows/reachability-guards.yml),
   one job per dismissed alert, that fails the build if the invariant ever
   stops holding. This converts the dismissal from a snapshot assertion
   ("true on the day we dismissed it") into an enforced invariant ("true on
   every PR and push").

Without (2), a `tolerable_risk` dismissal is a comment in a UI that nobody
re-reads — and silently rots when a future PR introduces the reachable code
path. With (2), the build fails the moment the invariant stops being true.

### Worked example: alert #3 (uuid)

The `uuid` buf-bounds CVE (GHSA-w5hq-g745-h8pq) is dismissed as
`tolerable_risk` because `src/` does not import uuid — only `jayson` uses it
transitively, generating v4 random request IDs with no `buf` argument under
`@solana/web3.js`. The job `uuid-not-imported-in-src` enforces the
"`src/` does not import uuid" half of that invariant by grepping for direct
imports on every PR and push.

### Adding a new dismissed alert

1. Write the dismissal comment on the GitHub alert, stating the reachability
   invariant.
2. Add a new job to `reachability-guards.yml`, named for the invariant
   (e.g. `<package>-<invariant>`), that fails the build when the invariant
   stops holding. Include the alert number and GHSA ID in a job-level comment.
3. Confirm the guard passes on the current tree, then dismiss the alert.

If step 2 isn't possible — i.e. the invariant cannot be mechanically
enforced — the alert is not eligible for `tolerable_risk` dismissal. Patch
the dependency or accept the alert as open instead.
