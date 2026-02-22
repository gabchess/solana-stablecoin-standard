import { Command } from "commander";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { SolanaStablecoin } from "@stbr/sss-token";
import {
  setupContext,
  printHeader,
  printResult,
  printSuccess,
  handleError,
} from "../helpers";

// ---------------------------------------------------------------------------
// sss-token init sss1 / sss-token init sss2
// ---------------------------------------------------------------------------

export function registerInitCommands(parent: Command): void {
  const init = parent
    .command("init")
    .description("Initialize a new stablecoin");

  // ── init sss1 ───────────────────────────────────────────────────

  init
    .command("sss1")
    .description("Initialize an SSS-1 (minimal) stablecoin")
    .requiredOption("--name <name>", "Token name (max 32 chars)")
    .requiredOption("--symbol <symbol>", "Token symbol (max 10 chars)")
    .requiredOption("--uri <uri>", "Metadata URI (max 200 chars)")
    .option("--decimals <decimals>", "Token decimals", "6")
    .option("--supply-cap <cap>", "Maximum supply (omit for unlimited)")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        printHeader("Initialize SSS-1 Stablecoin");

        const supplyCap = opts.supplyCap ? new BN(opts.supplyCap) : null;

        const stablecoin = await SolanaStablecoin.createSss1(ctx.program, {
          name: opts.name,
          symbol: opts.symbol,
          uri: opts.uri,
          decimals: parseInt(opts.decimals, 10),
          supplyCap,
        });

        const state = await stablecoin.getState();

        printSuccess("SSS-1 stablecoin initialized");
        printResult({
          mint: stablecoin.mint,
          config: stablecoin.config,
          preset: state.preset,
          decimals: state.decimals,
          supplyCap: state.supplyCap,
          masterAuthority: state.masterAuthority,
        });
      }),
    );

  // ── init sss2 ───────────────────────────────────────────────────

  init
    .command("sss2")
    .description("Initialize an SSS-2 (compliant) stablecoin")
    .requiredOption("--name <name>", "Token name (max 32 chars)")
    .requiredOption("--symbol <symbol>", "Token symbol (max 10 chars)")
    .requiredOption("--uri <uri>", "Metadata URI (max 200 chars)")
    .requiredOption(
      "--hook-program <pubkey>",
      "Transfer hook program ID",
    )
    .option("--decimals <decimals>", "Token decimals", "6")
    .option("--supply-cap <cap>", "Maximum supply (omit for unlimited)")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        printHeader("Initialize SSS-2 Stablecoin");

        const supplyCap = opts.supplyCap ? new BN(opts.supplyCap) : null;
        const hookProgramId = new PublicKey(opts.hookProgram);

        const stablecoin = await SolanaStablecoin.createSss2(
          ctx.program,
          ctx.hookProgram,
          {
            name: opts.name,
            symbol: opts.symbol,
            uri: opts.uri,
            decimals: parseInt(opts.decimals, 10),
            supplyCap,
            hookProgramId,
          },
        );

        const state = await stablecoin.getState();

        printSuccess("SSS-2 stablecoin initialized");
        printResult({
          mint: stablecoin.mint,
          config: stablecoin.config,
          preset: state.preset,
          decimals: state.decimals,
          supplyCap: state.supplyCap,
          masterAuthority: state.masterAuthority,
          transferHookProgram: state.transferHookProgram,
        });
      }),
    );
}
