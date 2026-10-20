# B站稍后再看排序

Chrome / Edge 浏览器扩展，**在 B 站原生稍后再看页面直接排序原生视频卡片**。不使用独立弹窗或由扩展生成的第二套视频视图。

适用路径：

- https://www.bilibili.com/watchlater/list#/list
- https://www.bilibili.com/watchlater/#/list
- https://www.bilibili.com/list/watchlater

## v0.4.0：原生视图全量排序

在 B 站「最近添加／最早添加」附近增加一个「扩展排序」下拉框，支持：

- B站默认顺序
- 发布时间：最新优先 / 最早优先
- 视频总时长：短到长 / 长到短

**与 v0.3.0 的区别：** v0.3.0 会隐藏 B 站列表，生成一套扩展卡片。v0.4.0 已完全删除扩展卡片网格，只操作原网站已创建的原生视频卡片，保留原有封面、排版、视频点击、删除等交互。

### 全量排序的保障

1. 调用当前账号的 B 站稍后再看接口读取 `pubdate`、`duration` 和 BV 号。校验接口记录数、接口报告的总数以及能读取到的页面标题总数。
2. 根据**所有视频**的数据计算全局排序位置。
3. 检查 B 站原生页面中的视频卡片是否已经完整创建；如果未加载完全，则自动滚动触发网站自身的懒加载机制，完成后恢复原先的滚动位置。
4. 只有在原生卡片数和身份全部匹配时，才对原生 flex/grid 布局子项施加 CSS `order`。**不会移动、克隆或替换原来的 DOM 节点**。
5. 切回「B站默认顺序」时，恢复卡片先前的内联样式和 B 站原生展示顺序。

如果网站使用了**虚拟列表**（只在 DOM 中保留部分卡片并反复复用），或者部分视频无法与接口记录对应，就无法安全地给全部原生卡片排序。此时扩展会明确显示 `原生卡片未能全部加载或匹配`，保留原生顺序，**不会使用假的全量排序结果，也不会改成扩展视图**。

扩展自动加载时可能出现短暂的自动滚动；完成后恢复之前的滚动位置。用户滚轮或触摸操作可中断自动加载。

## 安装 / 更新

1. 打开 [GitHub 仓库](https://github.com/PyRookie1/bilibili-watchlater-sorter)，点击 **Code → Download ZIP** 并解压。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启开发者模式，点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。
4. 如果安装过旧版，把下载文件替换到原目录，然后在扩展管理页面点击**刷新扩展**。
5. 重新打开或刷新 [B站稍后再看](https://www.bilibili.com/watchlater/list#/list)，使用「扩展排序」下拉菜单。旁边的 ↻ 按钮会重新获取数据。

只有当状态显示 `原生列表已全量排序 423/423`（具体数字因账号而异）时，才表示**全局排序完成**。

## 说明

- 不改变 B 站服务器记录顺序，也不改变自动连播队列。
- 原生视频卡片、播放链接及删除按钮仍归 B 站原网页控制；扩展只设置卡片布局顺序。
- B 站自身的搜索、筛选和删除导致卡片数量变化时，可能需要点击 ↻ 重新获取数据。全量排序要求显示完整清单；筛选后的部分卡片不能作为完整清单排序。
- 使用非官方维护的 B 站稍后再看接口，接口、DOM 类名、懒加载逻辑变化时需要维护。
- **尚未使用真实登录的 B 站账号验证所有 423 个视频及各个交互**。自动化测试不能替代该验收。

## 开发和测试

Node.js 20+，无第三方运行依赖：

```bash
npm test
```

GitHub Actions 在 push 和 pull request 时执行语法检查及 Node 单元测试。

```
manifest.json
src/
  api.js                 # 获取完整接口数据和完整性校验
  background.js          # MV3 service worker
  page-bridge.js         # 页面上下文请求备用通道
  sort.js                # 发布时间、总时长排序
  native-sort.js         # BV/AV 识别与原生卡片排序位置
  content.js             # 原生排序控件、自动加载和 CSS order
  content.css            # 仅排序控件样式，无扩展视频网格
test/
  api.test.js
  background.test.js
  sort.test.js
  native-sort.test.js
  content.test.js
.github/workflows/test.yml
```

## 隐私

扩展仅申请 `storage` 和 `https://api.bilibili.com/*` 权限，使用 B 站已有登录状态，不读取 Cookie 值、不上传视频清单到第三方服务器，仅保存排序偏好。
