import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import { SssToken } from "../target/types/sss_token";
import { SssTransferHook } from "../target/types/sss_transfer_hook";
import { expect } from "chai";
import {
  findConfigPda,
  findBlacklistEntryPda,
  findRoleConfigPda,
  findExtraAccountMetaListPda,
  initializeSss2,
  initializeExtraAccountMetaList,
  assignRole,
  airdrop,
  createAta,
  getAta,
  Role,
  TOKEN_PROGRAM,
  HOOK_PROGRAM_ID,
} from "./helpers";

describe("Transfer Hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const hookProgram = anchor.workspace.SssTransferHook as Program<SssTransferHook>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;
  let extraAccountMetaList: PublicKey;

  // Roles
  let blacklisterKeypair: Keypair;
  let blacklisterRolePda: PublicKey;
  let minterKeypair: Keypair;
  let minterRolePda: PublicKey;

  // Wallets
  let senderKeypair: Keypair;
  let senderAta: PublicKey;
  let receiverKeypair: Keypair;
  let receiverAta: PublicKey;

  const decimals = 6;

  // ── Setup ─────────────────────────────────────────────────────

  before(async () => {
    // Create SSS-2 stablecoin
    mint = Keypair.generate();
    const result = await initializeSss2(program, authority, mint, {
      name: "Hook Test",
      symbol: "HKTST",
      uri: "https://test.com",
      decimals,
    });
    configPda = result.config;

    // Initialize ExtraAccountMetaList for the transfer hook
    extraAccountMetaList = await initializeExtraAccountMetaList(
      hookProgram,
      program,
      authority,
      mint.publicKey
    );

    // Assign roles
    blacklisterKeypair = Keypair.generate();
    await airdrop(provider, blacklisterKeypair.publicKey);
    blacklisterRolePda = await assignRole(
      program, authority, configPda, Role.Blacklister,
      blacklisterKeypair.publicKey
    );

    minterKeypair = Keypair.generate();
    await airdrop(provider, minterKeypair.publicKey);
    minterRolePda = await assignRole(
      program, authority, configPda, Role.Minter,
      minterKeypair.publicKey, null
    );

    // Create sender and receiver wallets
    senderKeypair = Keypair.generate();
    await airdrop(provider, senderKeypair.publicKey);
    senderAta = await createAta(provider, mint.publicKey, senderKeypair.publicKey, senderKeypair);

    receiverKeypair = Keypair.generate();
    await airdrop(provider, receiverKeypair.publicKey);
    receiverAta = await createAta(provider, mint.publicKey, receiverKeypair.publicKey, receiverKeypair);

    // Approve (thaw) both ATAs
    for (const ata of [senderAta, receiverAta]) {
      const sig = await program.methods
        .approveAccount()
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda,
          roleConfig: blacklisterRolePda,
          walletTokenAccount: ata,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([blacklisterKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Mint tokens to sender
    const mintSig = await program.methods
      .mintTokens(new anchor.BN(100_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda,
        roleConfig: minterRolePda,
        destination: senderAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(mintSig, "confirmed");
  });

  // ── ExtraAccountMetaList ──────────────────────────────────────

  it("ExtraAccountMetaList PDA is initialized", async () => {
    const info = await provider.connection.getAccountInfo(extraAccountMetaList);
    expect(info).to.not.be.null;
    expect(info!.data.length).to.be.greaterThan(0);
  });

  it("ExtraAccountMetaList PDA matches expected address", async () => {
    const [expected] = findExtraAccountMetaListPda(mint.publicKey, hookProgram.programId);
    expect(extraAccountMetaList.toBase58()).to.equal(expected.toBase58());
  });

  it("Cannot re-initialize ExtraAccountMetaList", async () => {
    try {
      await initializeExtraAccountMetaList(
        hookProgram, program, authority, mint.publicKey
      );
      expect.fail("Should have thrown — already initialized");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  // ── Clean transfer ────────────────────────────────────────────

  it("Clean wallet transfer passes through hook", async () => {
    const transferAmount = 1_000_000; // 1 token

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      senderAta,
      mint.publicKey,
      receiverAta,
      senderKeypair.publicKey,
      BigInt(transferAmount),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    const sig = await provider.sendAndConfirm(tx, [senderKeypair]);
    await provider.connection.confirmTransaction(sig, "confirmed");

    const receiverAccount = await getAccount(
      provider.connection,
      receiverAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(receiverAccount.amount)).to.equal(transferAmount);
  });

  it("Multiple clean transfers work", async () => {
    const transferAmount = 2_000_000;

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      senderAta,
      mint.publicKey,
      receiverAta,
      senderKeypair.publicKey,
      BigInt(transferAmount),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    const sig = await provider.sendAndConfirm(tx, [senderKeypair]);
    await provider.connection.confirmTransaction(sig, "confirmed");

    const receiverAccount = await getAccount(
      provider.connection,
      receiverAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    // 1M from previous test + 2M = 3M
    expect(Number(receiverAccount.amount)).to.equal(3_000_000);
  });

  // ── Blacklisted sender ────────────────────────────────────────

  it("Blacklisted sender: transfer rejected", async () => {
    // Blacklist the sender
    const [senderBlEntry] = findBlacklistEntryPda(
      configPda,
      senderKeypair.publicKey,
      program.programId
    );

    const blSig = await program.methods
      .blacklist(senderKeypair.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: senderBlEntry,
        walletTokenAccount: senderAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(blSig, "confirmed");

    // Attempt transfer from blacklisted sender — should fail
    // But the account is frozen, so the Token program itself will reject.
    // The hook would also reject, but freeze check happens first.
    try {
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        senderAta,
        mint.publicKey,
        receiverAta,
        senderKeypair.publicKey,
        BigInt(1_000_000),
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await provider.sendAndConfirm(tx, [senderKeypair]);
      expect.fail("Should have thrown — sender is blacklisted/frozen");
    } catch (err: any) {
      // Token program rejects frozen account transfer
      expect(err).to.exist;
    }

    // Unblacklist sender for following tests
    const unblSig = await program.methods
      .unblacklist()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: senderBlEntry,
        walletTokenAccount: senderAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(unblSig, "confirmed");
  });

  // ── Blacklisted receiver ──────────────────────────────────────

  it("Blacklisted receiver: transfer rejected", async () => {
    // Blacklist the receiver
    const [receiverBlEntry] = findBlacklistEntryPda(
      configPda,
      receiverKeypair.publicKey,
      program.programId
    );

    const blSig = await program.methods
      .blacklist(receiverKeypair.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: receiverBlEntry,
        walletTokenAccount: receiverAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(blSig, "confirmed");

    // Attempt transfer to blacklisted receiver
    try {
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        senderAta,
        mint.publicKey,
        receiverAta,
        senderKeypair.publicKey,
        BigInt(1_000_000),
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await provider.sendAndConfirm(tx, [senderKeypair]);
      expect.fail("Should have thrown — receiver is blacklisted");
    } catch (err: any) {
      // Either frozen account error or hook SenderBlacklisted/ReceiverBlacklisted
      expect(err).to.exist;
    }

    // Unblacklist receiver for following tests
    const unblSig = await program.methods
      .unblacklist()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: receiverBlEntry,
        walletTokenAccount: receiverAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(unblSig, "confirmed");
  });

  // ── Paused stablecoin ─────────────────────────────────────────

  it("Paused stablecoin: transfer rejected", async () => {
    // Assign Pauser role
    const pauserKeypair = Keypair.generate();
    await airdrop(provider, pauserKeypair.publicKey);
    const pauserRolePda = await assignRole(
      program, authority, configPda, Role.Pauser,
      pauserKeypair.publicKey
    );

    // Pause
    const pauseSig = await program.methods
      .pause()
      .accountsStrict({
        authority: pauserKeypair.publicKey,
        config: configPda,
        roleConfig: pauserRolePda,
      })
      .signers([pauserKeypair])
      .rpc();
    await provider.connection.confirmTransaction(pauseSig, "confirmed");

    // Attempt transfer while paused
    try {
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        senderAta,
        mint.publicKey,
        receiverAta,
        senderKeypair.publicKey,
        BigInt(1_000_000),
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await provider.sendAndConfirm(tx, [senderKeypair]);
      expect.fail("Should have thrown — stablecoin is paused");
    } catch (err: any) {
      expect(err).to.exist;
    }

    // Unpause for following tests
    const unpauseSig = await program.methods
      .unpause()
      .accountsStrict({
        authority: pauserKeypair.publicKey,
        config: configPda,
        roleConfig: pauserRolePda,
      })
      .signers([pauserKeypair])
      .rpc();
    await provider.connection.confirmTransaction(unpauseSig, "confirmed");
  });

  // ── Transfer works again after unpause ────────────────────────

  it("Transfer works after unpause", async () => {
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      senderAta,
      mint.publicKey,
      receiverAta,
      senderKeypair.publicKey,
      BigInt(500_000),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    const sig = await provider.sendAndConfirm(tx, [senderKeypair]);
    await provider.connection.confirmTransaction(sig, "confirmed");

    const receiverAccount = await getAccount(
      provider.connection,
      receiverAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    // 3M from previous + 500K = 3_500_000
    expect(Number(receiverAccount.amount)).to.equal(3_500_000);
  });

  // ── Transfer after unblacklist works ──────────────────────────

  it("Transfer works after sender is unblacklisted", async () => {
    // Sender was unblacklisted earlier. Verify a transfer works.
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      senderAta,
      mint.publicKey,
      receiverAta,
      senderKeypair.publicKey,
      BigInt(500_000),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    const sig = await provider.sendAndConfirm(tx, [senderKeypair]);
    await provider.connection.confirmTransaction(sig, "confirmed");

    const receiverAccount = await getAccount(
      provider.connection,
      receiverAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    // 3_500_000 + 500_000 = 4_000_000
    expect(Number(receiverAccount.amount)).to.equal(4_000_000);
  });

  // ── Sender has correct remaining balance ──────────────────────

  it("Sender balance decremented correctly after transfers", async () => {
    const senderAccount = await getAccount(
      provider.connection,
      senderAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    // Started with 100M, sent 1M + 2M + 0.5M + 0.5M = 4M → 96M
    expect(Number(senderAccount.amount)).to.equal(96_000_000);
  });
});
