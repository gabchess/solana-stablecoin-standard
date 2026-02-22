# TypeScript SDK Reference

The `@stbr/sss-token` package provides a TypeScript SDK for creating and managing SSS stablecoins. It wraps all on-chain instructions, handles PDA derivation, and manages account resolution for transfer hook operations.

## Installation

```bash
npm install @stbr/sss-token
# or
yarn add @stbr/sss-token
```

Peer dependency: `@coral-xyz/anchor >= 0.31.0`

## Quick Start

```typescript
import { SolanaStablecoin, Role } from "@stbr/sss-token";

// Load existing stablecoin
const stablecoin = await SolanaStablecoin.load(program, mintPubkey);

// Check state
const state = await stablecoin.getState();
console.log(state.preset);         // 1 or 2
console.log(state.paused);         // false
console.log(state.masterAuthority); // PublicKey
```

## SolanaStablecoin Class

### Constructor

Private constructor — use static factory methods instead.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `program` | `Program` | Anchor program instance |
| `provider` | `AnchorProvider` | Anchor provider |
| `mint` | `PublicKey` | Token-2022 mint address |
| `config` | `PublicKey` | StablecoinConfig PDA address |
| `configBump` | `number` | PDA bump seed |

### Static Factory Methods

#### `SolanaStablecoin.load(program, mint)`

Load an existing stablecoin from the chain.

```typescript
static async load(
  program: Program,
  mint: PublicKey,
): Promise<SolanaStablecoin>
```

Derives the config PDA, fetches on-chain state, and returns a fully-initialized instance with cached state.

#### `SolanaStablecoin.createSss1(program, params)`

Create a new SSS-1 stablecoin (minimal preset).

```typescript
static async createSss1(
  program: Program,
  params: CreateSss1Params,
): Promise<SolanaStablecoin>
```

Generates a new mint keypair, initializes the mint with MetadataPointer and MintCloseAuthority extensions, creates the StablecoinConfig PDA, and returns the loaded instance.

#### `SolanaStablecoin.createSss2(program, hookProgram, params)`

Create a new SSS-2 stablecoin (compliant preset).

```typescript
static async createSss2(
  program: Program,
  hookProgram: Program,
  params: CreateSss2Params,
): Promise<SolanaStablecoin>
```

Does everything `createSss1` does, plus initializes PermanentDelegate, TransferHook, and DefaultAccountState(Frozen) extensions. Also initializes the ExtraAccountMetaList PDA on the hook program automatically.

### State Methods

#### `refresh()`

Fetch the latest on-chain state and update the internal cache.

```typescript
async refresh(): Promise<StablecoinConfigState>
```

#### `getState()`

Get the cached on-chain state. Fetches if not yet cached.

```typescript
async getState(): Promise<StablecoinConfigState>
```

#### `isPaused()`

```typescript
async isPaused(): Promise<boolean>
```

#### `isSss2()`

```typescript
async isSss2(): Promise<boolean>
```

#### `getSupplyCap()`

Returns the supply cap as `BN`, or `null` for unlimited.

```typescript
async getSupplyCap(): Promise<BN | null>
```

#### `getMasterAuthority()`

```typescript
async getMasterAuthority(): Promise<PublicKey>
```

### PDA Helpers

These are instance methods that derive PDAs relative to this stablecoin.

#### `getConfigAddress()`

Returns `[PublicKey, number]` — the config PDA and bump.

#### `getRoleAddress(role, holder)`

```typescript
getRoleAddress(role: Role, holder: PublicKey): [PublicKey, number]
```

Derives the RoleConfig PDA for a specific role and wallet. Seeds: `["role", config, role_u8, holder]`.

#### `getBlacklistAddress(wallet)`

```typescript
getBlacklistAddress(wallet: PublicKey): [PublicKey, number]
```

Derives the BlacklistEntry PDA for a wallet. Seeds: `["blacklist", config, wallet]`.

#### `getTokenAccount(owner)`

```typescript
getTokenAccount(owner: PublicKey): PublicKey
```

Returns the Associated Token Account (ATA) address for a wallet. Uses Token-2022 program ID.

### Role Methods

#### `assignRole(authority, params)`

Assign a role to a wallet. Only the master authority can call this.

```typescript
async assignRole(authority: PublicKey, params: AssignRoleParams): Promise<string>
```

#### `revokeRole(authority, role, holder)`

Revoke a role from a wallet. Closes the RoleConfig PDA and returns rent to the authority.

```typescript
async revokeRole(authority: PublicKey, role: Role, holder: PublicKey): Promise<string>
```

#### `updateMintAllowance(authority, holder, newAllowance)`

Update a minter's allowance without revoking the role.

```typescript
async updateMintAllowance(
  authority: PublicKey,
  holder: PublicKey,
  newAllowance: BN | number | null,
): Promise<string>
```

Pass `null` for unlimited allowance.

#### `getRole(role, holder)`

Fetch a role config from the chain. Returns `null` if the role PDA doesn't exist.

```typescript
async getRole(role: Role, holder: PublicKey): Promise<RoleConfigState | null>
```

### Token Methods

#### `mintTokens(minter, params)`

Mint tokens to a destination account. Requires Minter role. Decrements the minter's allowance and checks supply cap.

```typescript
async mintTokens(minter: PublicKey, params: MintParams): Promise<string>
```

#### `burnTokens(authority, params, roleConfig?)`

Burn tokens from a token account. Two modes:
- **Self-burn:** Token owner calls with `roleConfig = null` (no role needed)
- **Forced burn:** Burner role holder calls with their RoleConfig PDA

```typescript
async burnTokens(
  authority: PublicKey,
  params: BurnParams,
  roleConfig?: PublicKey | null,
): Promise<string>
```

### Compliance Methods (SSS-2)

#### `approveAccount(blacklister, walletTokenAccount)`

Thaw a frozen token account (KYC approval). SSS-2 only.

```typescript
async approveAccount(blacklister: PublicKey, walletTokenAccount: PublicKey): Promise<string>
```

#### `blacklist(blacklister, wallet)`

Blacklist a wallet. Creates a BlacklistEntry PDA and freezes the wallet's ATA. SSS-2 only.

```typescript
async blacklist(blacklister: PublicKey, wallet: PublicKey): Promise<string>
```

#### `unblacklist(blacklister, wallet)`

Remove a wallet from the blacklist. Closes the BlacklistEntry PDA and thaws the ATA. SSS-2 only.

```typescript
async unblacklist(blacklister: PublicKey, wallet: PublicKey): Promise<string>
```

#### `seize(seizer, params, hookProgramId?)`

Seize tokens from a blacklisted wallet. Thaws the ATA, transfers via permanent delegate (bypassing the blacklist check in the hook), then re-freezes. SSS-2 only.

```typescript
async seize(
  seizer: PublicKey,
  params: SeizeParams,
  hookProgramId?: PublicKey,
): Promise<string>
```

The SDK automatically resolves the 6 remaining accounts needed for transfer hook resolution:
1. ExtraAccountMetaList PDA
2. Hook program
3. SSS token program
4. StablecoinConfig PDA
5. Sender BlacklistEntry PDA
6. Receiver BlacklistEntry PDA

#### `isBlacklisted(wallet)`

Check if a wallet has a BlacklistEntry PDA.

```typescript
async isBlacklisted(wallet: PublicKey): Promise<boolean>
```

### Admin Methods

#### `pause(authority, roleConfig?)`

Pause the stablecoin. Blocks minting, burning, and all transfers (via hook). Can be called by master authority (`roleConfig = null`) or a Pauser role holder.

```typescript
async pause(authority: PublicKey, roleConfig?: PublicKey | null): Promise<string>
```

#### `unpause(authority, roleConfig?)`

Resume normal operations.

```typescript
async unpause(authority: PublicKey, roleConfig?: PublicKey | null): Promise<string>
```

#### `transferMasterAuthority(authority, newAuthority)`

Transfer the master authority to a new wallet. Irreversible.

```typescript
async transferMasterAuthority(authority: PublicKey, newAuthority: PublicKey): Promise<string>
```

#### `updateSupplyCap(authority, newCap)`

Update or remove the supply cap. Pass `null` for unlimited.

```typescript
async updateSupplyCap(authority: PublicKey, newCap: BN | number | null): Promise<string>
```

## Standalone PDA Functions

These functions are exported from `@stbr/sss-token` and can be used without a `SolanaStablecoin` instance.

```typescript
import {
  getConfigAddress,
  getRoleAddress,
  getBlacklistAddress,
  getExtraAccountMetaListAddress,
  deriveStablecoinAddresses,
} from "@stbr/sss-token";
```

### `getConfigAddress(programId, mint)`

```typescript
function getConfigAddress(programId: PublicKey, mint: PublicKey): [PublicKey, number]
```

Seeds: `["stablecoin", mint]`

### `getRoleAddress(programId, config, role, holder)`

```typescript
function getRoleAddress(
  programId: PublicKey, config: PublicKey, role: number, holder: PublicKey
): [PublicKey, number]
```

Seeds: `["role", config, role_u8, holder]`

### `getBlacklistAddress(programId, config, wallet)`

```typescript
function getBlacklistAddress(
  programId: PublicKey, config: PublicKey, wallet: PublicKey
): [PublicKey, number]
```

Seeds: `["blacklist", config, wallet]`

### `getExtraAccountMetaListAddress(hookProgramId, mint)`

```typescript
function getExtraAccountMetaListAddress(
  hookProgramId: PublicKey, mint: PublicKey
): [PublicKey, number]
```

Seeds: `["extra-account-metas", mint]`

### `deriveStablecoinAddresses(programId, mint, hookProgramId?)`

Batch derivation helper. Returns config PDA (and ExtraAccountMetaList PDA if `hookProgramId` is provided).

```typescript
function deriveStablecoinAddresses(
  programId: PublicKey,
  mint: PublicKey,
  hookProgramId?: PublicKey,
): {
  config: PublicKey;
  configBump: number;
  extraAccountMetaList?: PublicKey;
  extraAccountMetaListBump?: number;
}
```

## Types

### `Role` Enum

```typescript
enum Role {
  Minter = 0,
  Burner = 1,
  Blacklister = 2,
  Pauser = 3,
  Seizer = 4,
}
```

### State Interfaces

#### `StablecoinConfigState`

| Field | Type | Description |
|-------|------|-------------|
| `masterAuthority` | `PublicKey` | Master authority wallet |
| `mint` | `PublicKey` | Token-2022 mint |
| `preset` | `number` | 1 = SSS-1, 2 = SSS-2 |
| `paused` | `boolean` | Emergency pause flag |
| `supplyCap` | `BN \| null` | Max supply (null = unlimited) |
| `transferHookProgram` | `PublicKey` | Hook program ID (PublicKey.default for SSS-1) |
| `decimals` | `number` | Token decimals |
| `bump` | `number` | PDA bump |

#### `RoleConfigState`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `PublicKey` | Parent StablecoinConfig |
| `role` | `number` | Role type (0–4) |
| `holder` | `PublicKey` | Wallet holding the role |
| `mintAllowance` | `BN \| null` | Minter allowance (null = unlimited) |
| `bump` | `number` | PDA bump |

#### `BlacklistEntryState`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `PublicKey` | Parent StablecoinConfig |
| `wallet` | `PublicKey` | Blacklisted wallet |
| `bump` | `number` | PDA bump |

### Parameter Interfaces

| Interface | Fields | Used By |
|-----------|--------|---------|
| `CreateSss1Params` | `name`, `symbol`, `uri`, `decimals?`, `supplyCap?` | `createSss1()` |
| `CreateSss2Params` | extends `CreateSss1Params` + `hookProgramId` | `createSss2()` |
| `AssignRoleParams` | `role`, `holder`, `mintAllowance?` | `assignRole()` |
| `MintParams` | `amount`, `destination` | `mintTokens()` |
| `BurnParams` | `amount`, `fromAta` | `burnTokens()` |
| `SeizeParams` | `amount`, `fromAta`, `treasuryAta`, `wallet`, `treasuryWallet` | `seize()` |

All `amount` fields accept `BN | number`. The SDK coerces `number` to `BN` internally.

## Constants

```typescript
import {
  SSS_TOKEN_PROGRAM_ID,
  SSS_TRANSFER_HOOK_PROGRAM_ID,
  STABLECOIN_SEED,
  ROLE_SEED,
  BLACKLIST_SEED,
  EXTRA_ACCOUNT_METAS_SEED,
} from "@stbr/sss-token";
```

| Constant | Value |
|----------|-------|
| `SSS_TOKEN_PROGRAM_ID` | `CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3` |
| `SSS_TRANSFER_HOOK_PROGRAM_ID` | `F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz` |
| `STABLECOIN_SEED` | `Buffer.from("stablecoin")` |
| `ROLE_SEED` | `Buffer.from("role")` |
| `BLACKLIST_SEED` | `Buffer.from("blacklist")` |
| `EXTRA_ACCOUNT_METAS_SEED` | `Buffer.from("extra-account-metas")` |

## Full SSS-2 Lifecycle Example

```typescript
import { SolanaStablecoin, Role } from "@stbr/sss-token";

// 1. Deploy SSS-2 stablecoin
const stablecoin = await SolanaStablecoin.createSss2(program, hookProgram, {
  name: "Brazilian Real Stablecoin",
  symbol: "BRLUSD",
  uri: "https://example.com/metadata.json",
  decimals: 6,
  supplyCap: 100_000_000_000_000, // 100M tokens (6 decimals)
  hookProgramId: SSS_TRANSFER_HOOK_PROGRAM_ID,
});

// 2. Assign roles
await stablecoin.assignRole(authority, {
  role: Role.Minter,
  holder: minterWallet,
  mintAllowance: 10_000_000_000_000, // 10M
});

await stablecoin.assignRole(authority, {
  role: Role.Blacklister,
  holder: complianceWallet,
});

await stablecoin.assignRole(authority, {
  role: Role.Seizer,
  holder: complianceWallet,
});

// 3. Approve user's token account (KYC gate)
const userAta = stablecoin.getTokenAccount(userWallet);
await stablecoin.approveAccount(complianceWallet, userAta);

// 4. Mint tokens to approved user
await stablecoin.mintTokens(minterWallet, {
  amount: 1_000_000_000_000, // 1M
  destination: userAta,
});

// 5. Check minter allowance after mint
const minterRole = await stablecoin.getRole(Role.Minter, minterWallet);
console.log(minterRole?.mintAllowance?.toString()); // 9_000_000_000_000

// 6. Blacklist a suspicious wallet
await stablecoin.blacklist(complianceWallet, suspiciousWallet);
console.log(await stablecoin.isBlacklisted(suspiciousWallet)); // true

// 7. Seize blacklisted funds to treasury
const suspiciousAta = stablecoin.getTokenAccount(suspiciousWallet);
const treasuryAta = stablecoin.getTokenAccount(treasuryWallet);

await stablecoin.seize(complianceWallet, {
  amount: 500_000_000_000, // 500K
  fromAta: suspiciousAta,
  treasuryAta,
  wallet: suspiciousWallet,
  treasuryWallet,
});

// 8. Unblacklist after resolution
await stablecoin.unblacklist(complianceWallet, suspiciousWallet);
console.log(await stablecoin.isBlacklisted(suspiciousWallet)); // false

// 9. Emergency pause
await stablecoin.pause(authority);
console.log(await stablecoin.isPaused()); // true

// 10. Resume operations
await stablecoin.unpause(authority);
```
