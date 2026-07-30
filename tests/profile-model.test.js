"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_PROFILE_END_MARKER,
  DEFAULT_PROFILE_START_MARKER,
  createBackup,
  formatLocalDateTime,
  formatShortcut,
  shortcutKey,
  validateBackup,
  validateProfiles
} = require("../lib/profile-model.js");

function createProfile(overrides = {}) {
  return {
    content: "使用中文。",
    createdAt: "2026-07-22 15:20:00",
    enabled: true,
    endMarker: DEFAULT_PROFILE_END_MARKER,
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
    startMarker: DEFAULT_PROFILE_START_MARKER,
    updatedAt: "2026-07-22 15:30:00",
    ...overrides
  };
}

const profile = createProfile();
assert.equal(formatShortcut(profile.shortcut), "Ctrl+Shift+1");
assert.equal(shortcutKey(profile.shortcut), "C:-:S:-:Digit1");

const backup = createBackup([profile]);
assert.equal(backup.format, "agent-prompt-webchat-loader");
assert.equal(backup.schemaVersion, 2);
assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.equal(backup.profiles[0].startMarker, DEFAULT_PROFILE_START_MARKER);
assert.equal(backup.profiles[0].endMarker, DEFAULT_PROFILE_END_MARKER);
assert.equal(validateBackup(JSON.parse(JSON.stringify(backup))).length, 1);
const editedFileBackup = createBackup([createProfile({
  contentEdited: true,
  fileName: "AGENTS.md",
  sourceType: "file"
})]);
assert.equal(
  validateBackup(JSON.parse(JSON.stringify(editedFileBackup)))[0].contentEdited,
  true
);
const legacyFileBackup = JSON.parse(JSON.stringify(editedFileBackup));
delete legacyFileBackup.profiles[0].contentEdited;
assert.equal(validateBackup(legacyFileBackup)[0].contentEdited, false);
assert.equal(validateProfiles([createProfile({ contentEdited: true })])[0].contentEdited, false);
assert.equal(
  formatLocalDateTime(new Date(2026, 6, 22, 15, 30, 45)),
  "2026-07-22 15:30:45"
);
const defaultedMarkers = validateProfiles([createProfile({
  endMarker: " ",
  startMarker: " "
})])[0];
assert.equal(defaultedMarkers.startMarker, DEFAULT_PROFILE_START_MARKER);
assert.equal(defaultedMarkers.endMarker, DEFAULT_PROFILE_END_MARKER);
const [normalizedLegacyTime] = validateProfiles([createProfile({
  createdAt: "2026-07-22T07:20:00.000Z",
  updatedAt: "2026-07-22T07:30:00.000Z"
})]);
assert.match(normalizedLegacyTime.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.match(normalizedLegacyTime.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

const customMarkerBackup = createBackup([createProfile({
  endMarker: "<<<自定义结束>>>",
  startMarker: "<<<自定义开始>>>"
})]);
const [customMarkerProfile] = validateBackup(JSON.parse(JSON.stringify(customMarkerBackup)));
assert.equal(customMarkerProfile.startMarker, "<<<自定义开始>>>");
assert.equal(customMarkerProfile.endMarker, "<<<自定义结束>>>");

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
  () => validateBackup({ ...backup, schemaVersion: 1 }),
  /不支持配置版本/
);
const missingMarkersBackup = JSON.parse(JSON.stringify(backup));
delete missingMarkersBackup.profiles[0].startMarker;
assert.throws(
  () => validateBackup(missingMarkersBackup),
  /缺少 startMarker 字段/
);
assert.throws(
  () => validateBackup({ ...backup, exportedAt: "2026-02-30 10:00:00" }),
  /exportedAt 格式无效/
);
assert.throws(
  () => validateBackup({
    ...backup,
    profiles: [{ ...profile, startMarker: "相同标记", endMarker: "相同标记" }]
  }),
  /开头标记和结尾标记不能相同/
);
assert.throws(
  () => validateBackup({
    ...backup,
    profiles: [{ ...profile, startMarker: "开始\n标记" }]
  }),
  /开头标记不能包含换行/
);
assert.throws(
  () => validateBackup({
    ...backup,
    profiles: [{ ...profile, updatedAt: "2026-07-22T15:30:00.000Z" }]
  }),
  /updatedAt 格式无效/
);
assert.throws(
  () => validateProfiles([{ ...profile, enabled: "true" }]),
  /启用状态必须是布尔值/
);
assert.throws(
  () => validateProfiles([{ ...profile, contentEdited: "true" }]),
  /正文编辑状态必须是布尔值/
);

console.log("profile-model tests passed");
