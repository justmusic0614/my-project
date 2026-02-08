#!/usr/bin/env node
"use strict";

function printHelp() {
  console.log(`
my-project - a CLI tool

Usage:
  my-project hello
  my-project backup --src <path> --dest <path> [--dry-run]
  my-project --help

Commands:
  hello     Print a greeting and timestamp
  backup    (scaffold) Validate args and show what would run

Examples:
  my-project hello
  my-project backup --src ~/Documents --dest ~/backup --dry-run
`.trim());
}

function parseArgs(argv) {
  // argv is process.argv.slice(2)
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function cmdHello() {
  console.log("Hello from my-project!");
  console.log("Timestamp: " + new Date().toISOString());
}

const fs = require("fs");
const path = require("path");

function copyFile(srcFile, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(srcFile, destFile);
}

function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });

  list.forEach((file) => {
    const full = path.join(dir, file.name);
    if (file.isDirectory()) {
      results = results.concat(walkDir(full));
    } else {
      results.push(full);
    }
  });

  return results;
}

function cmdBackup(args) {
  const src = args.src;
  const dest = args.dest;
  const dryRun = !!args["dry-run"];

  if (!src || !dest) {
    console.error("Error: backup requires --src and --dest");
    return;
  }

  const srcAbs = path.resolve(src);
  const destAbs = path.resolve(dest);

  console.log("Backup starting...");
  console.log("From:", srcAbs);
  console.log("To:", destAbs);
  console.log("Dry run:", dryRun);

  const files = walkDir(srcAbs);

  files.forEach((file) => {
    const relative = path.relative(srcAbs, file);
    const destFile = path.join(destAbs, relative);

    if (dryRun) {
      console.log("[DRY]", file, "→", destFile);
    } else {
      copyFile(file, destFile);
      console.log("[COPY]", file);
    }
  });

  console.log("Done.");
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }

  if (cmd === "hello") {
    cmdHello();
    return;
  }

  if (cmd === "backup") {
    cmdBackup(args);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error("");
  printHelp();
  process.exitCode = 1;
}

main();