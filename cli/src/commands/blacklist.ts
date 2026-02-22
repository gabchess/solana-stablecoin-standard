import { Command } from "commander";

import { SolanaStablecoin } from "@stbr/sss-token";
import {
  setupContext,
  parsePublicKey,
  printHeader,
  printResult,
  printSuccess,
  handleError,
} from "../helpers";

// ---------------------------------------------------------------------------
// sss-token blacklist add / remove / approve / check
// ---------------------------------------------------------------------------

export function registerBlacklistCommands(parent: Command): void {
  const blacklist = parent
    .command("blacklist")
    .description("Manage wallet blacklist (SSS-2 only)");

  // ── blacklist add ───────────────────────────────────────────────

  blacklist
    .command("add")
    .description("Blacklist a wallet — freezes its token account")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--wallet <pubkey>", "Wallet to blacklist")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const wallet = parsePublicKey(opts.wallet, "wallet");

        printHeader("Blacklist Wallet");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.blacklist(ctx.wallet.publicKey, wallet);

        printSuccess(`Wallet ${wallet.toBase58()} blacklisted`);
        printResult({ signature: sig, wallet, mint });
      }),
    );

  // ── blacklist remove ────────────────────────────────────────────

  blacklist
    .command("remove")
    .description("Remove a wallet from the blacklist — thaws its token account")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--wallet <pubkey>", "Wallet to unblacklist")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const wallet = parsePublicKey(opts.wallet, "wallet");

        printHeader("Remove from Blacklist");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.unblacklist(ctx.wallet.publicKey, wallet);

        printSuccess(`Wallet ${wallet.toBase58()} removed from blacklist`);
        printResult({ signature: sig, wallet, mint });
      }),
    );

  // ── blacklist approve ───────────────────────────────────────────

  blacklist
    .command("approve")
    .description("Approve (thaw) a frozen token account — KYC gate")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption(
      "--token-account <pubkey>",
      "Wallet's token account to approve",
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const tokenAccount = parsePublicKey(
          opts.tokenAccount,
          "token-account",
        );

        printHeader("Approve Account");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.approveAccount(
          ctx.wallet.publicKey,
          tokenAccount,
        );

        printSuccess(`Token account ${tokenAccount.toBase58()} approved`);
        printResult({ signature: sig, tokenAccount, mint });
      }),
    );

  // ── blacklist check ─────────────────────────────────────────────

  blacklist
    .command("check")
    .description("Check if a wallet is blacklisted")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--wallet <pubkey>", "Wallet to check")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const wallet = parsePublicKey(opts.wallet, "wallet");

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const blacklisted = await stablecoin.isBlacklisted(wallet);

        printResult({ wallet, blacklisted, mint });
      }),
    );
}
