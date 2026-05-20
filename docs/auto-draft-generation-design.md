# 自动全文生成设计

## 背景

当前写作流程是人工驱动的章节式生成：用户在头脑风暴中确认大纲后进入写作页，逐个章节触发生成，审核或修改后再确认章节。这个流程适合精修，但对于用户想先拿到完整初稿的场景，操作成本偏高。

新增能力的目标是在保留现有精修流程的基础上，提供一个“生成完整初稿”的快速模式：

- 大纲生成时为每个章节生成隐藏写作要求。
- 每个章节生成前按章节要求检索知识库参考资料。
- 每个章节独立调用一次 LLM。
- 后端按章节顺序串行生成，上一节完成后自动进入下一节。
- 生成结果保持待审核状态，不自动代表人工确认。

## 当前链路

核心链路如下：

1. `brainstorm/sessions/[id]/generate-outline` 根据对话生成大纲 JSON。
2. `POST /api/v1/drafts` 将大纲拍平成 `Draft` 和多条 `Section`。
3. `POST /api/v1/drafts/[id]/sections/[secId]/generate` 生成单个章节。
4. `generateSectionStream` 执行 RAG 检索并组装写作上下文。
5. `confirm` 将章节锁定，并异步生成摘要。

已有数据表已经足够承载自动全文生成：

- `Draft.outline` 保存完整原始大纲。
- `Section.description` 可保存章节定位。
- `Section.constraints` 可保存隐藏写作要求 JSON。
- `SectionReference` 可保存每章命中的参考资料。
- `AsyncTask` 可保存全文生成任务进度。

## 大纲结构扩展

大纲节点扩展为递归结构：

```ts
interface OutlineSection {
  num: string;
  title: string;
  description?: string;
  keyPoints?: string[];
  estimatedWords?: number;
  writingRequirements?: string;
  retrievalQuery?: string;
  referenceHints?: string[];
  children?: OutlineSection[];
}
```

字段用途：

- `description`：章节定位，可在页面展示。
- `writingRequirements`：隐藏写作要求，约束本章写作边界、重点和禁区。
- `retrievalQuery`：面向知识库检索优化的查询语句。
- `referenceHints`：辅助检索的关键词、实体、资料类型。

页面可以继续只展示标题、字数和必要要点，隐藏字段不需要在普通编辑界面呈现。

## 存储策略

不新增数据库字段，优先复用已有字段：

- `description` 写入 `Section.description`。
- `keyPoints` 写入 `Section.keyPoints`。
- `writingRequirements`、`retrievalQuery`、`referenceHints` 写入 `Section.constraints`。
- 原始完整大纲继续写入 `Draft.outline`。

这样可以避免迁移成本，并且允许旧草稿继续工作。

## RAG 检索策略

当前检索 query 主要来自文档标题、章节标题和章节描述。自动全文生成需要把 query 扩展为：

1. `constraints.retrievalQuery`
2. `section.title`
3. `section.description`
4. `section.keyPoints`
5. `constraints.writingRequirements`
6. `constraints.referenceHints`
7. `draft.title`

每个章节生成前执行一次独立检索，并将命中的参考保存到 `SectionReference`。

## 自动生成任务

新增 API：

```http
POST /api/v1/drafts/[id]/generate-all
```

请求体：

```json
{
  "overwrite": false,
  "stopOnError": true,
  "modelConfigId": "optional"
}
```

返回：

```json
{
  "taskId": "...",
  "status": "pending"
}
```

后端新增队列任务类型 `draft_generate_all`，worker 按 `Section.index` 串行处理章节。

## 章节状态策略

自动生成不自动确认章节，默认状态流转：

```text
pending/failed -> retrieving -> generating -> reviewing
```

生成完成后立即生成摘要并保存到 `Section.summary`，但章节仍保持 `reviewing`。这样下一章可以获得前文摘要，同时用户仍然可以人工审核、修改和确认。

人工确认仍使用现有 `confirm` 流程：

```text
reviewing -> locked
```

## 失败和恢复

默认策略：

- 遇到错误时当前章节设为 `failed`。
- 任务设为 `failed`。
- 已生成章节保留，不回滚。
- 用户再次点击“生成完整初稿”时默认跳过已有内容，只处理 `pending/failed`。

如果请求 `overwrite: true`，允许覆盖已有内容，但 UI 需要明确提示。

## 前端交互

写作详情页顶部增加“生成完整初稿”按钮。

按钮行为：

- 若没有运行中的全文任务，点击后创建任务。
- 若任务运行中，展示任务进度和当前状态。
- 通过 `/api/v1/tasks/[id]` 轮询进度。
- 任务结束后刷新草稿。

保留原有单章节生成、对比生成、人工确认和导出能力。

## 开发顺序

1. 扩展大纲类型和大纲生成 prompt。
2. 草稿创建时保存隐藏字段。
3. 增强 RAG 检索 query，并修复前文摘要连续性。
4. 抽出可复用的非 HTTP 章节生成服务。
5. 新增 `draft_generate_all` 队列任务和 API。
6. 写作页增加“生成完整初稿”入口和任务进度。
7. 运行 lint/build/test，修复类型和集成问题。
