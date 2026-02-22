# Operations Guide

Production deployment and day-to-day operations for SSS stablecoins.

## Key Management

### Master Authority

The master authority is the root of trust for a stablecoin. It can:
- Assign and revoke all roles
- Pause and unpause the stablecoin
- Transfer itself to a new wallet
- Update the supply cap

**Production requirement:** Use a multisig as the master authority. Single-key authority is a single point of failure — key compromise means total loss of control.

Recommended multisig programs:
- [Squads Protocol](https://squads.so/) — production-grade multisig for Solana
- Threshold: 2-of-3 minimum, 3-of-5 for high-value deployments

### Setting Up Multisig Authority

```bash
# 1. Deploy stablecoin with a temporary single-key authority
sss-token init sss2 --name "BRLUSD" --symbol "BRLUSD" --uri "https://..." \
  --hook-program F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz

# 2. Create a Squads multisig (use Squads CLI or UI)
# Multisig address: <MULTISIG_PUBKEY>

# 3. Transfer master authority to the multisig
sss-token admin transfer-authority --mint <MINT> --new-authority <MULTISIG_PUBKEY>
```

After transfer, all master authority operations require multisig approval. The original single-key authority loses all privileges.

### Role Key Separation

Each role should use a separate keypair. Never reuse the master authority key for operational roles.

| Role | Key Management | Rotation Frequency |
|------|---------------|-------------------|
| Master Authority | Cold wallet or multisig | Rarely (only if compromised) |
| Minter | Hot wallet with limited allowance | Monthly or per-campaign |
| Burner | Hot wallet | As needed |
| Blacklister | Hot wallet (compliance team) | Quarterly |
| Pauser | Hot wallet (ops team) | Quarterly |
| Seizer | Hot wallet (compliance team) | Quarterly |

Multiple wallets can hold the same role. This enables team-based operations without sharing keys.

## Role Rotation

### Rotating a Minter

```bash
# 1. Assign new minter
sss-token role assign --mint <MINT> --holder <NEW_MINTER> --role minter --allowance 10000000

# 2. Verify new minter works (small test mint)
sss-token mint --mint <MINT> --to <TEST_ATA> --amount 1

# 3. Revoke old minter
sss-token role revoke --mint <MINT> --holder <OLD_MINTER> --role minter
```

### Rotating a Compliance Role (Blacklister/Seizer)

```bash
# 1. Assign new blacklister
sss-token role assign --mint <MINT> --holder <NEW_WALLET> --role blacklister

# 2. Verify (approve a test account)
sss-token approve --mint <MINT> --wallet-ata <TEST_ATA>

# 3. Revoke old blacklister
sss-token role revoke --mint <MINT> --holder <OLD_WALLET> --role blacklister
```

### Emergency Role Revocation

If a role key is compromised:

```bash
# Immediate revocation (master authority signs)
sss-token role revoke --mint <MINT> --holder <COMPROMISED_WALLET> --role <ROLE>
```

If the master authority is compromised, there is no recovery mechanism. This is why multisig is critical for production.

## Incident Response

### Scenario 1: Suspicious Activity Detected

**Response time target: < 5 minutes**

```bash
# 1. Blacklist the suspicious wallet immediately
sss-token blacklist add --mint <MINT> --wallet <SUSPICIOUS_WALLET>

# 2. Verify blacklist is effective
sss-token admin info --mint <MINT>

# 3. If widespread: pause the entire stablecoin
sss-token admin pause --mint <MINT>

# 4. Investigate off-chain

# 5. If seizure required:
sss-token seize --mint <MINT> --from <FROM_ATA> --to <TREASURY_ATA> \
  --wallet <WALLET> --treasury-wallet <TREASURY> --amount <AMOUNT>

# 6. Unpause when investigation complete
sss-token admin unpause --mint <MINT>
```

### Scenario 2: Minter Key Compromise

```bash
# 1. Revoke compromised minter immediately
sss-token role revoke --mint <MINT> --holder <COMPROMISED_MINTER> --role minter

# 2. Assess damage — check recent mint transactions
# (Use Solana Explorer or RPC to review recent mint_tokens calls)

# 3. If unauthorized tokens were minted, burn them
sss-token burn --mint <MINT> --from <UNAUTHORIZED_ATA> --amount <AMOUNT>

# 4. Assign new minter with fresh keypair
sss-token role assign --mint <MINT> --holder <NEW_MINTER> --role minter --allowance <AMOUNT>
```

### Scenario 3: Regulatory Freeze Order

```bash
# 1. Pause all operations
sss-token admin pause --mint <MINT>

# 2. Blacklist specific wallets named in the order
sss-token blacklist add --mint <MINT> --wallet <WALLET_1>
sss-token blacklist add --mint <MINT> --wallet <WALLET_2>

# 3. Keep paused until legal review is complete
# 4. Unpause, leaving blacklisted wallets frozen
sss-token admin unpause --mint <MINT>
```

### Scenario 4: Pauser Key Compromise

A compromised Pauser can pause the stablecoin but cannot unpause without the same role. The master authority can always unpause:

```bash
# 1. Unpause via master authority (no role needed)
sss-token admin unpause --mint <MINT>

# 2. Revoke compromised pauser
sss-token role revoke --mint <MINT> --holder <COMPROMISED_PAUSER> --role pauser

# 3. Assign new pauser
sss-token role assign --mint <MINT> --holder <NEW_PAUSER> --role pauser
```

## Monitoring

### On-Chain State Checks

```bash
# View stablecoin config (preset, paused, supply cap, authority)
sss-token admin info --mint <MINT>
```

### Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Total supply | `getMint()` → `supply` | Approaching supply cap |
| Paused state | `StablecoinConfig.paused` | Any unexpected pause |
| Master authority | `StablecoinConfig.masterAuthority` | Any change |
| Minter allowance | `RoleConfig.mintAllowance` | Depleted (approaching 0) |
| Blacklist count | Count BlacklistEntry PDAs | Unusual spike |
| Failed transfers | Transfer hook error logs | Any `SenderBlacklisted` / `ReceiverBlacklisted` |

### RPC Monitoring

Use `getProgramAccounts` with filters to enumerate all role configs, blacklist entries, and stablecoin configs:

```typescript
// Find all minters for a stablecoin
const minters = await connection.getProgramAccounts(SSS_TOKEN_PROGRAM_ID, {
  filters: [
    { memcmp: { offset: 8, bytes: configPubkey.toBase58() } },  // config field
    { memcmp: { offset: 40, bytes: bs58.encode(Buffer.from([0])) } }, // role = Minter
  ],
});
```

### Event Monitoring

Monitor transaction logs for program invocations. Each instruction emits Anchor events that can be parsed:

```typescript
const logs = await connection.getConfirmedSignaturesForAddress2(
  SSS_TOKEN_PROGRAM_ID,
  { limit: 100 },
);
```

## Deployment Checklist

### Pre-Launch

- [ ] Master authority transferred to multisig
- [ ] All role keys generated and secured
- [ ] Minter allowances set to planned initial supply
- [ ] Supply cap set (if applicable)
- [ ] KYC process tested end-to-end (create ATA → approve → mint → transfer)
- [ ] Blacklist flow tested (blacklist → hook reject → seize → unblacklist)
- [ ] Pause/unpause tested
- [ ] Transfer hook verified on devnet
- [ ] Metadata URI resolves correctly
- [ ] SDK and CLI tested against deployed programs

### Post-Launch

- [ ] Monitor first minting transactions
- [ ] Verify transfer hook enforcement on real transfers
- [ ] Confirm KYC approval flow works with production identity provider
- [ ] Set up alerting for pause state changes
- [ ] Set up alerting for master authority changes
- [ ] Document role holder contact information for incident response
- [ ] Schedule first role rotation

## Upgrade Path

SSS programs are deployed as standard Solana BPF programs. Upgrades follow the standard Anchor upgrade flow.

### Program Upgrades

```bash
# Build new version
anchor build

# Deploy upgrade (requires upgrade authority)
anchor upgrade --program-id CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3 \
  target/deploy/sss_token.so

anchor upgrade --program-id F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz \
  target/deploy/sss_transfer_hook.so
```

### Upgrade Safety

- **Account layout changes** require migration logic. The StablecoinConfig has a 64-byte reserved block for future fields — use this before changing struct layout.
- **Token-2022 extensions are immutable** after mint creation. PermanentDelegate, TransferHook, and DefaultAccountState cannot be changed by program upgrades.
- **Test upgrades on devnet first.** Deploy the upgraded program, run the full test suite against it, and verify all existing accounts are readable.
- **Consider making programs immutable** after stabilization. Call `solana program set-upgrade-authority --final` to permanently disable upgrades.

### Account Migration

If a program upgrade changes account layout:

1. Add a version field or use the reserved block
2. Deploy the upgrade
3. Run a migration script that reads old accounts and writes new data
4. Verify all accounts are accessible with the new program

The 64-byte reserved block in StablecoinConfig (bytes 118–181) can accommodate several new fields without breaking existing accounts.
