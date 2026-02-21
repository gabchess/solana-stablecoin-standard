use anchor_lang::prelude::*;

use crate::{
    constants::STABLECOIN_SEED,
    error::StablecoinError,
    events::MasterAuthorityTransferred,
    state::StablecoinConfig,
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct TransferMasterAuthority<'info> {
    /// Current master authority — must sign to transfer.
    pub authority: Signer<'info>,

    /// StablecoinConfig — master_authority will be updated.
    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The new master authority.
    /// CHECK: Any valid pubkey can become the new authority. Validated by caller.
    pub new_authority: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<TransferMasterAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_authority = config.master_authority;
    let new_authority = ctx.accounts.new_authority.key();

    config.master_authority = new_authority;

    emit!(MasterAuthorityTransferred {
        config: config.key(),
        old_authority,
        new_authority,
    });

    msg!(
        "Master authority transferred: {} -> {}",
        old_authority,
        new_authority
    );

    Ok(())
}
