import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";

import { SSS_TOKEN_PROGRAM_ID, SSS_TRANSFER_HOOK_PROGRAM_ID } from "@stbr/sss-token";

// Bundled IDLs — no filesystem lookup required
import tokenIdl from "./idl/sss_token.json";
import hookIdl from "./idl/sss_transfer_hook.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_KEYPAIR_PATH = "~/.config/solana/id.json";
const DEFAULT_RPC_URL = "http://localhost:8899";

// ---------------------------------------------------------------------------
// Keypair loading
// ---------------------------------------------------------------------------

/**
 * Load a Keypair from a JSON file path.
 *
 * Supports `~` expansion for the home directory.
 */
export function loadKeypair(keypairPath: string): Keypair {
  const expanded = keypairPath.replace(/^~/, process.env.HOME || "");
  if (!fs.existsSync(expanded)) {
    console.error(`\n  ERROR: Keypair file not found: ${expanded}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ---------------------------------------------------------------------------
// Setup — connection, provider, programs
// ---------------------------------------------------------------------------

export interface CliContext {
  connection: Connection;
  wallet: Keypair;
  provider: AnchorProvider;
  program: Program;
  hookProgram: Program;
}

/**
 * Build the full CLI context from options (--url, --keypair).
 */
export function setupContext(opts: {
  url?: string;
  keypair?: string;
  hookProgramId?: PublicKey;
}): CliContext {
  const rpcUrl = opts.url || process.env.RPC_URL || DEFAULT_RPC_URL;
  const keypairPath = opts.keypair || process.env.ANCHOR_WALLET || DEFAULT_KEYPAIR_PATH;

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = loadKeypair(keypairPath);

  const anchorWallet = new anchor.Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  // Clone bundled IDLs to avoid mutating the shared import
  const tIdl = { ...tokenIdl } as any;
  const hIdl = { ...hookIdl } as any;

  const program = new Program(tIdl, provider);

  // If user supplies a hook program ID, override the IDL-embedded address
  if (opts.hookProgramId) {
    hIdl.address = opts.hookProgramId.toBase58();
  }
  const hookProgram = new Program(hIdl, provider);

  return { connection, wallet, provider, program, hookProgram };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

export function printHeader(title: string): void {
  console.log();
  console.log("=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
  console.log();
}

export function printResult(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, replacer, 2));
}

export function printSuccess(message: string): void {
  console.log(`  ✓ ${message}`);
}

export function printError(message: string): void {
  console.error(`  ✗ ${message}`);
}

/**
 * JSON replacer that converts PublicKey to base58 and BN to string.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }
  if (BN.isBN(value)) {
    return (value as BN).toString();
  }
  return value;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a public key string, exiting on failure.
 */
export function parsePublicKey(input: string, label: string): PublicKey {
  try {
    return new PublicKey(input);
  } catch {
    console.error(`\n  ERROR: Invalid ${label} public key: ${input}\n`);
    process.exit(1);
  }
}

/**
 * Parse an amount string to BN.
 */
export function parseAmount(input: string): BN {
  try {
    return new BN(input);
  } catch {
    console.error(`\n  ERROR: Invalid amount: ${input}\n`);
    process.exit(1);
  }
}

/**
 * Wrap an async command handler with error handling.
 */
export function handleError(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err: any) {
      const msg =
        err?.message || err?.toString() || "Unknown error";
      printError(msg);
      process.exit(1);
    }
  };
}
