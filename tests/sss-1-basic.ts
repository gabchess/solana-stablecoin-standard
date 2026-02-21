import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getTokenMetadata,
  getMetadataPointerState,
  getMintCloseAuthority,
} from "@solana/spl-token";
import { SssToken } from "../target/types/sss_token";
import { expect } from "chai";
import {
  findConfigPda,
  initializeSss1,
  airdrop,
} from "./helpers";

describe("SSS-1 Basic Operations", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  let mint: Keypair;
  let configPda: PublicKey;

  const name = "Test Stablecoin";
  const symbol = "TSTB";
  const uri = "https://test.com/metadata.json";
  const decimals = 6;

  // ── Core initialization ─────────────────────────────────────────

  it("Initializes an SSS-1 stablecoin", async () => {
    mint = Keypair.generate();
    const result = await initializeSss1(program, authority, mint, {
      name,
      symbol,
      uri,
      decimals,
    });
    configPda = result.config;
  });

  it("Config has correct fields", async () => {
    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.masterAuthority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(config.mint.toBase58()).to.equal(mint.publicKey.toBase58());
    expect(config.preset).to.equal(1);
    expect(config.paused).to.equal(false);
    expect(config.supplyCap).to.be.null;
    expect(config.decimals).to.equal(decimals);
    expect(config.transferHookProgram.toBase58()).to.equal(
      PublicKey.default.toBase58()
    );
  });

  // ── Token-2022 extension verification ───────────────────────────

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

  // ── Validation error tests ──────────────────────────────────────

  it("Rejects name too long (>32 chars)", async () => {
    const badMint = Keypair.generate();
    const longName = "A".repeat(33);
    try {
      await initializeSss1(program, authority, badMint, {
        name: longName,
        symbol,
        uri,
        decimals,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("NameTooLong");
    }
  });

  it("Rejects symbol too long (>10 chars)", async () => {
    const badMint = Keypair.generate();
    const longSymbol = "A".repeat(11);
    try {
      await initializeSss1(program, authority, badMint, {
        name,
        symbol: longSymbol,
        uri,
        decimals,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("SymbolTooLong");
    }
  });

  it("Rejects URI too long (>200 chars)", async () => {
    const badMint = Keypair.generate();
    const longUri = "https://" + "a".repeat(200);
    try {
      await initializeSss1(program, authority, badMint, {
        name,
        symbol,
        uri: longUri,
        decimals,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("UriTooLong");
    }
  });

  it("Cannot re-initialize with same mint", async () => {
    try {
      await initializeSss1(program, authority, mint, {
        name,
        symbol,
        uri,
        decimals,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Config PDA already exists or mint account already initialized
      expect(err).to.exist;
    }
  });

  // ── Supply cap ──────────────────────────────────────────────────

  it("Initializes with supply cap", async () => {
    const cappedMint = Keypair.generate();
    const result = await initializeSss1(program, authority, cappedMint, {
      name: "Capped Token",
      symbol: "CTKN",
      uri,
      decimals,
      supplyCap: 1_000_000_000,
    });

    const config = await program.account.stablecoinConfig.fetch(result.config);
    expect(config.supplyCap).to.not.be.null;
    expect(config.supplyCap!.toNumber()).to.equal(1_000_000_000);
    expect(config.preset).to.equal(1);
  });

  it("Different authority can initialize their own stablecoin", async () => {
    const otherAuthority = Keypair.generate();
    await airdrop(provider, otherAuthority.publicKey);

    const otherMint = Keypair.generate();
    const result = await initializeSss1(program, otherAuthority, otherMint, {
      name: "Other Coin",
      symbol: "OTH",
      uri,
      decimals,
    });

    const config = await program.account.stablecoinConfig.fetch(result.config);
    expect(config.masterAuthority.toBase58()).to.equal(
      otherAuthority.publicKey.toBase58()
    );
  });
});
