# Solana Stablecoin Standard (SSS)

A modular Token-2022 SDK for creating and managing stablecoins on Solana. Two presets cover the spectrum from minimal deployments to fully compliant institutional stablecoins.

Built for the [Superteam Brazil](https://superteam.fun/) bounty.

## Presets

**SSS-1 (Minimal)** — Token-2022 mint with MetadataPointer, MintCloseAuthority, and freeze authority. Role-based minting with per-minter allowances, optional supply cap, emergency pause. Suitable for internal tokens, testnet stablecoins, or deployments that don't need transfer restrictions.

**SSS-2 (Compliant)** — Everything in SSS-1, plus PermanentDelegate, TransferHook, and DefaultAccountState(Frozen). New token accounts start frozen and must be explicitly approved (KYC gate). A transfer hook checks every transfer against a blacklist. Seized funds move to treasury via permanent delegate without owner signature. Matches the compliance model of USDC, PYUSD, and EUROC.

## Architecture

```
programs/
  sss-token/           15 instructions — mint, burn, roles, blacklist, seize, admin
  sss-transfer-hook/   2 instructions  — ExtraAccountMetaList init + Execute handler

sdk/                   @stbr/sss-token — SolanaStablecoin class, PDA helpers, types
cli/                   sss-token CLI   — Commander interface for all operations
tests/                 124 integration tests across 10 files
docs/                  Architecture, security, testing, API, compliance, operations
```

Two programs because Token-2022 transfer hooks execute as a CPI into a separate program. The hook uses the SPL Transfer Hook Interface discriminator, which conflicts with Anchor's discriminator scheme. A `fallback` instruction in the hook program bridges the two.

### Why Token-2022 Extensions

Account-based hacks (wrapper programs that intercept transfers) can be bypassed by calling the token program directly. Token-2022 extensions enforce behavior at the protocol level:

- **TransferHook** — every `transfer_checked` call triggers the hook. No bypass path exists.
- **PermanentDelegate** — the config PDA can transfer tokens without owner signature. Enables seizure from blacklisted wallets.
- **DefaultAccountState(Frozen)** — all new ATAs start frozen. Forces KYC approval before first transfer.
- **MetadataPointer** — on-chain metadata without Metaplex dependency.

### Account Model

| Account | Seeds | Size | Description |
|---------|-------|------|-------------|
| StablecoinConfig | `["stablecoin", mint]` | 182 B | Master config: authority, preset, pause state, supply cap |
| RoleConfig | `["role", config, role_u8, holder]` | 83 B | One per (stablecoin, role, wallet) triple |
| BlacklistEntry | `["blacklist", config, wallet]` | 73 B | Existence = blacklisted (SSS-2 only) |

### Role-Based Access Control

| Role | ID | Operations |
|------|----|------------|
| Minter | 0 | `mint_tokens` (with per-minter allowance) |
| Burner | 1 | `burn_tokens` (forced burn from any ATA) |
| Blacklister | 2 | `blacklist`, `unblacklist`, `approve_account` |
| Pauser | 3 | `pause`, `unpause` |
| Seizer | 4 | `seize` (thaw, transfer via permanent delegate, re-freeze) |

The master authority can assign/revoke all roles, transfer itself, update supply cap, and pause/unpause directly.

## Getting Started

### Prerequisites

- Anchor CLI 0.31.1
- Agave 3.0.15 (build) + Agave 2.2.14 (test validator)
- Node 18+, Yarn

### Build and Test

```bash
# Build with Agave 3.0.15
anchor build

# Switch to Agave 2.2.14, then:
anchor test --skip-build
# 124 passing

# SDK tests (no validator needed)
cd sdk && yarn install && yarn test
# 82 passing
```

## SDK Usage

```typescript
import { SolanaStablecoin, Role } from "@stbr/sss-token";

// Create an SSS-2 stablecoin
const stablecoin = await SolanaStablecoin.createSss2(program, hookProgram, {
  name: "Brazilian Real Stablecoin",
  symbol: "BRLUSD",
  uri: "https://example.com/metadata.json",
  decimals: 6,
  supplyCap: 100_000_000,
  hookProgramId: HOOK_PROGRAM_ID,
});

// Assign a minter with 10M allowance
await stablecoin.assignRole(authority, {
  role: Role.Minter,
  holder: minterWallet,
  mintAllowance: 10_000_000,
});

// Approve a wallet (KYC thaw)
await stablecoin.approveAccount(blacklister, userTokenAccount);

// Mint tokens
await stablecoin.mintTokens(minter, {
  amount: 1_000_000,
  destination: userTokenAccount,
});

// Blacklist a wallet
await stablecoin.blacklist(blacklister, suspiciousWallet);

// Seize blacklisted funds
await stablecoin.seize(seizer, {
  amount: 500_000,
  fromAta: suspiciousAta,
  treasuryAta: treasuryAta,
  wallet: suspiciousWallet,
  treasuryWallet: treasuryWallet,
});
```

## CLI Usage

```bash
# Initialize SSS-2 stablecoin
sss-token init sss2 --name "BRLUSD" --symbol "BRLUSD" --uri "https://..." \
  --hook-program F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz

# Assign minter role
sss-token role assign --mint <MINT> --holder <WALLET> --role minter --allowance 10000000

# Mint tokens
sss-token mint --mint <MINT> --to <ATA> --amount 1000000

# Blacklist a wallet
sss-token blacklist add --mint <MINT> --wallet <WALLET>

# Seize from blacklisted wallet
sss-token seize --mint <MINT> --from <FROM_ATA> --to <TREASURY_ATA> \
  --wallet <WALLET> --treasury-wallet <TREASURY> --amount 500000

# Pause in emergency
sss-token admin pause --mint <MINT>

# View stablecoin info
sss-token admin info --mint <MINT>
```

## Test Coverage

**206 total tests** — 124 integration + 82 SDK unit tests.

| File | Tests | Coverage |
|------|------:|----------|
| `sss-1-basic.ts` | 13 | SSS-1 init, extensions, metadata, authority validation |
| `sss-2-basic.ts` | 12 | SSS-2 init, all 5 extensions, default frozen state |
| `role-management.ts` | 15 | Assign/revoke all 5 roles, allowance CRUD, unauthorized access |
| `mint-burn.ts` | 12 | Allowance tracking, supply cap, self-burn, pause blocking |
| `blacklist-compliance.ts` | 17 | Blacklist/unblacklist, approve, freeze/thaw, SSS-1 rejection |
| `transfer-hook.ts` | 11 | Hook enforcement, blacklisted sender/receiver, pause blocking |
| `seize.ts` | 9 | Thaw-transfer-refreeze, non-blacklisted rejection, role checks |
| `pause-admin.ts` | 10 | Pause/unpause, authority transfer, supply cap update |
| `edge-cases.ts` | 12 | Zero amounts, cap boundaries, double-blacklist, cross-preset |
| `full-lifecycle.ts` | 11 | SSS-1 + SSS-2 end-to-end flows |
| SDK: `pda.test.ts` | 18 | PDA derivation, determinism, cross-program uniqueness |
| SDK: `stablecoin.test.ts` | 36 | Class interface, parameter types, BN coercion |
| SDK: `types.test.ts` | 28 | Role enum, state interfaces, seed constants |

## Security Properties

**What SSS guarantees:**
- All transfers on SSS-2 mints pass through the transfer hook. No bypass path.
- Blacklisted wallets cannot send or receive tokens until explicitly unblacklisted.
- Seizure requires prior blacklisting. Cannot seize from non-blacklisted wallets.
- Every role-gated instruction validates three constraints: correct stablecoin, correct role type, correct holder.
- PDA seeds prevent cross-stablecoin privilege escalation.
- Extensions (PermanentDelegate, TransferHook, DefaultAccountState) are immutable after mint creation.

**What SSS does not guarantee:**
- Not a legal compliance framework. SSS is a technical primitive.
- No built-in multisig. Production deployments should use Squads or similar.
- No whitelist-only mode. Uses blacklist (block specific wallets) + frozen default (KYC gate).
- No rate limiting on non-Minter roles.

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Two-program design, account model, extension init order, transfer hook flow |
| [SECURITY.md](docs/SECURITY.md) | Threat model, signer validation, PDA collision resistance, error codes |
| [TESTING.md](docs/TESTING.md) | Hybrid build/test workflow, per-file breakdown, key discoveries |
| [SSS-1.md](docs/SSS-1.md) | Minimal preset reference |
| [SSS-2.md](docs/SSS-2.md) | Compliant preset reference |
| [API.md](docs/API.md) | Full instruction reference for both programs |
| [SDK.md](docs/SDK.md) | TypeScript SDK reference |
| [COMPLIANCE.md](docs/COMPLIANCE.md) | KYC/AML flow, blacklist lifecycle |
| [OPERATIONS.md](docs/OPERATIONS.md) | Key management, role rotation, incident response |

## Program IDs

```
sss-token:           CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3
sss-transfer-hook:   F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz
```

## License

MIT

---

Built by [@stablecoins-br](https://github.com/stablecoins-br) for Superteam Brazil.
