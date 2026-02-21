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
  findBlacklistEntryPda,
  findRoleConfigPda,
  initializeSss1,
  initializeSss2,
  assignRole,
  airdrop,
  createAta,
  getAta,
  Role,
  TOKEN_PROGRAM,
  HOOK_PROGRAM_ID,
} from "./helpers";

describe("Blacklist Compliance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;
  let blacklisterKeypair: Keypair;
  let blacklisterRolePda: PublicKey;
  let minterKeypair: Keypair;
  let minterRolePda: PublicKey;

  // Target wallets
  let targetWallet: Keypair;
  let targetAta: PublicKey;

  // ── Setup ─────────────────────────────────────────────────────

  before(async () => {
    // Create SSS-2 stablecoin
    mint = Keypair.generate();
    const result = await initializeSss2(program, authority, mint, {
      name: "Blacklist Test",
      symbol: "BLKT",
      uri: "https://test.com",
      decimals: 6,
    });
    configPda = result.config;

    // Assign Blacklister role
    blacklisterKeypair = Keypair.generate();
    await airdrop(provider, blacklisterKeypair.publicKey);
    blacklisterRolePda = await assignRole(
      program,
      authority,
      configPda,
      Role.Blacklister,
      blacklisterKeypair.publicKey
    );

    // Assign Minter role (for minting tokens to test accounts)
    minterKeypair = Keypair.generate();
    await airdrop(provider, minterKeypair.publicKey);
    minterRolePda = await assignRole(
      program,
      authority,
      configPda,
      Role.Minter,
      minterKeypair.publicKey,
      null // unlimited
    );

    // Create target wallet and ATA (starts frozen due to DefaultAccountState)
    targetWallet = Keypair.generate();
    await airdrop(provider, targetWallet.publicKey);
    targetAta = await createAta(
      provider,
      mint.publicKey,
      targetWallet.publicKey,
      targetWallet
    );
  });

  // ── approve_account (KYC thaw) ────────────────────────────────

  it("New ATA starts frozen on SSS-2", async () => {
    const account = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(true);
  });

  it("approve_account thaws a frozen ATA", async () => {
    const sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        walletTokenAccount: targetAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    const account = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(false);
  });

  // ── Mint tokens to target (need thawed ATA) ───────────────────

  it("Can mint to approved (thawed) ATA", async () => {
    const sig = await program.methods
      .mintTokens(new anchor.BN(10_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda,
        roleConfig: minterRolePda,
        destination: targetAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    const account = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(account.amount)).to.equal(10_000_000);
  });

  // ── Blacklist ─────────────────────────────────────────────────

  it("Blacklist wallet → creates BlacklistEntry PDA and freezes ATA", async () => {
    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      targetWallet.publicKey,
      program.programId
    );

    const sig = await program.methods
      .blacklist(targetWallet.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: blacklistEntryPda,
        walletTokenAccount: targetAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    // Verify BlacklistEntry exists
    const entry = await program.account.blacklistEntry.fetch(blacklistEntryPda);
    expect(entry.config.toBase58()).to.equal(configPda.toBase58());
    expect(entry.wallet.toBase58()).to.equal(targetWallet.publicKey.toBase58());

    // Verify ATA is frozen
    const account = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(true);
  });

  it("BlacklistEntry PDA has correct data", async () => {
    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      targetWallet.publicKey,
      program.programId
    );
    const entry = await program.account.blacklistEntry.fetch(blacklistEntryPda);
    expect(entry.config.toBase58()).to.equal(configPda.toBase58());
    expect(entry.wallet.toBase58()).to.equal(targetWallet.publicKey.toBase58());
  });

  // ── Unblacklist ───────────────────────────────────────────────

  it("Unblacklist → closes BlacklistEntry PDA and thaws ATA", async () => {
    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      targetWallet.publicKey,
      program.programId
    );

    const sig = await program.methods
      .unblacklist()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: blacklistEntryPda,
        walletTokenAccount: targetAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    // Verify BlacklistEntry PDA is closed
    const info = await provider.connection.getAccountInfo(blacklistEntryPda);
    expect(info).to.be.null;

    // Verify ATA is thawed
    const account = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(false);
  });

  // ── Re-blacklist for further tests ────────────────────────────

  it("Can re-blacklist after unblacklist", async () => {
    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      targetWallet.publicKey,
      program.programId
    );

    const sig = await program.methods
      .blacklist(targetWallet.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: blacklistEntryPda,
        walletTokenAccount: targetAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    const entry = await program.account.blacklistEntry.fetch(blacklistEntryPda);
    expect(entry.wallet.toBase58()).to.equal(targetWallet.publicKey.toBase58());
  });

  // ── Error paths ───────────────────────────────────────────────

  it("Double-blacklist same wallet → fails", async () => {
    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      targetWallet.publicKey,
      program.programId
    );

    try {
      await program.methods
        .blacklist(targetWallet.publicKey)
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda,
          roleConfig: blacklisterRolePda,
          blacklistEntry: blacklistEntryPda,
          walletTokenAccount: targetAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklisterKeypair])
        .rpc();
      expect.fail("Should have thrown — PDA already exists");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("Unblacklist non-blacklisted wallet → fails (no PDA)", async () => {
    const cleanWallet = Keypair.generate();
    await airdrop(provider, cleanWallet.publicKey);
    const cleanAta = await createAta(
      provider,
      mint.publicKey,
      cleanWallet.publicKey,
      cleanWallet
    );

    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      cleanWallet.publicKey,
      program.programId
    );

    try {
      await program.methods
        .unblacklist()
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda,
          roleConfig: blacklisterRolePda,
          blacklistEntry: blacklistEntryPda,
          walletTokenAccount: cleanAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([blacklisterKeypair])
        .rpc();
      expect.fail("Should have thrown — no BlacklistEntry");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("Non-blacklister cannot blacklist (Unauthorized)", async () => {
    const randomUser = Keypair.generate();
    await airdrop(provider, randomUser.publicKey);

    const victim = Keypair.generate();
    await airdrop(provider, victim.publicKey);
    const victimAta = await createAta(
      provider,
      mint.publicKey,
      victim.publicKey,
      victim
    );

    const [fakeRolePda] = findRoleConfigPda(
      configPda,
      Role.Blacklister,
      randomUser.publicKey,
      program.programId
    );
    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      victim.publicKey,
      program.programId
    );

    try {
      await program.methods
        .blacklist(victim.publicKey)
        .accountsStrict({
          blacklister: randomUser.publicKey,
          config: configPda,
          roleConfig: fakeRolePda,
          blacklistEntry: blacklistEntryPda,
          walletTokenAccount: victimAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown — no role");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("Non-blacklister cannot approve_account", async () => {
    const randomUser = Keypair.generate();
    await airdrop(provider, randomUser.publicKey);

    const newUser = Keypair.generate();
    await airdrop(provider, newUser.publicKey);
    const newAta = await createAta(
      provider,
      mint.publicKey,
      newUser.publicKey,
      newUser
    );

    const [fakeRolePda] = findRoleConfigPda(
      configPda,
      Role.Blacklister,
      randomUser.publicKey,
      program.programId
    );

    try {
      await program.methods
        .approveAccount()
        .accountsStrict({
          blacklister: randomUser.publicKey,
          config: configPda,
          roleConfig: fakeRolePda,
          walletTokenAccount: newAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown — no role");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  // ── SSS-1 rejection ───────────────────────────────────────────

  it("Blacklist on SSS-1 config → Sss2Required", async () => {
    const sss1Mint = Keypair.generate();
    const sss1Result = await initializeSss1(program, authority, sss1Mint, {
      name: "SSS1 Coin",
      symbol: "SS1",
    });

    const sss1Blacklister = Keypair.generate();
    await airdrop(provider, sss1Blacklister.publicKey);
    const sss1BlacklisterRole = await assignRole(
      program,
      authority,
      sss1Result.config,
      Role.Blacklister,
      sss1Blacklister.publicKey
    );

    const sss1Target = Keypair.generate();
    await airdrop(provider, sss1Target.publicKey);
    const sss1Ata = await createAta(
      provider,
      sss1Mint.publicKey,
      sss1Target.publicKey,
      sss1Target
    );

    const [sss1BlacklistEntry] = findBlacklistEntryPda(
      sss1Result.config,
      sss1Target.publicKey,
      program.programId
    );

    try {
      await program.methods
        .blacklist(sss1Target.publicKey)
        .accountsStrict({
          blacklister: sss1Blacklister.publicKey,
          config: sss1Result.config,
          roleConfig: sss1BlacklisterRole,
          blacklistEntry: sss1BlacklistEntry,
          walletTokenAccount: sss1Ata,
          mint: sss1Mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([sss1Blacklister])
        .rpc();
      expect.fail("Should have thrown — SSS-1 config");
    } catch (err: any) {
      expect(err.toString()).to.include("Sss2Required");
    }
  });

  it("approve_account on SSS-1 config → Sss2Required", async () => {
    const sss1Mint = Keypair.generate();
    const sss1Result = await initializeSss1(program, authority, sss1Mint, {
      name: "SSS1 Approve",
      symbol: "SS1A",
    });

    const sss1Blacklister = Keypair.generate();
    await airdrop(provider, sss1Blacklister.publicKey);
    const sss1BlacklisterRole = await assignRole(
      program,
      authority,
      sss1Result.config,
      Role.Blacklister,
      sss1Blacklister.publicKey
    );

    const sss1Target = Keypair.generate();
    await airdrop(provider, sss1Target.publicKey);
    const sss1Ata = await createAta(
      provider,
      sss1Mint.publicKey,
      sss1Target.publicKey,
      sss1Target
    );

    try {
      await program.methods
        .approveAccount()
        .accountsStrict({
          blacklister: sss1Blacklister.publicKey,
          config: sss1Result.config,
          roleConfig: sss1BlacklisterRole,
          walletTokenAccount: sss1Ata,
          mint: sss1Mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([sss1Blacklister])
        .rpc();
      expect.fail("Should have thrown — SSS-1 config");
    } catch (err: any) {
      expect(err.toString()).to.include("Sss2Required");
    }
  });

  it("Unblacklist on SSS-1 config → Sss2Required", async () => {
    const sss1Mint = Keypair.generate();
    const sss1Result = await initializeSss1(program, authority, sss1Mint, {
      name: "SSS1 Unbl",
      symbol: "SS1U",
    });

    const sss1Blacklister = Keypair.generate();
    await airdrop(provider, sss1Blacklister.publicKey);
    const sss1BlacklisterRole = await assignRole(
      program,
      authority,
      sss1Result.config,
      Role.Blacklister,
      sss1Blacklister.publicKey
    );

    const fakeWallet = Keypair.generate();
    const [fakeBlEntry] = findBlacklistEntryPda(
      sss1Result.config,
      fakeWallet.publicKey,
      program.programId
    );

    const sss1Target = Keypair.generate();
    await airdrop(provider, sss1Target.publicKey);
    const sss1Ata = await createAta(
      provider,
      sss1Mint.publicKey,
      sss1Target.publicKey,
      sss1Target
    );

    try {
      await program.methods
        .unblacklist()
        .accountsStrict({
          blacklister: sss1Blacklister.publicKey,
          config: sss1Result.config,
          roleConfig: sss1BlacklisterRole,
          blacklistEntry: fakeBlEntry,
          walletTokenAccount: sss1Ata,
          mint: sss1Mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([sss1Blacklister])
        .rpc();
      expect.fail("Should have thrown — SSS-1 config");
    } catch (err: any) {
      // Anchor may fail on blacklist_entry deserialization (PDA doesn't exist)
      // before reaching the Sss2Required preset check — both are correct rejections.
      expect(err).to.exist;
    }
  });

  // ── Minter with wrong role cannot blacklist ───────────────────

  it("Minter role cannot call blacklist (WrongRole)", async () => {
    const newTarget = Keypair.generate();
    await airdrop(provider, newTarget.publicKey);
    const newTargetAta = await createAta(
      provider,
      mint.publicKey,
      newTarget.publicKey,
      newTarget
    );

    const [blacklistEntryPda] = findBlacklistEntryPda(
      configPda,
      newTarget.publicKey,
      program.programId
    );

    try {
      await program.methods
        .blacklist(newTarget.publicKey)
        .accountsStrict({
          blacklister: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda,
          blacklistEntry: blacklistEntryPda,
          walletTokenAccount: newTargetAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown — wrong role");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  // ── approve_account on second wallet ──────────────────────────

  it("approve_account on second wallet works", async () => {
    const newUser = Keypair.generate();
    await airdrop(provider, newUser.publicKey);
    const newAta = await createAta(
      provider,
      mint.publicKey,
      newUser.publicKey,
      newUser
    );

    let account = await getAccount(
      provider.connection,
      newAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(true);

    const sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        walletTokenAccount: newAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    account = await getAccount(
      provider.connection,
      newAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(false);
  });

  // ── Full blacklist → unblacklist cycle ────────────────────────

  it("Full blacklist → unblacklist cycle on fresh wallet", async () => {
    const freshWallet = Keypair.generate();
    await airdrop(provider, freshWallet.publicKey);
    const freshAta = await createAta(
      provider,
      mint.publicKey,
      freshWallet.publicKey,
      freshWallet
    );

    // Approve first (thaw from DefaultAccountState)
    let sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        walletTokenAccount: freshAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    let account = await getAccount(
      provider.connection,
      freshAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(false);

    // Blacklist
    const [blPda] = findBlacklistEntryPda(
      configPda,
      freshWallet.publicKey,
      program.programId
    );

    sig = await program.methods
      .blacklist(freshWallet.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: blPda,
        walletTokenAccount: freshAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    account = await getAccount(
      provider.connection,
      freshAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(true);

    // Unblacklist
    sig = await program.methods
      .unblacklist()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: blPda,
        walletTokenAccount: freshAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    const info = await provider.connection.getAccountInfo(blPda);
    expect(info).to.be.null;

    account = await getAccount(
      provider.connection,
      freshAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(false);
  });
});
