#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PUBLIC_DIR = resolve(process.cwd(), "public");
const VERCEl_STATIC_DIR = join(process.cwd(), ".vercel", "output", "static");
const DIST_DIR = resolve(process.cwd(), "dist");

function ensureDir(path) {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return;
  } catch {
    mkdirSync(path, { recursive: true });
  }
}

ensureDir(DIST_DIR);

if (statSync(VERCEl_STATIC_DIR).isDirectory()) {
  cpSync(VERCEl_STATIC_DIR, DIST_DIR, { recursive: true, force: true });
}

// Pages need `public/` static assets at the site root (manifest, icons, etc.).
if (statSync(PUBLIC_DIR).isDirectory()) {
  for (const name of readdirSync(PUBLIC_DIR)) {
    const src = join(PUBLIC_DIR, name);
    const dest = join(DIST_DIR, name);
    cpSync(src, dest, { recursive: true, force: true });
  }
}
