# AGENTS.md 对话导入器

一个无需构建的 Chrome/Edge Manifest V3 扩展，用于管理多条 `AGENTS.md` 或文本规范，并把指定内容写入网页大模型的聊天输入框。

首次安装会添加以下默认网站配置：

- `https://chat.deepseek.com/*`
- `https://www.doubao.com/*`
- `https://www.qianwen.com/*`
- `https://chatgpt.com/*`

默认网站可以编辑或删除。也可以在设置页添加其他 HTTP/HTTPS 大模型网站，并配置聊天输入框选择器。

扩展只负责写入输入框，**不会自动点击发送**。

## 安装

1. 打开 Chrome 的 `chrome://extensions/` 或 Edge 的 `edge://extensions/`。
2. 开启“开发者模式”，点击“加载已解压的扩展程序”。
3. 选择包含 `manifest.json` 的仓库根目录。
4. 建议把扩展固定到浏览器工具栏。

扩展更新后，需要在扩展管理页面重新加载扩展，并刷新已经打开的目标网站。

## 配置管理

点击扩展弹窗右上角的设置按钮，或在扩展详情页中打开“扩展程序选项”。设置页支持：

- 添加一个或多个 `.md`、`.txt` 文件。
- 直接创建和编辑文本规范。
- 为每条配置设置名称、启用状态、顺序和适用网站。
- 为每条配置设置独立的开头标记和结尾标记；留空时恢复默认标记。
- 选择插入输入框首行或末尾。
- 录制页面快捷键，例如 `Ctrl+Shift+1`。
- 导入或导出完整 JSON 配置。

“网站管理”支持添加、编辑、复制和删除网站，配置多条有优先级的 CSS 选择器，开启通用输入框自动识别，并在已打开的目标网站中测试和高亮匹配元素。DeepSeek、豆包、千问和 ChatGPT 的只读参考模板会永久保留，删除默认网站后仍可从模板重新添加。

文件配置会优先读取磁盘最新正文，并保留一份未编辑的来源快照。文件被移动、删除、权限失效或配置来自 JSON 时，“重新读取”会恢复来源快照；也可以在设置页关联本地文件以重新读取磁盘最新内容。

## 插入配置

打开任意已添加且已授权的网站后，点击扩展图标：

1. 弹窗只显示已启用且适用于当前网站的配置。
2. 点击某条配置右侧的“插入”可以单独写入。
3. 点击“全部插入”会按设置页顺序写入当前网站全部有效配置。

新安装默认可以使用原生扩展快捷键 `Ctrl+I` 执行“全部插入”。浏览器若没有采用该快捷键，可在以下页面修改：

- Chrome：`chrome://extensions/shortcuts`
- Edge：`edge://extensions/shortcuts`

每条配置的动态快捷键由扩展设置页录制，只在受支持的聊天页面获得焦点时生效。快捷键至少需要包含 `Ctrl`、`Alt` 或 `Meta`，并且不能与适用网站范围重叠的其他配置或浏览器扩展命令冲突。部分浏览器或操作系统保留快捷键不会传递给网页，需要改用其他组合键。

## 插入和替换规则

每条配置都有独立 UUID 标记。第一次触发会根据配置写入输入框首部或末尾，并用空行与原有草稿分隔。

再次触发同一条配置时，扩展会替换旧内容并按照当前插入位置重新定位，不会重复叠加，也不会修改其他配置块。执行“全部插入”时，首部和末尾配置都会保持设置页中的顺序。

旧版的“全局规范”会自动迁移为适用于全部网站的文件配置；网站专属规范会迁移为对应网站的配置。旧 IndexedDB 记录会保留，迁移标记可避免重复创建条目。

## JSON 备份

导出的 JSON 使用固定格式：

```json
{
  "format": "agent-prompt-webchat-loader",
  "schemaVersion": 3,
  "exportedAt": "2026-07-22 15:30:45",
  "profiles": [
    {
      "content": "使用中文。",
      "createdAt": "2026-07-22 15:20:00",
      "enabled": true,
      "endMarker": "<<<请你严格遵循给定的规范:END>>>",
      "fileName": "",
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "通用规范",
      "order": 0,
      "placement": "prepend",
      "shortcut": null,
      "sites": ["*"],
      "sourceType": "text",
      "startMarker": "<<<请你严格遵循给定的规范:START>>>",
      "updatedAt": "2026-07-22 15:30:00"
    }
  ],
  "sites": [
    {
      "autoDetect": true,
      "createdAt": "2026-07-22 15:20:00",
      "editorSelectors": ["#prompt-textarea[contenteditable='true']"],
      "id": "10000000-0000-4000-8000-000000000004",
      "name": "ChatGPT",
      "origin": "https://chatgpt.com",
      "updatedAt": "2026-07-22 15:30:00"
    }
  ]
}
```

备份包含规范配置以及实际使用的网站名称、origin、选择器和自动识别状态。只读参考模板不重复写入备份。浏览器文件句柄、网站授权状态、最后导入记录及任何聊天内容不会导出。

`exportedAt`、`createdAt` 和 `updatedAt` 均使用浏览器本地时间，格式固定为 `YYYY-MM-DD HH:mm:ss`，字符串不携带时区偏移量。备份格式当前为 `schemaVersion: 3`，并兼容导入 `schemaVersion: 2` 的旧版 JSON。

导入时会先完整校验版本、配置及网站 ID、标记、时间、网站引用、选择器、插入位置和快捷键冲突。校验通过并确认后才会整体替换现有配置；解析或校验失败不会修改已有数据。导入的自定义网站需要在网站管理中主动授权。

## 隐私说明

- 配置正文和文件句柄保存在扩展专属 IndexedDB 中。
- 动态快捷键索引保存在 `chrome.storage.local` 中，不包含规范正文。
- 扩展不会把配置上传到外部服务器。
- 只有用户点击按钮或触发快捷键时，扩展才会写入当前聊天输入框。
- 扩展不会自动发送消息。

当用户手动发送后，输入框内容将按照目标网站自身的隐私政策发送给对应服务商。

## 项目结构

```text
assets/icons/ 扩展图标
background/   配置读取、文件刷新和导入编排
content/      网站编辑器探测、动态快捷键和文本写入
lib/          配置模型、IndexedDB 存储和内容块合并
options/      独立配置管理页
popup/        当前网站快速插入弹窗
tests/        无第三方依赖的确定性 Node.js 测试
manifest.json Manifest V3 配置
```

## 站点适配

普通网站可以直接在设置页添加，无需修改扩展代码。选择器应优先使用稳定的 `data-*` 属性、`role="textbox"`、`contenteditable="true"` 或稳定 `placeholder`，并保证只匹配一个可见编辑器。

维护参考模板时，只修改 `lib/site-model.js` 中的集中模板数据。模板更新不会覆盖用户已保存的网站配置。当前实现不能直接访问跨域 iframe 或封闭 Shadow DOM 内的编辑器。

## 开发检查

项目没有构建步骤和第三方依赖。运行确定性测试：

```powershell
node tests/instruction-block.test.js
node tests/site-model.test.js
node tests/profile-model.test.js
node tests/profile-store.test.js
```

浏览器改动需要在 DeepSeek、豆包、千问、ChatGPT 和至少一个自定义网站中人工检查：权限申请、选择器测试、文件刷新与缓存回退、文本配置、单条和全部插入、首尾位置、重复替换、页面快捷键、原生 `Ctrl+I` 以及 JSON 导入导出。每次检查都应确认扩展不会自动发送消息。
