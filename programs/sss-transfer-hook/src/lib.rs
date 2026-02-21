use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;

use instructions::*;

declare_id!("F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz");

#[program]
pub mod sss_transfer_hook {
    use super::*;
}
