# SSS-2: Compliant Stablecoin Preset

SSS-2 extends SSS-1 with on-chain compliance enforcement. New wallets start frozen (KYC gate), a transfer hook blocks blacklisted addresses at the protocol level, and a permanent delegate enables seizure without owner signature.

## Token-2022 Extensions

| Extension | Config Authority | Purpose |
|-----------|-----------------|---------|
| MetadataPointer | config PDA | On-chain metadata pointer |
| MintCloseAuthority | config PDA | Close mint at zero supply |
| PermanentDelegate | config PDA | Transfer from any ATA without owner signature (seizure) |
| TransferHook | config PDA | Routes every transfer through `sss-transfer-hook` for blacklist/pause checks |
| DefaultAccountState(Frozen) | config PDA | All new ATAs start frozen; must be thawed via `approve_account` |

All five extensions are immutable after mint creation. PermanentDelegate, TransferHook, and DefaultAccountState cannot be removed or changed.

## Compliance Flow

### 1. Wallet Onboarding (KYC Gate)

```
User creates ATA  →  ATA starts FROZEN (DefaultAccountState)
                          ↓
Blacklister calls approve_account  →  ATA thawed  →  User can receive tokens
```

The `approve_account` instruction thaws a frozen ATA. This is semantically a KYC approval — the Blacklister role verifies the user off-chain, then thaws their account on-chain. No BlacklistEntry PDA is created; this is a simple thaw.

### 2. Normal Transfers

Every `transfer_checked` call triggers the transfer hook:

```
transfer_checked(source, mint, dest, owner, amount)
    ↓
Token-2022 resolves ExtraAccountMetaList PDA
    ↓
CPI into sss-transfer-hook::Execute with 9 accounts
    ↓
Hook checks:
  1. config.paused == false
  2. owner == config (permanent delegate)? → approve (privileged transfer)
  3. sender BlacklistEntry PDA exists? → reject (SenderBlacklisted)
  4. receiver BlacklistEntry PDA exists? → reject (ReceiverBlacklisted)
    ↓
Transfer proceeds (or reverts)
```

### 3. Blacklisting

```
Blacklister calls blacklist(wallet)
    ↓
Creates BlacklistEntry PDA (seeds: ["blacklist", config, wallet])
Freezes wallet's ATA via CPI (freeze_account, config PDA as freeze authority)
    ↓
Transfer hook now rejects transfers involving this wallet
Wallet cannot send or receive until unblacklisted
```

### 4. Seizure

```
Seizer calls seize(wallet, treasury, amount)
    ↓
Step 1: thaw_account(wallet_ata)          — config PDA as freeze authority
Step 2: transfer_checked(wallet → treasury) — config PDA as permanent delegate
         Hook sees owner == config → bypasses blacklist check
Step 3: freeze_account(wallet_ata)         — re-freeze after seizure
    ↓
Tokens moved to treasury. Wallet remains blacklisted and frozen.
```

Seizure requires a BlacklistEntry PDA to exist for the target wallet. Non-blacklisted wallets cannot be seized.

### 5. Unblacklisting

```
Blacklister calls unblacklist(wallet)
    ↓
Closes BlacklistEntry PDA (returns rent to blacklister)
Thaws wallet's ATA
    ↓
Transfer hook no longer blocks this wallet
```

## Compliance Instructions

| Instruction | Required Role | Preset | Description |
|-------------|---------------|--------|-------------|
| `initialize_sss2` | deployer | — | Create mint with 5 extensions + config |
| `blacklist` | Blacklister | SSS-2 | Create BlacklistEntry + freeze ATA |
| `unblacklist` | Blacklister | SSS-2 | Close BlacklistEntry + thaw ATA |
| `approve_account` | Blacklister | SSS-2 | Thaw a frozen ATA (KYC gate, no BlacklistEntry) |
| `seize` | Seizer | SSS-2 | Thaw → transfer via permanent delegate → re-freeze |

All SSS-1 instructions also work on SSS-2 stablecoins.

## ExtraAccountMetaList

The transfer hook needs four extra accounts beyond the standard `transfer_checked` accounts:

| Index | Account | How Resolved |
|-------|---------|-------------|
| 5 | sss_token_program | Static pubkey |
| 6 | StablecoinConfig PDA | `Seed::Literal("stablecoin") + Seed::AccountKey(mint)` via index 5 |
| 7 | Sender BlacklistEntry | `Seed::Literal("blacklist") + Seed::AccountKey(config) + Seed::AccountData(source_token, 32, 32)` |
| 8 | Receiver BlacklistEntry | `Seed::Literal("blacklist") + Seed::AccountKey(config) + Seed::AccountData(dest_token, 32, 32)` |

Accounts 7 and 8 use `Seed::AccountData` to extract the owner pubkey from byte offset 32 of the source/destination token account data. The hook then checks if these PDAs have data (existence = blacklisted).

The ExtraAccountMetaList is initialized by calling `initialize_extra_account_meta_list` on the hook program after `initialize_sss2`. This can happen in the same transaction or a separate one.

## Transfer Hook Internals

The hook program receives the SPL Transfer Hook Interface discriminator (not Anchor's). A `fallback` function in `lib.rs` matches this discriminator and routes to the handler.

The handler reads the StablecoinConfig account data directly (no Anchor deserialization) at byte offset 73 to check the `paused` flag. This avoids pulling in Anchor dependencies in the hook program's critical path.

Privileged transfers (where the authority is the config PDA itself, i.e., permanent delegate acting) bypass blacklist checks entirely. This is how `seize` works — the config PDA is both the transfer authority and a known trusted signer.
