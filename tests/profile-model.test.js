"use strict";

const assert = require("node:assert/strict");
const {
  createBackup,
  formatShortcut,
  shortcutKey,
  validateBackup,
  validateProfiles
} = require("../lib/profile-model.js");

function createProfile(overrides = {}) {
  return {
    content: "使用中文。",
    enabled: true,
    id: "11111111-1111-4111-8111-111111111111",
    name: "通用规范",
    placement: "prepend",
    shortcut: {
      altKey: false,
      code: "Digit1",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true
    },
    sites: ["*"],
    sourceType: "text",
    ...overrides
  };
}

const profile = createProfile();
assert.equal(formatShortcut(profile.shortcut), "Ctrl+Shift+1");
assert.equal(shortcutKey(profile.shortcut), "C:-:S:-:Digit1");

const backup = createBackup([profile]);
assert.equal(backup.format, "agent-prompt-webchat-loader");
assert.equal(backup.schemaVersion, 1);
assert.equal(validateBackup(JSON.parse(JSON.stringify(backup))).length, 1);

const disjointShortcut = createProfile({
  id: "22222222-2222-4222-8222-222222222222",
  name: "豆包规范",
  sites: ["https://www.doubao.com"]
});
const deepSeekProfile = createProfile({
  id: "33333333-3333-4333-8333-333333333333",
  name: "DeepSeek 规范",
  sites: ["https://chat.deepseek.com"]
});
assert.equal(validateProfiles([disjointShortcut, deepSeekProfile]).length, 2);

assert.throws(
  () => validateProfiles([profile, disjointShortcut]),
  /快捷键.*冲突/
);
assert.throws(
  () => validateBackup({ ...backup, schemaVersion: 2 }),
  /不支持配置版本/
);
assert.throws(
  () => validateProfiles([{ ...profile, enabled: "true" }]),
  /启用状态必须是布尔值/
);

console.log("profile-model tests passed");
