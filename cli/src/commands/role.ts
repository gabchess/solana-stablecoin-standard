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
// Role name → enum mapping
// ---------------------------------------------------------------------------

const ROLE_MAP: Record<string, Role> = {
  minter: Role.Minter,
  burner: Role.Burner,
  blacklister: Role.Blacklister,
  pauser: Role.Pauser,
  seizer: Role.Seizer,
};

function parseRole(name: string): Role {
  const role = ROLE_MAP[name.toLowerCase()];
  if (role === undefined) {
    console.error(
      `\n  ERROR: Unknown role "${name}". Valid roles: ${Object.keys(ROLE_MAP).join(", ")}\n`,
    );
    process.exit(1);
  }
  return role;
}

// ---------------------------------------------------------------------------
// sss-token role assign / sss-token role revoke
// ---------------------------------------------------------------------------

export function registerRoleCommands(parent: Command): void {
  const role = parent
    .command("role")
    .description("Manage stablecoin roles");

  // ── role assign ─────────────────────────────────────────────────

  role
    .command("assign")
    .description("Assign a role to a wallet")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--holder <pubkey>", "Wallet to assign the role to")
    .requiredOption(
      "--role <role>",
      "Role name (minter, burner, blacklister, pauser, seizer)",
    )
    .option("--allowance <amount>", "Minting allowance (Minter role only, omit for unlimited)")
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const holder = parsePublicKey(opts.holder, "holder");
        const roleEnum = parseRole(opts.role);
        const mintAllowance = opts.allowance ? new BN(opts.allowance) : null;

        printHeader(`Assign Role: ${opts.role}`);

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.assignRole(ctx.wallet.publicKey, {
          role: roleEnum,
          holder,
          mintAllowance,
        });

        printSuccess(`Role "${opts.role}" assigned to ${holder.toBase58()}`);
        printResult({ signature: sig, role: opts.role, holder, mint });
      }),
    );

  // ── role revoke ─────────────────────────────────────────────────

  role
    .command("revoke")
    .description("Revoke a role from a wallet")
    .requiredOption("--mint <pubkey>", "Stablecoin mint address")
    .requiredOption("--holder <pubkey>", "Wallet to revoke the role from")
    .requiredOption(
      "--role <role>",
      "Role name (minter, burner, blacklister, pauser, seizer)",
    )
    .action(
      handleError(async function (this: Command) {
        const opts = this.opts();
        const globalOpts = this.parent!.parent!.opts();
        const ctx = setupContext(globalOpts);

        const mint = parsePublicKey(opts.mint, "mint");
        const holder = parsePublicKey(opts.holder, "holder");
        const roleEnum = parseRole(opts.role);

        printHeader(`Revoke Role: ${opts.role}`);

        const stablecoin = await SolanaStablecoin.load(ctx.program, mint);
        const sig = await stablecoin.revokeRole(
          ctx.wallet.publicKey,
          roleEnum,
          holder,
        );

        printSuccess(`Role "${opts.role}" revoked from ${holder.toBase58()}`);
        printResult({ signature: sig, role: opts.role, holder, mint });
      }),
    );
}
