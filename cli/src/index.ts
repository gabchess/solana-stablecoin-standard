#!/usr/bin/env node

import { Command } from "commander";

import { registerInitCommands } from "./commands/init";
import { registerRoleCommands } from "./commands/role";
import { registerMintCommand } from "./commands/mint";
import { registerBurnCommand } from "./commands/burn";
import { registerBlacklistCommands } from "./commands/blacklist";
import { registerSeizeCommand } from "./commands/seize";
import { registerAdminCommands } from "./commands/admin";

// ---------------------------------------------------------------------------
// sss-token CLI — Solana Stablecoin Standard
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("sss-token")
  .description("Solana Stablecoin Standard — Admin CLI")
  .version("0.1.0")
  .option(
    "-u, --url <url>",
    "Solana RPC URL",
    "http://localhost:8899",
  )
  .option(
    "-k, --keypair <path>",
    "Path to signer keypair",
    "~/.config/solana/id.json",
  );

// Register all subcommands
registerInitCommands(program);
registerRoleCommands(program);
registerMintCommand(program);
registerBurnCommand(program);
registerBlacklistCommands(program);
registerSeizeCommand(program);
registerAdminCommands(program);

program.parse(process.argv);
