import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { SssToken } from "../target/types/sss_token";
import { SssTransferHook } from "../target/types/sss_transfer_hook";
import { expect } from "chai";
import {
  findConfigPda,
  findRoleConfigPda,
  findBlacklistEntryPda,
  initializeSss1,
  initializeSss2,
  initializeExtraAccountMetaList,
  assignRole,
  createAta,
  airdrop,
  Role,
  TOKEN_PROGRAM,
  HOOK_PROGRAM_ID,
} from "./helpers";

describe("Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const hookProgram = anchor.workspace.SssTransferHook as Program<SssTransferHook>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  // ── SSS-1 stablecoin for basic edge case tests ─────────────────
  let mint1: Keypair;
  let configPda1: PublicKey;
  let minterKeypair: Keypair;
  let minterRolePda: PublicKey;
  let recipientAta: PublicKey;
  let recipientKeypair: Keypair;

  // ── SSS-2 stablecoin for compliance edge cases ─────────────────
  let mint2: Keypair;
  let configPda2: PublicKey;
  let blacklisterKeypair: Keypair;
  let blacklisterRolePda2: PublicKey;

  before(async () => {
    // ── SSS-1 setup ──────────────────────────────────────────────
    mint1 = Keypair.generate();
    const result1 = await initializeSss1(program, authority, mint1, {
      name: "Edge Case SSS1",
      symbol: "EC1",
      uri: "https://test.com",
      supplyCap: 10_000_000, // 10M cap
    });
    configPda1 = result1.config;

    // Minter with unlimited allowance (testing supply cap, not allowance)
    minterKeypair = Keypair.generate();
    await airdrop(provider, minterKeypair.publicKey);
    minterRolePda = await assignRole(
      program, authority, configPda1, Role.Minter,
      minterKeypair.publicKey, null
    );

    // Recipient ATA
    recipientKeypair = Keypair.generate();
    await airdrop(provider, recipientKeypair.publicKey);
    recipientAta = await createAta(
      provider, mint1.publicKey, recipientKeypair.publicKey
    );

    // ── SSS-2 setup ──────────────────────────────────────────────
    mint2 = Keypair.generate();
    const result2 = await initializeSss2(program, authority, mint2, {
      name: "Edge Case SSS2",
      symbol: "EC2",
      uri: "https://test.com",
    });
    configPda2 = result2.config;

    await initializeExtraAccountMetaList(
      hookProgram, program, authority, mint2.publicKey
    );

    blacklisterKeypair = Keypair.generate();
    await airdrop(provider, blacklisterKeypair.publicKey);
    blacklisterRolePda2 = await assignRole(
      program, authority, configPda2, Role.Blacklister,
      blacklisterKeypair.publicKey
    );
  });

  // ── Zero amount errors ──────────────────────────────────────────

  it("Zero amount mint → ZeroAmount", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(0))
        .accountsStrict({
          minter: minterKeypair.publicKey,
          config: configPda1,
          roleConfig: minterRolePda,
          destination: recipientAta,
          mint: mint1.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown — zero amount");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  it("Zero amount burn → ZeroAmount", async () => {
    // Mint some tokens first so the ATA has a balance
    let sig = await program.methods
      .mintTokens(new anchor.BN(1_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda1,
        roleConfig: minterRolePda,
        destination: recipientAta,
        mint: mint1.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .burnTokens(new anchor.BN(0))
        .accountsStrict({
          authority: recipientKeypair.publicKey,
          config: configPda1,
          roleConfig: null,
          fromAta: recipientAta,
          mint: mint1.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([recipientKeypair])
        .rpc();
      expect.fail("Should have thrown — zero amount");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  // ── Supply cap boundary ─────────────────────────────────────────

  it("Mint with exact supply cap → succeeds", async () => {
    // Current supply: 1M (from burn test). Cap: 10M. Mint exactly 9M more.
    const sig = await program.methods
      .mintTokens(new anchor.BN(9_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda1,
        roleConfig: minterRolePda,
        destination: recipientAta,
        mint: mint1.publicKey,
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
    expect(Number(account.amount)).to.equal(10_000_000);
  });

  it("Mint 1 over supply cap → SupplyCapExceeded", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(1))
        .accountsStrict({
          minter: minterKeypair.publicKey,
          config: configPda1,
          roleConfig: minterRolePda,
          destination: recipientAta,
          mint: mint1.publicKey,
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

  // ── Blacklist edge cases ────────────────────────────────────────

  it("Double-blacklist same wallet → error", async () => {
    // Create and approve a wallet on SSS-2
    const targetKeypair = Keypair.generate();
    await airdrop(provider, targetKeypair.publicKey);
    const targetAta = await createAta(
      provider, mint2.publicKey, targetKeypair.publicKey, targetKeypair
    );

    // Approve
    let sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda2,
        roleConfig: blacklisterRolePda2,
        walletTokenAccount: targetAta,
        mint: mint2.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Blacklist first time
    const [blEntry] = findBlacklistEntryPda(
      configPda2, targetKeypair.publicKey, program.programId
    );

    sig = await program.methods
      .blacklist(targetKeypair.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda2,
        roleConfig: blacklisterRolePda2,
        blacklistEntry: blEntry,
        walletTokenAccount: targetAta,
        mint: mint2.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Blacklist same wallet again → error (PDA already exists)
    try {
      await program.methods
        .blacklist(targetKeypair.publicKey)
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda2,
          roleConfig: blacklisterRolePda2,
          blacklistEntry: blEntry,
          walletTokenAccount: targetAta,
          mint: mint2.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklisterKeypair])
        .rpc();
      expect.fail("Should have thrown — double blacklist");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("Unblacklist wallet that was never blacklisted → fails", async () => {
    const cleanKeypair = Keypair.generate();
    await airdrop(provider, cleanKeypair.publicKey);
    const cleanAta = await createAta(
      provider, mint2.publicKey, cleanKeypair.publicKey, cleanKeypair
    );

    // Approve first
    let sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda2,
        roleConfig: blacklisterRolePda2,
        walletTokenAccount: cleanAta,
        mint: mint2.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Try to unblacklist (no BlacklistEntry PDA exists)
    const [fakeBlEntry] = findBlacklistEntryPda(
      configPda2, cleanKeypair.publicKey, program.programId
    );

    try {
      await program.methods
        .unblacklist()
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda2,
          roleConfig: blacklisterRolePda2,
          blacklistEntry: fakeBlEntry,
          walletTokenAccount: cleanAta,
          mint: mint2.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([blacklisterKeypair])
        .rpc();
      expect.fail("Should have thrown — no blacklist entry");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  // ── Role assignment edge cases ──────────────────────────────────

  it("Assign role to wallet that already has it → error", async () => {
    // minterKeypair already has Minter role on configPda1
    try {
      await assignRole(
        program, authority, configPda1, Role.Minter,
        minterKeypair.publicKey, 1_000_000
      );
      expect.fail("Should have thrown — duplicate role assignment");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  // ── Unauthorized signer on every admin instruction ──────────────

  it("Unauthorized signer on assign_role", async () => {
    const random = Keypair.generate();
    await airdrop(provider, random.publicKey);

    const [fakePda] = findRoleConfigPda(
      configPda1, Role.Minter, random.publicKey, program.programId
    );

    try {
      await program.methods
        .assignRole(Role.Minter, random.publicKey, null)
        .accountsStrict({
          authority: random.publicKey, // not master
          config: configPda1,
          roleConfig: fakePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([random])
        .rpc();
      expect.fail("Should have thrown — unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("Unauthorized signer on transfer_master_authority", async () => {
    const random = Keypair.generate();
    await airdrop(provider, random.publicKey);

    try {
      await program.methods
        .transferMasterAuthority()
        .accountsStrict({
          authority: random.publicKey, // not master
          config: configPda1,
          newAuthority: random.publicKey,
        })
        .signers([random])
        .rpc();
      expect.fail("Should have thrown — unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("Unauthorized signer on update_supply_cap", async () => {
    const random = Keypair.generate();
    await airdrop(provider, random.publicKey);

    try {
      await program.methods
        .updateSupplyCap(new anchor.BN(999))
        .accountsStrict({
          authority: random.publicKey, // not master
          config: configPda1,
          mint: mint1.publicKey,
        })
        .signers([random])
        .rpc();
      expect.fail("Should have thrown — unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // ── SSS-2 operations on SSS-1 config → Sss2Required ────────────

  it("Blacklist on SSS-1 config → Sss2Required", async () => {
    // Assign Blacklister on SSS-1
    const bl1Keypair = Keypair.generate();
    await airdrop(provider, bl1Keypair.publicKey);
    const bl1RolePda = await assignRole(
      program, authority, configPda1, Role.Blacklister,
      bl1Keypair.publicKey
    );

    // Create target ATA on SSS-1
    const targetKp = Keypair.generate();
    await airdrop(provider, targetKp.publicKey);
    const targetAta = await createAta(
      provider, mint1.publicKey, targetKp.publicKey, targetKp
    );

    const [blEntry] = findBlacklistEntryPda(
      configPda1, targetKp.publicKey, program.programId
    );

    try {
      await program.methods
        .blacklist(targetKp.publicKey)
        .accountsStrict({
          blacklister: bl1Keypair.publicKey,
          config: configPda1,
          roleConfig: bl1RolePda,
          blacklistEntry: blEntry,
          walletTokenAccount: targetAta,
          mint: mint1.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([bl1Keypair])
        .rpc();
      expect.fail("Should have thrown — SSS-1 config");
    } catch (err: any) {
      expect(err.toString()).to.include("Sss2Required");
    }
  });

  it("approve_account on SSS-1 config → Sss2Required", async () => {
    const bl1Keypair = Keypair.generate();
    await airdrop(provider, bl1Keypair.publicKey);
    const bl1RolePda = await assignRole(
      program, authority, configPda1, Role.Blacklister,
      bl1Keypair.publicKey
    );

    const targetKp = Keypair.generate();
    await airdrop(provider, targetKp.publicKey);
    const targetAta = await createAta(
      provider, mint1.publicKey, targetKp.publicKey, targetKp
    );

    try {
      await program.methods
        .approveAccount()
        .accountsStrict({
          blacklister: bl1Keypair.publicKey,
          config: configPda1,
          roleConfig: bl1RolePda,
          walletTokenAccount: targetAta,
          mint: mint1.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([bl1Keypair])
        .rpc();
      expect.fail("Should have thrown — SSS-1 config");
    } catch (err: any) {
      expect(err.toString()).to.include("Sss2Required");
    }
  });
});
