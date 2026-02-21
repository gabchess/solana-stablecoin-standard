import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
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

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  // Fund payer
  const payer = Keypair.generate();
  const sig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");

  const mintKeypair = Keypair.generate();
  const name = "Test Stablecoin";
  const symbol = "TSTB";
  const uri = "https://test.com/metadata.json";

  // Base mint size (just fixed extensions, NO metadata)
  const mintLen = getMintLen([ExtensionType.MetadataPointer, ExtensionType.MintCloseAuthority]);
  console.log(`mintLen (base, no metadata): ${mintLen}`);

  // Calculate metadata size manually
  // pack() returns just the content bytes, but Token-2022 adds TLV overhead:
  //   ArrayDiscriminator([u8;8]) + length(u32) = 12 bytes overhead
  const metadataContent = pack({
    name, symbol, uri,
    mint: mintKeypair.publicKey,
    updateAuthority: payer.publicKey,
    additionalMetadata: [],
  });
  const TLV_OVERHEAD = 12; // 8 bytes discriminator + 4 bytes length
  const metadataTlvSize = metadataContent.length + TLV_OVERHEAD;
  console.log(`metadata packed size: ${metadataContent.length}, with TLV overhead: ${metadataTlvSize}`);

  // Total size for lamports calculation — add generous buffer for any alignment
  const totalSize = mintLen + metadataTlvSize + 64;
  console.log(`total size for lamports: ${totalSize}`);

  // Fund for the FULL size
  const lamports = await connection.getMinimumBalanceForRentExemption(totalSize);
  console.log(`lamports: ${lamports}`);

  // Approach A: base_mint_size for space, total for lamports (should work)
  console.log("\n=== Approach A: base_mint_size for space, full lamports ===");
  try {
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,  // ONLY base mint size
        lamports,        // funded for full size including metadata
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
      ),
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint: mintKeypair.publicKey,
        metadata: mintKeypair.publicKey,
        name, symbol, uri,
        mintAuthority: payer.publicKey,
        updateAuthority: payer.publicKey,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
    console.log("SUCCESS! Mint + metadata created in single tx");

    const metadata = await getTokenMetadata(
      connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID
    );
    console.log(`Metadata: name=${metadata?.name}, symbol=${metadata?.symbol}, uri=${metadata?.uri}`);
  } catch (e: any) {
    console.log(`FAILED: ${e.message}`);
    if (e.logs) {
      console.log("Logs:", e.logs.join("\n"));
    }
  }

  // Approach B: Two separate transactions
  console.log("\n=== Approach B: Split into 2 transactions ===");
  const mintKeypair2 = Keypair.generate();
  const lamports2 = await connection.getMinimumBalanceForRentExemption(totalSize);
  try {
    const tx1 = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair2.publicKey,
        space: mintLen,
        lamports: lamports2,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(
        mintKeypair2.publicKey, payer.publicKey, mintKeypair2.publicKey,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintCloseAuthorityInstruction(
        mintKeypair2.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintKeypair2.publicKey, 6, payer.publicKey, payer.publicKey,
        TOKEN_2022_PROGRAM_ID
      ),
    );
    await sendAndConfirmTransaction(connection, tx1, [payer, mintKeypair2]);
    console.log("TX1 (create + extensions + mint): PASSED");

    const tx2 = new Transaction().add(
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint: mintKeypair2.publicKey,
        metadata: mintKeypair2.publicKey,
        name, symbol, uri,
        mintAuthority: payer.publicKey,
        updateAuthority: payer.publicKey,
      })
    );
    await sendAndConfirmTransaction(connection, tx2, [payer]);
    console.log("TX2 (metadata init): PASSED");

    const metadata = await getTokenMetadata(
      connection, mintKeypair2.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID
    );
    console.log(`Metadata: name=${metadata?.name}, symbol=${metadata?.symbol}`);
  } catch (e: any) {
    console.log(`FAILED: ${e.message}`);
    if (e.logs) {
      console.log("Logs:", e.logs.join("\n"));
    }
  }
}

main().catch(console.error);
