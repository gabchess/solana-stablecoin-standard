# Compliance Model

SSS provides on-chain compliance primitives for stablecoin issuers. SSS-2 enforces KYC gating, blacklisting, and asset seizure at the Token-2022 protocol level — these controls cannot be bypassed by calling the token program directly.

This document covers the compliance flow, not the legal framework. SSS is a technical primitive, not a regulatory opinion.

## KYC/AML Flow

### Account Lifecycle

```
1. User creates ATA
     ↓
   ATA starts FROZEN (DefaultAccountState extension)
     ↓
2. Issuer verifies user off-chain (KYC/AML)
     ↓
3. Blacklister calls approve_account → ATA thawed
     ↓
4. User can now receive and send tokens
     ↓
5. If flagged → blacklist(wallet) → ATA frozen + BlacklistEntry created
     ↓
6. If resolved → unblacklist(wallet) → ATA thawed + BlacklistEntry closed
```

### Step-by-Step

**1. Account Creation:** Any user can create an Associated Token Account (ATA) for an SSS-2 mint. The DefaultAccountState(Frozen) extension ensures the ATA starts frozen. The user cannot receive or send tokens until explicitly approved.

**2. Off-Chain Verification:** The issuer performs KYC/AML checks through their own off-chain process. SSS does not define how verification happens — this is the issuer's responsibility. Common approaches include identity providers (Jumio, Onfido), manual review, or integration with compliance platforms.

**3. On-Chain Approval:** Once verified, a wallet with the Blacklister role calls `approve_account` to thaw the user's ATA. This is a simple thaw operation — no BlacklistEntry PDA is created. The Blacklister role serves double duty: KYC approval (thawing) and enforcement (blacklisting).

**4. Normal Operation:** The user can now receive minted tokens, send transfers, and interact with the stablecoin normally. Every transfer passes through the transfer hook, which checks the blacklist in real time.

**5. Enforcement:** If a wallet is flagged (sanctions, fraud, suspicious activity), a Blacklister calls `blacklist(wallet)`. This creates a BlacklistEntry PDA and freezes the wallet's ATA. The transfer hook immediately blocks all transfers involving this wallet.

**6. Resolution:** If the issue is resolved, a Blacklister calls `unblacklist(wallet)`. This closes the BlacklistEntry PDA and thaws the ATA. The wallet resumes normal operation.

## Blacklist Lifecycle

### Creating a Blacklist Entry

```
blacklist(wallet) →
  1. Validate caller has Blacklister role
  2. Validate config is SSS-2
  3. Validate not paused
  4. Create BlacklistEntry PDA (seeds: ["blacklist", config, wallet])
  5. Freeze wallet's ATA (CPI to Token-2022 freeze_account)
```

The BlacklistEntry PDA uses an `init` constraint — calling `blacklist` on an already-blacklisted wallet fails with "account already exists." This prevents accidental double-blacklisting.

### Transfer Enforcement

The transfer hook checks blacklist status on every `transfer_checked` call:

1. Is `config.paused` nonzero? → reject (`TransfersPaused`)
2. Is the transfer authority the config PDA? → approve (privileged transfer, e.g., seizure)
3. Does a BlacklistEntry PDA exist for the sender's wallet? → reject (`SenderBlacklisted`)
4. Does a BlacklistEntry PDA exist for the receiver's wallet? → reject (`ReceiverBlacklisted`)
5. Approve transfer

The hook checks PDA existence by verifying `data_len > 0` on the resolved BlacklistEntry accounts. These accounts are derived using `Seed::AccountData` to extract the owner pubkey from the source/destination token account data at byte offset 32.

### Removing a Blacklist Entry

```
unblacklist(wallet) →
  1. Validate caller has Blacklister role
  2. Close BlacklistEntry PDA (returns rent to blacklister)
  3. Thaw wallet's ATA (CPI to Token-2022 thaw_account)
```

After unblacklisting, the transfer hook no longer blocks the wallet. No additional approval step is needed — thawing the ATA is sufficient.

## Asset Seizure

Seizure allows an issuer to recover tokens from a blacklisted wallet without the owner's signature. This is required for sanctioned address enforcement and court-ordered asset recovery.

### Prerequisites

- The target wallet **must** be blacklisted (BlacklistEntry PDA must exist)
- The caller **must** hold the Seizer role
- The stablecoin **must** be SSS-2 preset
- A treasury ATA must exist to receive seized tokens

### Seizure Flow

```
seize(wallet, treasury, amount) →
  1. Validate caller has Seizer role
  2. Validate BlacklistEntry exists for target wallet
  3. Thaw target wallet's ATA (config PDA as freeze authority)
  4. transfer_checked(target → treasury) using config PDA as permanent delegate
     → Transfer hook sees owner == config PDA → bypasses blacklist check
  5. Re-freeze target wallet's ATA
```

The permanent delegate is the StablecoinConfig PDA itself. When the hook sees that the transfer authority matches the config PDA, it recognizes this as a privileged operation and skips blacklist checks. This is how seized tokens move from a blacklisted wallet to treasury without triggering `SenderBlacklisted`.

### Seizure Constraints

- **Cannot seize from non-blacklisted wallets.** The `blacklist_entry` account constraint requires the PDA to exist. This prevents malicious seizure of non-flagged accounts.
- **Cannot seize while paused.** The transfer hook checks the pause flag before the privileged-transfer bypass — but since the hook sees the permanent delegate, it actually bypasses this check. The `seize` instruction itself does not check pause state because seizure is considered an enforcement action that should work even during emergencies.
- **Wallet remains frozen after seizure.** The re-freeze step ensures the blacklisted wallet cannot receive new tokens between seizure and resolution.

## SSS-1 vs SSS-2 Compliance Comparison

| Capability | SSS-1 | SSS-2 |
|-----------|-------|-------|
| Role-based minting | Yes | Yes |
| Per-minter allowances | Yes | Yes |
| Emergency pause (mint/burn) | Yes | Yes |
| Emergency pause (transfers) | No | Yes (via hook) |
| KYC gate (frozen default) | No | Yes |
| Blacklisting | No | Yes |
| Transfer enforcement | No | Yes (via hook) |
| Asset seizure | No | Yes |
| Forced burn | Yes (Burner role) | Yes (Burner role) |

SSS-1 is suitable when compliance is handled entirely off-chain. SSS-2 is required when the issuer needs on-chain enforcement that cannot be circumvented.

## Roles in Compliance

| Role | Compliance Function |
|------|-------------------|
| **Minter** | Controlled issuance with per-minter caps. Prevents unauthorized supply expansion. |
| **Burner** | Forced redemption from any ATA. Used for reserve management and token recalls. |
| **Blacklister** | KYC approval (thaw accounts) and enforcement (freeze + create blacklist entry). Core compliance role. |
| **Pauser** | Emergency halt of all operations. Circuit breaker for security incidents or regulatory orders. |
| **Seizer** | Asset recovery from blacklisted wallets. Required for sanctions enforcement. |

The master authority can perform all role-gated actions and is the only wallet that can assign/revoke roles or transfer authority. In production, the master authority should be a multisig (e.g., Squads Protocol).

## Limitations

**SSS is not a compliance framework.** It provides the on-chain enforcement primitives. The issuer is responsible for:

- KYC/AML verification processes
- Sanctions screening (OFAC, EU, etc.)
- Regulatory reporting
- Legal agreements with users
- Privacy and data protection compliance

**No whitelist-only mode.** SSS uses a blacklist model (block specific wallets) combined with frozen-by-default accounts (KYC gate). There is no concept of a whitelist that restricts transfers to pre-approved wallets only.

**No transfer amount limits.** The transfer hook checks blacklist status and pause state. It does not enforce per-transaction or per-day transfer limits.

**No built-in multisig.** All role-gated instructions accept a single signer. Production deployments should use a multisig program (Squads, Snowflake) as the master authority and role holders.

**No rate limiting.** Except for minter allowances, there are no rate limits on role-gated operations. A Blacklister can blacklist/unblacklist as fast as the network allows.

**Blacklist, not greylist.** There is no intermediate state between "approved" and "blacklisted." A wallet is either fully operational or fully blocked.
