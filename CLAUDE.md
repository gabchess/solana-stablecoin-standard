# Solana Stablecoin Standard — Claude Code Instructions

## Project
Building the Solana Stablecoin Standard (SSS) — a modular Token-2022 SDK for Solana.
Competition bounty by Superteam Brazil. Deadline: 21 days. Prize pool: $5,000 USDC.
Reference for quality: ~/solana-vault-standard

## Thinking
**Always think extensively before responding.** This is a complex Solana/Token-2022 project. Never give a shallow answer. Think through edge cases, security implications, and architectural tradeoffs before writing any code or making recommendations.

## Stack
- Anchor (Rust) — two programs: sss-token + sss-transfer-hook
- TypeScript SDK — @stbr/sss-token
- Admin CLI — sss-token commands
- Backend — TypeScript, Docker
- Token-2022 extensions: freeze authority, metadata, permanent delegate (SSS-2), transfer hook (SSS-2)

## Presets
- SSS-1: Minimal stablecoin — mint + freeze authority + metadata
- SSS-2: Compliant stablecoin — SSS-1 + permanent delegate + transfer hook + blacklist enforcement

## Rules
- Mirror the structure and patterns of ~/solana-vault-standard exactly
- Security first — all instructions must validate accounts, signers, and access control
- Every instruction must fail gracefully if a module wasn't enabled at initialization
- No hardcoded keys — role-based access control throughout
- Write tests for everything before marking anything done

## Source of Truth
Always read PLAN.md at session start before doing anything.

## Critical Token-2022 Gotchas (DO NOT ignore)
1. Transfer hook programs in Anchor REQUIRE a fallback instruction to bridge native → Anchor discriminators. Without it, the hook silently fails.
2. All accounts in transfer hook calls become READ-ONLY — including signer. The hook can check but not modify state in the same CPI.
3. Use `transferChecked` NOT `transfer` — `transfer` is deprecated in Token-2022.
4. ALL extensions must be declared at mint CREATION. Cannot add after the fact.
5. Hook's extra accounts (blacklist PDA) must be registered via `extra-account-meta-list` PDA.

## Reference URLs (read these before writing Token-2022 code)
- https://solana.com/developers/guides/token-extensions/transfer-hook
- https://solana.com/developers/guides/token-extensions/permanent-delegate
- https://rareskills.io/post/token-2022
