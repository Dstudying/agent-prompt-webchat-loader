# AGENTS.md 对话导入器

一个无需构建的 Chrome Manifest V3 扩展，用于把本地 `AGENTS.md` 规范导入网页大模型的聊天输入框。

当前支持：

- `https://chat.deepseek.com/*`
- `https://www.doubao.com/*`
- `https://www.qianwen.com/chat`

扩展只负责把内容写入输入框，**不会自动点击发送**。

## 安装

1. 打开 Chrome 或 Edge 的扩展管理页面。
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录，也就是包含 `manifest.json` 的目录。
5. 建议把扩展固定到浏览器工具栏。

扩展更新后，在扩展管理页面点击本扩展的“重新加载”，并刷新已经打开的 DeepSeek、豆包或千问页面。

## 使用

1. 打开 DeepSeek、豆包或千问聊天页面。
2. 点击工具栏中的扩展图标。
3. 在“全局规范”中选择通用的 `AGENTS.md`。
4. 如有需要，再为当前网站选择一个专属 Markdown 文件。
5. 点击“导入到当前输入框”，检查内容后手动发送。

新安装默认可按 `Ctrl + I` 直接导入。浏览器若没有采用默认快捷键，可在以下页面检查或修改：

- Chrome：`chrome://extensions/shortcuts`
- Edge：`edge://extensions/shortcuts`

扩展弹窗会显示当前实际生效的快捷键。点击“更改快捷键”可直接打开上述浏览器设置页；浏览器不允许扩展自行改写快捷键，因此需要在该页面中完成修改。已经安装过旧版本或手动修改过快捷键时，浏览器可能继续保留原设置，需要手动改为 `Ctrl + I`。

当全局文件和网站专属文件同时存在时，扩展会先放入全局规范，再放入网站规范。同一个输入框再次导入时，旧的规范块会被最新文件内容替换，不会重复叠加。

## 本地文件存储

首次使用需要手动选择文件。扩展会把文件名、正文和浏览器提供的文件句柄保存在扩展专属 IndexedDB 中，不会写入只读的 `assets/` 安装目录。

每次导入都会尝试从磁盘读取最新内容并更新缓存。如果读取权限失效，或者源文件被移动、删除，扩展会直接使用最后一次保存的正文，不需要重新授权。要强制更新内容，可在弹窗中点击“替换文件”重新选择；同一全局或网站槽位的新文件会覆盖旧记录。

旧版本只保存了文件句柄。升级后若句柄仍可读取，扩展会自动补齐正文；如果已经不可读取，只需重新选择一次文件。点击“清除”会删除对应槽位的文件名、正文和句柄，卸载扩展会删除全部扩展本地数据。

## 隐私说明

- 文件内容只在本机读取，并持久化在扩展专属 IndexedDB 中。
- 扩展自身不会把内容上传到任何服务器。
- 只有在你主动触发导入时，内容才会写入当前 DeepSeek、豆包或千问输入框。
- 扩展不会自动发送对话。
- 扩展只申请三个目标网站、活动标签页、脚本注入和本地扩展状态所需权限。

请注意：当你手动点击网页的发送按钮后，输入框中的内容将按照目标网站自身的隐私政策发送给相应服务商。

## 项目结构

```text
assets/icons/ 扩展清单、工具栏和弹窗使用的图标资源
background/   后台导入流程与快捷键处理
content/      网页输入框探测、写入与提示条
lib/          文件正文与句柄存储、规范块合并逻辑
popup/        扩展弹窗界面
tests/        无第三方依赖的核心逻辑测试
manifest.json Chrome Manifest V3 配置
```

## 站点支持配置

每个网站都需要在 Manifest 访问范围、后台 origin 白名单、弹窗名称映射和内容脚本选择器中同步注册。

| 网站 | 页面入口 | Manifest 匹配范围 | 运行时 origin | 弹窗名称 |
| --- | --- | --- | --- | --- |
| DeepSeek | `https://chat.deepseek.com/` | `https://chat.deepseek.com/*` | `https://chat.deepseek.com` | `DeepSeek` |
| 豆包 | `https://www.doubao.com/chat/` | `https://www.doubao.com/*` | `https://www.doubao.com` | `豆包` |
| 千问 | `https://www.qianwen.com/chat` | `https://www.qianwen.com/*` | `https://www.qianwen.com` | `千问` |

### DeepSeek

DeepSeek 主要使用 `textarea`，部分页面版本可能使用 Lexical 富文本编辑器。选择器按以下顺序匹配：

```javascript
"https://chat.deepseek.com": [
  "textarea#chat-input",
  "textarea[placeholder*='DeepSeek']",
  "textarea[placeholder*='发送消息']",
  "[contenteditable='true'][data-lexical-editor='true']",
  "[contenteditable='true'][role='textbox']"
]
```

### 豆包

豆包通常使用带 `data-testid` 容器的 Slate 编辑器，同时保留通用富文本框和 textarea 回退：

```javascript
"https://www.doubao.com": [
  "[data-testid*='chat_input'] [contenteditable='true']",
  "[data-testid*='chat-input'] [contenteditable='true']",
  "[contenteditable='true'][data-slate-editor='true']",
  "[contenteditable='true'][role='textbox']",
  "textarea[placeholder*='发送']"
]
```

### 千问

千问使用带聊天输入容器的 Slate 编辑器。选择器先限定聊天输入区域，再回退到页面中的唯一 Slate 编辑器：

```javascript
"https://www.qianwen.com": [
  "[data-chat-input-body='true'] [data-slate-editor='true']",
  "[data-testid='chat-input-content-measure'] [contenteditable='true']",
  "[data-chat-input-shell='true'] [contenteditable='true'][role='textbox']",
  "[contenteditable='true'][data-slate-editor='true']"
]
```

### 配置同步要求

`manifest.json` 的 `host_permissions` 和 `content_scripts[0].matches` 必须包含相同的三个范围：

```json
[
  "https://chat.deepseek.com/*",
  "https://www.doubao.com/*",
  "https://www.qianwen.com/*"
]
```

`background/service-worker.js` 使用 origin 白名单：

```javascript
const SUPPORTED_ORIGINS = new Set([
  "https://chat.deepseek.com",
  "https://www.doubao.com",
  "https://www.qianwen.com"
]);
```

`popup/popup.js` 使用相同 origin 作为网站专属文件的存储键：

```javascript
const SUPPORTED_SITES = {
  "https://chat.deepseek.com": "DeepSeek",
  "https://www.doubao.com": "豆包",
  "https://www.qianwen.com": "千问"
};
```

Manifest 匹配范围包含路径通配符；后台、弹窗和 `SITE_SELECTORS` 的键只使用 origin，不包含路径或尾部斜杠。

### 选择器维护

打开目标网站的聊天页面，按 `F12` 检查输入框。优先使用稳定的 `data-*` 属性，其次使用 `role="textbox"`、`contenteditable="true"` 或稳定的 `placeholder`，避免包含随机字符、构建哈希或位置序号的 class。

在开发者工具 Console 中替换候选选择器，确认最终只匹配一个可见、可编辑元素：

```javascript
const selector = "[contenteditable='true'][role='textbox']";
const editors = Array.from(document.querySelectorAll(selector)).filter((element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && rect.width >= 100
    && rect.height >= 20
    && !element.matches(":disabled, [aria-disabled='true']");
});
console.log(editors.length, editors);
```

结果必须为 `1`。分别检查新对话、已有对话和窗口宽度变化后的页面。不要仅依赖 `GENERIC_SELECTORS`；网站专属选择器可减少页面出现多个编辑器时的误匹配。如果输入框位于 iframe 或 Shadow DOM 中，当前查找逻辑无法直接访问，需要先扩展探测实现。

### 重新加载与验证

1. 在 `chrome://extensions/` 或 `edge://extensions/` 重新加载扩展，并刷新三个目标网站的聊天页面。
2. 确认弹窗分别显示“当前网站：DeepSeek”“当前网站：豆包”和“当前网站：千问”。
3. 分别检查全局与网站专属 `AGENTS.md`、空输入框、已有草稿和重复导入。
4. 确认旧规范块被替换、光标停在全部内容末尾，且弹窗按钮和快捷键都能触发导入。
5. 确认扩展只写入输入框，不会自动发送消息。

若提示“当前网站不受支持”，检查 Manifest、`SUPPORTED_ORIGINS` 和 `SUPPORTED_SITES` 是否同步。若提示“没有找到唯一可用的聊天输入框”，检查隐藏输入框、页面属性变化、iframe 或 Shadow DOM。

## 开发检查

项目没有构建步骤和第三方依赖。可使用 Node.js 运行核心文本合并测试：

```powershell
node tests/instruction-block.test.js
```

网站输入框结构可能随站点升级而变化。相关适配选择器集中在 `content/content.js` 的 `SITE_SELECTORS` 中；添加新站点时还需同步更新 `manifest.json`、后台 origin 白名单和弹窗站点名称映射。
