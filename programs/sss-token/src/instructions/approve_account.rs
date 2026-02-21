use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction::thaw_account;

use crate::{
    constants::{ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::AccountApproved,
    state::{Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// Approve (thaw) a frozen token account for a new user.
///
/// In SSS-2, all new token accounts start frozen (DefaultAccountState::Frozen).
/// Before a wallet can receive tokens, a Blacklister must call approve_account
/// to thaw the account — acting as a KYC/compliance gate.
///
/// This is semantically distinct from unblacklist: approve_account only thaws,
/// no BlacklistEntry is involved.
#[derive(Accounts)]
pub struct ApproveAccount<'info> {
    /// Blacklister authority — must hold the Blacklister role.
    pub blacklister: Signer<'info>,

    /// StablecoinConfig — must be SSS-2 preset.
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

    /// The wallet's token account to thaw (approve).
    #[account(
        mut,
        token::mint = mint,
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

pub fn handler(ctx: Context<ApproveAccount>) -> Result<()> {
    let config = &ctx.accounts.config;
    let mint_key = config.mint;
    let wallet = ctx.accounts.wallet_token_account.owner;

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

    // ── Emit event ─────────────────────────────────────────────────────
    emit!(AccountApproved {
        config: config.key(),
        wallet,
        blacklister: ctx.accounts.blacklister.key(),
    });

    msg!("Account approved (thawed) for wallet: {}", wallet);

    Ok(())
}
