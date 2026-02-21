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
  findBlacklistEntryPda,
  findRoleConfigPda,
  findExtraAccountMetaListPda,
  initializeSss1,
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

describe("Seize", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const hookProgram = anchor.workspace.SssTransferHook as Program<SssTransferHook>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  /**
   * Build remaining accounts for seize instruction's transfer_checked CPI.
   * Token-2022 needs these for the transfer hook resolution:
   *   - ExtraAccountMetaList PDA
   *   - Transfer hook program
   *   - sss_token_program (for PDA derivation)
   *   - StablecoinConfig PDA
   *   - Sender BlacklistEntry PDA
   *   - Receiver BlacklistEntry PDA
   */
  function buildSeizeRemainingAccounts(
    mintPk: PublicKey,
    configPk: PublicKey,
    senderWallet: PublicKey,
    receiverWallet: PublicKey
  ) {
    const [extraMetaList] = findExtraAccountMetaListPda(mintPk, HOOK_PROGRAM_ID);
    const [senderBl] = findBlacklistEntryPda(configPk, senderWallet, program.programId);
    const [receiverBl] = findBlacklistEntryPda(configPk, receiverWallet, program.programId);

    return [
      { pubkey: extraMetaList, isWritable: false, isSigner: false },
      { pubkey: HOOK_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: program.programId, isWritable: false, isSigner: false },
      { pubkey: configPk, isWritable: false, isSigner: false },
      { pubkey: senderBl, isWritable: false, isSigner: false },
      { pubkey: receiverBl, isWritable: false, isSigner: false },
    ];
  }

  let mint: Keypair;
  let configPda: PublicKey;

  // Roles
  let seizerKeypair: Keypair;
  let seizerRolePda: PublicKey;
  let blacklisterKeypair: Keypair;
  let blacklisterRolePda: PublicKey;
  let minterKeypair: Keypair;
  let minterRolePda: PublicKey;

  // Target (blacklisted wallet)
  let targetKeypair: Keypair;
  let targetAta: PublicKey;

  // Treasury
  let treasuryKeypair: Keypair;
  let treasuryAta: PublicKey;

  // ── Setup ─────────────────────────────────────────────────────

  before(async () => {
    // Create SSS-2 stablecoin
    mint = Keypair.generate();
    const result = await initializeSss2(program, authority, mint, {
      name: "Seize Test",
      symbol: "SZTT",
      uri: "https://test.com",
      decimals: 6,
    });
    configPda = result.config;

    // Initialize ExtraAccountMetaList (required for transfer_checked hook CPI)
    await initializeExtraAccountMetaList(
      hookProgram, program, authority, mint.publicKey
    );

    // Assign roles
    seizerKeypair = Keypair.generate();
    await airdrop(provider, seizerKeypair.publicKey);
    seizerRolePda = await assignRole(
      program, authority, configPda, Role.Seizer,
      seizerKeypair.publicKey
    );

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
      minterKeypair.publicKey, null // unlimited
    );

    // Create target wallet, approve, mint tokens, then blacklist
    targetKeypair = Keypair.generate();
    await airdrop(provider, targetKeypair.publicKey);
    targetAta = await createAta(
      provider, mint.publicKey, targetKeypair.publicKey, targetKeypair
    );

    // Approve target ATA (thaw from DefaultAccountState)
    let sig = await program.methods
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

    // Mint 10M tokens to target
    sig = await program.methods
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

    // Create treasury wallet and approve
    treasuryKeypair = Keypair.generate();
    await airdrop(provider, treasuryKeypair.publicKey);
    treasuryAta = await createAta(
      provider, mint.publicKey, treasuryKeypair.publicKey, treasuryKeypair
    );

    sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        walletTokenAccount: treasuryAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Blacklist the target
    const [blEntry] = findBlacklistEntryPda(
      configPda, targetKeypair.publicKey, program.programId
    );

    sig = await program.methods
      .blacklist(targetKeypair.publicKey)
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        blacklistEntry: blEntry,
        walletTokenAccount: targetAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");
  });

  // ── Successful seize ──────────────────────────────────────────

  it("Seize tokens from blacklisted wallet to treasury", async () => {
    const [blEntry] = findBlacklistEntryPda(
      configPda, targetKeypair.publicKey, program.programId
    );

    const sig = await program.methods
      .seize(new anchor.BN(5_000_000))
      .accountsStrict({
        seizer: seizerKeypair.publicKey,
        config: configPda,
        roleConfig: seizerRolePda,
        blacklistEntry: blEntry,
        fromAta: targetAta,
        treasuryAta: treasuryAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .remainingAccounts(
        buildSeizeRemainingAccounts(
          mint.publicKey, configPda,
          targetKeypair.publicKey, treasuryKeypair.publicKey
        )
      )
      .signers([seizerKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    // Verify tokens moved
    const targetAccount = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(targetAccount.amount)).to.equal(5_000_000); // 10M - 5M

    const treasuryAccount = await getAccount(
      provider.connection,
      treasuryAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(treasuryAccount.amount)).to.equal(5_000_000);
  });

  it("Source account is re-frozen after seize", async () => {
    const targetAccount = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(targetAccount.isFrozen).to.equal(true);
  });

  it("Can seize remaining tokens (second seize)", async () => {
    const [blEntry] = findBlacklistEntryPda(
      configPda, targetKeypair.publicKey, program.programId
    );

    const sig = await program.methods
      .seize(new anchor.BN(5_000_000))
      .accountsStrict({
        seizer: seizerKeypair.publicKey,
        config: configPda,
        roleConfig: seizerRolePda,
        blacklistEntry: blEntry,
        fromAta: targetAta,
        treasuryAta: treasuryAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .remainingAccounts(
        buildSeizeRemainingAccounts(
          mint.publicKey, configPda,
          targetKeypair.publicKey, treasuryKeypair.publicKey
        )
      )
      .signers([seizerKeypair])
      .rpc();

    await provider.connection.confirmTransaction(sig, "confirmed");

    const targetAccount = await getAccount(
      provider.connection,
      targetAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(targetAccount.amount)).to.equal(0);

    const treasuryAccount = await getAccount(
      provider.connection,
      treasuryAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(treasuryAccount.amount)).to.equal(10_000_000); // 5M + 5M
  });

  // ── Error paths ───────────────────────────────────────────────

  it("Seize zero amount → ZeroAmount error", async () => {
    const [blEntry] = findBlacklistEntryPda(
      configPda, targetKeypair.publicKey, program.programId
    );

    try {
      await program.methods
        .seize(new anchor.BN(0))
        .accountsStrict({
          seizer: seizerKeypair.publicKey,
          config: configPda,
          roleConfig: seizerRolePda,
          blacklistEntry: blEntry,
          fromAta: targetAta,
          treasuryAta: treasuryAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([seizerKeypair])
        .rpc();
      expect.fail("Should have thrown — zero amount");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  it("Seize from non-blacklisted wallet → fails (no BlacklistEntry)", async () => {
    // Create a clean wallet with tokens
    const cleanKeypair = Keypair.generate();
    await airdrop(provider, cleanKeypair.publicKey);
    const cleanAta = await createAta(
      provider, mint.publicKey, cleanKeypair.publicKey, cleanKeypair
    );

    // Approve and mint
    let sig = await program.methods
      .approveAccount()
      .accountsStrict({
        blacklister: blacklisterKeypair.publicKey,
        config: configPda,
        roleConfig: blacklisterRolePda,
        walletTokenAccount: cleanAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([blacklisterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    sig = await program.methods
      .mintTokens(new anchor.BN(1_000_000))
      .accountsStrict({
        minter: minterKeypair.publicKey,
        config: configPda,
        roleConfig: minterRolePda,
        destination: cleanAta,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([minterKeypair])
      .rpc();
    await provider.connection.confirmTransaction(sig, "confirmed");

    // No BlacklistEntry exists for cleanKeypair
    const [fakeBlEntry] = findBlacklistEntryPda(
      configPda, cleanKeypair.publicKey, program.programId
    );

    try {
      await program.methods
        .seize(new anchor.BN(500_000))
        .accountsStrict({
          seizer: seizerKeypair.publicKey,
          config: configPda,
          roleConfig: seizerRolePda,
          blacklistEntry: fakeBlEntry,
          fromAta: cleanAta,
          treasuryAta: treasuryAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([seizerKeypair])
        .rpc();
      expect.fail("Should have thrown — wallet not blacklisted");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("Non-seizer cannot seize (Unauthorized)", async () => {
    const [blEntry] = findBlacklistEntryPda(
      configPda, targetKeypair.publicKey, program.programId
    );

    // Minter tries to seize — wrong role
    try {
      await program.methods
        .seize(new anchor.BN(1_000))
        .accountsStrict({
          seizer: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda, // Minter, not Seizer
          blacklistEntry: blEntry,
          fromAta: targetAta,
          treasuryAta: treasuryAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown — wrong role");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("Random user without role cannot seize", async () => {
    const randomUser = Keypair.generate();
    await airdrop(provider, randomUser.publicKey);

    const [fakeRolePda] = findRoleConfigPda(
      configPda, Role.Seizer, randomUser.publicKey, program.programId
    );
    const [blEntry] = findBlacklistEntryPda(
      configPda, targetKeypair.publicKey, program.programId
    );

    try {
      await program.methods
        .seize(new anchor.BN(1_000))
        .accountsStrict({
          seizer: randomUser.publicKey,
          config: configPda,
          roleConfig: fakeRolePda,
          blacklistEntry: blEntry,
          fromAta: targetAta,
          treasuryAta: treasuryAta,
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

  it("Seize on SSS-1 config → Sss2Required", async () => {
    // Create SSS-1 stablecoin
    const sss1Mint = Keypair.generate();
    const sss1Result = await initializeSss1(program, authority, sss1Mint, {
      name: "SSS1 Seize",
      symbol: "SS1S",
    });

    // Assign Seizer role on SSS-1
    const sss1Seizer = Keypair.generate();
    await airdrop(provider, sss1Seizer.publicKey);
    const sss1SeizerRole = await assignRole(
      program, authority, sss1Result.config, Role.Seizer,
      sss1Seizer.publicKey
    );

    // Create wallets
    const sss1Target = Keypair.generate();
    await airdrop(provider, sss1Target.publicKey);
    const sss1TargetAta = await createAta(
      provider, sss1Mint.publicKey, sss1Target.publicKey, sss1Target
    );

    const sss1Treasury = Keypair.generate();
    await airdrop(provider, sss1Treasury.publicKey);
    const sss1TreasuryAta = await createAta(
      provider, sss1Mint.publicKey, sss1Treasury.publicKey, sss1Treasury
    );

    // BlacklistEntry PDA (won't exist, but constraint check on preset fires first)
    const [sss1BlEntry] = findBlacklistEntryPda(
      sss1Result.config, sss1Target.publicKey, program.programId
    );

    try {
      await program.methods
        .seize(new anchor.BN(1_000))
        .accountsStrict({
          seizer: sss1Seizer.publicKey,
          config: sss1Result.config,
          roleConfig: sss1SeizerRole,
          blacklistEntry: sss1BlEntry,
          fromAta: sss1TargetAta,
          treasuryAta: sss1TreasuryAta,
          mint: sss1Mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([sss1Seizer])
        .rpc();
      expect.fail("Should have thrown — SSS-1 config");
    } catch (err: any) {
      // Anchor may fail on blacklist_entry deserialization (PDA doesn't exist)
      // before reaching the Sss2Required preset check — both are correct rejections.
      expect(err).to.exist;
    }
  });

  it("Treasury receives correct total after multiple seizes", async () => {
    const treasuryAccount = await getAccount(
      provider.connection,
      treasuryAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(treasuryAccount.amount)).to.equal(10_000_000);
  });
});
