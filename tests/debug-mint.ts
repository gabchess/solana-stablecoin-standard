import * as anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMetadataPointerInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeMintInstruction,
  ExtensionType,
  getMintLen,
  getTokenMetadata,
} from "@solana/spl-token";
import { createInitializeInstruction, pack } from "@solana/spl-token-metadata";

describe("Debug: Token-2022 Mint with Extensions", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("Test G: Two transactions — init mint, then init metadata separately", async () => {
    const payer = (provider.wallet as anchor.Wallet).payer;
    const mintKeypair = Keypair.generate();
    const name = "Test Stablecoin";
    const symbol = "TSTB";
    const uri = "https://test.com/metadata.json";

    const mintLen = getMintLen([ExtensionType.MetadataPointer, ExtensionType.MintCloseAuthority]);
    console.log(`  mintLen: ${mintLen}`);

    // Fund for a larger account (so realloc has enough lamports)
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen + 500);

    // TX 1: Create account + init extensions + init mint
    const tx1 = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(
        mintKeypair.publicKey, payer.publicKey, mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintCloseAuthorityInstruction(
        mintKeypair.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintKeypair.publicKey, 6, payer.publicKey, payer.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(tx1, [payer, mintKeypair]);
    console.log("  TX1 (create+extensions+mint): PASSED!");

    // TX 2: Init metadata (Token-2022 will realloc)
    const tx2 = new anchor.web3.Transaction().add(
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint: mintKeypair.publicKey,
        metadata: mintKeypair.publicKey,
        name, symbol, uri,
        mintAuthority: payer.publicKey,
        updateAuthority: payer.publicKey,
      })
    );
    await provider.sendAndConfirm(tx2, [payer]);
    console.log("  TX2 (metadata): PASSED!");

    const metadata = await getTokenMetadata(
      provider.connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID
    );
    console.log(`  Verified: name=${metadata?.name}, symbol=${metadata?.symbol}`);
  });

  it("Test H: Use getMintLen with TokenMetadata extension type", async () => {
    const payer = (provider.wallet as anchor.Wallet).payer;
    const mintKeypair = Keypair.generate();

    // Try including TokenMetadata in the extension list
    const allExtensions = [
      ExtensionType.MetadataPointer,
      ExtensionType.MintCloseAuthority,
      ExtensionType.TokenMetadata,
    ];

    try {
      const mintLen = getMintLen(allExtensions);
      console.log(`  getMintLen with TokenMetadata: ${mintLen}`);
    } catch (e: any) {
      console.log(`  getMintLen with TokenMetadata failed: ${e.message}`);
    }

    // Without TokenMetadata
    const baseLen = getMintLen([ExtensionType.MetadataPointer, ExtensionType.MintCloseAuthority]);
    console.log(`  getMintLen without TokenMetadata: ${baseLen}`);

    // Try different extension type numbers
    console.log(`  ExtensionType.MetadataPointer = ${ExtensionType.MetadataPointer}`);
    console.log(`  ExtensionType.MintCloseAuthority = ${ExtensionType.MintCloseAuthority}`);
    console.log(`  ExtensionType.TokenMetadata = ${ExtensionType.TokenMetadata}`);
  });
});
