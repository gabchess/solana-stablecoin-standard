import { PublicKey } from "@solana/web3.js";
import {
  STABLECOIN_SEED,
  ROLE_SEED,
  BLACKLIST_SEED,
  EXTRA_ACCOUNT_METAS_SEED,
} from "./constants";

// ---------------------------------------------------------------------------
// Individual PDA derivation helpers
// ---------------------------------------------------------------------------

/**
 * Derives the StablecoinConfig PDA address.
 *
 * Seeds: ["stablecoin", mint]
 */
export function getConfigAddress(
  programId: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mint.toBuffer()],
    programId,
  );
}

/**
 * Derives the RoleConfig PDA address.
 *
 * Seeds: ["role", config, role_u8, holder]
 */
export function getRoleAddress(
  programId: PublicKey,
  config: PublicKey,
  role: number,
  holder: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, config.toBuffer(), Buffer.from([role]), holder.toBuffer()],
    programId,
  );
}

/**
 * Derives the BlacklistEntry PDA address.
 *
 * Seeds: ["blacklist", config, wallet]
 */
export function getBlacklistAddress(
  programId: PublicKey,
  config: PublicKey,
  wallet: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), wallet.toBuffer()],
    programId,
  );
}

/**
 * Derives the ExtraAccountMetaList PDA address for the transfer hook.
 *
 * Seeds: ["extra-account-metas", mint]
 */
export function getExtraAccountMetaListAddress(
  hookProgramId: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    hookProgramId,
  );
}

// ---------------------------------------------------------------------------
// Batch derivation helper
// ---------------------------------------------------------------------------

/**
 * Derives all core PDA addresses for a stablecoin.
 *
 * Returns the config PDA and its bump. For SSS-2, also derives the
 * ExtraAccountMetaList PDA for the transfer hook.
 */
export function deriveStablecoinAddresses(
  programId: PublicKey,
  mint: PublicKey,
  hookProgramId?: PublicKey,
): {
  config: PublicKey;
  configBump: number;
  extraAccountMetaList?: PublicKey;
  extraAccountMetaListBump?: number;
} {
  const [config, configBump] = getConfigAddress(programId, mint);

  if (hookProgramId) {
    const [extraAccountMetaList, extraAccountMetaListBump] =
      getExtraAccountMetaListAddress(hookProgramId, mint);
    return {
      config,
      configBump,
      extraAccountMetaList,
      extraAccountMetaListBump,
    };
  }

  return { config, configBump };
}
