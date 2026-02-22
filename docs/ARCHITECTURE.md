# Architecture

## Presets

SSS defines two stablecoin presets on Solana's Token-2022 program.

**SSS-1 (Minimal)** deploys a mint with two extensions:
- MetadataPointer (on-chain name/symbol/uri)
- MintCloseAuthority

The config PDA holds mint authority, freeze authority, and an optional supply cap. Roles (Minter, Burner, Pauser) gate operations. No transfer restrictions.

**SSS-2 (Compliant)** adds three extensions on top of SSS-1:
- PermanentDelegate (enables seizure of blacklisted funds)
- TransferHook (enforces blacklist checks on every transfer)
- DefaultAccountState(Frozen) (all new ATAs start frozen; must be thawed via `approve_account`)

SSS-2 unlocks the Blacklister and Seizer roles and requires a companion transfer hook program.

## Two-Program Design

Token-2022 transfer hooks execute as a CPI from the token program into a separate hook program. Anchor programs cannot host both the stablecoin logic and the hook handler in one binary because the hook's `Execute` instruction uses the SPL Transfer Hook Interface discriminator, not Anchor's 8-byte discriminator.

```
sss-token           CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3
sss-transfer-hook   F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz
```

The hook program has a `fallback` instruction that matches the SPL discriminator and routes to its handler. Without this fallback, the hook silently fails at runtime.

## Account Model

### StablecoinConfig (182 bytes)

Seeds: `["stablecoin", mint]`

```
Field                   Type           Bytes
discriminator           [u8; 8]        8
master_authority        Pubkey         32
mint                    Pubkey         32
preset                  u8             1
paused                  bool           1
supply_cap              Option<u64>    9
transfer_hook_program   Pubkey         32
decimals                u8             1
bump                    u8             1
_reserved               [u8; 64]       64
```

The 64-byte reserved block allows future fields without migration. `transfer_hook_program` is `Pubkey::default` for SSS-1 and the hook program ID for SSS-2.

### RoleConfig (83 bytes)

Seeds: `["role", config, role_u8, holder]`

```
Field                   Type           Bytes
discriminator           [u8; 8]        8
config                  Pubkey         32
role                    u8             1
holder                  Pubkey         32
mint_allowance          Option<u64>    9
bump                    u8             1
```

The 4-part seed ensures one PDA per (stablecoin, role type, wallet) triple. `mint_allowance` is only meaningful for the Minter role; `None` means unlimited.

### BlacklistEntry (73 bytes)

Seeds: `["blacklist", config, wallet]`

```
Field                   Type           Bytes
discriminator           [u8; 8]        8
config                  Pubkey         32
wallet                  Pubkey         32
bump                    u8             1
```

Existence of this PDA means the wallet is blacklisted. The transfer hook checks `data_len() > 0` on the PDA account info to determine blacklist status without deserialization.

## Token-2022 Extension Initialization Order

All Token-2022 extensions must be declared before `initialize_mint2`. The SSS-2 initialization follows this exact sequence:

1. Calculate mint space: `ExtensionType::try_calculate_account_len` for all extensions
2. `system_instruction::create_account` with base mint size (extensions only, no metadata)
3. `spl_token_2022::extension::metadata_pointer::instruction::initialize` (MetadataPointer)
4. `spl_token_2022::extension::mint_close_authority::instruction::initialize` (MintCloseAuthority)
5. `spl_token_2022::instruction::initialize_permanent_delegate` (PermanentDelegate)
6. `spl_token_2022::extension::transfer_hook::instruction::initialize` (TransferHook)
7. `spl_token_2022::extension::default_account_state::instruction::initialize` (DefaultAccountState = Frozen)
8. `spl_token_2022::instruction::initialize_mint2` (finalizes the mint)
9. `spl_token_metadata_interface::instruction::initialize` (on-chain metadata)

The `create_account` call uses `base_mint_size` (extensions without metadata) for the `space` parameter but `rent.minimum_balance(total_mint_size)` (including metadata) for lamports. This is because metadata is a variable-length TLV that Token-2022 appends after the fixed extensions.

## RBAC Design

Five roles, each enforced via PDA existence and Anchor constraints:

| Role | Value | Gated Operations |
|------|-------|-------------------|
| Minter | 0 | `mint_tokens` |
| Burner | 1 | `burn_tokens` (role-based burn) |
| Blacklister | 2 | `blacklist`, `unblacklist`, `approve_account` |
| Pauser | 3 | `pause`, `unpause` |
| Seizer | 4 | `seize` |

The master authority can assign and revoke all roles, transfer itself, update the supply cap, and call pause/unpause directly (bypassing the Pauser role by passing `roleConfig: null`).

Every role-gated instruction validates three constraints on the `role_config` account:
```rust
constraint = role_config.config == config.key()    // belongs to this stablecoin
constraint = role_config.role == Role::X as u8      // correct role type
constraint = role_config.holder == signer.key()     // signer holds the role
```

## Transfer Hook Flow

When a user calls `transfer_checked` on an SSS-2 mint, Token-2022:

1. Looks up the TransferHook extension on the mint to find the hook program ID
2. Resolves the ExtraAccountMetaList PDA (seeds: `["extra-account-metas", mint]`) on the hook program
3. Deserializes the meta list to build the full account list for the hook CPI
4. CPIs into `sss-transfer-hook::Execute` with 9 accounts

The hook handler checks:
- **Paused?** Reads byte 73 of the StablecoinConfig data (the `paused` field). If nonzero, rejects.
- **Privileged transfer?** If `owner == config` (permanent delegate acting as authority), approves without blacklist checks. This allows `seize` to transfer from blacklisted accounts.
- **Sender blacklisted?** If the sender's BlacklistEntry PDA has `data_len() > 0`, rejects.
- **Receiver blacklisted?** Same check on the receiver's BlacklistEntry PDA.

The ExtraAccountMetaList registers 4 extra accounts:

| Index | Account | Derivation |
|-------|---------|------------|
| 5 | sss_token_program | Static pubkey |
| 6 | StablecoinConfig PDA | `Seed::Literal("stablecoin") + Seed::AccountKey(mint)` via sss_token_program |
| 7 | Sender BlacklistEntry | `Seed::Literal("blacklist") + Seed::AccountKey(config) + Seed::AccountData(source_token, offset=32, len=32)` |
| 8 | Receiver BlacklistEntry | `Seed::Literal("blacklist") + Seed::AccountKey(config) + Seed::AccountData(dest_token, offset=32, len=32)` |

Accounts 7 and 8 use `Seed::AccountData` to extract the owner pubkey from the source/destination token account data at byte offset 32 (the `owner` field in the SPL token account layout).

## Seize Flow

Seizing tokens from a blacklisted wallet requires the Seizer role and executes three CPIs in sequence, all signed by the config PDA:

```
1. thaw_account(from_ata, mint, config_pda)
   Config PDA is the freeze authority. Temporarily unfreezes the blacklisted ATA.

2. transfer_checked(from_ata, mint, treasury_ata, config_pda, amount)
   Config PDA acts as permanent delegate. The transfer triggers the hook,
   which sees owner == config and bypasses blacklist checks.

   Remaining accounts (6 entries) are added to BOTH the instruction's
   account_metas AND the AccountInfo vec for invoke_signed.

3. freeze_account(from_ata, mint, config_pda)
   Re-freezes the blacklisted ATA after seizure.
```

The remaining accounts for the transfer CPI:
1. ExtraAccountMetaList PDA
2. Hook program ID
3. SSS token program ID
4. StablecoinConfig PDA
5. Sender BlacklistEntry PDA
6. Receiver BlacklistEntry PDA
