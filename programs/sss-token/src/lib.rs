use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("CgvFp3RNTC9SCpbHqP3KjzRLMd1SckdoWDynqfcQDvA3");

#[program]
pub mod sss_token {
    use super::*;

    pub fn initialize_sss1(
        ctx: Context<InitializeSss1>,
        name: String,
        symbol: String,
        uri: String,
        decimals: u8,
        supply_cap: Option<u64>,
    ) -> Result<()> {
        instructions::initialize_sss1::handler(ctx, name, symbol, uri, decimals, supply_cap)
    }

    pub fn assign_role(
        ctx: Context<AssignRole>,
        role: u8,
        holder: Pubkey,
        mint_allowance: Option<u64>,
    ) -> Result<()> {
        instructions::assign_role::handler(ctx, role, holder, mint_allowance)
    }

    pub fn revoke_role(ctx: Context<RevokeRole>) -> Result<()> {
        instructions::revoke_role::handler(ctx)
    }

    pub fn update_mint_allowance(
        ctx: Context<UpdateMintAllowance>,
        new_allowance: Option<u64>,
    ) -> Result<()> {
        instructions::update_mint_allowance::handler(ctx, new_allowance)
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint_tokens::handler(ctx, amount)
    }

    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn_tokens::handler(ctx, amount)
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx)
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::unpause::handler(ctx)
    }

    pub fn transfer_master_authority(ctx: Context<TransferMasterAuthority>) -> Result<()> {
        instructions::transfer_master_authority::handler(ctx)
    }

    pub fn update_supply_cap(
        ctx: Context<UpdateSupplyCap>,
        new_cap: Option<u64>,
    ) -> Result<()> {
        instructions::update_supply_cap::handler(ctx, new_cap)
    }

    // ── SSS-2 instructions ──────────────────────────────────────────────

    pub fn initialize_sss2(
        ctx: Context<InitializeSss2>,
        name: String,
        symbol: String,
        uri: String,
        decimals: u8,
        supply_cap: Option<u64>,
        hook_program_id: Pubkey,
    ) -> Result<()> {
        instructions::initialize_sss2::handler(
            ctx,
            name,
            symbol,
            uri,
            decimals,
            supply_cap,
            hook_program_id,
        )
    }

    pub fn blacklist(ctx: Context<Blacklist>, wallet: Pubkey) -> Result<()> {
        instructions::blacklist::handler(ctx, wallet)
    }

    pub fn unblacklist(ctx: Context<Unblacklist>) -> Result<()> {
        instructions::unblacklist::handler(ctx)
    }

    pub fn approve_account(ctx: Context<ApproveAccount>) -> Result<()> {
        instructions::approve_account::handler(ctx)
    }

    pub fn seize<'info>(ctx: Context<'_, '_, 'info, 'info, Seize<'info>>, amount: u64) -> Result<()> {
        instructions::seize::handler(ctx, amount)
    }
}
