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
}
