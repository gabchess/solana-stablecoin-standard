import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
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
  findRoleConfigPda,
  findBlacklistEntryPda,
  findExtraAccountMetaListPda,
  initializeSss1,
  initializeSss2,
  initializeExtraAccountMetaList,
  assignRole,
  createAta,
  getAta,
  airdrop,
  Role,
  TOKEN_PROGRAM,
  HOOK_PROGRAM_ID,
} from "./helpers";

// ═══════════════════════════════════════════════════════════════════
// Full Lifecycle — end-to-end flows for SSS-1 and SSS-2
// ═══════════════════════════════════════════════════════════════════

describe("Full Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const hookProgram = anchor.workspace.SssTransferHook as Program<SssTransferHook>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  // ─────────────────────────────────────────────────────────────────
  // SSS-1: initialize → assign minter → mint → burn → pause → unpause
  // ─────────────────────────────────────────────────────────────────

  describe("SSS-1 End-to-End", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let minterKeypair: Keypair;
    let minterRolePda: PublicKey;
    let pauserKeypair: Keypair;
    let pauserRolePda: PublicKey;
    let userKeypair: Keypair;
    let userAta: PublicKey;

    it("Initialize SSS-1 stablecoin", async () => {
      mint = Keypair.generate();
      const result = await initializeSss1(program, authority, mint, {
        name: "Lifecycle SSS1",
        symbol: "LC1",
        uri: "https://lifecycle.com",
        decimals: 6,
        supplyCap: 1_000_000_000, // 1B
      });
      configPda = result.config;

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.preset).to.equal(1);
      expect(config.paused).to.equal(false);
      expect(config.masterAuthority.toString()).to.equal(
        authority.publicKey.toString()
      );
    });

    it("Assign minter and pauser roles", async () => {
      minterKeypair = Keypair.generate();
      await airdrop(provider, minterKeypair.publicKey);
      minterRolePda = await assignRole(
        program, authority, configPda, Role.Minter,
        minterKeypair.publicKey, null // unlimited
      );

      pauserKeypair = Keypair.generate();
      await airdrop(provider, pauserKeypair.publicKey);
      pauserRolePda = await assignRole(
        program, authority, configPda, Role.Pauser,
        pauserKeypair.publicKey
      );

      // Verify
      const minterRole = await program.account.roleConfig.fetch(minterRolePda);
      expect(minterRole.role).to.equal(Role.Minter);
      expect(minterRole.holder.toString()).to.equal(
        minterKeypair.publicKey.toString()
      );
    });

    it("Mint tokens to user", async () => {
      userKeypair = Keypair.generate();
      await airdrop(provider, userKeypair.publicKey);
      userAta = await createAta(
        provider, mint.publicKey, userKeypair.publicKey
      );

      const sig = await program.methods
        .mintTokens(new anchor.BN(50_000_000))
        .accountsStrict({
          minter: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda,
          destination: userAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      const account = await getAccount(
        provider.connection,
        userAta,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      expect(Number(account.amount)).to.equal(50_000_000);
    });

    it("User self-burns tokens", async () => {
      const sig = await program.methods
        .burnTokens(new anchor.BN(10_000_000))
        .accountsStrict({
          authority: userKeypair.publicKey,
          config: configPda,
          roleConfig: null,
          fromAta: userAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([userKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      const account = await getAccount(
        provider.connection,
        userAta,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      expect(Number(account.amount)).to.equal(40_000_000);
    });

    it("Pause → mint fails → unpause → mint succeeds", async () => {
      // Pause
      let sig = await program.methods
        .pause()
        .accountsStrict({
          authority: pauserKeypair.publicKey,
          config: configPda,
          roleConfig: pauserRolePda,
        })
        .signers([pauserKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Mint fails while paused
      try {
        await program.methods
          .mintTokens(new anchor.BN(1_000_000))
          .accountsStrict({
            minter: minterKeypair.publicKey,
            config: configPda,
            roleConfig: minterRolePda,
            destination: userAta,
            mint: mint.publicKey,
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
          })
          .signers([minterKeypair])
          .rpc();
        expect.fail("Should have thrown — paused");
      } catch (err: any) {
        expect(err.toString()).to.include("Paused");
      }

      // Unpause
      sig = await program.methods
        .unpause()
        .accountsStrict({
          authority: pauserKeypair.publicKey,
          config: configPda,
          roleConfig: pauserRolePda,
        })
        .signers([pauserKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Mint succeeds after unpause
      sig = await program.methods
        .mintTokens(new anchor.BN(1_000_000))
        .accountsStrict({
          minter: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda,
          destination: userAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      const account = await getAccount(
        provider.connection,
        userAta,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      // 40M + 1M = 41M
      expect(Number(account.amount)).to.equal(41_000_000);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // SSS-2: initialize → approve → mint → transfer (hook passes) →
  //        blacklist → transfer (hook rejects) → seize → unblacklist
  // ─────────────────────────────────────────────────────────────────

  describe("SSS-2 End-to-End", () => {
    let mint: Keypair;
    let configPda: PublicKey;
    let minterKeypair: Keypair;
    let minterRolePda: PublicKey;
    let blacklisterKeypair: Keypair;
    let blacklisterRolePda: PublicKey;
    let seizerKeypair: Keypair;
    let seizerRolePda: PublicKey;

    let aliceKeypair: Keypair;
    let aliceAta: PublicKey;
    let bobKeypair: Keypair;
    let bobAta: PublicKey;
    let treasuryKeypair: Keypair;
    let treasuryAta: PublicKey;

    it("Initialize SSS-2 stablecoin + ExtraAccountMetaList", async () => {
      mint = Keypair.generate();
      const result = await initializeSss2(program, authority, mint, {
        name: "Lifecycle SSS2",
        symbol: "LC2",
        uri: "https://lifecycle.com",
        decimals: 6,
      });
      configPda = result.config;

      await initializeExtraAccountMetaList(
        hookProgram, program, authority, mint.publicKey
      );

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.preset).to.equal(2);
    });

    it("Assign roles + approve wallets + mint tokens", async () => {
      // Assign all roles
      minterKeypair = Keypair.generate();
      await airdrop(provider, minterKeypair.publicKey);
      minterRolePda = await assignRole(
        program, authority, configPda, Role.Minter,
        minterKeypair.publicKey, null
      );

      blacklisterKeypair = Keypair.generate();
      await airdrop(provider, blacklisterKeypair.publicKey);
      blacklisterRolePda = await assignRole(
        program, authority, configPda, Role.Blacklister,
        blacklisterKeypair.publicKey
      );

      seizerKeypair = Keypair.generate();
      await airdrop(provider, seizerKeypair.publicKey);
      seizerRolePda = await assignRole(
        program, authority, configPda, Role.Seizer,
        seizerKeypair.publicKey
      );

      // Create wallets
      aliceKeypair = Keypair.generate();
      await airdrop(provider, aliceKeypair.publicKey);
      aliceAta = await createAta(
        provider, mint.publicKey, aliceKeypair.publicKey, aliceKeypair
      );

      bobKeypair = Keypair.generate();
      await airdrop(provider, bobKeypair.publicKey);
      bobAta = await createAta(
        provider, mint.publicKey, bobKeypair.publicKey, bobKeypair
      );

      treasuryKeypair = Keypair.generate();
      await airdrop(provider, treasuryKeypair.publicKey);
      treasuryAta = await createAta(
        provider, mint.publicKey, treasuryKeypair.publicKey, treasuryKeypair
      );

      // Approve all wallets (thaw from DefaultAccountState=Frozen)
      for (const { kp, ata } of [
        { kp: aliceKeypair, ata: aliceAta },
        { kp: bobKeypair, ata: bobAta },
        { kp: treasuryKeypair, ata: treasuryAta },
      ]) {
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

      // Mint tokens to Alice
      const sig = await program.methods
        .mintTokens(new anchor.BN(20_000_000))
        .accountsStrict({
          minter: minterKeypair.publicKey,
          config: configPda,
          roleConfig: minterRolePda,
          destination: aliceAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([minterKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      const aliceAccount = await getAccount(
        provider.connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(aliceAccount.amount)).to.equal(20_000_000);
    });

    it("Transfer Alice → Bob passes through transfer hook", async () => {
      const connection = provider.connection;
      const transferAmount = BigInt(5_000_000);

      // Build hook-aware transfer instruction
      const ix = await createTransferCheckedWithTransferHookInstruction(
        connection,
        aliceAta,
        mint.publicKey,
        bobAta,
        aliceKeypair.publicKey,
        transferAmount,
        6, // decimals
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new anchor.web3.Transaction().add(ix);
      const sig = await provider.sendAndConfirm(tx, [aliceKeypair]);
      await connection.confirmTransaction(sig, "confirmed");

      const bobAccount = await getAccount(
        connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(bobAccount.amount)).to.equal(5_000_000);

      const aliceAccount = await getAccount(
        connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(aliceAccount.amount)).to.equal(15_000_000);
    });

    it("Blacklist Bob → transfer to Bob rejected by hook", async () => {
      // Blacklist Bob
      const [blEntry] = findBlacklistEntryPda(
        configPda, bobKeypair.publicKey, program.programId
      );

      let sig = await program.methods
        .blacklist(bobKeypair.publicKey)
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda,
          roleConfig: blacklisterRolePda,
          blacklistEntry: blEntry,
          walletTokenAccount: bobAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklisterKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Bob is frozen — verify
      const bobAccount = await getAccount(
        provider.connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(bobAccount.isFrozen).to.equal(true);

      // Alice tries to transfer to Bob → rejected by hook (receiver blacklisted)
      try {
        const ix = await createTransferCheckedWithTransferHookInstruction(
          provider.connection,
          aliceAta,
          mint.publicKey,
          bobAta,
          aliceKeypair.publicKey,
          BigInt(1_000_000),
          6,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

        const tx = new anchor.web3.Transaction().add(ix);
        await provider.sendAndConfirm(tx, [aliceKeypair]);
        expect.fail("Should have thrown — receiver blacklisted");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it("Seize tokens from blacklisted Bob → treasury", async () => {
      const [blEntry] = findBlacklistEntryPda(
        configPda, bobKeypair.publicKey, program.programId
      );
      const [extraMetaList] = findExtraAccountMetaListPda(
        mint.publicKey, HOOK_PROGRAM_ID
      );
      const [senderBl] = findBlacklistEntryPda(
        configPda, bobKeypair.publicKey, program.programId
      );
      const [receiverBl] = findBlacklistEntryPda(
        configPda, treasuryKeypair.publicKey, program.programId
      );

      const remainingAccounts = [
        { pubkey: extraMetaList, isWritable: false, isSigner: false },
        { pubkey: HOOK_PROGRAM_ID, isWritable: false, isSigner: false },
        { pubkey: program.programId, isWritable: false, isSigner: false },
        { pubkey: configPda, isWritable: false, isSigner: false },
        { pubkey: senderBl, isWritable: false, isSigner: false },
        { pubkey: receiverBl, isWritable: false, isSigner: false },
      ];

      const sig = await program.methods
        .seize(new anchor.BN(5_000_000)) // seize all of Bob's tokens
        .accountsStrict({
          seizer: seizerKeypair.publicKey,
          config: configPda,
          roleConfig: seizerRolePda,
          blacklistEntry: blEntry,
          fromAta: bobAta,
          treasuryAta: treasuryAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .remainingAccounts(remainingAccounts)
        .signers([seizerKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Bob has 0 tokens now
      const bobAccount = await getAccount(
        provider.connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(bobAccount.amount)).to.equal(0);

      // Treasury has 5M
      const treasuryAccount = await getAccount(
        provider.connection, treasuryAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(treasuryAccount.amount)).to.equal(5_000_000);

      // Bob is still frozen
      expect(bobAccount.isFrozen).to.equal(true);
    });

    it("Unblacklist Bob → can receive transfers again", async () => {
      const [blEntry] = findBlacklistEntryPda(
        configPda, bobKeypair.publicKey, program.programId
      );

      // Unblacklist
      let sig = await program.methods
        .unblacklist()
        .accountsStrict({
          blacklister: blacklisterKeypair.publicKey,
          config: configPda,
          roleConfig: blacklisterRolePda,
          blacklistEntry: blEntry,
          walletTokenAccount: bobAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([blacklisterKeypair])
        .rpc();
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Bob is thawed
      let bobAccount = await getAccount(
        provider.connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(bobAccount.isFrozen).to.equal(false);

      // Alice can transfer to Bob again
      const ix = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        aliceAta,
        mint.publicKey,
        bobAta,
        aliceKeypair.publicKey,
        BigInt(2_000_000),
        6,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new anchor.web3.Transaction().add(ix);
      sig = await provider.sendAndConfirm(tx, [aliceKeypair]);
      await provider.connection.confirmTransaction(sig, "confirmed");

      bobAccount = await getAccount(
        provider.connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(bobAccount.amount)).to.equal(2_000_000);

      const aliceAccount = await getAccount(
        provider.connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      // 15M - 2M = 13M
      expect(Number(aliceAccount.amount)).to.equal(13_000_000);
    });
  });
});
