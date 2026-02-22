# SSS-1: Minimal Stablecoin Preset

SSS-1 creates a Token-2022 mint with role-based minting, optional supply caps, and emergency pause. No transfer restrictions.

## Token-2022 Extensions

| Extension | Config Authority | Purpose |
|-----------|-----------------|---------|
| MetadataPointer | config PDA | Points to on-chain metadata stored on the mint account itself |
| MintCloseAuthority | config PDA | Allows closing the mint when supply reaches zero |

Mint authority and freeze authority are both set to the StablecoinConfig PDA.

## Initialization

```bash
sss-token init sss1 --name "Test USD" --symbol "TUSD" --uri "https://..." --decimals 6
```

Parameters:
- `name` (string, max 32 chars) — token name stored in on-chain metadata
- `symbol` (string, max 10 chars) — token symbol
- `uri` (string, max 200 chars) — metadata URI (typically points to a JSON file)
- `decimals` (u8, default 6) — token decimal places
- `supply_cap` (Option<u64>) — maximum total supply, omit for unlimited

The initialization creates the mint keypair, derives the StablecoinConfig PDA from `["stablecoin", mint]`, sets up extensions in the required order (MetadataPointer and MintCloseAuthority before `initialize_mint2`, metadata content after), and stores configuration.

## Available Instructions

| Instruction | Required Role | Description |
|-------------|---------------|-------------|
| `initialize_sss1` | deployer (becomes master authority) | Create mint + config |
| `assign_role` | master authority | Create a RoleConfig PDA |
| `revoke_role` | master authority | Close a RoleConfig PDA |
| `update_mint_allowance` | master authority | Change a minter's allowance |
| `mint_tokens` | Minter | CPI mint_to via config PDA, decrements allowance |
| `burn_tokens` | Burner or token owner | CPI burn; self-burn requires no role |
| `pause` | Pauser or master authority | Set config.paused = true |
| `unpause` | Pauser or master authority | Set config.paused = false |
| `transfer_master_authority` | master authority | Hand off to a new authority |
| `update_supply_cap` | master authority | Change or remove supply cap |

SSS-2-only instructions (`blacklist`, `unblacklist`, `approve_account`, `seize`) reject with `Sss2Required` if called on an SSS-1 config.

## Role System

The master authority is set at initialization and can assign any of five roles:

| Role | ID | Minting Allowance | Notes |
|------|----|-------------------|-------|
| Minter | 0 | Per-minter cap or unlimited (null) | Allowance decrements on each mint |
| Burner | 1 | N/A | Can burn from any ATA (not just own) |
| Blacklister | 2 | N/A | SSS-2 only — no-op on SSS-1 |
| Pauser | 3 | N/A | Master authority can also pause directly |
| Seizer | 4 | N/A | SSS-2 only — no-op on SSS-1 |

Multiple wallets can hold the same role. One wallet can hold multiple roles (separate RoleConfig PDAs).

## PDA Layout

**StablecoinConfig** — seeds: `["stablecoin", mint.key()]`, 182 bytes
- Stores master_authority, mint, preset (1), paused, supply_cap, decimals, bump
- 64-byte reserved block for future upgrades

**RoleConfig** — seeds: `["role", config.key(), &[role_u8], holder.key()]`, 83 bytes
- One PDA per (stablecoin, role type, wallet) combination
- `init` constraint on `assign_role` means duplicate assignment fails (account already exists)
- `close` on `revoke_role` returns rent to the authority

## When to Use SSS-1 vs SSS-2

Use SSS-1 when:
- You need basic minting with role separation but no transfer restrictions
- Your compliance model is off-chain (separate KYC service, no on-chain enforcement)
- You want the simplest deployment with fewest extensions
- You're running on testnet or internal environments

Use SSS-2 when:
- You need on-chain blacklist enforcement that cannot be bypassed
- Regulatory requirements demand KYC gating (frozen-by-default accounts)
- You need seizure capability for sanctioned wallets
- You're building a production stablecoin with compliance obligations
