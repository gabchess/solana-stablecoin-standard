use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

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

    /// The stablecoin mint — used to validate current supply against new cap.
    #[account(
        constraint = mint.key() == config.mint @ StablecoinError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<UpdateSupplyCap>, new_cap: Option<u64>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_cap = config.supply_cap;

    // Validate new cap is not below current supply
    if let Some(cap) = new_cap {
        require!(
            ctx.accounts.mint.supply <= cap,
            StablecoinError::SupplyCapExceeded
        );
    }

    config.supply_cap = new_cap;

    emit!(SupplyCapUpdated {
        config: config.key(),
        old_cap,
        new_cap,
    });

    msg!("Supply cap updated: {:?} -> {:?}", old_cap, new_cap);

    Ok(())
}
