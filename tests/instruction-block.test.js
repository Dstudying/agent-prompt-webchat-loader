"use strict";

const assert = require("node:assert/strict");
const {
  END_MARKER,
  START_MARKER,
  buildProfileBlock,
  buildInstructionBlock,
  mergeProfileBlocks,
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

const firstProfile = {
  content: "使用中文。",
  id: "11111111-1111-4111-8111-111111111111",
  name: "通用规范",
  placement: "prepend"
};
const secondProfile = {
  content: "结论优先。",
  id: "22222222-2222-4222-8222-222222222222",
  name: "写作规范",
  placement: "append"
};
const firstProfileBlock = buildProfileBlock(firstProfile);
const secondProfileBlock = buildProfileBlock(secondProfile);
const multiProfileImport = mergeProfileBlocks(draft, [firstProfile, secondProfile]);
assert.equal(
  multiProfileImport,
  `${firstProfileBlock}\n\n${draft}\n\n${secondProfileBlock}`
);

const updatedFirstProfile = { ...firstProfile, content: "始终使用简体中文。" };
const updatedProfileImport = mergeProfileBlocks(multiProfileImport, [updatedFirstProfile]);
assert.equal(updatedProfileImport.includes("使用中文。"), false);
assert.equal(updatedProfileImport.includes("始终使用简体中文。"), true);
assert.equal(updatedProfileImport.includes(secondProfileBlock), true);

const middleDraft = `第一段\n\n${firstProfileBlock}\n\n第二段`;
assert.equal(
  mergeProfileBlocks(middleDraft, [{ ...firstProfile, content: "新规范。", placement: "append" }]),
  `第一段\n\n第二段\n\n${buildProfileBlock({ ...firstProfile, content: "新规范。", placement: "append" })}`
);

console.log("instruction-block tests passed");
