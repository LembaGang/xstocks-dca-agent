// Append-only JSONL trade log. Each line records a decision (executed,
// skipped, or blocked) with the HO receipt id where applicable. The
// transaction signature itself is the on-chain proof for executions; the
// receipt id ties the decision to a verifiable attestation.

import { appendFileSync } from 'node:fs';

export type LogStatus =
  | 'EXECUTED'
  | 'DRY_RUN'
  | 'SKIPPED_LOCAL'       // calendar precheck said no
  | 'BLOCKED_BY_GATE'     // HO gate denied
  | 'BLOCKED_BY_COST'     // cost-bps cap exceeded
  | 'ERRORED';            // unexpected failure during execution

export interface LogEntry {
  ts: string;
  symbol: string;
  status: LogStatus;
  mic: string;
  /** Receipt id from /v5/status or /v5/demo when a signed receipt was used. */
  ho_receipt_id?: string;
  ho_downgraded?: boolean;     // soft-mode network-error pass; honesty flag
  reason?: string;
  in_amount?: string;          // atomic units of input mint
  out_amount?: string;
  router?: string;
  cost_bps?: number;
  signature?: string;          // Solana tx signature on success
  error?: string;
}

export function appendLogEntry(path: string, entry: LogEntry): void {
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
}
