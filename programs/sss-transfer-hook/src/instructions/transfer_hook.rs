use anchor_lang::prelude::*;

use crate::error::TransferHookError;

// ---------------------------------------------------------------------------
// Execute Handler (raw AccountInfo — called via fallback)
// ---------------------------------------------------------------------------

/// The Execute handler is called by Token-2022 during every `transfer_checked`.
///
/// This is NOT a normal Anchor instruction — it receives raw AccountInfo
/// because Token-2022 uses the spl-transfer-hook-interface discriminator,
/// not Anchor's discriminator. The lib.rs fallback routes here.
///
/// Account layout (set by Token-2022 + ExtraAccountMetaList resolution):
///   [0] source_token          — source token account
///   [1] mint                  — the Token-2022 mint
///   [2] destination_token     — destination token account
///   [3] owner                 — authority who signed the transfer
///   [4] extra_account_meta_list — this program's meta list PDA
///   [5] sss_token_program     — the sss-token program (static)
///   [6] config                — StablecoinConfig PDA (from sss-token)
///   [7] sender_blacklist      — BlacklistEntry PDA for sender (may not exist)
///   [8] receiver_blacklist    — BlacklistEntry PDA for receiver (may not exist)
///
/// Logic:
///   1. Check config.paused → reject if true
///   2. Check sender blacklist → reject if PDA exists (data_len > 0)
///   3. Check receiver blacklist → reject if PDA exists (data_len > 0)
///   4. Return Ok(()) — transfer is approved
///
/// IMPORTANT: Transfer hook accounts are READ-ONLY. The hook cannot modify
/// state — it can only approve or reject the transfer.
pub fn handler<'info>(
    _program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    _amount: u64,
) -> Result<()> {
    // ── Validate minimum account count ──────────────────────────────────
    if accounts.len() < 9 {
        msg!("Transfer hook: insufficient accounts (got {}, need 9)", accounts.len());
        return Err(ProgramError::NotEnoughAccountKeys.into());
    }

    // Account references
    let config_info = &accounts[6];
    let sender_blacklist_info = &accounts[7];
    let receiver_blacklist_info = &accounts[8];

    // ── Step 1: Check paused state ──────────────────────────────────────
    // Raw byte read of StablecoinConfig (Anchor account with 8-byte discriminator).
    //
    // Full byte offset layout of StablecoinConfig:
    //   [0..8]     discriminator (Anchor account discriminator)
    //   [8..40]    master_authority (Pubkey, 32 bytes)
    //   [40..72]   mint (Pubkey, 32 bytes)
    //   [72]       preset (u8, 1 byte)
    //   [73]       paused (bool, 1 byte) ← read below
    //   [74]       supply_cap tag (u8: 0=None, 1=Some)
    //   [75..83]   supply_cap value (u64, 8 bytes, only if tag==1)
    //   [83..115]  transfer_hook_program (Pubkey, 32 bytes)
    //   [115]      decimals (u8, 1 byte)
    //   [116]      bump (u8, 1 byte)
    //   [117]      pending_master_authority tag (u8: 0=None, 1=Some)
    //   [118..150] pending_master_authority value (Pubkey, only if tag==1)
    //   [150..181] _reserved ([u8; 31])
    //
    // We only need byte 73 (paused) for the hook check.
    // If the config account doesn't have enough data, something is very wrong.
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < 74 {
        msg!("Transfer hook: config account data too short");
        return Err(ProgramError::InvalidAccountData.into());
    }

    let paused = config_data[73];
    if paused != 0 {
        msg!("Transfer hook: transfers are paused");
        return Err(TransferHookError::TransfersPaused.into());
    }

    // ── Step 2: Check for privileged transfer (permanent delegate) ──────
    // When the config PDA (permanent delegate) initiates a transfer — e.g.
    // during a seize operation — we skip blacklist checks.  The owner/authority
    // account at index 3 will equal the config PDA at index 6 in that case.
    let owner_info = &accounts[3];
    if owner_info.key == config_info.key {
        msg!("Transfer hook: privileged transfer by permanent delegate — approved");
        return Ok(());
    }

    // ── Step 3: Check sender blacklist ──────────────────────────────────
    // If the BlacklistEntry PDA exists (has data), the sender is blacklisted.
    // Token-2022 resolves the PDA address from ExtraAccountMetaList seeds.
    // If the PDA doesn't exist on-chain, the account will have data_len == 0.
    if sender_blacklist_info.data_len() > 0 {
        msg!("Transfer hook: sender is blacklisted");
        return Err(TransferHookError::SenderBlacklisted.into());
    }

    // ── Step 4: Check receiver blacklist ────────────────────────────────
    if receiver_blacklist_info.data_len() > 0 {
        msg!("Transfer hook: receiver is blacklisted");
        return Err(TransferHookError::ReceiverBlacklisted.into());
    }

    // ── Transfer approved ───────────────────────────────────────────────
    msg!("Transfer hook: approved");
    Ok(())
}
