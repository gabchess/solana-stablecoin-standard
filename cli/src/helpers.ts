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
import * as path from "path";

import { SSS_TOKEN_PROGRAM_ID, SSS_TRANSFER_HOOK_PROGRAM_ID } from "@stbr/sss-token";

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
// IDL loading
// ---------------------------------------------------------------------------

/**
 * Locate and parse an IDL JSON file from the project's `target/idl/` directory.
 *
 * Walks up from `__dirname` to find the project root (where `target/` lives).
 */
function findProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "target", "idl"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  console.error(
    "\n  ERROR: Could not find project root (no target/idl/ directory).",
  );
  console.error("  Run 'anchor build' first.\n");
  process.exit(1);
}

function loadIdl(name: string): any {
  const root = findProjectRoot();
  const idlPath = path.join(root, "target", "idl", `${name}.json`);
  if (!fs.existsSync(idlPath)) {
    console.error(`\n  ERROR: IDL not found at ${idlPath}`);
    console.error("  Run 'anchor build' first.\n");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
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

  const tokenIdl = loadIdl("sss_token");
  const hookIdl = loadIdl("sss_transfer_hook");

  const program = new Program(tokenIdl, provider);
  const hookProgram = new Program(hookIdl, provider);

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
