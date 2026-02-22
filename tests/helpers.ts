import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { SssToken } from "../target/types/sss_token";
import { SssTransferHook } from "../target/types/sss_transfer_hook";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

export const STABLECOIN_SEED = Buffer.from("stablecoin");
export const ROLE_SEED = Buffer.from("role");
export const BLACKLIST_SEED = Buffer.from("blacklist");

// ---------------------------------------------------------------------------
// Role constants (mirrors Rust enum — using const object for strip-only TS)
// ---------------------------------------------------------------------------

export const Role = {
  Minter: 0,
  Burner: 1,
  Blacklister: 2,
  Pauser: 3,
  Seizer: 4,
} as const;

export type RoleType = (typeof Role)[keyof typeof Role];

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

export function findConfigPda(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mint.toBuffer()],
    programId
  );
}

export function findRoleConfigPda(
  config: PublicKey,
  role: RoleType | number,
  holder: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, config.toBuffer(), Buffer.from([role]), holder.toBuffer()],
    programId
  );
}

export function findBlacklistEntryPda(
  config: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), wallet.toBuffer()],
    programId
  );
}

// ---------------------------------------------------------------------------
// Token account helpers
// ---------------------------------------------------------------------------

export function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export async function createAta(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  payer?: Keypair
): Promise<PublicKey> {
  const ata = getAta(mint, owner);

  const ix = createAssociatedTokenAccountInstruction(
    payer ? payer.publicKey : provider.wallet.publicKey,
    ata,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new anchor.web3.Transaction().add(ix);
  let sig: string;
  if (payer) {
    sig = await provider.sendAndConfirm(tx, [payer]);
  } else {
    sig = await provider.sendAndConfirm(tx);
  }

  // Ensure account is visible at "confirmed" level before returning
  await provider.connection.confirmTransaction(sig, "confirmed");

  return ata;
}

// ---------------------------------------------------------------------------
// Airdrop helper
// ---------------------------------------------------------------------------

export async function airdrop(
  provider: anchor.AnchorProvider,
  to: PublicKey,
  amount: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(to, amount);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

// ---------------------------------------------------------------------------
// Instruction helpers
// ---------------------------------------------------------------------------

/**
 * Initialize an SSS-1 stablecoin.
 *
 * The Rust program handles ALL Token-2022 setup via CPI:
 *   1. SystemProgram.createAccount (pre-allocated for extensions + metadata)
 *   2. InitializeMetadataPointer  (before mint init)
 *   3. InitializeMintCloseAuthority (before mint init)
 *   4. InitializeMint2            (config PDA = mint_authority + freeze_authority)
 *   5. InitializeTokenMetadata    (config PDA signs as mint_authority)
 *   6. Set StablecoinConfig state
 *
 * Full pre-allocation avoids realloc — critical for Agave 3.0.x.
 */
export async function initializeSss1(
  program: Program<SssToken>,
  authority: Keypair,
  mint: Keypair,
  opts: {
    name?: string;
    symbol?: string;
    uri?: string;
    decimals?: number;
    supplyCap?: number | null;
  } = {}
): Promise<{ config: PublicKey; mint: PublicKey }> {
  const {
    name = "Test Stablecoin",
    symbol = "TSTB",
    uri = "https://test.com",
    decimals = 6,
    supplyCap = null,
  } = opts;

  const [configPda] = findConfigPda(mint.publicKey, program.programId);

  await program.methods
    .initializeSss1(
      name,
      symbol,
      uri,
      decimals,
      supplyCap !== null ? new anchor.BN(supplyCap) : null
    )
    .accountsStrict({
      authority: authority.publicKey,
      mint: mint.publicKey,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([authority, mint])
    .rpc();

  return { config: configPda, mint: mint.publicKey };
}

export async function assignRole(
  program: Program<SssToken>,
  authority: Keypair,
  config: PublicKey,
  role: RoleType,
  holder: PublicKey,
  mintAllowance: number | null = null
): Promise<PublicKey> {
  const [roleConfigPda] = findRoleConfigPda(
    config,
    role,
    holder,
    program.programId
  );

  await program.methods
    .assignRole(
      role,
      holder,
      mintAllowance !== null ? new anchor.BN(mintAllowance) : null
    )
    .accountsStrict({
      authority: authority.publicKey,
      config: config,
      roleConfig: roleConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  return roleConfigPda;
}

// ---------------------------------------------------------------------------
// SSS-2 helpers
// ---------------------------------------------------------------------------

export const HOOK_PROGRAM_ID = new PublicKey(
  "F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz"
);

export const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

export function findExtraAccountMetaListPda(
  mint: PublicKey,
  hookProgramId: PublicKey = HOOK_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    hookProgramId
  );
}

/**
 * Initialize an SSS-2 stablecoin with all 5 Token-2022 extensions:
 *   MetadataPointer, MintCloseAuthority, PermanentDelegate,
 *   TransferHook, DefaultAccountState(Frozen)
 */
export async function initializeSss2(
  program: Program<SssToken>,
  authority: Keypair,
  mint: Keypair,
  opts: {
    name?: string;
    symbol?: string;
    uri?: string;
    decimals?: number;
    supplyCap?: number | null;
    hookProgramId?: PublicKey;
  } = {}
): Promise<{ config: PublicKey; mint: PublicKey }> {
  const {
    name = "Test Stablecoin",
    symbol = "TSTB",
    uri = "https://test.com",
    decimals = 6,
    supplyCap = null,
    hookProgramId = HOOK_PROGRAM_ID,
  } = opts;

  const [configPda] = findConfigPda(mint.publicKey, program.programId);

  await program.methods
    .initializeSss2(
      name,
      symbol,
      uri,
      decimals,
      supplyCap !== null ? new anchor.BN(supplyCap) : null,
      hookProgramId
    )
    .accountsStrict({
      authority: authority.publicKey,
      mint: mint.publicKey,
      config: configPda,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([authority, mint])
    .rpc();

  return { config: configPda, mint: mint.publicKey };
}

/**
 * Initialize the ExtraAccountMetaList for the transfer hook.
 * Requires the master authority to sign — validates caller is authorized.
 */
export async function initializeExtraAccountMetaList(
  hookProgram: Program<SssTransferHook>,
  sssTokenProgram: Program<SssToken>,
  payer: Keypair,
  mint: PublicKey,
  authority?: Keypair
): Promise<PublicKey> {
  const [extraAccountMetaList] = findExtraAccountMetaListPda(
    mint,
    hookProgram.programId
  );
  const [configPda] = findConfigPda(mint, sssTokenProgram.programId);

  // Authority defaults to payer if not provided (backwards compatible)
  const auth = authority || payer;
  const signers = authority && authority !== payer ? [payer, auth] : [payer];

  await hookProgram.methods
    .initializeExtraAccountMetaList()
    .accountsStrict({
      payer: payer.publicKey,
      authority: auth.publicKey,
      config: configPda,
      extraAccountMetaList,
      mint,
      sssTokenProgram: sssTokenProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .signers(signers)
    .rpc();

  return extraAccountMetaList;
}
