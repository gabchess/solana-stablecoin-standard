import { Command } from "commander";
import { BN } from "@coral-xyz/anchor";

import { SolanaStablecoin, Role } from "@stbr/sss-token";
import {
  setupContext,
  parsePublicKey,
  printHeader,
  printResult,
  printSuccess,
  handleError,
} from "../helpers";

// ---------------------------------------------------------------------------
// sss-token admin pause / unpause / transfer-authority / set-cap / info
// ---------------------------------------------------------------------------

export function registerAdminCommands(parent: Command): void {
  const admin = parent
    .command("admin")
    .description("Admin operations");

  // ── admin pause ─────────────────────────────────────────────────

  admin
    .command("pause")
    .description("Pause the stablecoin (blocks mint/burn/transfer)")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .option(
      "--as-pauser",
      "Pause using the Pauser role (otherwise pauses as master authority)",
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");

        printHeader("Pause Stablecoin");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);

        let roleConfig = null;
        if (opts.asPauser) {
          const [rolePda] = stablecoin.getRoleAddress(
            Role.Pauser,
            ctx.wallet.publicKey,
          );
          roleConfig = rolePda;
        }

        const sig = await stablecoin.pause(ctx.wallet.publicKey, roleConfig);

        printSuccess("Stablecoin paused");
        printResult({ signature: sig, mint, paused: true });
      }),
    );

  // ── admin unpause ───────────────────────────────────────────────

  admin
    .command("unpause")
    .description("Unpause the stablecoin")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .option(
      "--as-pauser",
      "Unpause using the Pauser role (otherwise unpauses as master authority)",
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");

        printHeader("Unpause Stablecoin");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);

        let roleConfig = null;
        if (opts.asPauser) {
          const [rolePda] = stablecoin.getRoleAddress(
            Role.Pauser,
            ctx.wallet.publicKey,
          );
          roleConfig = rolePda;
        }

        const sig = await stablecoin.unpause(ctx.wallet.publicKey, roleConfig);

        printSuccess("Stablecoin unpaused");
        printResult({ signature: sig, mint, paused: false });
      }),
    );

  // ── admin transfer-authority ────────────────────────────────────

  admin
    .command("transfer-authority")
    .description("Transfer master authority to a new wallet")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption(
      "--new-authority <pubkey>",
      "New master authority wallet",
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const newAuthority = parsePublicKey(
          opts.newAuthority,
          "new-authority",
        );

        printHeader("Transfer Master Authority");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.transferMasterAuthority(
          ctx.wallet.publicKey,
          newAuthority,
        );

        printSuccess(
          `Master authority transferred to ${newAuthority.toBase58()}`,
        );
        printResult({ signature: sig, mint, newAuthority });
      }),
    );

  // ── admin set-cap ───────────────────────────────────────────────

  admin
    .command("set-cap")
    .description("Update the supply cap (omit --cap for unlimited)")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .option("--cap <amount>", "New supply cap (omit for unlimited)")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const newCap = opts.cap ? new BN(opts.cap) : null;

        printHeader("Update Supply Cap");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.updateSupplyCap(
          ctx.wallet.publicKey,
          newCap,
        );

        printSuccess(
          newCap
            ? `Supply cap set to ${newCap.toString()}`
            : "Supply cap removed (unlimited)",
        );
        printResult({ signature: sig, mint, supplyCap: newCap });
      }),
    );

  // ── admin info ──────────────────────────────────────────────────

  admin
    .command("info")
    .description("Display stablecoin configuration and state")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const state = await stablecoin.getState();

        printHeader("Stablecoin Info");
        printResult({
          mint,
          config: stablecoin.config,
          preset: state.preset === 1 ? "SSS-1 (minimal)" : "SSS-2 (compliant)",
          masterAuthority: state.masterAuthority,
          paused: state.paused,
          decimals: state.decimals,
          supplyCap: state.supplyCap,
          transferHookProgram: state.transferHookProgram,
          bump: state.bump,
        });
      }),
    );
}
