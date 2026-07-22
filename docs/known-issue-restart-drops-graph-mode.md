# 已知风险：处理中途退出重启会丢失"完整分析"模式

> 文档状态：**已记录，待后续版本修复**（不在当前迭代改码）
> 发现日期：2026-07-21
> 影响版本：当前 `main`（截至 v1.0.5）
> 严重程度：中（功能不影响基础使用，但知识图谱会静默缺失）
> 用户可规避：是（见第 6 节）

---

## 1. 现象

用户上传文档时选择了"完整分析"（`KnowledgeMode = "full"`，对应 `indexMode: "graph"`），但如果在文档处理过程中退出程序（或 `npm run dev` 热重载 / 手动重启），下次程序重新启动后：

- 文档最终状态显示 **`ready`**，看起来一切正常；
- 但**知识图谱页（`/search` → 知识图谱标签页）显示"暂无拓扑数据"**；
- 基础检索、Wiki 提炼仍正常工作，唯独**实体/关系图谱从未抽取**。

用户重新手工上传并选择"完整分析"可正常生成图谱 —— 说明选项机制本身是好的，问题出在"中途重启后恢复处理"这条边角路径。

---

## 2. 根因

崩溃恢复路径 `src/lib/queue/index.ts` 的 `recoverOrphanedPhaseOne`（第 131–159 行）在程序重启时扫描卡在 `queued` / `converting` / `splitting` 状态的文档并重新提交 `document_convert` 任务。它依赖 `resolveRecoveryOptions`（第 89–129 行）恢复用户原始的处理选项：

```ts
// src/lib/queue/index.ts:110-128
const latest = (await findTasksByResourceIdentity({ ... take: 1 }))[0];
if (latest?.inputData) {
  const parsed = JSON.parse(latest.inputData);
  if (parsed.options) {            // ← 致命缺陷：{} 是 truthy，空对象直接命中此分支
    return parsed.options;          // ← 返回空 options
  }
}
return {};                          // ← 或：找不到 prior task 时直接返回空
```

两个失效点：

1. **空对象穿透**：若 prior `document_convert` 任务的 `options` 是 `{}`（空对象，JavaScript 中为 truthy），第 121 行的 `if (parsed.options)` 判断**成立**，直接返回空 `{}`，而不会继续往前寻找真正的原始 options。
2. **无 prior task 时回退为空**：若用户上传后第一次处理还没来得及创建带 options 的任务，重启时根本查不到 prior task，直接走到第 128 行返回 `{}`。

恢复路径拿到空 `{}` 后，提交 `document_convert` 任务的 `input_data` 变成 `{"docId":"...","options":{}}`，沿整条链路传递：

| 环节 | 正常路径（前端 handleProcess） | 崩溃恢复路径（本风险） |
|------|------------------------------|----------------------|
| 触发点 | `src/app/(dashboard)/documents/page.tsx:195` reprocess | `src/lib/queue/index.ts:155` recoverOrphanedPhaseOne |
| options 来源 | `knowledgeModeToOptions("full")` → `{indexMode:"graph",...}` | `resolveRecoveryOptions` → `{}` |
| `document_convert.input_data` | `{"options":{"indexMode":"graph",...}}` | `{"options":{}}` |
| `shouldEnqueueGraphIndex` 判断 | `indexMode==="graph"` ✅ | `undefined==="graph"` ❌ false |
| `rag_index`（图谱抽取）任务 | 排队 ✅ | **从未排队** ❌ |
| 知识图谱数据 | 有 ✅ | 无 → "暂无拓扑数据" |

`shouldEnqueueGraphIndex` 在 `src/lib/queue/workers/index-mode-flags.ts:47-49`：

```ts
export function shouldEnqueueGraphIndex(options): boolean {
  return options.indexMode === "graph" && (options.indexTarget || "full") === "full";
}
```

它**要求 `indexMode` 显式等于 `"graph"`**，缺失则 false。而对比之下 `shouldEnqueueWikiSynthesis`（同文件第 61-63 行）在 `indexTarget` 缺失时默认 `"full"` —— 所以 wiki 能跑、图谱不能跑，这一不对称是本 bug 的决定性特征。

---

## 3. 诊断证据（2026-07-21 实测）

对当时 3 份状态 `ready` 但图谱为空的文档查任务库：

```
精通Transformer.pdf:   doc上传 04:38:44 → convert任务创建 04:41:41 (间隔 175 秒)
精益创业实战.epub:      doc上传 04:38:45 → convert任务创建 04:41:40 (间隔 175 秒)
云原生平台建设技术方案:  doc上传 04:38:46 → convert任务创建 04:41:41 (间隔 175 秒)

所有 document_convert 任务：
  input_data      = {"docId":"...","options":{}}   ← options 全空
  parent_task_id  = (none)                          ← 不是前端 handleProcess 触发
  三份创建时间戳相差 < 0.4 秒                         ← 批量同时创建，非用户逐个操作

任务分布：
  rag_embed_index  : 3 份完成 (index_mode 全是 "basic")
  wiki_synthesize  : 3 份完成                          ← 默认值能跑
  rag_index (图谱) : 0 份                              ← 从未排队（要求显式 graph）
```

"175 秒间隔"符合"上传 → 程序退出 → 重启 → 恢复扫描"的时间模式；"parent_task_id 为空 + 批量同时创建"符合 `recoverOrphanedPhaseOne` 的调用特征（前端 `handleProcess` 路径会逐个提交且带 `parentTaskId`）。

---

## 4. 影响范围

- **受影响场景**：任何在文档处理中途（`queued` / `converting` / `splitting` 状态）发生的程序退出 / 崩溃 / `npm run dev` 热重载 / 手动重启。
- **不受影响场景**：单次会话内上传→选择完整分析→等待处理完成，中途不重启。
- **功能影响**：知识图谱实体/关系数据缺失；基础语义检索、关键词检索、Wiki 提炼均正常（因基础索引 + FTS 已完成）。
- **无报错**：整个过程无任何错误日志或 UI 提示 —— 文档状态 `ready`，`conversion_warning` 为空。用户完全感知不到图谱没建。

---

## 5. 建议修复方向（后续版本）

候选方案，可组合：

1. **`resolveRecoveryOptions` 安全默认**（最小改动）：空 options 时回退到"完整分析"默认值（`{indexMode:"graph", indexTarget:"full", wikiEnabled:true}`），而非 `{}`。理由：图谱缺失的代价（重新上传/重新处理）远大于多跑一次抽取的 token 成本。修复点：`src/lib/queue/index.ts:121-128`。

2. **持久化用户选择到 document 行**（稳健长期方案）：上传时或点击"开始处理"时，把用户选择的 `KnowledgeMode` / `ProcessingOptions` 写入 `documents` 表（新增字段或复用现有 metadata 列），这样任何恢复路径都能读到，不依赖任务是否成功创建。修复点：`upload/route.ts` + `documents` schema。

3. **修正空对象穿透判断**：`resolveRecoveryOptions` 第 121 行的 `if (parsed.options)` 应改为 `if (parsed.options && Object.keys(parsed.options).length > 0)`，与 reprocess 路由的继承逻辑（`src/app/api/v1/documents/[id]/reprocess/route.ts:61`）保持一致。

4. **前端/恢复路径加可观测性**：当 `shouldEnqueueGraphIndex` 因 indexMode 缺失返回 false 时，若文档历史曾有 graph 意图，写一条 `conversion_warning` 提示用户"图谱未抽取，请重新处理"，避免静默失败。

推荐组合：**#3（必做，修正逻辑缺陷）+ #1（兜底安全默认）+ #2（根治，下一版本）**。

---

## 6. 用户规避方法（修复前）

在文档处理完成（状态变为 `ready`）之前：

- **不要手动重启 `npm run dev`**；
- **不要让编辑器触发热重载**（处理大文档时尤其注意）；
- 如果已经发生（图谱空白），**删除该文档重新上传**，或对该文档手动触发一次带 `indexMode:"graph"` 的重新处理。

---

## 7. 相关文件索引

- `src/lib/queue/index.ts:89-129` — `resolveRecoveryOptions`（根因所在）
- `src/lib/queue/index.ts:131-159` — `recoverOrphanedPhaseOne`（恢复入口）
- `src/lib/queue/workers/index-mode-flags.ts:47-49` — `shouldEnqueueGraphIndex`（图谱门控）
- `src/lib/queue/workers/index-mode-flags.ts:61-63` — `shouldEnqueueWikiSynthesis`（对照：默认值能跑）
- `src/app/api/v1/documents/[id]/reprocess/route.ts:43-67` — 正常路径的 options 继承逻辑（参考实现）
- `src/app/(dashboard)/documents/page.tsx:180-219` — 前端 `handleProcess`（正常路径，options 正确）
- `src/components/documents/processing-settings.tsx:51-69` — `knowledgeModeToOptions`（"完整分析"→`indexMode:"graph"` 映射）
