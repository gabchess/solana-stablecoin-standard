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

describe("Mint and Burn", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;
  let minterKeypair: Keypair;
  let burnerKeypair: Keypair;
  let minterRolePda: PublicKey;
  let burnerRolePda: PublicKey;
  let recipientAta: PublicKey;
  let recipientKeypair: Keypair;

  before(async () => {
    // Initialize stablecoin with supply cap
    mint = Keypair.generate();
    const result = await initializeSss1(program, authority, mint, {
      supplyCap: 10_000_000_000, // 10B base units
    });
    configPda = result.config;

    // Create minter with 5M allowance
    minterKeypair = Keypair.generate();
    await airdrop(provider, minterKeypair.publicKey);
    minterRolePda = await assignRole(
      program,
      authority,
      configPda,
      Role.Minter,
      minterKeypair.publicKey,
      5_000_000
    );

    // Create burner
    burnerKeypair = Keypair.generate();
    await airdrop(provider, burnerKeypair.publicKey);
    burnerRolePda = await assignRole(
      program,
      authority,
      configPda,
      Role.Burner,
      burnerKeypair.publicKey
    );

    // Create recipient + ATA
    recipientKeypair = Keypair.generate();
    await airdrop(provider, recipientKeypair.publicKey);
    recipientAta = await createAta(
      provider,
      mint.publicKey,
      recipientKeypair.publicKey
    );
  });

  // ── Minting ─────────────────────────────────────────────────────

  it("Mints tokens with allowance", async () => {
    const sig = await program.methods
      .mintTokens(new anchor.BN(1_000_000))
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
    expect(Number(account.amount)).to.equal(1_000_000);
  });

  it("Allowance decremented after mint", async () => {
    const rc = await program.account.roleConfig.fetch(minterRolePda);
    // Started with 5M, minted 1M → 4M remaining
    expect(rc.mintAllowance!.toNumber()).to.equal(4_000_000);
  });

  it("Mints more tokens (second mint)", async () => {
    const sig = await program.methods
      .mintTokens(new anchor.BN(2_000_000))
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
    expect(Number(account.amount)).to.equal(3_000_000); // 1M + 2M

    const rc = await program.account.roleConfig.fetch(minterRolePda);
    expect(rc.mintAllowance!.toNumber()).to.equal(2_000_000); // 4M - 2M
  });

  it("Rejects mint exceeding allowance", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(3_000_000)) // only 2M remaining
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
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("AllowanceExceeded");
    }
  });

  it("Rejects zero amount mint", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(0))
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
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  // ── Supply cap enforcement ──────────────────────────────────────

  it("Rejects mint exceeding supply cap", async () => {
    // Create unlimited minter for supply cap test
    const unlimitedMinter = Keypair.generate();
    await airdrop(provider, unlimitedMinter.publicKey);
    const unlimitedRolePda = await assignRole(
      program,
      authority,
      configPda,
      Role.Minter,
      unlimitedMinter.publicKey,
      null // unlimited
    );

    // Try to mint the entire supply cap — 3M already minted, so 10B would exceed
    try {
      await program.methods
        .mintTokens(new anchor.BN(10_000_000_000))
        .accountsStrict({
          minter: unlimitedMinter.publicKey,
          config: configPda,
          roleConfig: unlimitedRolePda,
          destination: recipientAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([unlimitedMinter])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("SupplyCapExceeded");
    }
  });

  // ── Unlimited minter ────────────────────────────────────────────

  it("Unlimited minter can mint without allowance check", async () => {
    // Use a separate stablecoin (no supply cap) for this test
    const mint2 = Keypair.generate();
    const result2 = await initializeSss1(program, authority, mint2);
    const config2 = result2.config;

    const unlimitedMinter = Keypair.generate();
    await airdrop(provider, unlimitedMinter.publicKey);
    const rolePda = await assignRole(
      program,
      authority,
      config2,
      Role.Minter,
      unlimitedMinter.publicKey,
      null
    );

    // Create ATA for recipient on mint2
    const ata2 = await createAta(
      provider,
      mint2.publicKey,
      recipientKeypair.publicKey
    );

    const sig = await program.methods
      .mintTokens(new anchor.BN(999_999_999))
      .accountsStrict({
        minter: unlimitedMinter.publicKey,
        config: config2,
        roleConfig: rolePda,
        destination: ata2,
        mint: mint2.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([unlimitedMinter])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    const account = await getAccount(
      provider.connection,
      ata2,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(account.amount)).to.equal(999_999_999);
  });

  // ── Burning ─────────────────────────────────────────────────────

  it("Owner can self-burn (no Burner role needed)", async () => {
    const balanceBefore = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const before = Number(balanceBefore.amount);

    await program.methods
      .burnTokens(new anchor.BN(500_000))
      .accountsStrict({
        authority: recipientKeypair.publicKey,
        config: configPda,
        roleConfig: null,
        fromAta: recipientAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([recipientKeypair])
      .rpc();

    const balanceAfter = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(balanceAfter.amount)).to.equal(before - 500_000);
  });

  it("Rejects zero amount burn", async () => {
    try {
      await program.methods
        .burnTokens(new anchor.BN(0))
        .accountsStrict({
          authority: recipientKeypair.publicKey,
          config: configPda,
          roleConfig: null,
          fromAta: recipientAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([recipientKeypair])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  // ── Paused state ────────────────────────────────────────────────

  it("Cannot mint while paused", async () => {
    // Pause the stablecoin (master authority can pause directly)
    await program.methods
      .pause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: null,
      })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .mintTokens(new anchor.BN(1_000))
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
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("Paused");
    }

    // Unpause for subsequent tests
    await program.methods
      .unpause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: null,
      })
      .signers([authority])
      .rpc();
  });

  it("Cannot burn while paused", async () => {
    // Pause again
    await program.methods
      .pause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: null,
      })
      .signers([authority])
      .rpc();

    try {
      await program.methods
        .burnTokens(new anchor.BN(100))
        .accountsStrict({
          authority: recipientKeypair.publicKey,
          config: configPda,
          roleConfig: null,
          fromAta: recipientAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([recipientKeypair])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("Paused");
    }

    // Unpause
    await program.methods
      .unpause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: null,
      })
      .signers([authority])
      .rpc();
  });

  // ── Wrong role ──────────────────────────────────────────────────

  it("Non-minter cannot mint (wrong role)", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(1000))
        .accountsStrict({
          minter: burnerKeypair.publicKey,
          config: configPda,
          roleConfig: burnerRolePda, // Burner role, not Minter
          destination: recipientAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([burnerKeypair])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongRole");
    }
  });
});
