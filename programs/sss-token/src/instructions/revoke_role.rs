use anchor_lang::prelude::*;

use crate::{
    constants::{ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::RoleRevoked,
    state::{RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RevokeRole<'info> {
    /// Master authority — only the master can revoke roles.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// StablecoinConfig for this stablecoin.
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// RoleConfig PDA — closed here, lamports returned to authority.
    #[account(
        mut,
        close = authority,
        seeds = [
            ROLE_SEED,
            config.key().as_ref(),
            &[role_config.role],
            role_config.holder.as_ref(),
        ],
        bump = role_config.bump,
        constraint = role_config.config == config.key() @ StablecoinError::InvalidRoleConfig,
    )]
    pub role_config: Account<'info, RoleConfig>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<RevokeRole>) -> Result<()> {
    let role = ctx.accounts.role_config.role;
    let holder = ctx.accounts.role_config.holder;
    let config_key = ctx.accounts.config.key();

    // Anchor `close = authority` handles account closure + lamport return.

    emit!(RoleRevoked {
        config: config_key,
        role,
        holder,
    });

    msg!("Role {} revoked from {}", role, holder);

    Ok(())
}
