use anchor_lang::prelude::*;

use crate::{
    constants::STABLECOIN_SEED,
    error::StablecoinError,
    events::StablecoinUnpaused,
    state::{Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Unpause<'info> {
    /// Authority — must be master_authority OR have Pauser role.
    pub authority: Signer<'info>,

    /// StablecoinConfig — will be set to unpaused.
    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// Optional Pauser RoleConfig — required if authority is not master.
    pub role_config: Option<Account<'info, RoleConfig>>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<Unpause>) -> Result<()> {
    let authority_key = ctx.accounts.authority.key();
    let config = &mut ctx.accounts.config;
    let config_key = config.key();
    let is_master = authority_key == config.master_authority;

    // ── Authorization: master_authority OR Pauser role ──────────────────
    if !is_master {
        let role_config = ctx
            .accounts
            .role_config
            .as_ref()
            .ok_or(StablecoinError::Unauthorized)?;

        require!(
            role_config.config == config_key,
            StablecoinError::InvalidRoleConfig
        );
        require!(
            role_config.role == Role::Pauser as u8,
            StablecoinError::WrongRole
        );
        require!(
            role_config.holder == authority_key,
            StablecoinError::Unauthorized
        );
    }

    config.paused = false;

    emit!(StablecoinUnpaused {
        config: config_key,
    });

    msg!("Stablecoin unpaused");

    Ok(())
}
