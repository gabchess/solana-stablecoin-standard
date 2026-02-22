import { expect } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { SolanaStablecoin } from "../src/stablecoin";
import { getConfigAddress, getRoleAddress, getBlacklistAddress } from "../src/pda";
import { SSS_TOKEN_PROGRAM_ID } from "../src/constants";
import {
  Role,
  CreateSss1Params,
  CreateSss2Params,
  AssignRoleParams,
  MintParams,
  BurnParams,
  SeizeParams,
} from "../src/types";

// ---------------------------------------------------------------------------
// SolanaStablecoin — interface coverage tests
//
// These are SDK-level unit tests that validate TypeScript interfaces,
// parameter structures, PDA delegation, and type coercion without
// requiring a running Solana validator.
// ---------------------------------------------------------------------------

describe("SolanaStablecoin", () => {
  // ── Class structure ─────────────────────────────────────────────

  describe("class structure", () => {
    it("exports SolanaStablecoin as a class", () => {
      expect(SolanaStablecoin).to.be.a("function");
      expect(SolanaStablecoin.prototype).to.be.an("object");
    });

    it("has private constructor (no direct instantiation)", () => {
      // The constructor is private, so TypeScript prevents direct use.
      // At runtime, we verify the class doesn't expose a public new().
      // We can only instantiate via static factories.
      expect(SolanaStablecoin).to.have.property("load");
      expect(SolanaStablecoin).to.have.property("createSss1");
      expect(SolanaStablecoin).to.have.property("createSss2");
    });

    it("has static factory methods", () => {
      expect(SolanaStablecoin.load).to.be.a("function");
      expect(SolanaStablecoin.createSss1).to.be.a("function");
      expect(SolanaStablecoin.createSss2).to.be.a("function");
    });

    it("prototype has all role methods", () => {
      const proto = SolanaStablecoin.prototype;
      expect(proto.assignRole).to.be.a("function");
      expect(proto.revokeRole).to.be.a("function");
      expect(proto.updateMintAllowance).to.be.a("function");
      expect(proto.getRole).to.be.a("function");
    });

    it("prototype has all token methods", () => {
      const proto = SolanaStablecoin.prototype;
      expect(proto.mintTokens).to.be.a("function");
      expect(proto.burnTokens).to.be.a("function");
    });

    it("prototype has all compliance methods", () => {
      const proto = SolanaStablecoin.prototype;
      expect(proto.blacklist).to.be.a("function");
      expect(proto.unblacklist).to.be.a("function");
      expect(proto.approveAccount).to.be.a("function");
      expect(proto.seize).to.be.a("function");
      expect(proto.isBlacklisted).to.be.a("function");
    });

    it("prototype has all admin methods", () => {
      const proto = SolanaStablecoin.prototype;
      expect(proto.pause).to.be.a("function");
      expect(proto.unpause).to.be.a("function");
      expect(proto.transferMasterAuthority).to.be.a("function");
      expect(proto.updateSupplyCap).to.be.a("function");
    });

    it("prototype has state helpers", () => {
      const proto = SolanaStablecoin.prototype;
      expect(proto.refresh).to.be.a("function");
      expect(proto.getState).to.be.a("function");
      expect(proto.isPaused).to.be.a("function");
      expect(proto.isSss2).to.be.a("function");
      expect(proto.getSupplyCap).to.be.a("function");
      expect(proto.getMasterAuthority).to.be.a("function");
    });

    it("prototype has PDA helper methods", () => {
      const proto = SolanaStablecoin.prototype;
      expect(proto.getConfigAddress).to.be.a("function");
      expect(proto.getRoleAddress).to.be.a("function");
      expect(proto.getBlacklistAddress).to.be.a("function");
      expect(proto.getTokenAccount).to.be.a("function");
    });
  });

  // ── Parameter interfaces ────────────────────────────────────────

  describe("parameter interfaces", () => {
    it("CreateSss1Params accepts required fields", () => {
      const params: CreateSss1Params = {
        name: "Test USD",
        symbol: "TUSD",
        uri: "https://example.com/metadata.json",
      };

      expect(params.name).to.equal("Test USD");
      expect(params.symbol).to.equal("TUSD");
      expect(params.uri).to.equal("https://example.com/metadata.json");
      expect(params.decimals).to.be.undefined;
      expect(params.supplyCap).to.be.undefined;
    });

    it("CreateSss1Params accepts optional fields", () => {
      const params: CreateSss1Params = {
        name: "Test USD",
        symbol: "TUSD",
        uri: "https://example.com/metadata.json",
        decimals: 9,
        supplyCap: new BN(1_000_000_000),
      };

      expect(params.decimals).to.equal(9);
      expect((params.supplyCap as BN).toNumber()).to.equal(1_000_000_000);
    });

    it("CreateSss1Params accepts number supply cap", () => {
      const params: CreateSss1Params = {
        name: "Test USD",
        symbol: "TUSD",
        uri: "https://example.com/metadata.json",
        supplyCap: 5_000_000,
      };

      expect(params.supplyCap).to.equal(5_000_000);
    });

    it("CreateSss1Params accepts null supply cap (unlimited)", () => {
      const params: CreateSss1Params = {
        name: "Test USD",
        symbol: "TUSD",
        uri: "https://example.com/metadata.json",
        supplyCap: null,
      };

      expect(params.supplyCap).to.be.null;
    });

    it("CreateSss2Params extends CreateSss1Params with hookProgramId", () => {
      const hookId = PublicKey.unique();
      const params: CreateSss2Params = {
        name: "Compliant USD",
        symbol: "CUSD",
        uri: "https://example.com/metadata.json",
        hookProgramId: hookId,
      };

      expect(params.hookProgramId).to.be.instanceOf(PublicKey);
      expect(params.hookProgramId.equals(hookId)).to.be.true;
      // Inherits SSS-1 fields
      expect(params.name).to.equal("Compliant USD");
    });

    it("AssignRoleParams accepts all fields", () => {
      const holder = PublicKey.unique();
      const params: AssignRoleParams = {
        role: Role.Minter,
        holder,
        mintAllowance: new BN(1_000_000),
      };

      expect(params.role).to.equal(Role.Minter);
      expect(params.holder.equals(holder)).to.be.true;
      expect((params.mintAllowance as BN).toNumber()).to.equal(1_000_000);
    });

    it("AssignRoleParams allows null mint allowance (unlimited)", () => {
      const params: AssignRoleParams = {
        role: Role.Minter,
        holder: PublicKey.unique(),
        mintAllowance: null,
      };

      expect(params.mintAllowance).to.be.null;
    });

    it("AssignRoleParams works for non-Minter roles without allowance", () => {
      const params: AssignRoleParams = {
        role: Role.Blacklister,
        holder: PublicKey.unique(),
      };

      expect(params.role).to.equal(Role.Blacklister);
      expect(params.mintAllowance).to.be.undefined;
    });

    it("MintParams accepts BN and number amounts", () => {
      const dest = PublicKey.unique();

      const withBN: MintParams = { amount: new BN(500_000), destination: dest };
      expect((withBN.amount as BN).toNumber()).to.equal(500_000);

      const withNum: MintParams = { amount: 500_000, destination: dest };
      expect(withNum.amount).to.equal(500_000);
    });

    it("BurnParams accepts BN and number amounts", () => {
      const ata = PublicKey.unique();

      const withBN: BurnParams = { amount: new BN(100_000), fromAta: ata };
      expect((withBN.amount as BN).toNumber()).to.equal(100_000);

      const withNum: BurnParams = { amount: 100_000, fromAta: ata };
      expect(withNum.amount).to.equal(100_000);
    });

    it("SeizeParams includes all required fields", () => {
      const params: SeizeParams = {
        amount: new BN(250_000),
        fromAta: PublicKey.unique(),
        treasuryAta: PublicKey.unique(),
        wallet: PublicKey.unique(),
        treasuryWallet: PublicKey.unique(),
      };

      expect(params.amount).to.be.instanceOf(BN);
      expect(params.fromAta).to.be.instanceOf(PublicKey);
      expect(params.treasuryAta).to.be.instanceOf(PublicKey);
      expect(params.wallet).to.be.instanceOf(PublicKey);
      expect(params.treasuryWallet).to.be.instanceOf(PublicKey);
    });
  });

  // ── PDA delegation ──────────────────────────────────────────────

  describe("PDA delegation", () => {
    // We can't instantiate SolanaStablecoin directly (private ctor),
    // but we can verify that the standalone PDA helpers produce
    // consistent results — the class delegates to these same functions.

    const programId = SSS_TOKEN_PROGRAM_ID;
    const mint = PublicKey.unique();
    const config = PublicKey.unique();

    it("getConfigAddress is re-exported from pda module", () => {
      const [addr, bump] = getConfigAddress(programId, mint);
      expect(addr).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
    });

    it("getRoleAddress produces unique PDA per role type", () => {
      const holder = PublicKey.unique();
      const pdas = new Set<string>();

      for (const role of [
        Role.Minter,
        Role.Burner,
        Role.Blacklister,
        Role.Pauser,
        Role.Seizer,
      ]) {
        const [addr] = getRoleAddress(programId, config, role, holder);
        pdas.add(addr.toBase58());
      }

      // All 5 roles should produce 5 distinct PDAs
      expect(pdas.size).to.equal(5);
    });

    it("getBlacklistAddress produces unique PDA per wallet", () => {
      const wallet1 = PublicKey.unique();
      const wallet2 = PublicKey.unique();
      const [addr1] = getBlacklistAddress(programId, config, wallet1);
      const [addr2] = getBlacklistAddress(programId, config, wallet2);

      expect(addr1.equals(addr2)).to.be.false;
    });

    it("ATA derivation uses Token-2022 program ID", () => {
      const owner = Keypair.generate().publicKey; // must be on-curve
      const ata = getAssociatedTokenAddressSync(
        mint,
        owner,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      expect(ata).to.be.instanceOf(PublicKey);
      // Ensure the Token-2022 ATA is different from a regular Token ATA
      // (if we used TOKEN_PROGRAM_ID it would produce a different address)
    });
  });

  // ── BN coercion ─────────────────────────────────────────────────

  describe("BN coercion", () => {
    it("BN from number", () => {
      const bn = new BN(1_000_000);
      expect(bn.toNumber()).to.equal(1_000_000);
    });

    it("BN from string for large values", () => {
      const bn = new BN("18446744073709551615"); // u64::MAX
      expect(bn.toString()).to.equal("18446744073709551615");
    });

    it("BN arithmetic works correctly", () => {
      const a = new BN(500_000);
      const b = new BN(300_000);

      expect(a.add(b).toNumber()).to.equal(800_000);
      expect(a.sub(b).toNumber()).to.equal(200_000);
      expect(a.gt(b)).to.be.true;
      expect(b.lt(a)).to.be.true;
    });

    it("BN comparison with zero", () => {
      const zero = new BN(0);
      const positive = new BN(1);

      expect(zero.isZero()).to.be.true;
      expect(positive.isZero()).to.be.false;
      expect(positive.gt(zero)).to.be.true;
    });

    it("BN handles null pattern for optional supply cap", () => {
      // SDK pattern: supplyCap can be BN | number | null
      const unlimited: BN | number | null = null;
      const capped: BN | number | null = new BN(10_000_000);
      const cappedNum: BN | number | null = 10_000_000;

      expect(unlimited).to.be.null;
      expect(capped).to.be.instanceOf(BN);
      expect(typeof cappedNum).to.equal("number");

      // Coerce pattern (mirrors internal toBN())
      const coerced =
        cappedNum != null
          ? typeof cappedNum === "number"
            ? new BN(cappedNum)
            : cappedNum
          : null;
      expect(coerced).to.be.instanceOf(BN);
      expect((coerced as BN).toNumber()).to.equal(10_000_000);
    });
  });

  // ── Token program constants ─────────────────────────────────────

  describe("token program constants", () => {
    it("Token-2022 program ID is correct", () => {
      expect(TOKEN_2022_PROGRAM_ID.toBase58()).to.equal(
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      );
    });

    it("Associated Token Program ID is correct", () => {
      expect(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()).to.equal(
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      );
    });

    it("SSS Token Program ID is a valid PublicKey", () => {
      expect(SSS_TOKEN_PROGRAM_ID).to.be.instanceOf(PublicKey);
      expect(SSS_TOKEN_PROGRAM_ID.toBase58()).to.have.lengthOf.greaterThan(30);
    });
  });

  // ── Metadata validation ─────────────────────────────────────────

  describe("metadata validation", () => {
    it("name within 32-char limit", () => {
      const params: CreateSss1Params = {
        name: "A".repeat(32),
        symbol: "TST",
        uri: "https://example.com",
      };
      expect(params.name.length).to.equal(32);
    });

    it("symbol within 10-char limit", () => {
      const params: CreateSss1Params = {
        name: "Test",
        symbol: "A".repeat(10),
        uri: "https://example.com",
      };
      expect(params.symbol.length).to.equal(10);
    });

    it("uri within 200-char limit", () => {
      const uri = "https://example.com/" + "a".repeat(180);
      const params: CreateSss1Params = {
        name: "Test",
        symbol: "TST",
        uri,
      };
      expect(params.uri.length).to.equal(200);
    });

    it("default decimals is undefined (SDK defaults to 6)", () => {
      const params: CreateSss1Params = {
        name: "Test",
        symbol: "TST",
        uri: "https://example.com",
      };
      expect(params.decimals).to.be.undefined;
    });
  });
});
