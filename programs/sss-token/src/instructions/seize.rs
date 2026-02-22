use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction::{freeze_account, thaw_account, transfer_checked};

use crate::{
    constants::{BLACKLIST_SEED, ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::TokensSeized,
    state::{BlacklistEntry, Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// Seize tokens from a blacklisted wallet.
///
/// The seize flow is:
///   1. Thaw the frozen source account (config PDA = freeze authority)
///   2. Transfer tokens via permanent delegate (config PDA = permanent delegate)
///   3. Re-freeze the source account
///
/// Requirements:
///   - SSS-2 preset only (PermanentDelegate extension required)
///   - Seizer role required
///   - Source wallet must be blacklisted (BlacklistEntry must exist)
///   - Treasury account must be thawed (approved) to receive tokens
#[derive(Accounts)]
pub struct Seize<'info> {
    /// Seizer authority — must hold the Seizer role.
    pub seizer: Signer<'info>,

    /// StablecoinConfig — must be SSS-2 preset and not paused.
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.preset == 2 @ StablecoinError::Sss2Required,
        constraint = !config.paused @ StablecoinError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// Seizer's RoleConfig — validates Seizer role and holder.
    #[account(
        seeds = [
            ROLE_SEED,
            config.key().as_ref(),
            &[role_config.role],
            role_config.holder.as_ref(),
        ],
        bump = role_config.bump,
        constraint = role_config.config == config.key() @ StablecoinError::InvalidRoleConfig,
        constraint = role_config.role == Role::Seizer as u8 @ StablecoinError::WrongRole,
        constraint = role_config.holder == seizer.key() @ StablecoinError::Unauthorized,
    )]
    pub role_config: Account<'info, RoleConfig>,

    /// BlacklistEntry — proves the source wallet is blacklisted.
    #[account(
        seeds = [BLACKLIST_SEED, config.key().as_ref(), blacklist_entry.wallet.as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.config == config.key() @ StablecoinError::InvalidRoleConfig,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    /// Source token account (blacklisted wallet's ATA) — tokens are seized from here.
    #[account(
        mut,
        token::mint = mint,
        token::authority = blacklist_entry.wallet,
        token::token_program = token_program,
    )]
    pub from_ata: InterfaceAccount<'info, TokenAccount>,

    /// Treasury token account — seized tokens go here.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,

    /// The stablecoin mint.
    #[account(
        mut,
        constraint = mint.key() == config.mint @ StablecoinError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, Seize<'info>>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let config = &ctx.accounts.config;
    let mint_key = config.mint;
    let decimals = config.decimals;
    let from_wallet = ctx.accounts.blacklist_entry.wallet;

    // Config PDA signer seeds — for freeze authority and permanent delegate CPIs
    let bump_bytes = [config.bump];
    let config_seeds: &[&[u8]] = &[STABLECOIN_SEED, mint_key.as_ref(), &bump_bytes];

    // ── Step 1: Thaw the source (blacklisted) account ──────────────────
    // The account is typically frozen (blacklisted). Skip thaw if already thawed
    // to avoid CPI error on double-thaw.
    // Config PDA = freeze authority.
    if ctx.accounts.from_ata.is_frozen() {
        let ix_thaw = thaw_account(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.from_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(), // freeze authority = config PDA
            &[],
        )?;

        invoke_signed(
            &ix_thaw,
            &[
                ctx.accounts.from_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            &[config_seeds],
        )?;
    }

    // ── Step 2: Transfer via permanent delegate ─────────────────────────
    // Config PDA = permanent delegate (set immutably at mint init).
    // The permanent delegate can transfer tokens from any account without
    // the account owner's signature.
    //
    // CRITICAL: Because the mint has a TransferHook extension, Token-2022
    // will CPI into the hook program during transfer_checked.  The hook
    // needs extra accounts (ExtraAccountMetaList + resolved PDAs).
    // These must be provided as remaining_accounts by the caller and
    // forwarded here.
    let mut ix_transfer = transfer_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.from_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.treasury_ata.key(),
        &ctx.accounts.config.key(), // authority = permanent delegate (config PDA)
        &[],
        amount,
        decimals,
    )?;

    // Add transfer hook extra accounts to the instruction's account_metas.
    // Token-2022 only processes accounts listed in the instruction — passing
    // them only as AccountInfos is not enough.  The extra accounts are:
    // ExtraAccountMetaList, hook program, sss-token program, config, sender BL, receiver BL.
    for remaining in ctx.remaining_accounts.iter() {
        ix_transfer.accounts.push(AccountMeta {
            pubkey: *remaining.key,
            is_signer: remaining.is_signer,
            is_writable: remaining.is_writable,
        });
    }

    // Build account infos: standard transfer accounts + hook extra accounts
    let mut transfer_account_infos = vec![
        ctx.accounts.from_ata.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.treasury_ata.to_account_info(),
        ctx.accounts.config.to_account_info(),
    ];
    for remaining in ctx.remaining_accounts.iter() {
        transfer_account_infos.push(remaining.clone());
    }

    invoke_signed(
        &ix_transfer,
        &transfer_account_infos,
        &[config_seeds],
    )?;

    // ── Step 3: Re-freeze the source account ────────────────────────────
    // The account must remain frozen after seizure — wallet is still blacklisted.
    let ix_freeze = freeze_account(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.from_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(), // freeze authority = config PDA
        &[],
    )?;

    invoke_signed(
        &ix_freeze,
        &[
            ctx.accounts.from_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        &[config_seeds],
    )?;

    // ── Emit event ─────────────────────────────────────────────────────
    emit!(TokensSeized {
        config: config.key(),
        from: from_wallet,
        treasury: ctx.accounts.treasury_ata.key(),
        amount,
        seizer: ctx.accounts.seizer.key(),
    });

    msg!(
        "Seized {} tokens from {} to treasury {}",
        amount,
        from_wallet,
        ctx.accounts.treasury_ata.key()
    );

    Ok(())
}
