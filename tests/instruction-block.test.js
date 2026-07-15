"use strict";

const assert = require("node:assert/strict");
const {
  END_MARKER,
  START_MARKER,
  buildInstructionBlock,
  mergeInstructionBlock
} = require("../lib/instruction-block.js");

const globalSource = {
  scope: "global",
  origin: "https://chat.deepseek.com",
  name: "AGENTS.md",
  content: "始终使用中文。"
};

const siteSource = {
  scope: "site",
  origin: "https://chat.deepseek.com",
  name: "deepseek.md",
  content: "回答保持简洁。"
};

const combinedBlock = buildInstructionBlock([globalSource, siteSource]);
assert.ok(combinedBlock.startsWith(START_MARKER));
assert.ok(combinedBlock.endsWith(END_MARKER));
assert.ok(combinedBlock.indexOf("始终使用中文") < combinedBlock.indexOf("回答保持简洁"));

const draft = "请帮我解释这段代码。";
const firstImport = mergeInstructionBlock(draft, combinedBlock);
assert.equal(firstImport, `${combinedBlock}\n\n${draft}`);

const updatedBlock = buildInstructionBlock([
  { ...globalSource, content: "始终使用简体中文。" }
]);
const secondImport = mergeInstructionBlock(firstImport, updatedBlock);
assert.equal(secondImport, `${updatedBlock}\n\n${draft}`);
assert.equal(secondImport.includes("回答保持简洁"), false);

assert.equal(mergeInstructionBlock("", combinedBlock), combinedBlock);
assert.equal(buildInstructionBlock([{ ...globalSource, content: "   " }]), "");

console.log("instruction-block tests passed");
