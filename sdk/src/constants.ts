import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Seed prefixes (must match Rust constants in programs/sss-token/src/constants.rs)
// ---------------------------------------------------------------------------

export const STABLECOIN_SEED = Buffer.from("stablecoin");
export const ROLE_SEED = Buffer.from("role");
export const BLACKLIST_SEED = Buffer.from("blacklist");
export const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------

/** SSS Token program (sss-token) */
export const SSS_TOKEN_PROGRAM_ID = new PublicKey(
  "CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3",
);

/** SSS Transfer Hook program (sss-transfer-hook) */
export const SSS_TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz",
);
