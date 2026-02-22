import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

import {
  getConfigAddress,
  getRoleAddress,
  getBlacklistAddress,
  getExtraAccountMetaListAddress,
} from "./pda";
import { SSS_TRANSFER_HOOK_PROGRAM_ID } from "./constants";
import {
  Role,
  StablecoinConfigState,
  RoleConfigState,
  BlacklistEntryState,
  CreateSss1Params,
  CreateSss2Params,
  AssignRoleParams,
  MintParams,
  BurnParams,
  SeizeParams,
} from "./types";

// ---------------------------------------------------------------------------
// SolanaStablecoin — main SDK class
// ---------------------------------------------------------------------------

/**
 * SDK entry point for interacting with an SSS stablecoin.
 *
 * - Private constructor — instantiate via `SolanaStablecoin.load()` or
 *   `SolanaStablecoin.createSss1()` / `SolanaStablecoin.createSss2()`.
 * - Lazy state caching with `getState()` / `refresh()`.
 * - All transaction methods return the transaction signature (`string`).
 */
export class SolanaStablecoin {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly mint: PublicKey;
  readonly config: PublicKey;
  readonly configBump: number;

  private _state: StablecoinConfigState | null = null;

  // ── Private constructor ─────────────────────────────────────────

  private constructor(
    program: Program,
    provider: AnchorProvider,
    mint: PublicKey,
    config: PublicKey,
    configBump: number,
  ) {
    this.program = program;
    this.provider = provider;
    this.mint = mint;
    this.config = config;
    this.configBump = configBump;
  }

  // ── Static factory methods ──────────────────────────────────────

  /**
   * Load an existing stablecoin from the chain.
   *
   * Derives the config PDA, fetches on-chain state, and returns a
   * fully-initialized `SolanaStablecoin` instance.
   */
  static async load(
    program: Program,
    mint: PublicKey,
  ): Promise<SolanaStablecoin> {
    const provider = program.provider as AnchorProvider;
    const [config, configBump] = getConfigAddress(program.programId, mint);

    const instance = new SolanaStablecoin(
      program,
      provider,
      mint,
      config,
      configBump,
    );

    await instance.refresh();
    return instance;
  }

  /**
   * Create an SSS-1 stablecoin (minimal preset).
   *
   * Extensions: MetadataPointer, MintCloseAuthority.
   */
  static async createSss1(
    program: Program,
    params: CreateSss1Params,
  ): Promise<SolanaStablecoin> {
    const provider = program.provider as AnchorProvider;
    const authority = provider.wallet.publicKey;
    const mintKeypair = Keypair.generate();
    const [config] = getConfigAddress(program.programId, mintKeypair.publicKey);

    const decimals = params.decimals ?? 6;
    const supplyCap =
      params.supplyCap != null ? toBN(params.supplyCap) : null;

    await (program.methods as any)
      .initializeSss1(params.name, params.symbol, params.uri, decimals, supplyCap)
      .accountsStrict({
        authority,
        mint: mintKeypair.publicKey,
        config,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    return SolanaStablecoin.load(program, mintKeypair.publicKey);
  }

  /**
   * Create an SSS-2 stablecoin (compliant preset).
   *
   * Extensions: MetadataPointer, MintCloseAuthority, PermanentDelegate,
   * TransferHook, DefaultAccountState(Frozen).
   *
   * After creation, call `initializeExtraAccountMetaList()` on the
   * hook program to enable transfer hook resolution.
   */
  static async createSss2(
    program: Program,
    hookProgram: Program,
    params: CreateSss2Params,
  ): Promise<SolanaStablecoin> {
    const provider = program.provider as AnchorProvider;
    const authority = provider.wallet.publicKey;
    const mintKeypair = Keypair.generate();
    const [config] = getConfigAddress(program.programId, mintKeypair.publicKey);

    const decimals = params.decimals ?? 6;
    const supplyCap =
      params.supplyCap != null ? toBN(params.supplyCap) : null;

    await (program.methods as any)
      .initializeSss2(
        params.name,
        params.symbol,
        params.uri,
        decimals,
        supplyCap,
        params.hookProgramId,
      )
      .accountsStrict({
        authority,
        mint: mintKeypair.publicKey,
        config,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    // Initialize ExtraAccountMetaList for transfer hook
    const [extraAccountMetaList] = getExtraAccountMetaListAddress(
      hookProgram.programId,
      mintKeypair.publicKey,
    );

    await (hookProgram.methods as any)
      .initializeExtraAccountMetaList()
      .accountsStrict({
        payer: authority,
        extraAccountMetaList,
        mint: mintKeypair.publicKey,
        sssTokenProgram: program.programId,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return SolanaStablecoin.load(program, mintKeypair.publicKey);
  }

  // ── State management ────────────────────────────────────────────

  /**
   * Fetch the latest on-chain state.
   *
   * Refreshes the internal cache and returns the state.
   */
  async refresh(): Promise<StablecoinConfigState> {
    const accountNs = this.program.account as Record<
      string,
      { fetch: (addr: PublicKey) => Promise<unknown> }
    >;
    this._state = (await accountNs["stablecoinConfig"].fetch(
      this.config,
    )) as StablecoinConfigState;
    return this._state;
  }

  /**
   * Get the cached on-chain state (fetches if not cached).
   */
  async getState(): Promise<StablecoinConfigState> {
    if (!this._state) {
      await this.refresh();
    }
    return this._state!;
  }

  // ── PDA helpers ─────────────────────────────────────────────────

  /** Derive the config PDA for this stablecoin. */
  getConfigAddress(): [PublicKey, number] {
    return [this.config, this.configBump];
  }

  /** Derive a RoleConfig PDA. */
  getRoleAddress(role: Role, holder: PublicKey): [PublicKey, number] {
    return getRoleAddress(this.program.programId, this.config, role, holder);
  }

  /** Derive a BlacklistEntry PDA. */
  getBlacklistAddress(wallet: PublicKey): [PublicKey, number] {
    return getBlacklistAddress(this.program.programId, this.config, wallet);
  }

  /** Get the ATA address for a wallet's token account. */
  getTokenAccount(owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      this.mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
  }

  // ── Role methods ────────────────────────────────────────────────

  /**
   * Assign a role to a wallet.
   *
   * Only the master authority can assign roles.
   */
  async assignRole(
    authority: PublicKey,
    params: AssignRoleParams,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(params.role, params.holder);
    const allowance =
      params.mintAllowance != null ? toBN(params.mintAllowance) : null;

    return (this.program.methods as any)
      .assignRole(params.role, params.holder, allowance)
      .accountsStrict({
        authority,
        config: this.config,
        roleConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Revoke a role from a wallet.
   *
   * Only the master authority can revoke roles.
   */
  async revokeRole(
    authority: PublicKey,
    role: Role,
    holder: PublicKey,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(role, holder);

    return (this.program.methods as any)
      .revokeRole()
      .accountsStrict({
        authority,
        config: this.config,
        roleConfig,
      })
      .rpc();
  }

  /**
   * Update a minter's allowance.
   *
   * Only the master authority can update allowances.
   */
  async updateMintAllowance(
    authority: PublicKey,
    holder: PublicKey,
    newAllowance: BN | number | null,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(Role.Minter, holder);
    const allowance = newAllowance != null ? toBN(newAllowance) : null;

    return (this.program.methods as any)
      .updateMintAllowance(allowance)
      .accountsStrict({
        authority,
        config: this.config,
        roleConfig,
      })
      .rpc();
  }

  /**
   * Fetch a role config from the chain.
   *
   * Returns `null` if the role PDA doesn't exist.
   */
  async getRole(
    role: Role,
    holder: PublicKey,
  ): Promise<RoleConfigState | null> {
    const [roleConfig] = this.getRoleAddress(role, holder);
    try {
      const accountNs = this.program.account as Record<
        string,
        { fetch: (addr: PublicKey) => Promise<unknown> }
      >;
      return (await accountNs["roleConfig"].fetch(
        roleConfig,
      )) as RoleConfigState;
    } catch {
      return null;
    }
  }

  // ── Token methods ───────────────────────────────────────────────

  /**
   * Mint tokens to a destination account.
   *
   * Requires Minter role.
   */
  async mintTokens(
    minter: PublicKey,
    params: MintParams,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(Role.Minter, minter);

    return (this.program.methods as any)
      .mintTokens(toBN(params.amount))
      .accountsStrict({
        minter,
        config: this.config,
        roleConfig,
        destination: params.destination,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Burn tokens from a token account.
   *
   * Can be called by the token owner (self-burn, no role needed)
   * or by a wallet with the Burner role.
   */
  async burnTokens(
    authority: PublicKey,
    params: BurnParams,
    roleConfig?: PublicKey | null,
  ): Promise<string> {
    return (this.program.methods as any)
      .burnTokens(toBN(params.amount))
      .accountsStrict({
        authority,
        config: this.config,
        roleConfig: roleConfig ?? null,
        fromAta: params.fromAta,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  // ── Compliance methods (SSS-2) ──────────────────────────────────

  /**
   * Blacklist a wallet — creates BlacklistEntry PDA and freezes ATA.
   *
   * Requires Blacklister role. SSS-2 only.
   */
  async blacklist(
    blacklister: PublicKey,
    wallet: PublicKey,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(Role.Blacklister, blacklister);
    const [blacklistEntry] = this.getBlacklistAddress(wallet);
    const walletAta = this.getTokenAccount(wallet);

    return (this.program.methods as any)
      .blacklist(wallet)
      .accountsStrict({
        blacklister,
        config: this.config,
        roleConfig,
        blacklistEntry,
        walletTokenAccount: walletAta,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Remove a wallet from the blacklist — closes BlacklistEntry PDA and thaws ATA.
   *
   * Requires Blacklister role. SSS-2 only.
   */
  async unblacklist(
    blacklister: PublicKey,
    wallet: PublicKey,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(Role.Blacklister, blacklister);
    const [blacklistEntry] = this.getBlacklistAddress(wallet);
    const walletAta = this.getTokenAccount(wallet);

    return (this.program.methods as any)
      .unblacklist()
      .accountsStrict({
        blacklister,
        config: this.config,
        roleConfig,
        blacklistEntry,
        walletTokenAccount: walletAta,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /**
   * Approve (thaw) a frozen token account — KYC gate for SSS-2.
   *
   * Requires Blacklister role. SSS-2 only.
   */
  async approveAccount(
    blacklister: PublicKey,
    walletTokenAccount: PublicKey,
  ): Promise<string> {
    const [roleConfig] = this.getRoleAddress(Role.Blacklister, blacklister);

    return (this.program.methods as any)
      .approveAccount()
      .accountsStrict({
        blacklister,
        config: this.config,
        roleConfig,
        walletTokenAccount,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /**
   * Seize tokens from a blacklisted wallet.
   *
   * Thaws → transfers via permanent delegate → re-freezes.
   * Requires Seizer role. SSS-2 only.
   */
  async seize(
    seizer: PublicKey,
    params: SeizeParams,
    hookProgramId: PublicKey = SSS_TRANSFER_HOOK_PROGRAM_ID,
  ): Promise<string> {
    const [seizerRole] = this.getRoleAddress(Role.Seizer, seizer);
    const [blacklistEntry] = this.getBlacklistAddress(params.wallet);
    const [extraMetaList] = getExtraAccountMetaListAddress(
      hookProgramId,
      this.mint,
    );
    const [senderBl] = this.getBlacklistAddress(params.wallet);
    const [receiverBl] = this.getBlacklistAddress(params.treasuryWallet);

    const remainingAccounts = [
      { pubkey: extraMetaList, isWritable: false, isSigner: false },
      { pubkey: hookProgramId, isWritable: false, isSigner: false },
      { pubkey: this.program.programId, isWritable: false, isSigner: false },
      { pubkey: this.config, isWritable: false, isSigner: false },
      { pubkey: senderBl, isWritable: false, isSigner: false },
      { pubkey: receiverBl, isWritable: false, isSigner: false },
    ];

    return (this.program.methods as any)
      .seize(toBN(params.amount))
      .accountsStrict({
        seizer,
        config: this.config,
        roleConfig: seizerRole,
        blacklistEntry,
        fromAta: params.fromAta,
        treasuryAta: params.treasuryAta,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
  }

  /**
   * Check if a wallet is blacklisted.
   *
   * Returns `true` if a BlacklistEntry PDA exists for the wallet.
   */
  async isBlacklisted(wallet: PublicKey): Promise<boolean> {
    const [blacklistEntry] = this.getBlacklistAddress(wallet);
    try {
      const accountNs = this.program.account as Record<
        string,
        { fetch: (addr: PublicKey) => Promise<unknown> }
      >;
      await accountNs["blacklistEntry"].fetch(blacklistEntry);
      return true;
    } catch {
      return false;
    }
  }

  // ── Admin methods ───────────────────────────────────────────────

  /**
   * Pause the stablecoin — blocks minting, burning, and transfers.
   *
   * Can be called by master authority (roleConfig = null) or Pauser role.
   */
  async pause(
    authority: PublicKey,
    roleConfig?: PublicKey | null,
  ): Promise<string> {
    return (this.program.methods as any)
      .pause()
      .accountsStrict({
        authority,
        config: this.config,
        roleConfig: roleConfig ?? null,
      })
      .rpc();
  }

  /**
   * Unpause the stablecoin — resumes normal operations.
   *
   * Can be called by master authority (roleConfig = null) or Pauser role.
   */
  async unpause(
    authority: PublicKey,
    roleConfig?: PublicKey | null,
  ): Promise<string> {
    return (this.program.methods as any)
      .unpause()
      .accountsStrict({
        authority,
        config: this.config,
        roleConfig: roleConfig ?? null,
      })
      .rpc();
  }

  /**
   * Transfer master authority to a new wallet.
   *
   * Only the current master authority can call this.
   */
  async transferMasterAuthority(
    authority: PublicKey,
    newAuthority: PublicKey,
  ): Promise<string> {
    return (this.program.methods as any)
      .transferMasterAuthority()
      .accountsStrict({
        authority,
        config: this.config,
        newAuthority,
      })
      .rpc();
  }

  /**
   * Update the supply cap.
   *
   * Only the master authority can update the cap. Pass `null` for unlimited.
   */
  async updateSupplyCap(
    authority: PublicKey,
    newCap: BN | number | null,
  ): Promise<string> {
    const cap = newCap != null ? toBN(newCap) : null;

    return (this.program.methods as any)
      .updateSupplyCap(cap)
      .accountsStrict({
        authority,
        config: this.config,
      })
      .rpc();
  }

  // ── State helpers ───────────────────────────────────────────────

  /** Check if the stablecoin is paused. */
  async isPaused(): Promise<boolean> {
    const state = await this.getState();
    return state.paused;
  }

  /** Check if the stablecoin is SSS-2 preset. */
  async isSss2(): Promise<boolean> {
    const state = await this.getState();
    return state.preset === 2;
  }

  /** Get the current supply cap (null = unlimited). */
  async getSupplyCap(): Promise<BN | null> {
    const state = await this.getState();
    return state.supplyCap;
  }

  /** Get the master authority public key. */
  async getMasterAuthority(): Promise<PublicKey> {
    const state = await this.getState();
    return state.masterAuthority;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Coerce a `BN | number` to `BN`. */
function toBN(value: BN | number): BN {
  return typeof value === "number" ? new BN(value) : value;
}
