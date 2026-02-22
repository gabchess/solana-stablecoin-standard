import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";

import { SolanaStablecoin, SSS_TRANSFER_HOOK_PROGRAM_ID } from "@stbr/sss-token";
import {
  setupContext,
  parsePublicKey,
  parseAmount,
  printHeader,
  printResult,
  printSuccess,
  handleError,
} from "../helpers";

// ---------------------------------------------------------------------------
// sss-token seize
// ---------------------------------------------------------------------------

export function registerSeizeCommand(parent: Command): void {
  parent
    .command("seize")
    .description(
      "Seize tokens from a blacklisted wallet via permanent delegate (SSS-2 only)",
    )
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--from <pubkey>", "Blacklisted wallet's token account")
    .requiredOption("--to <pubkey>", "Treasury token account")
    .requiredOption("--amount <amount>", "Amount to seize (base units)")
    .requiredOption("--wallet <pubkey>", "Blacklisted wallet public key")
    .requiredOption(
      "--treasury-wallet <pubkey>",
      "Treasury wallet public key",
    )
    .option(
      "--hook-program <pubkey>",
      "Transfer hook program ID",
      SSS_TRANSFER_HOOK_PROGRAM_ID.toBase58(),
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const fromAta = parsePublicKey(opts.from, "from");
        const treasuryAta = parsePublicKey(opts.to, "to");
        const amount = parseAmount(opts.amount);
        const wallet = parsePublicKey(opts.wallet, "wallet");
        const treasuryWallet = parsePublicKey(
          opts.treasuryWallet,
          "treasury-wallet",
        );
        const hookProgramId = new PublicKey(opts.hookProgram);

        printHeader("Seize Tokens");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.seize(
          ctx.wallet.publicKey,
          { amount, fromAta, treasuryAta, wallet, treasuryWallet },
          hookProgramId,
        );

        printSuccess(`Seized ${amount.toString()} tokens`);
        printResult({
          signature: sig,
          amount: amount.toString(),
          fromWallet: wallet,
          toTreasury: treasuryWallet,
          mint,
        });
      }),
    );
}
