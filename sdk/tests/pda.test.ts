import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  getConfigAddress,
  getRoleAddress,
  getBlacklistAddress,
  getExtraAccountMetaListAddress,
  deriveStablecoinAddresses,
} from "../src/pda";
import { Role } from "../src/types";
import {
  SSS_TOKEN_PROGRAM_ID,
  SSS_TRANSFER_HOOK_PROGRAM_ID,
  STABLECOIN_SEED,
  ROLE_SEED,
  BLACKLIST_SEED,
  EXTRA_ACCOUNT_METAS_SEED,
} from "../src/constants";

describe("PDA Derivation", () => {
  // Known program IDs from the deployed programs
  const PROGRAM_ID = SSS_TOKEN_PROGRAM_ID;
  const HOOK_PROGRAM_ID = SSS_TRANSFER_HOOK_PROGRAM_ID;
  const MINT = PublicKey.unique();

  // ── getConfigAddress ────────────────────────────────────────────

  describe("getConfigAddress", () => {
    it("returns a valid PublicKey and bump", () => {
      const [config, bump] = getConfigAddress(PROGRAM_ID, MINT);

      expect(config).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
      expect(bump).to.be.greaterThanOrEqual(0);
      expect(bump).to.be.lessThanOrEqual(255);
    });

    it("returns deterministic results", () => {
      const [config1, bump1] = getConfigAddress(PROGRAM_ID, MINT);
      const [config2, bump2] = getConfigAddress(PROGRAM_ID, MINT);

      expect(config1.equals(config2)).to.be.true;
      expect(bump1).to.equal(bump2);
    });

    it("different mints produce different PDAs", () => {
      const mint2 = PublicKey.unique();
      const [config1] = getConfigAddress(PROGRAM_ID, MINT);
      const [config2] = getConfigAddress(PROGRAM_ID, mint2);

      expect(config1.equals(config2)).to.be.false;
    });

    it("matches manual PDA derivation with correct seeds", () => {
      const [manual] = PublicKey.findProgramAddressSync(
        [STABLECOIN_SEED, MINT.toBuffer()],
        PROGRAM_ID,
      );
      const [derived] = getConfigAddress(PROGRAM_ID, MINT);

      expect(derived.equals(manual)).to.be.true;
    });
  });

  // ── getRoleAddress ──────────────────────────────────────────────

  describe("getRoleAddress", () => {
    const holder = PublicKey.unique();
    const config = PublicKey.unique();

    it("returns a valid PublicKey and bump", () => {
      const [rolePda, bump] = getRoleAddress(
        PROGRAM_ID,
        config,
        Role.Minter,
        holder,
      );

      expect(rolePda).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
      expect(bump).to.be.lessThanOrEqual(255);
    });

    it("different roles produce different PDAs", () => {
      const [minterPda] = getRoleAddress(
        PROGRAM_ID,
        config,
        Role.Minter,
        holder,
      );
      const [burnerPda] = getRoleAddress(
        PROGRAM_ID,
        config,
        Role.Burner,
        holder,
      );

      expect(minterPda.equals(burnerPda)).to.be.false;
    });

    it("different holders produce different PDAs", () => {
      const holder2 = PublicKey.unique();
      const [pda1] = getRoleAddress(PROGRAM_ID, config, Role.Minter, holder);
      const [pda2] = getRoleAddress(PROGRAM_ID, config, Role.Minter, holder2);

      expect(pda1.equals(pda2)).to.be.false;
    });

    it("matches manual derivation with all 5 role values", () => {
      for (const role of [
        Role.Minter,
        Role.Burner,
        Role.Blacklister,
        Role.Pauser,
        Role.Seizer,
      ]) {
        const [manual] = PublicKey.findProgramAddressSync(
          [
            ROLE_SEED,
            config.toBuffer(),
            Buffer.from([role]),
            holder.toBuffer(),
          ],
          PROGRAM_ID,
        );
        const [derived] = getRoleAddress(PROGRAM_ID, config, role, holder);

        expect(derived.equals(manual)).to.be.true;
      }
    });
  });

  // ── getBlacklistAddress ─────────────────────────────────────────

  describe("getBlacklistAddress", () => {
    const config = PublicKey.unique();
    const wallet = PublicKey.unique();

    it("returns a valid PublicKey and bump", () => {
      const [blacklist, bump] = getBlacklistAddress(
        PROGRAM_ID,
        config,
        wallet,
      );

      expect(blacklist).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
      expect(bump).to.be.lessThanOrEqual(255);
    });

    it("different wallets produce different PDAs", () => {
      const wallet2 = PublicKey.unique();
      const [pda1] = getBlacklistAddress(PROGRAM_ID, config, wallet);
      const [pda2] = getBlacklistAddress(PROGRAM_ID, config, wallet2);

      expect(pda1.equals(pda2)).to.be.false;
    });

    it("matches manual derivation", () => {
      const [manual] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, config.toBuffer(), wallet.toBuffer()],
        PROGRAM_ID,
      );
      const [derived] = getBlacklistAddress(PROGRAM_ID, config, wallet);

      expect(derived.equals(manual)).to.be.true;
    });
  });

  // ── getExtraAccountMetaListAddress ──────────────────────────────

  describe("getExtraAccountMetaListAddress", () => {
    it("returns a valid PublicKey and bump", () => {
      const [metaList, bump] = getExtraAccountMetaListAddress(
        HOOK_PROGRAM_ID,
        MINT,
      );

      expect(metaList).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
      expect(bump).to.be.lessThanOrEqual(255);
    });

    it("matches manual derivation", () => {
      const [manual] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_METAS_SEED, MINT.toBuffer()],
        HOOK_PROGRAM_ID,
      );
      const [derived] = getExtraAccountMetaListAddress(HOOK_PROGRAM_ID, MINT);

      expect(derived.equals(manual)).to.be.true;
    });

    it("uses hook program ID, not token program ID", () => {
      const [fromHook] = getExtraAccountMetaListAddress(HOOK_PROGRAM_ID, MINT);
      const [fromToken] = getExtraAccountMetaListAddress(PROGRAM_ID, MINT);

      // Different programs should produce different PDAs
      expect(fromHook.equals(fromToken)).to.be.false;
    });
  });

  // ── deriveStablecoinAddresses (batch) ───────────────────────────

  describe("deriveStablecoinAddresses", () => {
    it("returns config address without hook program", () => {
      const addrs = deriveStablecoinAddresses(PROGRAM_ID, MINT);

      expect(addrs.config).to.be.instanceOf(PublicKey);
      expect(addrs.configBump).to.be.a("number");
      expect(addrs.extraAccountMetaList).to.be.undefined;
      expect(addrs.extraAccountMetaListBump).to.be.undefined;
    });

    it("returns both config and meta list with hook program", () => {
      const addrs = deriveStablecoinAddresses(
        PROGRAM_ID,
        MINT,
        HOOK_PROGRAM_ID,
      );

      expect(addrs.config).to.be.instanceOf(PublicKey);
      expect(addrs.configBump).to.be.a("number");
      expect(addrs.extraAccountMetaList).to.be.instanceOf(PublicKey);
      expect(addrs.extraAccountMetaListBump).to.be.a("number");
    });

    it("config matches individual derivation", () => {
      const [individual] = getConfigAddress(PROGRAM_ID, MINT);
      const batch = deriveStablecoinAddresses(PROGRAM_ID, MINT);

      expect(batch.config.equals(individual)).to.be.true;
    });

    it("meta list matches individual derivation", () => {
      const [individual] = getExtraAccountMetaListAddress(
        HOOK_PROGRAM_ID,
        MINT,
      );
      const batch = deriveStablecoinAddresses(
        PROGRAM_ID,
        MINT,
        HOOK_PROGRAM_ID,
      );

      expect(batch.extraAccountMetaList!.equals(individual)).to.be.true;
    });
  });
});
