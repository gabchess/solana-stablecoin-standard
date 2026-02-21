use anchor_lang::prelude::*;

use crate::{
    constants::{ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::MintAllowanceUpdated,
    state::{Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdateMintAllowance<'info> {
    /// Master authority — only the master can update allowances.
    pub authority: Signer<'info>,

    /// StablecoinConfig for this stablecoin.
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The Minter's RoleConfig PDA — must be a Minter role.
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
    )]
    pub role_config: Account<'info, RoleConfig>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(
    ctx: Context<UpdateMintAllowance>,
    new_allowance: Option<u64>,
) -> Result<()> {
    let role_config = &mut ctx.accounts.role_config;
    let old_allowance = role_config.mint_allowance;

    role_config.mint_allowance = new_allowance;

    emit!(MintAllowanceUpdated {
        config: ctx.accounts.config.key(),
        holder: role_config.holder,
        old_allowance,
        new_allowance,
    });

    msg!(
        "Mint allowance updated for {}: {:?} -> {:?}",
        role_config.holder,
        old_allowance,
        new_allowance
    );

    Ok(())
}
