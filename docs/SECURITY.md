# Security

## Threat Model

SSS assumes the master authority is a trusted admin (multisig in production). All other wallets are untrusted. The design prevents:

- Unauthorized minting, burning, or role assignment
- Transfers to/from blacklisted wallets
- Operations during emergency pause
- Cross-stablecoin privilege escalation via PDA collisions

### Who Can Do What

| Action | Required Authority |
|--------|-------------------|
| Assign/revoke any role | Master authority only |
| Transfer master authority | Current master authority only |
| Update supply cap | Master authority only |
| Mint tokens | Minter role holder |
| Burn tokens (role-based) | Burner role holder |
| Burn tokens (self-burn) | Token account owner (no role needed) |
| Pause / unpause | Master authority OR Pauser role holder |
| Blacklist / unblacklist | Blacklister role holder |
| Approve (thaw) account | Blacklister role holder |
| Seize tokens | Seizer role holder |
| Transfer tokens | Any non-blacklisted wallet (SSS-2 hook enforced) |

## Signer Validation

Every instruction enforces signer checks through Anchor's `#[account]` constraints. The table below lists each instruction and its access control:

| Instruction | Signer | Constraints |
|-------------|--------|-------------|
| `initialize_sss1` | `authority` | Becomes `master_authority`. No prior state exists. |
| `initialize_sss2` | `authority` | Same as SSS-1. |
| `assign_role` | `authority` | `config.master_authority == authority.key()` |
| `revoke_role` | `authority` | `config.master_authority == authority.key()` |
| `update_mint_allowance` | `authority` | `config.master_authority == authority.key()` |
| `transfer_master_authority` | `authority` | `config.master_authority == authority.key()` |
| `update_supply_cap` | `authority` | `config.master_authority == authority.key()` |
| `mint_tokens` | `minter` | `role_config.role == Minter`, `role_config.holder == minter.key()`, `!config.paused` |
| `burn_tokens` | `authority` | Either `role_config.role == Burner` with `holder == authority`, or `role_config == null` (self-burn by ATA owner) |
| `pause` | `authority` | Either `config.master_authority == authority` or `role_config.role == Pauser` with `holder == authority` |
| `unpause` | `authority` | Same as `pause` |
| `blacklist` | `blacklister` | `role_config.role == Blacklister`, `holder == blacklister`, `config.preset == 2` |
| `unblacklist` | `blacklister` | Same as `blacklist` |
| `approve_account` | `blacklister` | Same as `blacklist` (Blacklister role, SSS-2) |
| `seize` | `seizer` | `role_config.role == Seizer`, `holder == seizer`, `config.preset == 2`, blacklist_entry must exist |

## PDA Collision Resistance

Each account type uses distinct seed prefixes to prevent cross-type collisions:

```
StablecoinConfig:  ["stablecoin",  mint]
RoleConfig:        ["role",        config, role_u8, holder]
BlacklistEntry:    ["blacklist",   config, wallet]
ExtraAccountMeta:  ["extra-account-metas", mint]  (on hook program)
```

Cross-stablecoin attacks are prevented because:

1. **Config PDAs include the mint.** Two stablecoins produce different config PDAs. A role assigned under config A cannot pass the `role_config.config == config.key()` constraint on config B.

2. **Role PDAs include the config.** The 4-part seed `["role", config, role_u8, holder]` ties each role to a specific stablecoin. A Minter on stablecoin A has no authority on stablecoin B.

3. **Blacklist PDAs include the config.** A blacklist entry on stablecoin A does not affect stablecoin B, even for the same wallet.

4. **ExtraAccountMetaList PDAs live on a separate program.** The hook program's meta list uses the mint as a seed, bound to one stablecoin's mint.

## Token-2022 Extension Immutability

These properties are set at mint creation and cannot be changed after `initialize_mint2`:

| Extension | Immutable Property | Consequence |
|-----------|-------------------|-------------|
| PermanentDelegate | Delegate address (config PDA) | Cannot be reassigned. Seizure always routes through the config PDA. |
| TransferHook | Hook program ID | The program that validates transfers is fixed at deploy. The hook authority can update it, but the authority is the config PDA (no external caller can change it). |
| DefaultAccountState | Initial state (Frozen) | All new ATAs for SSS-2 mints start frozen. Cannot be changed to unfrozen post-init. |
| MetadataPointer | Metadata account address | Points to the mint itself. On-chain metadata content (name, symbol, uri) can be updated by the metadata authority, but the pointer target cannot change. |
| MintCloseAuthority | Close authority (config PDA) | Only the config PDA can close the mint (requires zero supply). |

The mint authority and freeze authority are set to the config PDA. They can be reassigned by the current authority, but since the config PDA is the authority and it only acts via `invoke_signed` within program instructions, no external party can reassign them.

## Error Codes

The `sss-token` program defines 12 error codes:

| Code | Name | Trigger |
|------|------|---------|
| 6000 | `Unauthorized` | Signer is not master authority or role holder |
| 6001 | `Paused` | Operation attempted while stablecoin is paused |
| 6002 | `ZeroAmount` | Mint or burn with amount = 0 |
| 6003 | `AllowanceExceeded` | Minter's per-role allowance would be exceeded |
| 6004 | `SupplyCapExceeded` | Global supply cap would be exceeded |
| 6005 | `Sss2Required` | Blacklist/approve/seize on an SSS-1 stablecoin |
| 6006 | `WrongRole` | Role type does not match the operation |
| 6007 | `InvalidRoleConfig` | Role PDA does not belong to this stablecoin |
| 6008 | `NotBlacklisted` | Unblacklist called on a non-blacklisted wallet |
| 6009 | `InvalidMint` | Mint pubkey does not match config.mint |
| 6010 | `NameTooLong` | Name exceeds 32 characters |
| 6011 | `SymbolTooLong` | Symbol exceeds 10 characters |

The `sss-transfer-hook` program defines 3 error codes:

| Code | Name | Trigger |
|------|------|---------|
| 6000 | `TransfersPaused` | Config paused flag is nonzero |
| 6001 | `SenderBlacklisted` | Sender's BlacklistEntry PDA exists |
| 6002 | `ReceiverBlacklisted` | Receiver's BlacklistEntry PDA exists |

## Agave Compatibility

Programs compile on Agave 3.0.15 (`platform-tools v2.1`) and deploy to validators running Agave 2.2.14. The test workflow:

1. Build with Agave 3.0.15: `anchor build`
2. Switch active release symlink to 2.2.14
3. Run tests: `anchor test --skip-build`

This hybrid approach is necessary because `anchor build` requires 3.0.x for `platform-tools v2.1` BPF compilation, but the local test validator ships with 2.2.x runtime.

## Known Limitations

1. **No whitelist-only mode.** SSS-2 uses a blacklist (block specific wallets). There is no positive-list mode where only pre-approved wallets can hold tokens. The DefaultAccountState(Frozen) extension provides a KYC gate — wallets must be thawed via `approve_account` before receiving tokens — but once approved, a wallet remains unfrozen unless explicitly blacklisted.

2. **Seize requires prior blacklisting.** The `seize` instruction validates that a `BlacklistEntry` PDA exists for the target wallet. You cannot seize from a non-blacklisted wallet.

3. **Single master authority.** There is no built-in multisig. Production deployments should set the master authority to a Squads multisig or similar program.

4. **No allowance for non-Minter roles.** The `mint_allowance` field on `RoleConfig` only applies to the Minter role. Burner, Blacklister, Pauser, and Seizer roles have no rate-limiting mechanism.

5. **Transfer hook accounts are read-only.** Token-2022 marks all accounts in hook CPIs as read-only (except the source and destination token accounts). The hook can check state but cannot modify it. All state mutations (blacklist creation, pause toggling) happen through `sss-token` instructions.

6. **Metadata update not exposed.** The on-chain metadata (name, symbol, uri) can technically be updated since the config PDA is the metadata update authority, but no instruction currently exposes this. Adding one requires a program upgrade.
