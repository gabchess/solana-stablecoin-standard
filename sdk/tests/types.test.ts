import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import {
  Role,
  StablecoinConfigState,
  RoleConfigState,
  BlacklistEntryState,
  CreateSss1Params,
  CreateSss2Params,
  AssignRoleParams,
  MintParams,
  BurnParams,
  SeizeParams,
} from "../src/types";
import {
  STABLECOIN_SEED,
  ROLE_SEED,
  BLACKLIST_SEED,
  EXTRA_ACCOUNT_METAS_SEED,
  SSS_TOKEN_PROGRAM_ID,
  SSS_TRANSFER_HOOK_PROGRAM_ID,
} from "../src/constants";

// ---------------------------------------------------------------------------
// Types, enums, and constants — unit tests
// ---------------------------------------------------------------------------

describe("Types & Constants", () => {
  // ── Role enum ───────────────────────────────────────────────────

  describe("Role enum", () => {
    it("has exactly 5 roles", () => {
      // TypeScript numeric enums have both forward and reverse mappings,
      // so Object.keys includes both the names and numeric indices.
      const numericValues = Object.values(Role).filter(
        (v) => typeof v === "number",
      );
      expect(numericValues).to.have.lengthOf(5);
    });

    it("Minter = 0", () => {
      expect(Role.Minter).to.equal(0);
    });

    it("Burner = 1", () => {
      expect(Role.Burner).to.equal(1);
    });

    it("Blacklister = 2", () => {
      expect(Role.Blacklister).to.equal(2);
    });

    it("Pauser = 3", () => {
      expect(Role.Pauser).to.equal(3);
    });

    it("Seizer = 4", () => {
      expect(Role.Seizer).to.equal(4);
    });

    it("values are sequential starting from 0", () => {
      const values = [
        Role.Minter,
        Role.Burner,
        Role.Blacklister,
        Role.Pauser,
        Role.Seizer,
      ];
      values.forEach((v, i) => {
        expect(v).to.equal(i);
      });
    });

    it("reverse mapping works (number → name)", () => {
      expect(Role[0]).to.equal("Minter");
      expect(Role[1]).to.equal("Burner");
      expect(Role[2]).to.equal("Blacklister");
      expect(Role[3]).to.equal("Pauser");
      expect(Role[4]).to.equal("Seizer");
    });

    it("each role can be used as a buffer seed byte", () => {
      for (const role of [
        Role.Minter,
        Role.Burner,
        Role.Blacklister,
        Role.Pauser,
        Role.Seizer,
      ]) {
        const buf = Buffer.from([role]);
        expect(buf).to.have.lengthOf(1);
        expect(buf[0]).to.equal(role);
      }
    });
  });

  // ── State interfaces ────────────────────────────────────────────

  describe("StablecoinConfigState", () => {
    it("can construct a valid SSS-1 state object", () => {
      const state: StablecoinConfigState = {
        masterAuthority: PublicKey.unique(),
        mint: PublicKey.unique(),
        preset: 1,
        paused: false,
        supplyCap: null,
        transferHookProgram: PublicKey.default,
        decimals: 6,
        bump: 255,
      };

      expect(state.masterAuthority).to.be.instanceOf(PublicKey);
      expect(state.mint).to.be.instanceOf(PublicKey);
      expect(state.preset).to.equal(1);
      expect(state.paused).to.be.false;
      expect(state.supplyCap).to.be.null;
      expect(state.transferHookProgram.equals(PublicKey.default)).to.be.true;
      expect(state.decimals).to.equal(6);
      expect(state.bump).to.be.greaterThanOrEqual(0);
      expect(state.bump).to.be.lessThanOrEqual(255);
    });

    it("can construct a valid SSS-2 state object", () => {
      const hookId = PublicKey.unique();
      const state: StablecoinConfigState = {
        masterAuthority: PublicKey.unique(),
        mint: PublicKey.unique(),
        preset: 2,
        paused: false,
        supplyCap: new BN(10_000_000_000),
        transferHookProgram: hookId,
        decimals: 6,
        bump: 253,
      };

      expect(state.preset).to.equal(2);
      expect(state.supplyCap).to.be.instanceOf(BN);
      expect((state.supplyCap as BN).toNumber()).to.equal(10_000_000_000);
      expect(state.transferHookProgram.equals(hookId)).to.be.true;
    });

    it("paused flag is a boolean", () => {
      const unpaused: StablecoinConfigState = {
        masterAuthority: PublicKey.unique(),
        mint: PublicKey.unique(),
        preset: 1,
        paused: false,
        supplyCap: null,
        transferHookProgram: PublicKey.default,
        decimals: 6,
        bump: 255,
      };
      const paused: StablecoinConfigState = { ...unpaused, paused: true };

      expect(unpaused.paused).to.be.false;
      expect(paused.paused).to.be.true;
    });
  });

  describe("RoleConfigState", () => {
    it("can construct a minter role with allowance", () => {
      const state: RoleConfigState = {
        config: PublicKey.unique(),
        role: Role.Minter,
        holder: PublicKey.unique(),
        mintAllowance: new BN(5_000_000),
        bump: 254,
      };

      expect(state.role).to.equal(0);
      expect(state.mintAllowance).to.be.instanceOf(BN);
      expect((state.mintAllowance as BN).toNumber()).to.equal(5_000_000);
    });

    it("can construct a minter role with unlimited allowance", () => {
      const state: RoleConfigState = {
        config: PublicKey.unique(),
        role: Role.Minter,
        holder: PublicKey.unique(),
        mintAllowance: null,
        bump: 254,
      };

      expect(state.mintAllowance).to.be.null;
    });

    it("non-minter roles have null allowance", () => {
      for (const role of [
        Role.Burner,
        Role.Blacklister,
        Role.Pauser,
        Role.Seizer,
      ]) {
        const state: RoleConfigState = {
          config: PublicKey.unique(),
          role,
          holder: PublicKey.unique(),
          mintAllowance: null,
          bump: 252,
        };

        expect(state.mintAllowance).to.be.null;
      }
    });
  });

  describe("BlacklistEntryState", () => {
    it("can construct a valid blacklist entry", () => {
      const state: BlacklistEntryState = {
        config: PublicKey.unique(),
        wallet: PublicKey.unique(),
        bump: 250,
      };

      expect(state.config).to.be.instanceOf(PublicKey);
      expect(state.wallet).to.be.instanceOf(PublicKey);
      expect(state.bump).to.equal(250);
    });
  });

  // ── Seed constants ──────────────────────────────────────────────

  describe("seed constants", () => {
    it("STABLECOIN_SEED is correct", () => {
      expect(STABLECOIN_SEED.toString()).to.equal("stablecoin");
    });

    it("ROLE_SEED is correct", () => {
      expect(ROLE_SEED.toString()).to.equal("role");
    });

    it("BLACKLIST_SEED is correct", () => {
      expect(BLACKLIST_SEED.toString()).to.equal("blacklist");
    });

    it("EXTRA_ACCOUNT_METAS_SEED is correct", () => {
      expect(EXTRA_ACCOUNT_METAS_SEED.toString()).to.equal(
        "extra-account-metas",
      );
    });

    it("all seeds are Buffer instances", () => {
      for (const seed of [
        STABLECOIN_SEED,
        ROLE_SEED,
        BLACKLIST_SEED,
        EXTRA_ACCOUNT_METAS_SEED,
      ]) {
        expect(Buffer.isBuffer(seed)).to.be.true;
      }
    });

    it("seeds match Rust string literals exactly", () => {
      // Verify byte-level equivalence with the Rust program's constants
      expect(STABLECOIN_SEED).to.deep.equal(Buffer.from("stablecoin"));
      expect(ROLE_SEED).to.deep.equal(Buffer.from("role"));
      expect(BLACKLIST_SEED).to.deep.equal(Buffer.from("blacklist"));
      expect(EXTRA_ACCOUNT_METAS_SEED).to.deep.equal(
        Buffer.from("extra-account-metas"),
      );
    });
  });

  // ── Program IDs ─────────────────────────────────────────────────

  describe("program IDs", () => {
    it("SSS_TOKEN_PROGRAM_ID is a valid PublicKey", () => {
      expect(SSS_TOKEN_PROGRAM_ID).to.be.instanceOf(PublicKey);
    });

    it("SSS_TRANSFER_HOOK_PROGRAM_ID is a valid PublicKey", () => {
      expect(SSS_TRANSFER_HOOK_PROGRAM_ID).to.be.instanceOf(PublicKey);
    });

    it("program IDs are different", () => {
      expect(SSS_TOKEN_PROGRAM_ID.equals(SSS_TRANSFER_HOOK_PROGRAM_ID)).to.be
        .false;
    });

    it("program IDs are not the default PublicKey", () => {
      expect(SSS_TOKEN_PROGRAM_ID.equals(PublicKey.default)).to.be.false;
      expect(SSS_TRANSFER_HOOK_PROGRAM_ID.equals(PublicKey.default)).to.be
        .false;
    });

    it("SSS_TOKEN_PROGRAM_ID matches expected base58", () => {
      expect(SSS_TOKEN_PROGRAM_ID.toBase58()).to.equal(
        "CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3",
      );
    });

    it("SSS_TRANSFER_HOOK_PROGRAM_ID matches expected base58", () => {
      expect(SSS_TRANSFER_HOOK_PROGRAM_ID.toBase58()).to.equal(
        "F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz",
      );
    });
  });
});
