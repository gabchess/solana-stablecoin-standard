use anchor_lang::prelude::*;

use crate::{
    constants::STABLECOIN_SEED,
    error::StablecoinError,
    events::MasterAuthorityTransferred,
    state::StablecoinConfig,
};

// ---------------------------------------------------------------------------
// Accounts — Step 1: Initiate transfer (set pending)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct TransferMasterAuthority<'info> {
    /// Current master authority — must sign to initiate transfer.
    pub authority: Signer<'info>,

    /// StablecoinConfig — pending_master_authority will be set.
    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The proposed new master authority.
    /// CHECK: Any valid pubkey can be proposed. Must accept via accept_master_authority.
    pub new_authority: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------------------
// Handler — Step 1: Store pending authority
// ---------------------------------------------------------------------------

pub fn handler(ctx: Context<TransferMasterAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let new_authority = ctx.accounts.new_authority.key();

    config.pending_master_authority = Some(new_authority);

    msg!(
        "Master authority transfer initiated: {} -> {} (pending acceptance)",
        config.master_authority,
        new_authority
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts — Step 2: Accept transfer (new authority confirms)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AcceptMasterAuthority<'info> {
    /// The pending new authority — must sign to accept.
    pub new_authority: Signer<'info>,

    /// StablecoinConfig — master_authority will be updated.
    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.pending_master_authority == Some(new_authority.key()) @ StablecoinError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

// ---------------------------------------------------------------------------
// Handler — Step 2: Finalize authority transfer
// ---------------------------------------------------------------------------

pub fn accept_handler(ctx: Context<AcceptMasterAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_authority = config.master_authority;
    let new_authority = ctx.accounts.new_authority.key();

    config.master_authority = new_authority;
    config.pending_master_authority = None;

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
