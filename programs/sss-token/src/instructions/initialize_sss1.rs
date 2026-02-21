use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::{
    spl_token_2022::{
        extension::ExtensionType,
        instruction::{initialize_mint2, initialize_mint_close_authority},
    },
    Token2022,
};
use spl_token_2022::extension::metadata_pointer::instruction::initialize as initialize_metadata_pointer;
use spl_token_metadata_interface::instruction::initialize as initialize_token_metadata;

use crate::{
    constants::{MAX_NAME_LEN, MAX_SYMBOL_LEN, MAX_URI_LEN, STABLECOIN_SEED},
    error::StablecoinError,
    events::StablecoinInitialized,
    state::StablecoinConfig,
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeSss1<'info> {
    /// Master authority — deployer and initial admin of the stablecoin.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The Token-2022 mint account. Caller generates a fresh Keypair and signs
    /// the transaction with it. We create the account via CPI inside the handler.
    /// CHECK: Validated by create_account + Token-2022 init CPIs.
    #[account(mut)]
    pub mint: Signer<'info>,

    /// StablecoinConfig PDA derived from ["stablecoin", mint].
    #[account(
        init,
        payer = authority,
        space = StablecoinConfig::LEN,
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub fn handler(
    ctx: Context<InitializeSss1>,
    name: String,
    symbol: String,
    uri: String,
    decimals: u8,
    supply_cap: Option<u64>,
) -> Result<()> {
    // ── Validate metadata lengths ──────────────────────────────────────
    require!(name.len() <= MAX_NAME_LEN, StablecoinError::NameTooLong);
    require!(
        symbol.len() <= MAX_SYMBOL_LEN,
        StablecoinError::SymbolTooLong
    );
    require!(uri.len() <= MAX_URI_LEN, StablecoinError::UriTooLong);

    let mint_key = ctx.accounts.mint.key();
    let config_key = ctx.accounts.config.key();
    let config_bump = ctx.bumps.config;

    // Config PDA signer seeds — needed for metadata init (mint_authority = config PDA)
    let bump_bytes = [config_bump];
    let config_seeds: &[&[u8]] = &[STABLECOIN_SEED, mint_key.as_ref(), &bump_bytes];

    // ── Step 1: Calculate mint account size ────────────────────────────
    // SSS-1 has 2 extensions: MetadataPointer, MintCloseAuthority
    let extension_types = &[
        ExtensionType::MetadataPointer,
        ExtensionType::MintCloseAuthority,
    ];
    let base_mint_size =
        ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(extension_types)
            .map_err(|_| StablecoinError::MathOverflow)?;

    // Metadata content size (spl-token-metadata-interface borsh format):
    //   update_authority(32) + mint(32) + name(4+len) + symbol(4+len) + uri(4+len) + additional_metadata(4)
    let metadata_content_size: usize = 32
        + 32
        + (4 + name.len())
        + (4 + symbol.len())
        + (4 + uri.len())
        + 4;
    // Variable-length TLV overhead: ArrayDiscriminator([u8;8]) + length(u32) = 12 bytes
    let metadata_tlv_size: usize = 8 + 4 + metadata_content_size;

    let total_mint_size = base_mint_size
        .checked_add(metadata_tlv_size)
        .ok_or(StablecoinError::MathOverflow)?;

    let rent = &ctx.accounts.rent;
    // Fund for the FULL size (including metadata) so realloc has enough lamports.
    let lamports = rent.minimum_balance(total_mint_size);

    // ── Step 2: Create mint account (Keypair signer → invoke) ──────────
    // IMPORTANT: Use base_mint_size (fixed extensions only) as `space`.
    // Token-2022's initialize_mint2 does an exact equality check between the
    // calculated size (from initialized extensions) and the account's data_len().
    // Metadata is not initialized yet, so it must NOT be included in `space`.
    // The metadata `initialize` instruction will realloc the account to fit.
    invoke(
        &anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.authority.key(),
            &mint_key,
            lamports,
            base_mint_size as u64,
            &ctx.accounts.token_program.key(),
        ),
        &[
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // ── Step 3: Initialize MetadataPointer extension (BEFORE mint init) ─
    // Points to self: metadata lives inside the mint account.
    let ix_metadata_ptr = initialize_metadata_pointer(
        &ctx.accounts.token_program.key(),
        &mint_key,
        Some(config_key),  // authority = config PDA
        Some(mint_key),    // metadata_address = mint itself
    )?;

    invoke(
        &ix_metadata_ptr,
        &[ctx.accounts.mint.to_account_info()],
    )?;

    // ── Step 4: Initialize MintCloseAuthority extension (BEFORE mint init) ─
    let ix_close_auth = initialize_mint_close_authority(
        &ctx.accounts.token_program.key(),
        &mint_key,
        Some(&config_key), // close_authority = config PDA
    )?;

    invoke(
        &ix_close_auth,
        &[ctx.accounts.mint.to_account_info()],
    )?;

    // ── Step 5: Initialize Mint2 ──────────────────────────────────────
    // config PDA = mint_authority + freeze_authority
    let ix_init_mint = initialize_mint2(
        &ctx.accounts.token_program.key(),
        &mint_key,
        &config_key,       // mint authority = config PDA
        Some(&config_key), // freeze authority = config PDA
        decimals,
    )?;

    invoke(
        &ix_init_mint,
        &[ctx.accounts.mint.to_account_info()],
    )?;

    // ── Step 6: Initialize Metadata (AFTER mint init) ─────────────────
    // Token-2022 implements the spl-token-metadata-interface natively.
    // mint_authority (config PDA) must sign → invoke_signed.
    let ix_init_metadata = initialize_token_metadata(
        &ctx.accounts.token_program.key(), // Token-2022 is the metadata program
        &mint_key,                          // metadata account = mint (via MetadataPointer)
        &config_key,                        // update authority = config PDA
        &mint_key,                          // mint
        &config_key,                        // mint authority = config PDA (signer)
        name.clone(),
        symbol.clone(),
        uri.clone(),
    );

    invoke_signed(
        &ix_init_metadata,
        &[
            ctx.accounts.mint.to_account_info(),   // metadata
            ctx.accounts.config.to_account_info(),  // update authority
            ctx.accounts.mint.to_account_info(),   // mint
            ctx.accounts.config.to_account_info(),  // mint authority (signer)
        ],
        &[config_seeds],
    )?;

    // ── Step 7: Set StablecoinConfig state ──────────────────────────────
    let config = &mut ctx.accounts.config;
    config.master_authority = ctx.accounts.authority.key();
    config.mint = mint_key;
    config.preset = 1;
    config.paused = false;
    config.supply_cap = supply_cap;
    config.transfer_hook_program = Pubkey::default(); // No hook for SSS-1
    config.decimals = decimals;
    config.bump = config_bump;
    config._reserved = [0u8; 64];

    // ── Step 8: Emit event ─────────────────────────────────────────────
    emit!(StablecoinInitialized {
        config: config.key(),
        authority: config.master_authority,
        mint: config.mint,
        preset: 1,
    });

    msg!("SSS-1 stablecoin initialized: {} ({})", name, symbol);

    Ok(())
}
