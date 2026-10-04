// Isolated-suite proof: forbid canonical-schema reads from ANY other checkout.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const { fileURLToPath } = require("node:url");
const { resolve, sep } = require("node:path");
const checkout = fs.realpathSync(resolve(process.env.D07_ORACLE_CHECKOUT));
const read = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  const path = file instanceof URL ? fileURLToPath(file) : typeof file === "string" ? resolve(file) : "";
  if (/(?:input|output)\.schema\.json$/.test(path) && !fs.realpathSync(path).startsWith(checkout + sep)) {
    throw new Error("External schema oracle is forbidden in isolated suite");
  }
  return read.call(this, file, ...args);
};
syncBuiltinESMExports();
