#!/usr/bin/env node
// scripts/shim-csstools.cjs
const fs = require("fs");
const path = require("path");

// 1) Create CommonJS shim entry points for ESM-only @csstools packages
const csstoolsPkgs = [
  "@csstools/css-calc",
  "@csstools/css-tokenizer",
  "@csstools/css-parser-algorithms",
  "@csstools/media-query-list-parser",
  "@csstools/selector-specificity",
];

for (const k of csstoolsPkgs) {
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

// 2) Hard-stub @asamuzakjp/css-color CJS to avoid tokenizer destructuring crashes inside cssstyle
//    We stub BOTH the top-level install and the nested copy under cssstyle/node_modules.
const stubTargets = [
  path.join(process.cwd(), "node_modules", "@asamuzakjp", "css-color", "dist", "cjs"),
  path.join(process.cwd(), "node_modules", "cssstyle", "node_modules", "@asamuzakjp", "css-color", "dist", "cjs"),
];

for (const dir of stubTargets) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "index.cjs");
    // Minimal no-op export. cssstyle can function for our crawler without full color parsing.
    fs.writeFileSync(file, "module.exports = {};\n");
    console.log(`[shim-csstools] stubbed ${file}`);
  } catch (e) {
    console.error(`[shim-csstools] failed to stub css-color at ${dir}: ${e.message}`);
  }
}
