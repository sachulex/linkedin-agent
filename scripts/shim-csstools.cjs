#!/usr/bin/env node
// scripts/shim-csstools.cjs
const fs = require("fs");
const path = require("path");

// 1) Ensure CJS shims for ESM-only @csstools packages so require(".../dist/index.cjs") works
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

// 2) Stub css-color that crashes under cssstyle on Node 20 in our env
const cssColorTargets = [
  path.join(process.cwd(), "node_modules", "@asamuzakjp", "css-color", "dist", "cjs"),
  path.join(process.cwd(), "node_modules", "cssstyle", "node_modules", "@asamuzakjp", "css-color", "dist", "cjs"),
];
for (const dir of cssColorTargets) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "index.cjs");
    fs.writeFileSync(file, "module.exports = {};\n");
    console.log(`[shim-csstools] stubbed ${file}`);
  } catch (e) {
    console.error(`[shim-csstools] failed to stub css-color at ${dir}: ${e.message}`);
  }
}

// 3) Provide a minimal, safe cssstyle utils.js so parsers can destructure without exploding
//    This avoids TypeError: Cannot destructure 'cssCalc' of 'utils' as it is undefined.
const utilsContent = `
'use strict';
function cssCalc(v){ return v; }
function isColor(_v){ return false; }
function isGradient(_v){ return false; }
function splitValue(v){ return String(v||'').trim().split(/\\s+/); }
module.exports = { cssCalc, isColor, isGradient, splitValue };
`;

// Apply to top-level cssstyle and a nested copy if present
const utilsTargets = [
  path.join(process.cwd(), "node_modules", "cssstyle", "lib", "utils.js"),
  path.join(process.cwd(), "node_modules", "jsdom", "node_modules", "cssstyle", "lib", "utils.js"),
];
for (const file of utilsTargets) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, utilsContent);
    console.log(`[shim-csstools] wrote safe utils -> ${file}`);
  } catch (e) {
    console.error(`[shim-csstools] failed to write utils at ${file}: ${e.message}`);
  }
}
