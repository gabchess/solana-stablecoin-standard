use anchor_lang::prelude::*;

#[event]
pub struct StablecoinInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub preset: u8,
}

#[event]
pub struct RoleAssigned {
    pub config: Pubkey,
    pub role: u8,
    pub holder: Pubkey,
    pub mint_allowance: Option<u64>,
}

#[event]
pub struct RoleRevoked {
    pub config: Pubkey,
    pub role: u8,
    pub holder: Pubkey,
}

#[event]
pub struct MintAllowanceUpdated {
    pub config: Pubkey,
    pub holder: Pubkey,
    pub old_allowance: Option<u64>,
    pub new_allowance: Option<u64>,
}

#[event]
pub struct TokensMinted {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TokensBurned {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WalletBlacklisted {
    pub config: Pubkey,
    pub wallet: Pubkey,
    pub blacklister: Pubkey,
}

#[event]
pub struct WalletUnblacklisted {
    pub config: Pubkey,
    pub wallet: Pubkey,
    pub blacklister: Pubkey,
}

#[event]
pub struct AccountApproved {
    pub config: Pubkey,
    pub wallet: Pubkey,
    pub blacklister: Pubkey,
}

#[event]
pub struct TokensSeized {
    pub config: Pubkey,
    pub from: Pubkey,
    pub treasury: Pubkey,
    pub amount: u64,
    pub seizer: Pubkey,
}

#[event]
pub struct StablecoinPaused {
    pub config: Pubkey,
}

#[event]
pub struct StablecoinUnpaused {
    pub config: Pubkey,
}

#[event]
pub struct MasterAuthorityTransferred {
    pub config: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct SupplyCapUpdated {
    pub config: Pubkey,
    pub old_cap: Option<u64>,
    pub new_cap: Option<u64>,
}
