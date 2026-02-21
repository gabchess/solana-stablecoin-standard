use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("SSSToken11111111111111111111111111111111111");

#[program]
pub mod sss_token {
    use super::*;
}
