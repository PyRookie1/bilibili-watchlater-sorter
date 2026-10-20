# B站稍后再看排序

Chrome / Edge Manifest V3 浏览器扩展，将 **「扩展排序」下拉框嵌入 B 站稍后再看原生列表**，放在页面顶部「最近添加／最早添加」旁边，直接调整原有视频卡片的**显示顺序**，不再打开独立弹窗。

适配用户截图中的地址：

- https://www.bilibili.com/watchlater/list#/list
- https://www.bilibili.com/watchlater/#/list
- https://www.bilibili.com/list/watchlater

## 排序选项

- B站默认顺序（恢复页面原有排列）
- 发布时间：最新优先
- 发布时间：最早优先
- 总时长：短到长
- 总时长：长到短

排序基于 B 站稍后再看接口返回的 `pubdate`（视频发布时间，Unix 秒）与 `duration`（全部分 P 总时长，秒）。缺失或无法匹配元数据的视频在末尾显示，相同值维持原来相对顺序。排序选项使用 `chrome.storage.local` 保存。

## 安装

1. 打开 [GitHub 仓库](https://github.com/PyRookie1/bilibili-watchlater-sorter)，**Code → Download ZIP**，下载并解压。
2. 打开 `chrome://extensions`（Edge：`edge://extensions`），开启开发者模式，点击 **加载已解压的扩展程序**。
3. 选择包含 `manifest.json` 的项目根目录。安装过旧版时，先点击扩展的**刷新**按钮，再刷新 B 站页面。
4. 登录 B 站，打开 [稍后再看](https://www.bilibili.com/watchlater/list#/list)。
5. 在右上角 B 站「最近添加」旁边找到 **扩展排序** 下拉框。选择排序方式即可重排原有视频卡片；旁边的 ↻ 按钮用于刷新排序元数据。

若 B 站调整了原生排序控件的结构，扩展会在视频网格上方显示一行排序控件作为备用方案。

## 实现与安全边界

- 使用现有 `.watchlater-list-container` 容器和 `.video-card` 视频卡片，匹配卡片链接中的 BV 号与 API 数据。
- 通过 CSS `order` 属性调整网格/弹性布局中的**视觉显示位置**，**不调用 appendChild 重排 DOM 节点**，避免干扰 B 站对卡片的事件处理和界面更新。
- 使用 `MutationObserver` 处理页面动态加载、新增/删除卡片和 SPA 重新渲染；新卡片会自动应用当前的排序数据。
- 使用 B 站已有登录状态从 `https://api.bilibili.com/x/v2/history/toview` 获取列表，优先通过 MV3 后台请求，失败时通过页面上下文请求。无额外服务器，不读取用户 Cookie 内容，也不上传数据。
- 只保存排序模式，不持久化视频清单。
- B 站页面自身的搜索、筛选、批量管理、播放链接仍使用原生功能。

### 重要限制

1. **仅改变页面显示顺序**：不修改 B 站服务器的稍后再看排列，也不改变视频的自动连播队列。
2. **对当前已渲染的卡片生效**：如果 B 站采用懒加载或虚拟列表，未加载的卡片不会自动被创建。状态提示会显示「已排序已加载卡片 N / 列表共 M 项」，不能将这种情况理解为全量排序。
3. 如果 B 站更新 CSS 类名、修改网格布局、取消 BV 号链接或修改未公开接口，扩展需要进一步适配。
4. GitHub 单元测试无法替代真实 B 站登录态和 423 项列表的端到端测试。

## 开发与测试

Node.js 20+，无第三方依赖：

```bash
npm test
```

GitHub Actions 会在 push / pull request 后执行脚本语法检查与单元测试。目录结构：

```
manifest.json
src/
  background.js       # 稍后再看 API 读取
  page-bridge.js      # 页面上下文备用请求
  sort.js             # 稳定排序算法
  native-sort.js      # 卡片 BV 号解析、排序名次映射
  content.js          # 注入原生排序栏、应用 CSS order
  content.css         # 控件样式
test/
  sort.test.js
  native-sort.test.js
  background.test.js
.github/workflows/test.yml
```

## 隐私

仅申请 `storage` 和 `https://api.bilibili.com/*`，扩展脚本仅注入稍后再看页面。无遥测、无第三方服务。
