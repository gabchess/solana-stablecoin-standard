use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction::mint_to_checked;

use crate::{
    constants::{ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::TokensMinted,
    state::{Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MintTokens<'info> {
    /// The minter — must hold the Minter role.
    pub minter: Signer<'info>,

    /// StablecoinConfig — checked not paused, supply cap enforced.
    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = !config.paused @ StablecoinError::Paused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// Minter's RoleConfig — validates Minter role and holder.
    #[account(
        mut,
        seeds = [
            ROLE_SEED,
            config.key().as_ref(),
            &[role_config.role],
            role_config.holder.as_ref(),
        ],
        bump = role_config.bump,
        constraint = role_config.config == config.key() @ StablecoinError::InvalidRoleConfig,
        constraint = role_config.role == Role::Minter as u8 @ StablecoinError::WrongRole,
        constraint = role_config.holder == minter.key() @ StablecoinError::Unauthorized,
    )]
    pub role_config: Account<'info, RoleConfig>,

    /// Destination token account — must already exist.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    /// The stablecoin mint.
    #[account(
        mut,
        constraint = mint.key() == config.mint @ StablecoinError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let config = &ctx.accounts.config;
    let mint_key = config.mint;
    let decimals = config.decimals;

    // ── Check mint allowance ───────────────────────────────────────────
    let role_config = &mut ctx.accounts.role_config;
    if let Some(allowance) = role_config.mint_allowance {
        require!(amount <= allowance, StablecoinError::AllowanceExceeded);
        role_config.mint_allowance = Some(
            allowance
                .checked_sub(amount)
                .ok_or(StablecoinError::MathOverflow)?,
        );
    }
    // None = unlimited allowance — no check needed

    // ── Check supply cap ───────────────────────────────────────────────
    if let Some(cap) = config.supply_cap {
        let current_supply = ctx.accounts.mint.supply;
        let new_supply = current_supply
            .checked_add(amount)
            .ok_or(StablecoinError::MathOverflow)?;
        require!(new_supply <= cap, StablecoinError::SupplyCapExceeded);
    }

    // ── CPI: mint_to_checked ───────────────────────────────────────────
    // Config PDA is the mint authority → invoke_signed
    let bump_bytes = [config.bump];
    let config_seeds: &[&[u8]] = &[STABLECOIN_SEED, mint_key.as_ref(), &bump_bytes];

    let ix = mint_to_checked(
        &ctx.accounts.token_program.key(),
        &mint_key,
        &ctx.accounts.destination.key(),
        &ctx.accounts.config.key(), // mint authority = config PDA
        &[],                        // no multisig signers
        amount,
        decimals,
    )?;

    invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        &[config_seeds],
    )?;

    // ── Emit event ─────────────────────────────────────────────────────
    emit!(TokensMinted {
        config: ctx.accounts.config.key(),
        minter: ctx.accounts.minter.key(),
        destination: ctx.accounts.destination.key(),
        amount,
    });

    msg!("Minted {} tokens to {}", amount, ctx.accounts.destination.key());

    Ok(())
}
