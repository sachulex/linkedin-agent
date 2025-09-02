#!/usr/bin/env node
// scripts/shim-csstools.cjs
const fs = require("fs");
const path = require("path");

const pkgs = [
  "@csstools/css-calc",
  "@csstools/css-tokenizer",
  "@csstools/css-parser-algorithms",
  "@csstools/media-query-list-parser",
  "@csstools/selector-specificity",
];

for (const k of pkgs) {
  try {
    const pkgRoot = path.join(process.cwd(), "node_modules", k);
    const distDir = path.join(pkgRoot, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const cjsPath = path.join(distDir, "index.cjs");
    fs.writeFileSync(cjsPath, `module.exports = require('${k}');\n`);
    console.log(`[shim-csstools] wrote ${cjsPath}`);
  } catch (e) {
    console.error(`[shim-csstools] failed for ${k}: ${e.message}`);
  }
}
