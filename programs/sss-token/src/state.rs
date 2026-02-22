use anchor_lang::prelude::*;

use crate::constants::{BLACKLIST_SEED, ROLE_SEED, STABLECOIN_SEED};

// ---------------------------------------------------------------------------
// Role enum
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Role {
    Minter = 0,
    Burner = 1,
    Blacklister = 2,
    Pauser = 3,
    Seizer = 4,
}

impl Role {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Role::Minter),
            1 => Some(Role::Burner),
            2 => Some(Role::Blacklister),
            3 => Some(Role::Pauser),
            4 => Some(Role::Seizer),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// StablecoinConfig — one per stablecoin mint
// ---------------------------------------------------------------------------

#[account]
pub struct StablecoinConfig {
    /// Master authority who can assign/revoke all roles
    pub master_authority: Pubkey,
    /// The Token-2022 stablecoin mint
    pub mint: Pubkey,
    /// Preset level: 1 = SSS-1 (minimal), 2 = SSS-2 (compliant)
    pub preset: u8,
    /// Emergency pause flag — blocks mint/burn/transfer when true
    pub paused: bool,
    /// Optional maximum total supply (None = unlimited)
    pub supply_cap: Option<u64>,
    /// Transfer hook program ID (Pubkey::default() for SSS-1)
    pub transfer_hook_program: Pubkey,
    /// Token decimals
    pub decimals: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Pending master authority for two-step transfer (None = no pending transfer)
    pub pending_master_authority: Option<Pubkey>,
    /// Reserved for future upgrades
    pub _reserved: [u8; 31],
}

impl StablecoinConfig {
    pub const LEN: usize = 8 +  // discriminator
        32 +  // master_authority
        32 +  // mint
        1 +   // preset
        1 +   // paused
        9 +   // supply_cap (Option<u64>: 1 tag + 8 value)
        32 +  // transfer_hook_program
        1 +   // decimals
        1 +   // bump
        33 +  // pending_master_authority (Option<Pubkey>: 1 tag + 32 value)
        31;   // _reserved

    pub const SEED_PREFIX: &'static [u8] = STABLECOIN_SEED;
}

// ---------------------------------------------------------------------------
// RoleConfig — one per role assignment
// ---------------------------------------------------------------------------

#[account]
pub struct RoleConfig {
    /// Parent StablecoinConfig this role belongs to
    pub config: Pubkey,
    /// The role type (Role enum as u8)
    pub role: u8,
    /// Wallet that holds this role
    pub holder: Pubkey,
    /// Minting allowance (only meaningful for Minter role, None = unlimited)
    pub mint_allowance: Option<u64>,
    /// PDA bump seed
    pub bump: u8,
}

impl RoleConfig {
    pub const LEN: usize = 8 +  // discriminator
        32 +  // config
        1 +   // role
        32 +  // holder
        9 +   // mint_allowance (Option<u64>: 1 tag + 8 value)
        1;    // bump

    pub const SEED_PREFIX: &'static [u8] = ROLE_SEED;
}

// ---------------------------------------------------------------------------
// BlacklistEntry — one per blacklisted wallet (SSS-2 only)
// ---------------------------------------------------------------------------

#[account]
pub struct BlacklistEntry {
    /// Parent StablecoinConfig
    pub config: Pubkey,
    /// The blacklisted wallet address
    pub wallet: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

impl BlacklistEntry {
    pub const LEN: usize = 8 +  // discriminator
        32 +  // config
        32 +  // wallet
        1;    // bump

    pub const SEED_PREFIX: &'static [u8] = BLACKLIST_SEED;
}
