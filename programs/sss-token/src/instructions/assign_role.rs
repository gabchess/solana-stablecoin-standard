use anchor_lang::prelude::*;

use crate::{
    constants::{ROLE_SEED, STABLECOIN_SEED},
    error::StablecoinError,
    events::RoleAssigned,
    state::{Role, RoleConfig, StablecoinConfig},
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(role: u8, holder: Pubkey)]
pub struct AssignRole<'info> {
    /// Master authority — only the master can assign roles.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// StablecoinConfig for this stablecoin.
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// RoleConfig PDA — created here.
    /// Seeds: ["role", config, role_u8, holder]
    #[account(
        init,
        payer = authority,
        space = RoleConfig::LEN,
        seeds = [ROLE_SEED, config.key().as_ref(), &[role], holder.as_ref()],
        bump,
    )]
    pub role_config: Account<'info, RoleConfig>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(
    ctx: Context<AssignRole>,
    role: u8,
    holder: Pubkey,
    mint_allowance: Option<u64>,
) -> Result<()> {
    // Validate role enum value
    require!(Role::from_u8(role).is_some(), StablecoinError::WrongRole);

    let config_key = ctx.accounts.config.key();

    // Populate the RoleConfig account
    let role_config = &mut ctx.accounts.role_config;
    role_config.config = config_key;
    role_config.role = role;
    role_config.holder = holder;
    role_config.mint_allowance = mint_allowance;
    role_config.bump = ctx.bumps.role_config;

    emit!(RoleAssigned {
        config: config_key,
        role,
        holder,
        mint_allowance,
    });

    msg!(
        "Role {} assigned to {}",
        role,
        holder
    );

    Ok(())
}
