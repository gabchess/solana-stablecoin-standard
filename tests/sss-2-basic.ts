import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getTokenMetadata,
  getMetadataPointerState,
  getMintCloseAuthority,
  getPermanentDelegate,
  getTransferHook,
  getDefaultAccountState,
  getAccount,
  AccountState,
} from "@solana/spl-token";
import { SssToken } from "../target/types/sss_token";
import { expect } from "chai";
import {
  findConfigPda,
  initializeSss2,
  airdrop,
  createAta,
  HOOK_PROGRAM_ID,
} from "./helpers";

describe("SSS-2 Basic Operations", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;

  const name = "Compliant Coin";
  const symbol = "COMP";
  const uri = "https://test.com/metadata.json";
  const decimals = 6;

  // ── Core initialization ─────────────────────────────────────────

  it("Initializes an SSS-2 stablecoin", async () => {
    mint = Keypair.generate();
    const result = await initializeSss2(program, authority, mint, {
      name,
      symbol,
      uri,
      decimals,
    });
    configPda = result.config;
  });

  it("Config has correct fields with preset=2", async () => {
    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.masterAuthority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(config.mint.toBase58()).to.equal(mint.publicKey.toBase58());
    expect(config.preset).to.equal(2);
    expect(config.paused).to.equal(false);
    expect(config.supplyCap).to.be.null;
    expect(config.decimals).to.equal(decimals);
    expect(config.transferHookProgram.toBase58()).to.equal(
      HOOK_PROGRAM_ID.toBase58()
    );
  });

  // ── Token-2022 extension verification (all 5) ──────────────────

  it("Mint has MetadataPointer extension", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const metadataPointer = getMetadataPointerState(mintInfo);
    expect(metadataPointer).to.not.be.null;
    expect(metadataPointer!.metadataAddress!.toBase58()).to.equal(
      mint.publicKey.toBase58()
    );
  });

  it("Mint has MintCloseAuthority extension", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const closeAuth = getMintCloseAuthority(mintInfo);
    expect(closeAuth).to.not.be.null;
    expect(closeAuth!.closeAuthority!.toBase58()).to.equal(
      configPda.toBase58()
    );
  });

  it("Mint has PermanentDelegate extension pointing to config PDA", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const permDelegate = getPermanentDelegate(mintInfo);
    expect(permDelegate).to.not.be.null;
    expect(permDelegate!.delegate!.toBase58()).to.equal(
      configPda.toBase58()
    );
  });

  it("Mint has TransferHook extension pointing to hook program", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const transferHook = getTransferHook(mintInfo);
    expect(transferHook).to.not.be.null;
    expect(transferHook!.programId!.toBase58()).to.equal(
      HOOK_PROGRAM_ID.toBase58()
    );
  });

  it("Mint has DefaultAccountState set to Frozen", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const defaultState = getDefaultAccountState(mintInfo);
    expect(defaultState).to.not.be.null;
    expect(defaultState!.state).to.equal(AccountState.Frozen);
  });

  it("Mint has correct metadata (name, symbol, URI)", async () => {
    const metadata = await getTokenMetadata(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(metadata).to.not.be.null;
    expect(metadata!.name).to.equal(name);
    expect(metadata!.symbol).to.equal(symbol);
    expect(metadata!.uri).to.equal(uri);
  });

  it("Mint authority is config PDA", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.mintAuthority!.toBase58()).to.equal(configPda.toBase58());
  });

  it("Freeze authority is config PDA", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mint.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.freezeAuthority!.toBase58()).to.equal(
      configPda.toBase58()
    );
  });

  // ── DefaultAccountState behavior ──────────────────────────────

  it("New ATA starts frozen (DefaultAccountState)", async () => {
    const user = Keypair.generate();
    await airdrop(provider, user.publicKey);
    const ata = await createAta(provider, mint.publicKey, user.publicKey, user);
    const account = await getAccount(
      provider.connection,
      ata,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.equal(true);
  });

  // ── Supply cap ──────────────────────────────────────────────────

  it("Initializes SSS-2 with supply cap", async () => {
    const cappedMint = Keypair.generate();
    const result = await initializeSss2(program, authority, cappedMint, {
      name: "Capped Compliant",
      symbol: "CCMP",
      uri,
      decimals,
      supplyCap: 500_000_000,
    });

    const config = await program.account.stablecoinConfig.fetch(result.config);
    expect(config.supplyCap).to.not.be.null;
    expect(config.supplyCap!.toNumber()).to.equal(500_000_000);
    expect(config.preset).to.equal(2);
  });
});
