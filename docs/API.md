# API Reference

## sss-token Program

Program ID: `CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3`

---

### `initialize_sss1`

Create an SSS-1 stablecoin mint with MetadataPointer and MintCloseAuthority extensions.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer, Mut | Pays for account creation, becomes master authority |
| `mint` | Signer, Mut | New mint keypair |
| `config` | PDA, Mut | StablecoinConfig — seeds: `["stablecoin", mint]` |
| `token_program` | Program | Token-2022 program |
| `system_program` | Program | System program |
| `rent` | Sysvar | Rent sysvar |

**Parameters:** `name: String`, `symbol: String`, `uri: String`, `decimals: u8`, `supply_cap: Option<u64>`

**Errors:** `NameTooLong`, `SymbolTooLong`, `UriTooLong`

---

### `initialize_sss2`

Create an SSS-2 stablecoin mint with 5 extensions: MetadataPointer, MintCloseAuthority, PermanentDelegate, TransferHook, DefaultAccountState(Frozen).

**Accounts:** Same as `initialize_sss1`.

**Parameters:** `name: String`, `symbol: String`, `uri: String`, `decimals: u8`, `supply_cap: Option<u64>`, `hook_program_id: Pubkey`

**Errors:** `NameTooLong`, `SymbolTooLong`, `UriTooLong`

---

### `assign_role`

Create a RoleConfig PDA, granting a role to a wallet.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer, Mut | Must be config.master_authority |
| `config` | PDA | StablecoinConfig |
| `role_config` | PDA, Mut | New RoleConfig — seeds: `["role", config, role_u8, holder]` |
| `system_program` | Program | System program |

**Parameters:** `role: u8`, `holder: Pubkey`, `mint_allowance: Option<u64>`

**Errors:** `Unauthorized`, `WrongRole` (invalid role value)

---

### `revoke_role`

Close a RoleConfig PDA, revoking a role from a wallet. Rent returns to authority.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer, Mut | Must be config.master_authority |
| `config` | PDA | StablecoinConfig |
| `role_config` | PDA, Mut | RoleConfig to close |

**Parameters:** None.

**Errors:** `Unauthorized`, `InvalidRoleConfig`

---

### `update_mint_allowance`

Update a minter's allowance without revoking and reassigning the role.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Must be config.master_authority |
| `config` | PDA | StablecoinConfig |
| `role_config` | PDA, Mut | Minter's RoleConfig |

**Parameters:** `new_allowance: Option<u64>` (null = unlimited)

**Errors:** `Unauthorized`, `InvalidRoleConfig`

---

### `mint_tokens`

Mint tokens to a destination account. Decrements the minter's allowance and checks supply cap.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `minter` | Signer | Must hold Minter role |
| `config` | PDA, Mut | StablecoinConfig (checks paused, supply cap) |
| `role_config` | PDA, Mut | Minter's RoleConfig (decrements allowance) |
| `destination` | Token Account, Mut | Receives minted tokens |
| `mint` | Mint, Mut | The stablecoin mint |
| `token_program` | Program | Token-2022 |
| `system_program` | Program | System program |

**Parameters:** `amount: u64`

**Errors:** `Unauthorized`, `WrongRole`, `Paused`, `ZeroAmount`, `AllowanceExceeded`, `SupplyCapExceeded`

---

### `burn_tokens`

Burn tokens from a token account. Two modes: self-burn (token owner, no role needed) or forced burn (Burner role).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Token owner (self-burn) or Burner role holder |
| `config` | PDA | StablecoinConfig |
| `role_config` | PDA or null | Burner's RoleConfig, or null for self-burn |
| `from_ata` | Token Account, Mut | Account to burn from |
| `mint` | Mint, Mut | The stablecoin mint |
| `token_program` | Program | Token-2022 |

**Parameters:** `amount: u64`

**Errors:** `Unauthorized`, `WrongRole`, `Paused`, `ZeroAmount`

---

### `blacklist`

Blacklist a wallet: create BlacklistEntry PDA and freeze the wallet's ATA. SSS-2 only.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `blacklister` | Signer, Mut | Must hold Blacklister role |
| `config` | PDA | StablecoinConfig (preset must be 2) |
| `role_config` | PDA | Blacklister's RoleConfig |
| `blacklist_entry` | PDA, Mut | New BlacklistEntry — seeds: `["blacklist", config, wallet]` |
| `wallet_token_account` | Token Account, Mut | Wallet's ATA to freeze |
| `mint` | Mint | The stablecoin mint |
| `token_program` | Program | Token-2022 |
| `system_program` | Program | System program |

**Parameters:** `wallet: Pubkey`

**Errors:** `Unauthorized`, `WrongRole`, `Sss2Required`, `Paused`

---

### `unblacklist`

Remove a wallet from the blacklist: close BlacklistEntry PDA and thaw the wallet's ATA. SSS-2 only.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `blacklister` | Signer | Must hold Blacklister role |
| `config` | PDA | StablecoinConfig |
| `role_config` | PDA | Blacklister's RoleConfig |
| `blacklist_entry` | PDA, Mut | BlacklistEntry to close |
| `wallet_token_account` | Token Account, Mut | Wallet's ATA to thaw |
| `mint` | Mint | The stablecoin mint |
| `token_program` | Program | Token-2022 |

**Parameters:** None.

**Errors:** `Unauthorized`, `WrongRole`, `Sss2Required`, `NotBlacklisted`

---

### `approve_account`

Thaw a frozen token account (KYC approval). Does not create or require a BlacklistEntry. SSS-2 only.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `blacklister` | Signer | Must hold Blacklister role |
| `config` | PDA | StablecoinConfig |
| `role_config` | PDA | Blacklister's RoleConfig |
| `wallet_token_account` | Token Account, Mut | ATA to thaw |
| `mint` | Mint | The stablecoin mint |
| `token_program` | Program | Token-2022 |

**Parameters:** None.

**Errors:** `Unauthorized`, `WrongRole`, `Sss2Required`

---

### `seize`

Seize tokens from a blacklisted wallet: thaw ATA, transfer via permanent delegate, re-freeze ATA. SSS-2 only.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `seizer` | Signer | Must hold Seizer role |
| `config` | PDA | StablecoinConfig (permanent delegate) |
| `role_config` | PDA | Seizer's RoleConfig |
| `blacklist_entry` | PDA | Must exist for target wallet |
| `from_ata` | Token Account, Mut | Blacklisted wallet's ATA |
| `treasury_ata` | Token Account, Mut | Treasury's ATA (receives seized tokens) |
| `mint` | Mint, Mut | The stablecoin mint |
| `token_program` | Program | Token-2022 |

**Remaining Accounts (6):** ExtraAccountMetaList, hook program, sss-token program, config PDA, sender BlacklistEntry, receiver BlacklistEntry.

**Parameters:** `amount: u64`

**Errors:** `Unauthorized`, `WrongRole`, `Sss2Required`, `ZeroAmount`, `InvalidRoleConfig`

---

### `pause`

Set config.paused = true. Blocks `mint_tokens`, `burn_tokens`, and all transfers (via hook).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Master authority or Pauser role holder |
| `config` | PDA, Mut | StablecoinConfig |
| `role_config` | PDA or null | Pauser's RoleConfig, or null if master authority |

**Parameters:** None.

**Errors:** `Unauthorized`, `WrongRole`

---

### `unpause`

Set config.paused = false.

**Accounts:** Same as `pause`.

**Parameters:** None.

**Errors:** `Unauthorized`, `WrongRole`

---

### `transfer_master_authority`

Transfer the master authority to a new wallet.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Current master authority |
| `config` | PDA, Mut | StablecoinConfig |
| `new_authority` | UncheckedAccount | New master authority |

**Parameters:** None.

**Errors:** `Unauthorized`

---

### `update_supply_cap`

Update or remove the supply cap.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `authority` | Signer | Must be config.master_authority |
| `config` | PDA, Mut | StablecoinConfig |

**Parameters:** `new_cap: Option<u64>` (null = unlimited)

**Errors:** `Unauthorized`

---

## sss-transfer-hook Program

Program ID: `F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz`

---

### `initialize_extra_account_meta_list`

Register the extra accounts that Token-2022 resolves at transfer time.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| `payer` | Signer, Mut | Pays for account creation |
| `extra_account_meta_list` | PDA, Mut | Seeds: `["extra-account-metas", mint]` |
| `mint` | UncheckedAccount | The SSS-2 mint |
| `sss_token_program` | UncheckedAccount | The sss-token program ID |
| `system_program` | Program | System program |

**Parameters:** None.

---

### `transfer_hook` (Execute — via fallback)

Called automatically by Token-2022 on every `transfer_checked`. Not called directly.

**Accounts (9):**

| Index | Account | Description |
|-------|---------|-------------|
| 0 | source_token | Source token account |
| 1 | mint | The Token-2022 mint |
| 2 | destination_token | Destination token account |
| 3 | owner | Transfer authority (signer) |
| 4 | extra_account_meta_list | This program's meta list PDA |
| 5 | sss_token_program | sss-token program (static) |
| 6 | config | StablecoinConfig PDA |
| 7 | sender_blacklist | Sender's BlacklistEntry PDA (may not exist) |
| 8 | receiver_blacklist | Receiver's BlacklistEntry PDA (may not exist) |

**Logic:**
1. If config.paused is nonzero → `TransfersPaused`
2. If owner == config (permanent delegate) → approve (privileged transfer)
3. If sender_blacklist has data → `SenderBlacklisted`
4. If receiver_blacklist has data → `ReceiverBlacklisted`
5. Approve transfer
