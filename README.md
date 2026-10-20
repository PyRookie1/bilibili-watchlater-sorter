# B站稍后再看排序

Chrome / Edge Manifest V3 浏览器扩展，为哔哩哔哩「稍后再看」提供一个**独立排序面板**，按视频发布时间及全部分 P 总时长排序。不会修改服务器列表和自动连播顺序。

## 功能

- 发布时间：最新优先、最早优先
- 视频总时长：短到长、长到短
- 恢复接口原始顺序，稳定排序（相同值维持原来的顺序）
- 缺失元数据排在最后
- 一次读取、浏览器本地排序；记住选项；支持手动刷新
- 无第三方依赖，不采集 Cookie，不上传视频清单

## 安装

1. 在仓库页面使用 **Code → Download ZIP**，解压；或运行 `git clone https://github.com/PyRookie1/bilibili-watchlater-sorter.git`。
2. 打开 Chrome 的 `chrome://extensions`（Edge：`edge://extensions`）。
3. 启用开发者模式，选择 **加载已解压的扩展程序**，选择含 `manifest.json` 的仓库根目录。
4. 登录 B 站，打开 [稍后再看](https://www.bilibili.com/list/watchlater)（也支持旧版 `/watchlater/list/`）。
5. 点击右下角「稍后再看排序」或浏览器工具栏扩展图标，选择排序方式。

## 工作原理

通过当前 B 站登录状态读取 `https://api.bilibili.com/x/v2/history/toview`，使用接口的 `pubdate`（发布时间 Unix 秒）、`duration`（所有分 P 的总秒数）排序。优先使用 MV3 service worker 请求；遇到跨站 Cookie 限制时尝试从 B 站页面上下文读取。请求失败时显示错误提示。列表数量与接口声明的数量不符时会提示可能未完全返回。

**限制：** 仅在扩展面板中排序，不重排 B 站原生卡片，也不调整自动连播队列。删除、批量操作等请在 B 站原生页面执行，然后点击「刷新列表」。接口属于非官方维护的接口，可能发生变更；尚未通过真实登录账号的端到端验证。

## 本地测试

Node.js 20+，无 npm 依赖：

```bash
npm test
```

GitHub Actions 在 push / pull request 时自动执行测试。

## 目录

```
manifest.json
src/
  background.js    # B站接口请求和扩展图标
  page-bridge.js   # 页面上下文备用请求
  sort.js          # 稳定排序和安全链接处理
  content.js       # 排序面板和交互
  content.css      # 页面样式
test/
  sort.test.js
  background.test.js
.github/workflows/test.yml
```

## 隐私

扩展仅申请 `storage` 和 `https://api.bilibili.com/*` 权限。存储内容仅为排序偏好，不保存视频列表；不读取或外传登录 Cookie，没有遥测服务。脚本仅注入 B 站稍后再看两个页面路径。

## 相关文档

- [第三方整理的 Bilibili API](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/historytoview/toview.md)
- [Chrome 内容脚本](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
