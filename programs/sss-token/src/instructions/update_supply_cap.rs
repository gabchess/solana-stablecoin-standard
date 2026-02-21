use anchor_lang::prelude::*;

use crate::{
    constants::STABLECOIN_SEED,
    error::StablecoinError,
    events::SupplyCapUpdated,
    state::StablecoinConfig,
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdateSupplyCap<'info> {
    /// Master authority — only the master can update supply cap.
    pub authority: Signer<'info>,

    /// StablecoinConfig — supply_cap will be updated.
    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<UpdateSupplyCap>, new_cap: Option<u64>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_cap = config.supply_cap;

    config.supply_cap = new_cap;

    emit!(SupplyCapUpdated {
        config: config.key(),
        old_cap,
        new_cap,
    });

    msg!("Supply cap updated: {:?} -> {:?}", old_cap, new_cap);

    Ok(())
}
