use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub mod error;
pub mod instructions;

use instructions::*;

declare_id!("F1aUaKxYyCRWJLW7oeAiHNFk2WFJhS2NTm7LdGh8zuSz");

#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Initialize the ExtraAccountMetaList PDA for a given mint.
    /// Must be called once after the SSS-2 mint is created.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Fallback instruction handler — bridges Token-2022's native Execute
    /// discriminator to our Anchor program.
    ///
    /// Without this fallback, the transfer hook silently fails because
    /// Token-2022 sends the spl-transfer-hook-interface discriminator,
    /// which doesn't match any Anchor instruction discriminator.
    ///
    /// CRITICAL: This is the #1 Token-2022 gotcha for Anchor programs.
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        // The Execute instruction data is:
        //   [0..8]  discriminator (spl-transfer-hook-interface hash)
        //   [8..16] amount (u64, little-endian)
        if data.len() < 16 {
            return Err(ProgramError::InvalidInstructionData.into());
        }

        let discriminator = &data[..8];

        if discriminator == ExecuteInstruction::SPL_DISCRIMINATOR_SLICE {
            // Parse amount from bytes 8..16
            let amount_bytes: [u8; 8] = data[8..16]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            let amount = u64::from_le_bytes(amount_bytes);

            instructions::transfer_hook::handler(program_id, accounts, amount)
        } else {
            Err(ProgramError::InvalidInstructionData.into())
        }
    }
}
