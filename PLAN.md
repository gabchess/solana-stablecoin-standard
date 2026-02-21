# Solana Stablecoin Standard (SSS) — Architectural Blueprint

## Context

We are building the **Solana Stablecoin Standard (SSS)** — a modular Token-2022 SDK for creating and managing stablecoins on Solana. This is a Superteam Brazil competition entry ($5,000 USDC, 21-day deadline). The reference codebase `~/solana-vault-standard` provides our structural template — we mirror its patterns exactly but adapt the domain from vaults to stablecoins.

---

## 1. What We Learned from the Reference (SVS)

### Folder layout
```
programs/svs-{1,2}/src/ → lib.rs, state.rs, error.rs, constants.rs, events.rs, instructions/
sdk/core/ → TypeScript SDK wrapping the program
sdk/privacy/ → Privacy-extended SDK
tests/ → Anchor integration tests (Chai)
scripts/ → ts-node integration scripts
proof-backend/ → Rust Axum server (Docker)
docs/ → ARCHITECTURE.md, SECURITY.md, TESTING.md, SDK.md
```

### Key patterns to mirror exactly
- **Account structs**: `LEN` const with discriminator, `SEED_PREFIX` const, `_reserved: [u8; 64]`
- **Instructions**: One file per instruction in `instructions/` dir, exported via `mod.rs`
- **lib.rs**: Thin routing layer — delegates to `instructions::handler()`
- **Access control**: `constraint = authority.key() == vault.authority @ VaultError::Unauthorized`
- **Pause check**: `constraint = !vault.paused @ VaultError::VaultPaused` on the account
- **Token-2022 mint creation**: `create_account` → init extensions (BEFORE mint) → `initialize_mint2` → metadata
- **CPI signing**: `invoke_signed` with PDA seeds for mint authority operations
- **SDK**: Private constructor, static `load()` / `create()`, lazy `_state` caching, `.accountsStrict()`, bracket-notation account fetch
- **Events**: `#[event]` structs emitted from every mutating instruction
- **Errors**: `#[error_code]` enum with `#[msg("...")]` per variant, validated via `require!()` macro

### What we adapt (different domain)
- SVS has 1 state account (Vault). SSS has 3 (StablecoinConfig, RoleConfig, BlacklistEntry)
- SVS has a single authority. SSS has multi-role RBAC (master, minter, burner, blacklister, pauser, seizer)
- SVS uses a PDA mint (shares). SSS uses a Keypair mint (stablecoin token) — the config PDA is derived from the mint
- SVS has no transfer hook. SSS-2 requires a separate transfer hook program for blacklist enforcement

---

## 2. Monorepo Structure

```
solana-stablecoin-standard/
├── Anchor.toml
├── Cargo.toml                          # workspace: programs/*
├── package.json                        # workspaces: ["sdk/", "cli/"]
├── tsconfig.json
├── PLAN.md                             # Source of truth
├── CLAUDE.md
├── programs/
│   ├── sss-token/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs                  # declare_id!, instruction routing
│   │       ├── state.rs                # StablecoinConfig, RoleConfig, BlacklistEntry, Role enum
│   │       ├── error.rs                # StablecoinError enum
│   │       ├── constants.rs            # Seeds, limits
│   │       ├── events.rs              # All event structs
│   │       └── instructions/
│   │           ├── mod.rs
│   │           ├── initialize_sss1.rs
│   │           ├── initialize_sss2.rs
│   │           ├── assign_role.rs
│   │           ├── revoke_role.rs
│   │           ├── update_mint_allowance.rs
│   │           ├── mint_tokens.rs
│   │           ├── burn_tokens.rs
│   │           ├── blacklist.rs
│   │           ├── unblacklist.rs
│   │           ├── approve_account.rs
│   │           ├── seize.rs
│   │           ├── pause.rs
│   │           ├── unpause.rs
│   │           ├── transfer_master_authority.rs
│   │           └── update_supply_cap.rs
│   │
│   └── sss-transfer-hook/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                  # declare_id!, fallback handler for Execute
│           ├── error.rs                # TransferHookError
│           └── instructions/
│               ├── mod.rs
│               ├── initialize.rs       # InitializeExtraAccountMetaList
│               └── transfer_hook.rs    # Execute handler — blacklist check
│
├── sdk/
│   ├── package.json                    # @stbr/sss-token
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── stablecoin.ts              # SolanaStablecoin class
│   │   ├── pda.ts                      # PDA derivation helpers
│   │   ├── types.ts                    # Interfaces and enums
│   │   └── constants.ts                # Seeds, program IDs
│   └── tests/
│       ├── pda.test.ts
│       ├── stablecoin.test.ts
│       └── types.test.ts
│
├── cli/
│   ├── package.json                    # sss-token CLI
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # Commander entrypoint
│       └── commands/
│           ├── init.ts
│           ├── role.ts
│           ├── mint.ts
│           ├── burn.ts
│           ├── blacklist.ts
│           ├── seize.ts
│           └── admin.ts
│
├── backend/
│   ├── package.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── src/
│       ├── index.ts                    # Express server
│       └── routes/
│           ├── health.ts
│           └── stablecoin.ts           # Info/status endpoints
│
├── tests/
│   ├── helpers.ts
│   ├── sss-1-basic.ts
│   ├── sss-2-basic.ts
│   ├── role-management.ts
│   ├── mint-burn.ts
│   ├── blacklist-compliance.ts
│   ├── transfer-hook.ts
│   ├── pause-admin.ts
│   ├── seize.ts
│   ├── edge-cases.ts
│   └── full-lifecycle.ts
│
└── docs/
    ├── ARCHITECTURE.md
    ├── SECURITY.md
    └── TESTING.md
```

---

## 3. Account Structs

### StablecoinConfig (one per stablecoin)

```rust
#[account]
pub struct StablecoinConfig {
    pub master_authority: Pubkey,        // 32 — can assign/revoke all roles
    pub mint: Pubkey,                     // 32 — the Token-2022 stablecoin mint
    pub preset: u8,                       // 1  — 1=SSS-1, 2=SSS-2
    pub paused: bool,                     // 1  — emergency pause
    pub supply_cap: Option<u64>,          // 9  — max total supply (None=unlimited)
    pub transfer_hook_program: Pubkey,    // 32 — hook program ID (default for SSS-1)
    pub decimals: u8,                     // 1  — token decimals
    pub bump: u8,                         // 1  — PDA bump
    pub _reserved: [u8; 64],              // 64 — future upgrades
}
// LEN = 8 + 32+32+1+1+9+32+1+1+64 = 181
```

**PDA**: `["stablecoin", mint.key()]` — program = sss-token

### RoleConfig (one per role assignment)

```rust
#[repr(u8)]
pub enum Role {
    Minter = 0,
    Burner = 1,
    Blacklister = 2,
    Pauser = 3,
    Seizer = 4,
}

#[account]
pub struct RoleConfig {
    pub config: Pubkey,                   // 32 — parent StablecoinConfig
    pub role: u8,                         // 1  — Role enum as u8
    pub holder: Pubkey,                   // 32 — wallet holding this role
    pub mint_allowance: Option<u64>,      // 9  — minting quota (Minter only)
    pub bump: u8,                         // 1  — PDA bump
}
// LEN = 8 + 32+1+32+9+1 = 83
```

**PDA**: `["role", config.key(), &[role_u8], holder.key()]` — program = sss-token

### BlacklistEntry (one per blacklisted wallet, SSS-2 only)

```rust
#[account]
pub struct BlacklistEntry {
    pub config: Pubkey,                   // 32 — parent StablecoinConfig
    pub wallet: Pubkey,                   // 32 — blacklisted wallet
    pub bump: u8,                         // 1  — PDA bump
}
// LEN = 8 + 32+32+1 = 73
```

**PDA**: `["blacklist", config.key(), wallet.key()]` — program = sss-token

---

## 4. Complete Instruction List

### sss-token program (15 instructions)

| # | Instruction | Signer | Role Required | Preset | Key Logic |
|---|-------------|--------|---------------|--------|-----------|
| 1 | `initialize_sss1` | master_authority | — | — | Create mint with MetadataPointer + MintCloseAuthority, init config |
| 2 | `initialize_sss2` | master_authority | — | — | Create mint with 5 extensions, init config, init extra account metas |
| 3 | `assign_role` | master_authority | — | any | Create RoleConfig PDA |
| 4 | `revoke_role` | master_authority | — | any | Close RoleConfig PDA |
| 5 | `update_mint_allowance` | master_authority | — | any | Update RoleConfig.mint_allowance |
| 6 | `mint_tokens` | minter | Minter | any | Mint via CPI, decrement allowance, check supply cap |
| 7 | `burn_tokens` | authority | Burner or self | any | Burn via CPI (self-burn or forced via permanent delegate) |
| 8 | `blacklist` | blacklister | Blacklister | SSS-2 | Create BlacklistEntry, freeze account via CPI |
| 9 | `unblacklist` | blacklister | Blacklister | SSS-2 | Close BlacklistEntry, thaw account via CPI |
| 10 | `approve_account` | blacklister | Blacklister | SSS-2 | Thaw a frozen account (KYC approval, no BlacklistEntry needed) |
| 11 | `seize` | seizer | Seizer | SSS-2 | Thaw → transfer via permanent delegate → re-freeze |
| 12 | `pause` | pauser | Pauser or master | any | Set config.paused = true |
| 13 | `unpause` | pauser | Pauser or master | any | Set config.paused = false |
| 14 | `transfer_master_authority` | master_authority | — | any | Update config.master_authority |
| 15 | `update_supply_cap` | master_authority | — | any | Update config.supply_cap |

### sss-transfer-hook program (2 instructions)

| # | Instruction | Purpose |
|---|-------------|---------|
| 1 | `initialize_extra_account_meta_list` | Set up ExtraAccountMetaList PDA with blacklist check accounts |
| 2 | `transfer_hook` (fallback/Execute) | Check sender/receiver not blacklisted, check not paused |

---

## 5. Token-2022 Extension Initialization Order

### SSS-1 (2 extensions)

```
1. Calculate mint_size with extensions: [MetadataPointer, MintCloseAuthority]
2. create_account(payer, mint_keypair, lamports, mint_size, TOKEN_2022_PROGRAM_ID)
3. initialize_metadata_pointer(mint, authority=config_pda, metadata_address=mint) ← BEFORE mint init
4. initialize_mint_close_authority(mint, close_authority=config_pda)               ← BEFORE mint init
5. initialize_mint2(mint, decimals, mint_authority=config_pda, freeze_authority=config_pda)
6. initialize_metadata(mint, name, symbol, uri, update_authority=config_pda)       ← AFTER mint init
```

### SSS-2 (5 extensions)

```
1. Calculate mint_size with extensions: [MetadataPointer, MintCloseAuthority, PermanentDelegate, TransferHook, DefaultAccountState]
2. create_account(payer, mint_keypair, lamports, mint_size, TOKEN_2022_PROGRAM_ID)
3. initialize_metadata_pointer(mint, authority=config_pda, metadata_address=mint)  ← BEFORE mint init
4. initialize_mint_close_authority(mint, close_authority=config_pda)                ← BEFORE mint init
5. initialize_permanent_delegate(mint, delegate=config_pda)                        ← BEFORE mint init
6. initialize_transfer_hook(mint, authority=config_pda, hook_program_id)            ← BEFORE mint init
7. initialize_default_account_state(mint, state=Frozen)                             ← BEFORE mint init
8. initialize_mint2(mint, decimals, mint_authority=config_pda, freeze_authority=config_pda)
9. initialize_metadata(mint, name, symbol, uri, update_authority=config_pda)       ← AFTER mint init
```

**Critical rules**:
- ALL extensions must be initialized BEFORE `initialize_mint2`
- Metadata content (step 6/9) is set AFTER mint init — only the MetadataPointer is set before
- The mint account is a **Keypair** (Signer), not a PDA — Token-2022 requires the keypair for `create_account`
- The config PDA is derived FROM the mint address, so we need the mint's pubkey first
- `PermanentDelegate` is IMMUTABLE — cannot be changed after mint init
- `DefaultAccountState::Frozen` means every new token account starts frozen — only freeze_authority (config PDA) can thaw

---

## 6. Role-Based Access Control Design

### Validation pattern (in Anchor constraints)

```rust
// Role-gated instruction example (mint_tokens):
#[account(
    constraint = role_config.config == config.key() @ StablecoinError::InvalidRoleConfig,
    constraint = role_config.holder == minter.key() @ StablecoinError::Unauthorized,
    constraint = role_config.role == Role::Minter as u8 @ StablecoinError::WrongRole,
    seeds = [b"role", config.key().as_ref(), &[role_config.role], role_config.holder.as_ref()],
    bump = role_config.bump,
)]
pub role_config: Account<'info, RoleConfig>,
```

### Master authority fallback for pause/unpause

The `pause` and `unpause` instructions accept an **optional** RoleConfig. The handler checks:
```rust
let is_master = ctx.accounts.authority.key() == ctx.accounts.config.master_authority;
// If not master, role_config must be provided and valid
```

This uses `Option<Account<'info, RoleConfig>>` in the accounts struct.

### SSS-2-only instructions

`blacklist`, `unblacklist`, and `seize` add this constraint:
```rust
constraint = config.preset == 2 @ StablecoinError::Sss2Required
```

---

## 7. Transfer Hook Design (sss-transfer-hook)

### ExtraAccountMetaList

The hook needs these extra accounts resolved at transfer time:

1. **StablecoinConfig PDA** — derived from `["stablecoin", mint]` to check `paused`
2. **Sender BlacklistEntry PDA** — derived from `["blacklist", config, source_owner]`
3. **Receiver BlacklistEntry PDA** — derived from `["blacklist", config, dest_owner]`
4. **sss-token program ID** — needed for PDA derivation

These are registered via `ExtraAccountMeta::new_with_seeds()` in the `initialize` instruction.

### Execute handler (fallback)

```rust
fn transfer_hook(accounts: &[AccountInfo], _amount: u64) -> Result<()> {
    // 1. Check config is not paused
    // 2. If sender_blacklist_entry has data → reject (SenderBlacklisted)
    // 3. If receiver_blacklist_entry has data → reject (ReceiverBlacklisted)
    Ok(())
}
```

The hook is read-only — it can only approve or reject transfers. BlacklistEntry existence = blacklisted.

### Integration sequence

1. Deploy `sss-transfer-hook` program first
2. `initialize_sss2` creates mint with `TransferHook` extension pointing to the hook program
3. Call `initialize_extra_account_meta_list` on the hook program (can be same tx or separate)
4. Now all `transfer_checked` calls will invoke the hook automatically

---

## 8. Error Definitions

### StablecoinError (sss-token)

```rust
#[error_code]
pub enum StablecoinError {
    #[msg("Unauthorized — caller lacks required authority or role")]
    Unauthorized,
    #[msg("Stablecoin is paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Mint allowance exceeded")]
    AllowanceExceeded,
    #[msg("Supply cap would be exceeded")]
    SupplyCapExceeded,
    #[msg("This operation requires SSS-2 preset")]
    Sss2Required,
    #[msg("Invalid role for this operation")]
    WrongRole,
    #[msg("Role config does not belong to this stablecoin")]
    InvalidRoleConfig,
    #[msg("Wallet is not blacklisted")]
    NotBlacklisted,
    #[msg("Invalid mint for this stablecoin config")]
    InvalidMint,
    #[msg("Name too long (max 32 characters)")]
    NameTooLong,
    #[msg("Symbol too long (max 10 characters)")]
    SymbolTooLong,
    #[msg("URI too long (max 200 characters)")]
    UriTooLong,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
```

### TransferHookError (sss-transfer-hook)

```rust
#[error_code]
pub enum TransferHookError {
    #[msg("Sender is blacklisted")]
    SenderBlacklisted,
    #[msg("Receiver is blacklisted")]
    ReceiverBlacklisted,
    #[msg("Stablecoin is paused — transfers disabled")]
    TransfersPaused,
}
```

---

## 9. Event Definitions

```rust
StablecoinInitialized { config, authority, mint, preset }
RoleAssigned { config, role, holder, mint_allowance }
RoleRevoked { config, role, holder }
MintAllowanceUpdated { config, holder, old_allowance, new_allowance }
TokensMinted { config, minter, destination, amount }
TokensBurned { config, authority, from, amount }
WalletBlacklisted { config, wallet, blacklister }
WalletUnblacklisted { config, wallet, blacklister }
AccountApproved { config, wallet, blacklister }
TokensSeized { config, from, treasury, amount, seizer }
StablecoinPaused { config }
StablecoinUnpaused { config }
MasterAuthorityTransferred { config, old_authority, new_authority }
SupplyCapUpdated { config, old_cap, new_cap }
```

---

## 10. SDK Design (`@stbr/sss-token`)

### SolanaStablecoin class

Mirrors SVS's `SolanaVault` pattern:

```typescript
class SolanaStablecoin {
  // Private constructor — use factory methods
  private constructor(...)

  // Factory
  static async load(program, mint): Promise<SolanaStablecoin>
  static async createSss1(program, params): Promise<SolanaStablecoin>
  static async createSss2(program, hookProgram, params): Promise<SolanaStablecoin>

  // State
  async refresh(): Promise<StablecoinConfigState>
  async getState(): Promise<StablecoinConfigState>

  // Roles
  async assignRole(masterAuthority, holder, role, mintAllowance?): Promise<string>
  async revokeRole(masterAuthority, holder, role): Promise<string>
  async updateMintAllowance(masterAuthority, holder, newAllowance): Promise<string>
  async getRole(holder, role): Promise<RoleConfigState | null>

  // Token ops
  async mintTokens(minter, destination, amount): Promise<string>
  async burnTokens(authority, from, amount): Promise<string>

  // Compliance (SSS-2)
  async blacklist(blacklister, wallet): Promise<string>
  async unblacklist(blacklister, wallet): Promise<string>
  async approveAccount(blacklister, wallet): Promise<string>
  async seize(seizer, fromOwner, treasury, amount): Promise<string>
  async isBlacklisted(wallet): Promise<boolean>

  // Admin
  async pause(authority): Promise<string>
  async unpause(authority): Promise<string>
  async transferMasterAuthority(authority, newAuthority): Promise<string>
  async updateSupplyCap(authority, newCap): Promise<string>

  // PDA helpers
  getConfigAddress(): PublicKey
  getRoleAddress(holder, role): PublicKey
  getBlacklistAddress(wallet): PublicKey
}
```

### PDA module

```typescript
export function getConfigAddress(programId, mint): [PublicKey, number]
export function getRoleAddress(programId, config, role, holder): [PublicKey, number]
export function getBlacklistAddress(programId, config, wallet): [PublicKey, number]
export function getExtraAccountMetaListAddress(hookProgramId, mint): [PublicKey, number]
```

---

## 11. CLI Design

```
sss-token init sss1 --name "BRLUSD" --symbol "BRLUSD" --decimals 6 --uri "..."
sss-token init sss2 --name "BRLUSD" --symbol "BRLUSD" --decimals 6 --uri "..." --hook-program <ID>
sss-token role assign --mint <ADDR> --holder <WALLET> --role minter [--allowance 1000000]
sss-token role revoke --mint <ADDR> --holder <WALLET> --role minter
sss-token mint --mint <ADDR> --to <WALLET> --amount 1000
sss-token burn --mint <ADDR> --from <WALLET> --amount 500
sss-token blacklist add --mint <ADDR> --wallet <WALLET>
sss-token blacklist remove --mint <ADDR> --wallet <WALLET>
sss-token approve --mint <ADDR> --wallet <WALLET>
sss-token seize --mint <ADDR> --from <WALLET> --to <TREASURY> --amount 100
sss-token admin pause --mint <ADDR>
sss-token admin unpause --mint <ADDR>
sss-token info --mint <ADDR>
```

Built with `commander`, using the SDK internally.

---

## 12. Dependencies

### sss-token/Cargo.toml
```toml
anchor-lang = "0.31.1"
anchor-spl = { version = "0.31.1", features = ["token", "associated_token", "metadata"] }
spl-token-2022 = "6.0.0"
spl-token-metadata-interface = "0.5.1"
```

### sss-transfer-hook/Cargo.toml
```toml
anchor-lang = "0.31.1"
anchor-spl = { version = "0.31.1", features = ["token"] }
spl-token-2022 = "6.0.0"
spl-transfer-hook-interface = "0.8.0"
spl-tlv-account-resolution = "0.8.0"
```

### SDK package.json
```json
{
  "name": "@stbr/sss-token",
  "dependencies": {
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/spl-token": "^0.4.10",
    "@solana/web3.js": "^1.98.0"
  }
}
```

---

## 13. Testing Strategy

### Integration tests (in order of implementation)

| File | Tests | What it validates |
|------|:-----:|-------------------|
| `sss-1-basic.ts` | 12 | SSS-1 init, verify extensions, mint/burn, basic flow |
| `role-management.ts` | 15 | Assign/revoke all 5 roles, allowance CRUD, unauthorized attempts |
| `mint-burn.ts` | 12 | Allowance tracking, supply cap enforcement, self-burn |
| `sss-2-basic.ts` | 12 | SSS-2 init with all 5 extensions, default frozen state |
| `blacklist-compliance.ts` | 18 | Blacklist/unblacklist, approve_account (KYC thaw), freeze/thaw, SSS-1 rejection |
| `transfer-hook.ts` | 12 | Hook init, transfer blocked for blacklisted, allowed for clean |
| `seize.ts` | 10 | Thaw-transfer-freeze cycle, non-blacklisted rejection |
| `pause-admin.ts` | 10 | Pause/unpause, authority transfer, supply cap update |
| `edge-cases.ts` | 12 | Zero amounts, double-blacklist, unauthorized access |
| `full-lifecycle.ts` | 8 | End-to-end: create → roles → mint → transfer → blacklist → seize → burn |

**Total: ~118 integration tests**

### SDK unit tests: ~40 tests (PDA derivation, types, interface coverage)

### Key error paths to test
- Unauthorized signer for every instruction
- Minting beyond allowance / supply cap
- Operating while paused
- SSS-2 operations on SSS-1 config
- Double-blacklisting same wallet
- Seizing from non-blacklisted wallet
- Transfer hook rejection for blacklisted sender/receiver

---

## 14. Build Order (21-Day Timeline)

### Phase 1: Foundation (Days 1-5)
- **Day 1**: Scaffold entire monorepo — Anchor.toml, Cargo.toml, package.json, all empty files
- **Day 2-3**: `state.rs`, `error.rs`, `constants.rs`, `events.rs` + `initialize_sss1.rs` with Token-2022 extensions
- **Day 4-5**: Role management (`assign_role`, `revoke_role`, `update_mint_allowance`) + token ops (`mint_tokens`, `burn_tokens`) + admin (`pause`, `unpause`, `transfer_master_authority`, `update_supply_cap`)
- Tests: `sss-1-basic.ts`, `role-management.ts`, `mint-burn.ts`

### Phase 2: SSS-2 + Compliance (Days 6-12)
- **Day 6-7**: `initialize_sss2.rs` — 5 extensions in correct order. THE hardest part.
- **Day 8-9**: `sss-transfer-hook` program — ExtraAccountMetaList + Execute handler
- **Day 10-11**: `blacklist.rs`, `unblacklist.rs`, `seize.rs`
- **Day 12**: Integration testing across all components
- Tests: `sss-2-basic.ts`, `blacklist-compliance.ts`, `transfer-hook.ts`, `seize.ts`

### Phase 3: SDK + CLI + Polish (Days 13-18)
- **Day 13-14**: TypeScript SDK — `SolanaStablecoin` class, `pda.ts`, `types.ts`
- **Day 15-16**: CLI with commander
- **Day 17**: Backend (minimal Express server + Docker)
- **Day 18**: Documentation (ARCHITECTURE.md, SECURITY.md, TESTING.md)

### Phase 4: Harden + Submit (Days 19-21)
- **Day 19**: `edge-cases.ts`, `full-lifecycle.ts`, `pause-admin.ts`
- **Day 20**: Security review — all constraints, signer checks, edge cases
- **Day 21**: Final polish, README, submit

### If falling behind — cut list (lowest impact first)
1. Backend (judges care about programs/SDK, not a REST wrapper)
2. Fuzz tests (nice-to-have, not essential for competition)
3. CLI (SDK is the real deliverable; CLI is sugar)

---

## 15. Critical Technical Risks

1. **Token-2022 extension ordering**: Must get the init sequence exactly right. Budget extra time for debugging.
2. **Transfer hook account resolution**: ExtraAccountMeta with `new_with_seeds` is tricky — the account indices must exactly match the Token-2022 CPI account order.
3. **Seize compute budget**: Thaw → transfer → re-freeze is 3 CPIs in one instruction. Test early that it fits within 200K compute units.
4. **DefaultAccountState::Frozen + minting**: Minting to a frozen account will fail. The recipient must be approved (`approve_account` — thawed) BEFORE tokens can be minted to them. This is by design for KYC/compliance gating. Flow: user creates ATA (starts frozen) → Blacklister calls `approve_account` to thaw → Minter can now mint to that account.

### Design Decisions (confirmed)
- **Mint type**: Keypair (caller provides Signer). Config PDA derived from mint address. Matches real-world stablecoins.
- **KYC thawing**: Dedicated `approve_account` instruction (Blacklister role) — thaws frozen accounts for new users. Semantically distinct from `unblacklist` (which closes a BlacklistEntry AND thaws). `approve_account` only thaws, no BlacklistEntry involved.

---

## 16. Scope Assessment

### Is this overbuilt for 21 days?
**No, but at the limit.** The reference gives us a proven template. Most instructions follow the same pattern (validate role → check pause → CPI → emit event). The real risk is days 6-9 (SSS-2 init + transfer hook). If those go smoothly, we're on track.

### Is this underbuilt?
**No.** Six roles, two presets, transfer hook enforcement, permanent delegate seizure, default frozen accounts, supply caps, minting quotas — this matches what real stablecoins (USDC, PYUSD) implement. Adding a `whitelist` instruction (thaw for new SSS-2 users) would be a nice addition if time permits.

### Is it engineered right?
**Yes.** Single program for both presets (shared state, shared roles), separate transfer hook (required by Token-2022), modular SDK, clean PDA design. The architecture is competition-grade.

---

## Verification Plan

1. **Build**: `anchor build` — both programs compile
2. **Test**: `anchor test` — all ~118 integration tests pass
3. **SDK test**: `cd sdk && yarn test` — all ~40 unit tests pass
4. **CLI smoke test**: `sss-token init sss1 ...` on localnet
5. **Manual E2E**: Create SSS-2 stablecoin → assign roles → mint → transfer → blacklist → verify hook blocks transfer → seize → burn
6. **Security checklist**: Every instruction validates signer, role, pause state, preset requirement, and PDA seeds
