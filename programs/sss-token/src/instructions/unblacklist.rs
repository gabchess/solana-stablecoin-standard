use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction::thaw_account;

use crate::{
    constants::{BLACKLIST_SEED, ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::WalletUnblacklisted,
    state::{BlacklistEntry, Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Unblacklist<'info> {
    /// Blacklister authority — must hold the Blacklister role.
    #[account(mut)]
    pub blacklister: Signer<'info>,

    /// StablecoinConfig — must be SSS-2 preset and not paused.
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.preset == 2 @ StablecoinError::Sss2Required,
        constraint = !config.paused @ StablecoinError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// Blacklister's RoleConfig — validates Blacklister role and holder.
    #[account(
        seeds = [
            ROLE_SEED,
            config.key().as_ref(),
            &[role_config.role],
            role_config.holder.as_ref(),
        ],
        bump = role_config.bump,
        constraint = role_config.config == config.key() @ StablecoinError::InvalidRoleConfig,
        constraint = role_config.role == Role::Blacklister as u8 @ StablecoinError::WrongRole,
        constraint = role_config.holder == blacklister.key() @ StablecoinError::Unauthorized,
    )]
    pub role_config: Account<'info, RoleConfig>,

    /// BlacklistEntry PDA — will be closed (rent returned to blacklister).
    #[account(
        mut,
        seeds = [BLACKLIST_SEED, config.key().as_ref(), blacklist_entry.wallet.as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.config == config.key() @ StablecoinError::InvalidRoleConfig,
        close = blacklister,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    /// The wallet's token account to thaw.
    #[account(
        mut,
        token::mint = mint,
        token::authority = blacklist_entry.wallet,
        token::token_program = token_program,
    )]
    pub wallet_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The stablecoin mint.
    #[account(
        constraint = mint.key() == config.mint @ StablecoinError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<Unblacklist>) -> Result<()> {
    let config = &ctx.accounts.config;
    let mint_key = config.mint;
    let wallet = ctx.accounts.blacklist_entry.wallet;

    // ── CPI: thaw the wallet's token account ───────────────────────────
    // Config PDA is the freeze authority → invoke_signed
    let bump_bytes = [config.bump];
    let config_seeds: &[&[u8]] = &[STABLECOIN_SEED, mint_key.as_ref(), &bump_bytes];

    let ix = thaw_account(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.wallet_token_account.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(), // freeze authority = config PDA
        &[],                        // no multisig signers
    )?;

    invoke_signed(
        &ix,
        &[
            ctx.accounts.wallet_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        &[config_seeds],
    )?;

    // BlacklistEntry is automatically closed by Anchor's `close = blacklister`

    // ── Emit event ─────────────────────────────────────────────────────
    emit!(WalletUnblacklisted {
        config: config.key(),
        wallet,
        blacklister: ctx.accounts.blacklister.key(),
    });

    msg!("Wallet unblacklisted and thawed: {}", wallet);

    Ok(())
}
