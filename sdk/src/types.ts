import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ---------------------------------------------------------------------------
// Role enum — mirrors Rust enum in programs/sss-token/src/state.rs
// ---------------------------------------------------------------------------

export enum Role {
  Minter = 0,
  Burner = 1,
  Blacklister = 2,
  Pauser = 3,
  Seizer = 4,
}

// ---------------------------------------------------------------------------
// On-chain state interfaces
// ---------------------------------------------------------------------------

/** Mirrors StablecoinConfig account on-chain. */
export interface StablecoinConfigState {
  /** Master authority who can assign/revoke all roles. */
  masterAuthority: PublicKey;
  /** The Token-2022 stablecoin mint. */
  mint: PublicKey;
  /** Preset level: 1 = SSS-1 (minimal), 2 = SSS-2 (compliant). */
  preset: number;
  /** Emergency pause flag — blocks mint/burn/transfer when true. */
  paused: boolean;
  /** Optional maximum total supply (null = unlimited). */
  supplyCap: BN | null;
  /** Transfer hook program ID (PublicKey.default for SSS-1). */
  transferHookProgram: PublicKey;
  /** Token decimals. */
  decimals: number;
  /** PDA bump seed. */
  bump: number;
}

/** Mirrors RoleConfig account on-chain. */
export interface RoleConfigState {
  /** Parent StablecoinConfig this role belongs to. */
  config: PublicKey;
  /** The role type (Role enum as u8). */
  role: number;
  /** Wallet that holds this role. */
  holder: PublicKey;
  /** Minting allowance (only meaningful for Minter role, null = unlimited). */
  mintAllowance: BN | null;
  /** PDA bump seed. */
  bump: number;
}

/** Mirrors BlacklistEntry account on-chain. */
export interface BlacklistEntryState {
  /** Parent StablecoinConfig. */
  config: PublicKey;
  /** The blacklisted wallet address. */
  wallet: PublicKey;
  /** PDA bump seed. */
  bump: number;
}

// ---------------------------------------------------------------------------
// Parameter interfaces for SDK methods
// ---------------------------------------------------------------------------

/** Parameters for creating an SSS-1 stablecoin. */
export interface CreateSss1Params {
  /** Token name (max 32 chars). */
  name: string;
  /** Token symbol (max 10 chars). */
  symbol: string;
  /** Metadata URI (max 200 chars). */
  uri: string;
  /** Token decimals (default: 6). */
  decimals?: number;
  /** Optional maximum supply (null = unlimited). */
  supplyCap?: BN | number | null;
}

/** Parameters for creating an SSS-2 stablecoin. */
export interface CreateSss2Params extends CreateSss1Params {
  /** Transfer hook program ID. */
  hookProgramId: PublicKey;
}

/** Parameters for assigning a role. */
export interface AssignRoleParams {
  /** Role to assign. */
  role: Role;
  /** Wallet to hold this role. */
  holder: PublicKey;
  /** Mint allowance (only for Minter role, null = unlimited). */
  mintAllowance?: BN | number | null;
}

/** Parameters for minting tokens. */
export interface MintParams {
  /** Amount to mint (in base units). */
  amount: BN | number;
  /** Destination token account. */
  destination: PublicKey;
}

/** Parameters for burning tokens. */
export interface BurnParams {
  /** Amount to burn (in base units). */
  amount: BN | number;
  /** Token account to burn from. */
  fromAta: PublicKey;
}

/** Parameters for seizing tokens. */
export interface SeizeParams {
  /** Amount to seize (in base units). */
  amount: BN | number;
  /** Blacklisted wallet's token account. */
  fromAta: PublicKey;
  /** Treasury token account to receive seized tokens. */
  treasuryAta: PublicKey;
  /** The blacklisted wallet's public key (for PDA derivation). */
  wallet: PublicKey;
  /** Treasury wallet's public key (for PDA derivation). */
  treasuryWallet: PublicKey;
}
