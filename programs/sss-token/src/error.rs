use anchor_lang::prelude::*;

#[error_code]
pub enum StablecoinError {
    #[msg("Unauthorized - caller lacks required authority or role")]
    Unauthorized,

    #[msg("Stablecoin is paused")]
    Paused,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Mint allowance exceeded")]
    AllowanceExceeded,

    #[msg("Supply cap would be exceeded")]
    SupplyCapExceeded,

    #[msg("This operation requires SSS-2 preset")]
    Sss2Required,

    #[msg("Invalid role for this operation")]
    WrongRole,

    #[msg("Role config does not belong to this stablecoin")]
    InvalidRoleConfig,

    #[msg("Wallet is not blacklisted")]
    NotBlacklisted,

    #[msg("Invalid mint for this stablecoin config")]
    InvalidMint,

    #[msg("Name too long (max 32 characters)")]
    NameTooLong,

    #[msg("Symbol too long (max 10 characters)")]
    SymbolTooLong,

    #[msg("URI too long (max 200 characters)")]
    UriTooLong,

    #[msg("Arithmetic overflow")]
    MathOverflow,
}
