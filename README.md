# B站稍后再看排序

一个 Chrome / Edge Manifest V3 扩展，在 B 站原生「稍后再看」页面按发布时间或视频总时长排序。保留 B 站原有卡片、播放和管理交互，不使用独立视频视图。

## v0.6.0：针对 424 条数据的真正全量排序

已根据实际 Edge 页面诊断针对性调整：

- `/x/v2/history/toview/web` 接口会一次返回完整的 424 条记录。
- Vue 3.3.11 页面使用 Pinia `list` store；其中 `watchlaterList` 最初只有 20 条。
- 原生卡片对象包含 `title`、`cover`、`stats`、`author` 等 B 站加工后的字段，**不能直接把接口的原始视频 JSON 写入 `watchlaterList`**。
- Pinia store 自带 `loadMoreWatchlaterList` 方法，可以让 B 站自己创建缺少的卡片数据。

新版在选择扩展排序后：

1. 获取完整 API 数据，并校验 `count === list.length`。
2. 通过页面 Vue 应用注入的 Pinia，定位 `list` store。
3. **调用 B 站原有的 `loadMoreWatchlaterList` 来补齐原生 `watchlaterList`**，直到条数达到接口总数。整个过程不调用滚动 API。
4. 校验 424 条原生数据和 424 条接口记录的 BV/AV 号是否一一对应。
5. 根据完整 API 中的 `pubdate` 或 `duration` 对 **全部原生记录** 一次性排序，利用 Pinia `$patch` 重排原有列表，保留原生对象引用，并同步对齐 `checkedList`。
6. 如果原生分页方法未补齐所有项目或校验失败，显示明确错误，**不再把已渲染的 20 条排序称为全量排序**。

选择「B站默认顺序」时，在完整数据可用后根据接口顺序恢复全部记录。

### 与旧版本相比

- 不再使用 CSS `order` 对部分卡片冒充全量排序。
- 不再滚动屏幕触发懒加载。
- 不再注入独立卡片网格，也不使用非原生的视频数据模型。
- 无额外刷新按钮；只有一个排序下拉框，出错时才显示提示。
- 不修改账号服务器上的稍后再看顺序。

**性能说明：** 第一次从 20 条补齐到 424 条，可能需要 B 站自己的加载方法多次执行；这不是即时的原生排序。此过程中页面可能出现新卡片或加载变化，但不会由扩展滚动页面。以后已补齐时切换排序不需要再次逐批加载。

**兼容性说明：** v0.6.0 已通过模拟 Pinia 的完整 424 条加载与排序测试；仍未在真实登录的 Edge / B 站页面进行端到端验收。B 站更新内部 store、加载方法或筛选行为后可能需要进一步适配。

## 安装与更新

1. 在 [GitHub 仓库](https://github.com/PyRookie1/bilibili-watchlater-sorter) 点击 **Code → Download ZIP** 并解压。
2. 用最新文件覆盖已加载扩展的本地目录，或重新「加载已解压的扩展程序」。
3. 在 Edge 打开 `edge://extensions`，刷新扩展，再刷新 [稍后再看](https://www.bilibili.com/watchlater/list#/list)。
4. 使用「最近添加」附近新增的「排序」下拉框。

支持：**默认顺序、发布时间最新优先／最早优先、总时长短到长／长到短**。

如果出现「全量排序失败」，悬停错误文字可查看完整错误信息。此时扩展不会声称已经完成全量排序。

## 开发测试

要求 Node.js 20+：

```bash
npm test
```

- `src/full-native.js`：定位 Pinia `list` store，调用原生分页，校验并排序完整列表。
- `src/native-intercept.js`：MAIN world 中的完整排序消息桥。
- `src/content.js`：原生排序控件及完整 API 元数据读取。
- `src/api.js` / `src/background.js` / `src/page-bridge.js`：只读完整接口。
- `test/full-native.test.js`：模拟 20→424 条原生加载、原生对象引用与选中状态、默认顺序恢复、分页失败等。

## 隐私

扩展使用 B 站已有登录状态进行只读接口访问，不直接读取 Cookie 值，不把观看列表上传到第三方服务。排序选择只保存在本地。
