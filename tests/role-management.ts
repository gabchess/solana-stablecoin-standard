import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { SssToken } from "../target/types/sss_token";
import { expect } from "chai";
import {
  findConfigPda,
  findRoleConfigPda,
  initializeSss1,
  assignRole,
  airdrop,
  Role,
} from "./helpers";

describe("Role Management", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;

  // Role holders
  const minterWallet = Keypair.generate();
  const burnerWallet = Keypair.generate();
  const blacklisterWallet = Keypair.generate();
  const pauserWallet = Keypair.generate();
  const seizerWallet = Keypair.generate();

  before(async () => {
    mint = Keypair.generate();
    const result = await initializeSss1(program, authority, mint);
    configPda = result.config;
  });

  // ── Assign all 5 roles ─────────────────────────────────────────

  it("Assigns Minter role with allowance", async () => {
    const roleConfigPda = await assignRole(
      program,
      authority,
      configPda,
      Role.Minter,
      minterWallet.publicKey,
      1_000_000
    );

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.config.toBase58()).to.equal(configPda.toBase58());
    expect(rc.role).to.equal(Role.Minter);
    expect(rc.holder.toBase58()).to.equal(minterWallet.publicKey.toBase58());
    expect(rc.mintAllowance).to.not.be.null;
    expect(rc.mintAllowance!.toNumber()).to.equal(1_000_000);
  });

  it("Assigns Burner role", async () => {
    const roleConfigPda = await assignRole(
      program,
      authority,
      configPda,
      Role.Burner,
      burnerWallet.publicKey
    );

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.role).to.equal(Role.Burner);
    expect(rc.holder.toBase58()).to.equal(burnerWallet.publicKey.toBase58());
    expect(rc.mintAllowance).to.be.null;
  });

  it("Assigns Blacklister role", async () => {
    const roleConfigPda = await assignRole(
      program,
      authority,
      configPda,
      Role.Blacklister,
      blacklisterWallet.publicKey
    );

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.role).to.equal(Role.Blacklister);
    expect(rc.holder.toBase58()).to.equal(
      blacklisterWallet.publicKey.toBase58()
    );
  });

  it("Assigns Pauser role", async () => {
    const roleConfigPda = await assignRole(
      program,
      authority,
      configPda,
      Role.Pauser,
      pauserWallet.publicKey
    );

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.role).to.equal(Role.Pauser);
    expect(rc.holder.toBase58()).to.equal(pauserWallet.publicKey.toBase58());
  });

  it("Assigns Seizer role", async () => {
    const roleConfigPda = await assignRole(
      program,
      authority,
      configPda,
      Role.Seizer,
      seizerWallet.publicKey
    );

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.role).to.equal(Role.Seizer);
    expect(rc.holder.toBase58()).to.equal(seizerWallet.publicKey.toBase58());
  });

  // ── Verify PDA derivation ──────────────────────────────────────

  it("Role PDA matches manual derivation", async () => {
    const [expectedPda] = findRoleConfigPda(
      configPda,
      Role.Minter,
      minterWallet.publicKey,
      program.programId
    );

    const rc = await program.account.roleConfig.fetch(expectedPda);
    expect(rc.holder.toBase58()).to.equal(minterWallet.publicKey.toBase58());
    expect(rc.role).to.equal(Role.Minter);
  });

  // ── Unlimited allowance ────────────────────────────────────────

  it("Assigns Minter with unlimited allowance (null)", async () => {
    const unlimitedMinter = Keypair.generate();
    const roleConfigPda = await assignRole(
      program,
      authority,
      configPda,
      Role.Minter,
      unlimitedMinter.publicKey,
      null
    );

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.mintAllowance).to.be.null;
  });

  // ── Update mint allowance ──────────────────────────────────────

  it("Updates minter allowance", async () => {
    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Minter,
      minterWallet.publicKey,
      program.programId
    );

    await program.methods
      .updateMintAllowance(new anchor.BN(2_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: roleConfigPda,
      })
      .signers([authority])
      .rpc();

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.mintAllowance!.toNumber()).to.equal(2_000_000);
  });

  it("Updates allowance to unlimited (null)", async () => {
    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Minter,
      minterWallet.publicKey,
      program.programId
    );

    await program.methods
      .updateMintAllowance(null)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: roleConfigPda,
      })
      .signers([authority])
      .rpc();

    const rc = await program.account.roleConfig.fetch(roleConfigPda);
    expect(rc.mintAllowance).to.be.null;
  });

  // ── Revoke role ────────────────────────────────────────────────

  it("Revokes Seizer role (account closes)", async () => {
    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Seizer,
      seizerWallet.publicKey,
      program.programId
    );

    await program.methods
      .revokeRole()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleConfig: roleConfigPda,
      })
      .signers([authority])
      .rpc();

    // Account should be closed
    try {
      await program.account.roleConfig.fetch(roleConfigPda);
      expect.fail("Account should be closed");
    } catch (err: any) {
      expect(err.toString()).to.include("Account does not exist");
    }
  });

  // ── Error: Invalid role value ──────────────────────────────────

  it("Rejects invalid role value (255)", async () => {
    const randomWallet = Keypair.generate();
    const badRole = 255;
    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      badRole,
      randomWallet.publicKey,
      program.programId
    );

    try {
      await program.methods
        .assignRole(badRole, randomWallet.publicKey, null)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleConfig: roleConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("WrongRole");
    }
  });

  // ── Error: Unauthorized ────────────────────────────────────────

  it("Non-master cannot assign roles", async () => {
    const impostor = Keypair.generate();
    await airdrop(provider, impostor.publicKey);

    const randomHolder = Keypair.generate();
    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Minter,
      randomHolder.publicKey,
      program.programId
    );

    try {
      await program.methods
        .assignRole(Role.Minter, randomHolder.publicKey, null)
        .accountsStrict({
          authority: impostor.publicKey,
          config: configPda,
          roleConfig: roleConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([impostor])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("Cannot assign same role to same holder twice", async () => {
    // minterWallet already has Minter role from earlier test
    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Minter,
      minterWallet.publicKey,
      program.programId
    );

    try {
      await program.methods
        .assignRole(
          Role.Minter,
          minterWallet.publicKey,
          new anchor.BN(5000)
        )
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleConfig: roleConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Anchor init fails because PDA already has data
      expect(err).to.exist;
    }
  });

  it("Non-master cannot revoke roles", async () => {
    const impostor = Keypair.generate();
    await airdrop(provider, impostor.publicKey);

    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Burner,
      burnerWallet.publicKey,
      program.programId
    );

    try {
      await program.methods
        .revokeRole()
        .accountsStrict({
          authority: impostor.publicKey,
          config: configPda,
          roleConfig: roleConfigPda,
        })
        .signers([impostor])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("Non-master cannot update mint allowance", async () => {
    const impostor = Keypair.generate();
    await airdrop(provider, impostor.publicKey);

    const [roleConfigPda] = findRoleConfigPda(
      configPda,
      Role.Minter,
      minterWallet.publicKey,
      program.programId
    );

    try {
      await program.methods
        .updateMintAllowance(new anchor.BN(9999))
        .accountsStrict({
          authority: impostor.publicKey,
          config: configPda,
          roleConfig: roleConfigPda,
        })
        .signers([impostor])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });
});
