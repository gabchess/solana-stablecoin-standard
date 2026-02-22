import { Command } from "commander";

import { SolanaStablecoin, Role } from "@stbr/sss-token";
import { getRoleAddress, SSS_TOKEN_PROGRAM_ID } from "@stbr/sss-token";
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
// sss-token burn
// ---------------------------------------------------------------------------

export function registerBurnCommand(parent: Command): void {
  parent
    .command("burn")
    .description("Burn tokens from a token account")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--from <pubkey>", "Source token account (ATA)")
    .requiredOption("--amount <amount>", "Amount to burn (base units)")
    .option(
      "--as-burner",
      "Burn using the Burner role (otherwise burns as token owner)",
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const fromAta = parsePublicKey(opts.from, "from");
        const amount = parseAmount(opts.amount);

        printHeader("Burn Tokens");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);

        // Determine role config: Burner role PDA or null (self-burn)
        let roleConfig = null;
        if (opts.asBurner) {
          const [rolePda] = stablecoin.getRoleAddress(
            Role.Burner,
            ctx.wallet.publicKey,
          );
          roleConfig = rolePda;
        }

        const sig = await stablecoin.burnTokens(
          ctx.wallet.publicKey,
          { amount, fromAta },
          roleConfig,
        );

        printSuccess(`Burned ${amount.toString()} tokens`);
        printResult({
          signature: sig,
          amount: amount.toString(),
          fromAta,
          mint,
          asBurner: !!opts.asBurner,
        });
      }),
    );
}
