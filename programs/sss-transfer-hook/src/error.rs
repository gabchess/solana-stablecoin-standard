use anchor_lang::prelude::*;

#[error_code]
pub enum TransferHookError {
    #[msg("Transfers are paused")]
    TransfersPaused,

    #[msg("Sender is blacklisted")]
    SenderBlacklisted,

    #[msg("Receiver is blacklisted")]
    ReceiverBlacklisted,

    #[msg("Unauthorized — caller is not the master authority")]
    Unauthorized,
}
