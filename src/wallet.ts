// Wallet loader. Reads a 64-byte secret-key array from a JSON file (Solana CLI
// / Phantom export format) and returns a Keypair. Caller is responsible for
// keeping the file off disk in production (HSM, KMS, env-derived secret).

import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

export function loadWallet(path: string): Keypair {
  const raw = readFileSync(path, 'utf8').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Wallet file at ${path} is not valid JSON. Expected a 64-element byte array (the Solana CLI keypair format).`,
    );
  }

  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((n) => typeof n === 'number')) {
    throw new Error(
      `Wallet file at ${path} must be a JSON array of 64 numbers (the Solana CLI keypair format).`,
    );
  }

  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}
