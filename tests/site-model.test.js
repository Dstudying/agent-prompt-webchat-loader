"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_SITE_TEMPLATES,
  normalizeEditorSelectors,
  normalizeOrigin,
  originToMatchPattern,
  validateSites
} = require("../lib/site-model.js");

assert.equal(DEFAULT_SITE_TEMPLATES.length, 4);
assert.equal(DEFAULT_SITE_TEMPLATES[3].origin, "https://chatgpt.com");
assert.equal(normalizeOrigin("https://chatgpt.com/c/123?model=test"), "https://chatgpt.com");
assert.equal(originToMatchPattern("http://localhost:3000/chat"), "http://localhost/*");
assert.deepEqual(
  normalizeEditorSelectors("textarea\ntextarea\n  [contenteditable='true']  \n"),
  ["textarea", "[contenteditable='true']"]
);

const sites = validateSites(DEFAULT_SITE_TEMPLATES.map((template) => ({
  ...template,
  createdAt: "2026-07-30 10:00:00",
  updatedAt: "2026-07-30 10:00:00"
})));
assert.equal(sites.length, 4);

assert.throws(
  () => validateSites([sites[0], { ...sites[1], origin: sites[0].origin }]),
  /网站地址重复/
);
assert.throws(
  () => validateSites([{ ...sites[0], autoDetect: false, editorSelectors: [] }]),
  /至少需要一个输入框选择器，或开启自动识别，或提供自定义 JS 代码/
);

// code 字段可以替代选择器
const CODE_TEST_ID = "10000000-0000-4000-8000-000000000009";
const codeSites = validateSites([{
  ...sites[0],
  autoDetect: false,
  code: "function platformRead() { return ''; }\nfunction platformWrite(text) {}",
  editorSelectors: [],
  id: CODE_TEST_ID,
  origin: "https://code-test.example.com"
}]);
assert.equal(codeSites.length, 1);
assert.equal(codeSites[0].code.includes("platformRead"), true);

// 纯空字符串 code 不能替代选择器
assert.throws(
  () => validateSites([{ ...sites[0], autoDetect: false, code: "", editorSelectors: [], id: "10000000-0000-4000-8000-00000000000a" }]),
  /至少需要一个输入框选择器，或开启自动识别，或提供自定义 JS 代码/
);
assert.throws(
  () => validateSites([{ ...sites[0], autoDetect: false, code: "   ", editorSelectors: [], id: "10000000-0000-4000-8000-00000000000b" }]),
  /至少需要一个输入框选择器，或开启自动识别，或提供自定义 JS 代码/
);
assert.throws(
  () => validateSites([{ ...sites[0], updatedAt: "2026-02-30 10:00:00" }]),
  /网站时间格式无效/
);
assert.throws(() => normalizeOrigin("chrome://extensions"), /只支持 HTTP 或 HTTPS/);

console.log("site-model tests passed");
