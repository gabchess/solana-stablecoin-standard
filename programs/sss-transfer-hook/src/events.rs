use anchor_lang::prelude::*;

#[event]
pub struct ExtraAccountMetaListInitialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub extra_account_count: u8,
}
