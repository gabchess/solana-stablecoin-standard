use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Seed for the ExtraAccountMetaList PDA (standard spl-transfer-hook convention)
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// ExtraAccountMetaList PDA — stores the extra accounts Token-2022 must
    /// resolve and pass to the Execute handler during transfer_checked.
    ///
    /// CHECK: Created manually via system program CPI + ExtraAccountMetaList::init.
    /// Seeds = ["extra-account-metas", mint].
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The Token-2022 mint this hook serves.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The sss-token program whose PDAs we need to resolve.
    /// CHECK: Validated that it matches the transfer hook config.
    pub sss_token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/// Initializes the ExtraAccountMetaList PDA with 4 extra accounts that
/// Token-2022 will resolve and pass to the Execute handler:
///
/// Standard accounts (set by Token-2022 for Execute):
///   [0] source token account
///   [1] mint
///   [2] destination token account
///   [3] owner / authority (transfer signer)
///   [4] extra_account_meta_list PDA
///
/// Extra accounts (registered here, resolved by Token-2022):
///   [5] sss_token_program       — static pubkey
///   [6] StablecoinConfig PDA    — external PDA from sss_token_program
///   [7] Sender BlacklistEntry   — external PDA from sss_token_program
///   [8] Receiver BlacklistEntry — external PDA from sss_token_program
pub fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
    // Prevent re-initialization
    let meta_account = &ctx.accounts.extra_account_meta_list;
    require!(
        meta_account.data_len() == 0,
        anchor_lang::error::ErrorCode::AccountNotInitialized
    );

    let sss_token_program_key = ctx.accounts.sss_token_program.key();

    // ── Build extra account metas ──────────────────────────────────────
    //
    // CRITICAL: The index values here must match the FULL account list
    // that Token-2022 constructs for Execute. Getting these wrong causes
    // silent failures or panics.
    //
    // Index map:
    //   0 = source_token, 1 = mint, 2 = dest_token, 3 = owner, 4 = meta_list
    //   5 = sss_token_program, 6 = config, 7 = sender_blacklist, 8 = receiver_blacklist

    let extra_account_metas = [
        // ── Extra #0 (index 5): sss_token_program ──────────────────────
        // Static pubkey — used as program_id for PDA derivations below.
        ExtraAccountMeta::new_with_pubkey(&sss_token_program_key, false, false)?,

        // ── Extra #1 (index 6): StablecoinConfig PDA ───────────────────
        // Seeds: ["stablecoin", mint.key()]
        // Program: sss_token_program (index 5)
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // program_index → sss_token_program
            &[
                Seed::Literal {
                    bytes: b"stablecoin".to_vec(),
                },
                Seed::AccountKey { index: 1 }, // 1 = mint
            ],
            false, // is_signer
            false, // is_writable
        )?,

        // ── Extra #2 (index 7): Sender BlacklistEntry PDA ──────────────
        // Seeds: ["blacklist", config.key(), source_owner]
        // Program: sss_token_program (index 5)
        //
        // source_owner is read from source_token account data at offset 32
        // (Token account layout: mint[0..32], owner[32..64])
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // program_index → sss_token_program
            &[
                Seed::Literal {
                    bytes: b"blacklist".to_vec(),
                },
                Seed::AccountKey { index: 6 }, // 6 = config PDA
                Seed::AccountData {
                    account_index: 0,  // 0 = source_token
                    data_index: 32,    // owner starts at byte 32
                    length: 32,        // Pubkey is 32 bytes
                },
            ],
            false, // is_signer
            false, // is_writable
        )?,

        // ── Extra #3 (index 8): Receiver BlacklistEntry PDA ────────────
        // Seeds: ["blacklist", config.key(), dest_owner]
        // Program: sss_token_program (index 5)
        //
        // dest_owner is read from destination_token account data at offset 32
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // program_index → sss_token_program
            &[
                Seed::Literal {
                    bytes: b"blacklist".to_vec(),
                },
                Seed::AccountKey { index: 6 }, // 6 = config PDA
                Seed::AccountData {
                    account_index: 2,  // 2 = destination_token
                    data_index: 32,    // owner starts at byte 32
                    length: 32,        // Pubkey is 32 bytes
                },
            ],
            false, // is_signer
            false, // is_writable
        )?,
    ];

    // ── Calculate required account size ─────────────────────────────────
    let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())
        .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotSerialize)?;

    let lamports = Rent::get()?.minimum_balance(account_size);

    // ── Create the ExtraAccountMetaList PDA ─────────────────────────────
    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.bumps.extra_account_meta_list;
    let signer_seeds: &[&[u8]] = &[
        EXTRA_ACCOUNT_METAS_SEED,
        mint_key.as_ref(),
        &[bump],
    ];

    invoke_signed(
        &system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &ctx.accounts.extra_account_meta_list.key(),
            lamports,
            account_size as u64,
            &crate::id(), // owned by this program (transfer hook)
        ),
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.extra_account_meta_list.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    // ── Write the ExtraAccountMetaList data ─────────────────────────────
    let account_info = ctx.accounts.extra_account_meta_list.to_account_info();
    let mut data = account_info.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_account_metas)?;

    msg!(
        "ExtraAccountMetaList initialized for mint {} with {} extra accounts",
        ctx.accounts.mint.key(),
        extra_account_metas.len()
    );

    Ok(())
}
