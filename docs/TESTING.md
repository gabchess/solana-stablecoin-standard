# Testing

## Test Setup

SSS uses a hybrid build/test workflow because Anchor 0.31.x requires Agave 3.0.x for BPF compilation (`platform-tools v2.1`), but the local test validator ships with Agave 2.2.x runtime.

### Prerequisites

- Agave 3.0.15 installed (for `anchor build`)
- Agave 2.2.14 installed (for `anchor test --skip-build`)
- Anchor CLI 0.31.1
- Node 18+ and Yarn

### Switching Agave Versions

The active Solana release is a symlink at `~/.local/share/solana/install/active_release`. To switch:

```bash
# Point to 3.0.15 for building
cd ~/.local/share/solana/install
rm -f active_release
ln -s releases/stable-<hash>/solana-release active_release

# Verify
solana --version  # should show 3.0.15
```

Do the reverse for 2.2.14 before running tests.

## How to Run

### Anchor Integration Tests (124 tests)

```bash
# Step 1: Build with Agave 3.0.15
anchor build

# Step 2: Switch to Agave 2.2.14
# (symlink swap as described above)

# Step 3: Run tests (skip rebuild)
anchor test --skip-build
```

All 124 integration tests run against a local validator that `anchor test` starts automatically.

### SDK Unit Tests (82 tests)

```bash
cd sdk
yarn install
yarn test
```

SDK tests are pure unit tests. No validator needed. They validate PDA derivation, type interfaces, BN coercion, and class structure.

### CLI Smoke Test

```bash
# Build CLI
cd cli
yarn install
yarn build

# Verify help renders
node dist/index.js --help
node dist/index.js init --help
node dist/index.js admin --help

# Smoke test against localnet (requires running validator + deployed programs)
node dist/index.js admin info --mint <MINT_PUBKEY> --url http://localhost:8899
```

## Test File Breakdown

### Anchor Integration Tests (124 tests across 10 files)

| File | Tests | Coverage |
|------|------:|----------|
| `sss-1-basic.ts` | 13 | SSS-1 initialization, config state, mint authority, freeze authority, metadata verification |
| `sss-2-basic.ts` | 12 | SSS-2 initialization, PermanentDelegate, TransferHook extension, DefaultAccountState(Frozen), ExtraAccountMetaList |
| `role-management.ts` | 15 | Assign all 5 roles, revoke roles, duplicate assignment rejection, unauthorized assignment, update_mint_allowance |
| `mint-burn.ts` | 12 | Mint with allowance, unlimited allowance, allowance deduction, self-burn, burner-role burn, zero-amount rejection |
| `transfer-hook.ts` | 11 | Approved wallet transfers, blacklisted sender rejection, blacklisted receiver rejection, pause blocks transfer, unblacklist resumes transfer |
| `blacklist-compliance.ts` | 17 | Blacklist creates entry + freezes ATA, unblacklist closes entry + thaws ATA, approve_account thaws frozen ATA, SSS-2 required check |
| `seize.ts` | 9 | Seize from blacklisted wallet, treasury receives tokens, source refrozen after seize, non-blacklisted seize fails, wrong role fails |
| `pause-admin.ts` | 10 | Pause via Pauser role, unpause, pause via master authority, transfer_master_authority, update_supply_cap, cap enforcement |
| `edge-cases.ts` | 12 | Zero-amount mint/burn, mint exactly to supply cap, 1-over-cap rejection, double-blacklist error, unauthorized signers on admin ops, SSS-2 ops on SSS-1 |
| `full-lifecycle.ts` | 11 | SSS-1 end-to-end (init, roles, mint, burn, pause, unpause), SSS-2 end-to-end (init, approve, mint, transfer via hook, blacklist, hook reject, seize, unblacklist, resume) |

Two additional test files exist but are not part of the main suite:
- `debug-mint.ts` (2 tests) — Token-2022 extension debugging, used during development
- `standalone-metadata-test.ts` — One-off metadata verification script

Helper file: `helpers.ts` (331 lines) provides `buildSeizeRemainingAccounts()`, `initializeAndApprove()`, keypair generation, and ATA creation utilities shared across all test files.

### SDK Tests (82 tests across 3 files)

| File | Tests | Coverage |
|------|------:|----------|
| `pda.test.ts` | 18 | getConfigAddress, getRoleAddress, getBlacklistAddress, getExtraAccountMetaListAddress, deriveStablecoinAddresses — determinism, manual derivation matching, cross-program uniqueness |
| `stablecoin.test.ts` | 36 | SolanaStablecoin class structure (all 17 methods exist), CreateSss1Params/CreateSss2Params/AssignRoleParams/MintParams/BurnParams/SeizeParams interfaces, PDA delegation, ATA derivation, BN coercion, Token-2022 constants |
| `types.test.ts` | 28 | Role enum (5 values, sequential, reverse mapping, buffer seed encoding), StablecoinConfigState/RoleConfigState/BlacklistEntryState construction, seed constant values, program ID validation |

### Total: 206 tests (124 integration + 82 SDK)

## Key Discoveries

These issues were encountered and resolved during development. They are documented here to prevent regressions.

### 1. base_mint_size vs total_mint_size

Token-2022 `create_account` requires `space = base_mint_size` (fixed extensions only) but `lamports = rent.minimum_balance(total_mint_size)` (including variable-length metadata). If you pass `total_mint_size` as the space, the metadata TLV overlaps with reserved extension space and initialization fails silently.

**Fix:** Calculate `base_mint_size` with `try_calculate_account_len(&extension_types)` and `total_mint_size` by adding the metadata TLV length separately.

### 2. accountsStrict with null fields

Anchor's `.accountsStrict()` requires all fields, including optional ones. For instructions like `burn_tokens` where `role_config` is optional (self-burn vs burner-role burn), pass `roleConfig: null` explicitly. Anchor serializes this as `Option<Pubkey>::None`.

### 3. confirmTransaction timing on Agave 2.2.14

The local test validator on 2.2.14 does not guarantee immediate account visibility after `.rpc()` returns. Tests that call `.rpc()` followed by `getAccount()` can fail with "account not found."

**Fix:** Insert `await provider.connection.confirmTransaction(sig, "confirmed")` between the transaction and the subsequent read.

### 4. Transfer hook remaining accounts

Token-2022's `transfer_checked` CPI only processes accounts listed in the instruction's `account_metas`. Passing extra accounts as `AccountInfo` alone (via `remaining_accounts`) is insufficient — the hook program never sees them.

**Fix:** Add remaining accounts to both the instruction's `account_metas` vector AND the `AccountInfo` slice passed to `invoke_signed`:

```rust
for remaining in ctx.remaining_accounts.iter() {
    ix_transfer.accounts.push(AccountMeta {
        pubkey: *remaining.key,
        is_signer: remaining.is_signer,
        is_writable: remaining.is_writable,
    });
}
```

### 5. Rust lifetime annotations for mixed CPI accounts

Mixing `ctx.accounts.*.to_account_info()` and `ctx.remaining_accounts` in the same `Vec<AccountInfo>` causes a lifetime mismatch. The compiler cannot unify the lifetimes of owned account infos and borrowed remaining accounts.

**Fix:** Add explicit `'info` lifetime to the handler signature:

```rust
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Seize<'info>>,
    amount: u64,
) -> Result<()>
```

### 6. Allowance vs supply cap interaction

A minter with a 5M allowance cannot mint 9M tokens even if the supply cap is 10M. The allowance check runs first. Tests that target supply cap boundaries must use unlimited allowance (`mint_allowance: None`) to isolate the supply cap behavior.
