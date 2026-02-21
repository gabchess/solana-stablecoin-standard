use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction::burn_checked;

use crate::{
    constants::STABLECOIN_SEED,
    error::StablecoinError,
    events::TokensBurned,
    state::{Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    /// Authority — must be Burner role OR the from_ata owner (self-burn).
    pub authority: Signer<'info>,

    /// StablecoinConfig — checked not paused.
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = !config.paused @ StablecoinError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// Optional Burner RoleConfig — if authority is not the token owner,
    /// they must present a valid Burner role to authorize the burn.
    pub role_config: Option<Account<'info, RoleConfig>>,

    /// Token account to burn from.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub from_ata: InterfaceAccount<'info, TokenAccount>,

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

pub fn handler(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let authority_key = ctx.accounts.authority.key();
    let is_owner = authority_key == ctx.accounts.from_ata.owner;

    // ── Authorization: Burner role OR token account owner ──────────────
    if !is_owner {
        let role_config = ctx
            .accounts
            .role_config
            .as_ref()
            .ok_or(StablecoinError::Unauthorized)?;

        require!(
            role_config.config == ctx.accounts.config.key(),
            StablecoinError::InvalidRoleConfig
        );
        require!(
            role_config.role == Role::Burner as u8,
            StablecoinError::WrongRole
        );
        require!(
            role_config.holder == authority_key,
            StablecoinError::Unauthorized
        );
    }

    let decimals = ctx.accounts.config.decimals;

    // ── CPI: burn_checked ──────────────────────────────────────────────
    // Authority is the signer — they must own the token account
    // (or be a delegate / permanent delegate for SSS-2).
    let ix = burn_checked(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.from_ata.key(),
        &ctx.accounts.mint.key(),
        &authority_key, // token account authority
        &[],            // no multisig signers
        amount,
        decimals,
    )?;

    invoke(
        &ix,
        &[
            ctx.accounts.from_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.authority.to_account_info(),
        ],
    )?;

    // ── Emit event ─────────────────────────────────────────────────────
    emit!(TokensBurned {
        config: ctx.accounts.config.key(),
        authority: authority_key,
        from: ctx.accounts.from_ata.key(),
        amount,
    });

    msg!("Burned {} tokens from {}", amount, ctx.accounts.from_ata.key());

    Ok(())
}
