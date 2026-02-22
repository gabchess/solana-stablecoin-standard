import { Command } from "commander";

import { SolanaStablecoin } from "@stbr/sss-token";
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
// sss-token mint
// ---------------------------------------------------------------------------

export function registerMintCommand(parent: Command): void {
  parent
    .command("mint")
    .description("Mint tokens to a destination account")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--to <pubkey>", "Destination token account (ATA)")
    .requiredOption("--amount <amount>", "Amount to mint (base units)")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const destination = parsePublicKey(opts.to, "destination");
        const amount = parseAmount(opts.amount);

        printHeader("Mint Tokens");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.mintTokens(ctx.wallet.publicKey, {
          amount,
          destination,
        });

        printSuccess(`Minted ${amount.toString()} tokens`);
        printResult({ signature: sig, amount: amount.toString(), destination, mint });
      }),
    );
}
