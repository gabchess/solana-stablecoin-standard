use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction::freeze_account;

use crate::{
    constants::{BLACKLIST_SEED, ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::WalletBlacklisted,
    state::{BlacklistEntry, Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct Blacklist<'info> {
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

    /// BlacklistEntry PDA — created to mark the wallet as blacklisted.
    #[account(
        init,
        payer = blacklister,
        space = BlacklistEntry::LEN,
        seeds = [BLACKLIST_SEED, config.key().as_ref(), wallet.as_ref()],
        bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    /// The wallet's token account to freeze.
    #[account(
        mut,
        token::mint = mint,
        token::authority = wallet,
        token::token_program = token_program,
    )]
    pub wallet_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The stablecoin mint.
    #[account(
        constraint = mint.key() == config.mint @ StablecoinError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<Blacklist>, wallet: Pubkey) -> Result<()> {
    let config = &ctx.accounts.config;
    let mint_key = config.mint;

    // ── Set BlacklistEntry state ────────────────────────────────────────
    let entry = &mut ctx.accounts.blacklist_entry;
    entry.config = config.key();
    entry.wallet = wallet;
    entry.bump = ctx.bumps.blacklist_entry;

    // ── CPI: freeze the wallet's token account ─────────────────────────
    // Config PDA is the freeze authority → invoke_signed
    let bump_bytes = [config.bump];
    let config_seeds: &[&[u8]] = &[STABLECOIN_SEED, mint_key.as_ref(), &bump_bytes];

    let ix = freeze_account(
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

    // ── Emit event ─────────────────────────────────────────────────────
    emit!(WalletBlacklisted {
        config: config.key(),
        wallet,
        blacklister: ctx.accounts.blacklister.key(),
    });

    msg!("Wallet blacklisted and frozen: {}", wallet);

    Ok(())
}
