import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { SssToken } from "../target/types/sss_token";
import { expect } from "chai";
import {
  findConfigPda,
  findRoleConfigPda,
  initializeSss1,
  assignRole,
  createAta,
  airdrop,
  Role,
  TOKEN_PROGRAM,
} from "./helpers";

describe("Pause & Admin", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;

  // Roles
  let pauserKeypair: Keypair;
  let pauserRolePda: PublicKey;
  let minterKeypair: Keypair;
  let minterRolePda: PublicKey;

  // Recipient for minting tests
  let recipientKeypair: Keypair;
  let recipientAta: PublicKey;

  before(async () => {
    // Initialize SSS-1 stablecoin with supply cap
    mint = Keypair.generate();
    const result = await initializeSss1(program, authority, mint, {
      name: "Pause Admin Test",
      symbol: "PAT",
      uri: "https://test.com",
      supplyCap: 100_000_000, // 100M
    });
    configPda = result.config;

    // Assign Pauser role
    pauserKeypair = Keypair.generate();
    await airdrop(provider, pauserKeypair.publicKey);
    pauserRolePda = await assignRole(
      program, authority, configPda, Role.Pauser,
      pauserKeypair.publicKey
    );

    // Assign Minter role (unlimited)
    minterKeypair = Keypair.generate();
    await airdrop(provider, minterKeypair.publicKey);
    minterRolePda = await assignRole(
      program, authority, configPda, Role.Minter,
      minterKeypair.publicKey, null
    );

    // Create recipient ATA
    recipientKeypair = Keypair.generate();
    await airdrop(provider, recipientKeypair.publicKey);
    recipientAta = await createAta(
      provider, mint.publicKey, recipientKeypair.publicKey
    );
  });

  // ── Pause via Pauser role ───────────────────────────────────────

  it("Pause via Pauser role → config.paused = true", async () => {
    const sig = await program.methods
      .pause()
      .accountsStrict({
        authority: pauserKeypair.publicKey,
        config: configPda,
        roleConfig: pauserRolePda,
      })
      .signers([pauserKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.paused).to.equal(true);
  });

  it("Unpause via Pauser role → config.paused = false", async () => {
    const sig = await program.methods
      .unpause()
      .accountsStrict({
        authority: pauserKeypair.publicKey,
        config: configPda,
        roleConfig: pauserRolePda,
      })
      .signers([pauserKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.paused).to.equal(false);
  });

  // ── Pause via master authority (no RoleConfig) ──────────────────

  it("Pause via master authority directly (no RoleConfig)", async () => {
    const sig = await program.methods
      .pause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: null,
      })
      .signers([authority])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.paused).to.equal(true);
  });

  it("Unpause via master authority directly (no RoleConfig)", async () => {
    const sig = await program.methods
      .unpause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: null,
      })
      .signers([authority])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.paused).to.equal(false);
  });

  // ── Pause with wrong role → WrongRole ───────────────────────────

  it("Attempt pause with wrong role → WrongRole", async () => {
    try {
      await program.methods
        .pause()
        .accountsStrict({
          authority: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda, // Minter, not Pauser
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown — wrong role");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongRole");
    }
  });

  it("Random wallet without role cannot pause", async () => {
    const random = Keypair.generate();
    await airdrop(provider, random.publicKey);

    try {
      await program.methods
        .pause()
        .accountsStrict({
          authority: random.publicKey,
          config: configPda,
          roleConfig: null,
        })
        .signers([random])
        .rpc();
      expect.fail("Should have thrown — unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // ── transfer_master_authority ───────────────────────────────────

  it("transfer_master_authority → two-step: initiate + accept", async () => {
    const newAuth = Keypair.generate();
    await airdrop(provider, newAuth.publicKey);

    // Step 1: Initiate transfer (sets pending)
    let sig = await program.methods
      .transferMasterAuthority()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        newAuthority: newAuth.publicKey,
      })
      .signers([authority])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Verify: master_authority unchanged, pending set
    let config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.masterAuthority.toString()).to.equal(
      authority.publicKey.toString()
    );
    expect(config.pendingMasterAuthority.toString()).to.equal(
      newAuth.publicKey.toString()
    );

    // Step 2: Accept transfer (new authority signs)
    sig = await program.methods
      .acceptMasterAuthority()
      .accountsStrict({
        newAuthority: newAuth.publicKey,
        config: configPda,
      })
      .signers([newAuth])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.masterAuthority.toString()).to.equal(
      newAuth.publicKey.toString()
    );
    expect(config.pendingMasterAuthority).to.be.null;

    // Old authority cannot do master-only actions (e.g. update_supply_cap)
    try {
      await program.methods
        .updateSupplyCap(new anchor.BN(999))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown — old authority unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }

    // New authority CAN do master-only actions
    sig = await program.methods
      .updateSupplyCap(new anchor.BN(200_000_000))
      .accountsStrict({
        authority: newAuth.publicKey,
        config: configPda,
        mint: mint.publicKey,
      })
      .signers([newAuth])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.supplyCap.toNumber()).to.equal(200_000_000);

    // Transfer back: initiate + accept
    sig = await program.methods
      .transferMasterAuthority()
      .accountsStrict({
        authority: newAuth.publicKey,
        config: configPda,
        newAuthority: authority.publicKey,
      })
      .signers([newAuth])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    sig = await program.methods
      .acceptMasterAuthority()
      .accountsStrict({
        newAuthority: authority.publicKey,
        config: configPda,
      })
      .signers([authority])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");
  });

  // ── update_supply_cap ───────────────────────────────────────────

  it("update_supply_cap → new cap enforced on next mint", async () => {
    // Set cap to 5M
    let sig = await program.methods
      .updateSupplyCap(new anchor.BN(5_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        mint: mint.publicKey,
      })
      .signers([authority])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    let config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.supplyCap.toNumber()).to.equal(5_000_000);

    // Mint 5M exactly → should succeed
    sig = await program.methods
      .mintTokens(new anchor.BN(5_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda,
        roleConfig: minterRolePda,
        destination: recipientAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Mint 1 more → should fail (supply cap exceeded)
    try {
      await program.methods
        .mintTokens(new anchor.BN(1))
        .accountsStrict({
          minter: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda,
          destination: recipientAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown — supply cap exceeded");
    } catch (err: any) {
      expect(err.toString()).to.include("SupplyCapExceeded");
    }
  });

  it("Set supply cap to None → unlimited minting resumes", async () => {
    // Remove cap
    let sig = await program.methods
      .updateSupplyCap(null)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        mint: mint.publicKey,
      })
      .signers([authority])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    let config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.supplyCap).to.be.null;

    // Mint more → should succeed (no cap)
    sig = await program.methods
      .mintTokens(new anchor.BN(10_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda,
        roleConfig: minterRolePda,
        destination: recipientAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    const account = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    // 5M from cap test + 10M now = 15M
    expect(Number(account.amount)).to.equal(15_000_000);
  });

  it("Non-master cannot update supply cap", async () => {
    try {
      await program.methods
        .updateSupplyCap(new anchor.BN(1))
        .accountsStrict({
          authority: pauserKeypair.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .signers([pauserKeypair])
        .rpc();
      expect.fail("Should have thrown — unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });
});
