import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMarketIndex, marketInstallTarget } from "/Users/ljw/.hermes/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js";

const file = new URL("../market/index.json", import.meta.url);
const index = parseMarketIndex(JSON.parse(readFileSync(file, "utf8")), "https://raw.githubusercontent.com/0801ljw/dutang-dsh-plugin/main/market/index.json");
assert.equal(index.plugins.length, 1);
assert.equal(index.plugins[0].name, "@dutang/dsh-plugin-dutang");
assert.equal(index.plugins[0].versions[0].version, "0.4.0");
const target = marketInstallTarget(index.plugins[0].name, index.plugins[0].versions[0]);
assert.match(target.spec, /^git\+https:\/\/github\.com\/0801ljw\/dutang-dsh-plugin\.git#6478238/);
console.log("market index OK:", target.spec);
