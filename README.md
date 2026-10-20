# B站稍后再看全量排序

Chrome / Edge Manifest V3 扩展，在 B 站「稍后再看」页面右上角原生排序菜单附近增加「扩展排序」。**获取完整视频清单后统一排序，生成包含所有视频的网格视图**，无需事先手动滚动页面加载卡片。

适用页面：

- https://www.bilibili.com/watchlater/list#/list
- https://www.bilibili.com/watchlater/#/list
- https://www.bilibili.com/list/watchlater

## v0.3.0：全量排序

支持「发布时间：最新优先／最早优先」「总时长：短到长／长到短」「B站默认顺序」。总时长使用接口提供的 `duration` 字段（所有分 P 总秒数）；发布时间使用 `pubdate`。

**工作流程：**

1. 通过当前 B 站登录状态请求 `/x/v2/history/toview`。
2. 检查接口 `count` 与 `list.length`；不一致时尝试 `/x/v2/history/toview/web?jsonp=jsonp`。
3. 如果能从 B 站页面标题识别总数，还会将接口结果与标题总数比较。例如标题显示 423，接口报告 100、返回 100，仍视为**不完整**并尝试备用接口。
4. 只有校验完整后才进行全局排序，并在原生页面视频区域旁构建包含**所有**条目的视频网格，封面使用 `loading="lazy"` 节省流量。
5. 「B站默认顺序」立即撤去扩展网格、恢复原生视频区域。排序不会修改服务器上的稍后再看顺序。

**若两个接口都不能取全，扩展会明确提示「无法读取完整稍后再看列表」并保留原生列表，不会提供虚假的全量排序。** 没有使用未经证实的分页参数重复请求同一个接口。

## 安装

1. 从 [GitHub 仓库](https://github.com/PyRookie1/bilibili-watchlater-sorter) 选择 **Code → Download ZIP**，解压。
2. 打开 `chrome://extensions`（Edge：`edge://extensions`）。
3. 开启「开发者模式」，选择「加载已解压的扩展程序」，选中包含 `manifest.json` 的目录。
4. 如果已安装旧版本，**先更新本地文件并点击扩展的刷新按钮**，再刷新 B 站稍后再看页面。
5. 登录 B 站，进入 [稍后再看](https://www.bilibili.com/watchlater/list#/list)，选择「扩展排序」。顶部状态会显示 `已全量排序 423/423` 之类的确认文字。
6. 点击下拉框旁 **↻** 重新读取数据，包括其他标签页新增／删除的视频。

## 交互行为与限制

- **扩展视图中的视频标题和封面可点击，在新标签页打开该视频**。其操作不依赖 B 站的原始卡片。
- **删除、批量操作、搜索、未看完筛选和自动连播只在 B 站原生视图中使用**。请切换到「B站默认顺序」后操作；不会修改原站播放器内部的连续播放队列。
- 不复制或移动 B 站原生 DOM 卡片，而是保留原生列表、临时隐藏它，显示扩展根据全部视频数据生成的独立网格。切换默认排序后恢复原生视图。
- 动态路由和页面重渲染由 `MutationObserver` 处理。列表信息只保存在当前页面内存里；刷新元数据后可同步其他页面上发生的修改。
- 采用未公开的 B 站接口。若其返回字段或登录策略发生变化，必须修改扩展。
- **尚未在用户的真实登录态、完整 423 条列表以及各项原生交互下进行端到端验证**；自动化测试不等同于实际网页验收。

## 开发

要求 Node.js 20+，不需要安装第三方运行依赖：

```bash
npm test
```

GitHub Actions 会对 push / pull request 执行脚本语法检查和 Node 单元测试。

```
manifest.json
src/
  api.js            # 校验总数、双接口尝试、标准化视频数据
  background.js     # 扩展后台请求、登录状态复用
  page-bridge.js    # 页面上下文备用请求
  sort.js           # 发布时间和视频总时长的稳定排序
  content.js        # 嵌入控件与渲染全量视频网格
  content.css       # 响应式网格和 B 站风格控件
test/
  api.test.js
  background.test.js
  sort.test.js
  content.test.js
.github/workflows/test.yml
```

## 隐私

仅申请 `storage` 和 `https://api.bilibili.com/*` 权限。仅保存排序偏好，不保存完整视频列表到浏览器存储，不主动读取登录 Cookie 值，不将数据传给第三方服务器，不收集遥测。

## 相关资料

- [社区维护的 Bilibili 稍后再看 API 文档](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/historytoview/toview.md)
- [Chrome MV3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
