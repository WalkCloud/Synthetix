# 两阶段大纲生成架构设计方案 (Two-Stage Outline Generation Design)

本方案设计旨在优化头脑风暴大纲生成流程，解决由于 JSON 庞大导致 LLM 输出 Token 过多、生成效率低下以及质量校验失败引发频繁重试的问题。

---

## 1. 痛点分析与设计背景

### 1.1 现状与瓶颈
目前的大纲生成流程（[outline-worker.ts](file:///E:/project01/src/lib/queue/workers/outline-worker.ts)）是一次性（Monolithic）让模型生成完整且包含所有细节字段的 JSON：
- **Token 数量膨胀**：生成 15-30 个节点，每个节点均包含 `title`、`description`、`keyPoints`、`writingRequirements`、`retrievalQuery`、`referenceHints` 等。这使得生成结果常达 6,000 ~ 10,000 词，平均耗时达 **60～120 秒**。
- **重试惩罚极其严重**：若质量校验（[outline-quality.ts](file:///E:/project01/src/lib/brainstorm/outline-quality.ts)）失败，会携带反馈**全量重新生成**，耗时成倍增加，甚至引发网关超时。
- **模型关注度分散**：模型同时进行“结构规划”与“细节填充”，在长输出压力下容易产生幻觉或直接削减章节深度，导致生成的大纲质量下滑。

### 1.2 优化思路
将大纲生成拆解为**“结构规划 (Stage 1)”**与**“并发细节填充 (Stage 2)”**两个阶段：
1. **Stage 1 (骨架生成)**：仅生成 `num`、`title`、`description`、`estimatedWords`，并执行质量校验。体积小（~500 tokens），生成极快（5-8秒），重试成本极低。
2. **Stage 2 (细节填充)**：将骨架按一级章节进行拆分，并发调用 LLM API 进行 `keyPoints`、`writingRequirements`、`retrievalQuery` 等细节字段的填充，最后合并保存。

---

## 2. 总体架构设计

```
                       +-------------------------+
                       |   Brainstorm Session    |
                       +------------+------------+
                                    |
                                    v
                       +------------+------------+
                       | Phase A: Conversation   | (1 LLM Call, 5-8s)
                       |          Summary        |
                       +------------+------------+
                                    | (Summary JSON)
                                    v
+-----------------------------------+-----------------------------------+
|                           STAGE 1: PLANNING                           |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
                       +------------+------------+
                       |  Generate Outline       | (1 LLM Stream, 5-8s)
                       |  Skeleton (No details)  |
                       +------------+------------+
                                    |
                                    v
                       +------------+------------+
                       |   evaluateOutlineQuality| (Fast Validation)
                       +------------+------------+
                                    |
                    +---------------+---------------+
                    |                               |
                    v (Failed)                      v (Passed)
        +-----------+-----------+                   |
        |  Quick Retry Skeleton |                   |
        +-----------------------+                   |
                                                    v
+---------------------------------------------------+-------------------+
|                          STAGE 2: EXECUTION                           |
+---------------------------------------------------+-------------------+
                                                    |
         +------------------+------------------+----+------------------+
         |                  |                  |                       |
         v                  v                  v                       v
  +------+------+    +------+------+    +------+------+         +------+------+
  | Enrich      |    | Enrich      |    | Enrich      |  ...    | Enrich      | (Parallel API Calls, 5-10s)
  | Chapter 1   |    | Chapter 2   |    | Chapter 3   |         | Chapter N   |
  +------+------+    +------+------+    +------+------+         +------+------+
         |                  |                  |                       |
         +------------------+------------------+----+------------------+
                                    | (Merge JSON Branches)
                                    v
                       +------------+------------+
                       |  Construct Final Outline| (Standard Output Format)
                       +------------+------------+
                                    |
                                    v
                       +------------+------------+
                       |  Phase C: DB Write & UI | (Compatible with current UI)
                       +-------------------------+
```

---

## 3. 详细设计与核心代码适配

### 3.1 兼容性声明
合并后的最终大纲 JSON 格式与现有数据库 Schema（`Session.outline`）和前端组件 [edit-outline-node.tsx](file:///E:/project01/src/components/brainstorm/edit-outline-node.tsx) **完全兼容**。无需任何前端修改或数据库迁移。

---

### 3.2 第一阶段：轻量骨架 Prompt (Stage 1 Skeleton)
大纲 Prompt 构建函数（[outline-prompt.ts](file:///E:/project01/src/lib/brainstorm/outline-prompt.ts)）需要进行重构或新增：

#### 骨架 Prompt 模板 (以中文为例)
```markdown
根据需求摘要生成文档大纲结构（骨架）。

## 输出指令
1. 仅输出大纲的层次结构、章节编号、标题和一句话概括描述。
2. 目标大纲规格：2-3层级深度，4-8个一级章节，共15-30个叶子章节。
3. 请不要输出 keyPoints, writingRequirements, retrievalQuery 和 referenceHints 字段。
4. 编号必须体现层级："1", "1.1", "1.1.1" 等。

## 输出 JSON 格式 (严格输出 JSON，不要添加其他文字)：
{
  "title": "文档标题",
  "documentType": "主原型+次原型",
  "sections": [
    {
      "num": "1",
      "title": "一级章节名称",
      "description": "章节概括描述，字数在15-30字以内",
      "estimatedWords": 1500,
      "children": [
        { 
          "num": "1.1", 
          "title": "二级子章节名称", 
          "description": "二级章节描述", 
          "estimatedWords": 500,
          "children": []
        }
      ]
    }
  ]
}
```

---

### 3.3 第二阶段：并发填充 Prompt (Stage 2 Enrichment)
将大纲拆分成以“一级章节”为根的树分支，分别发送给模型：

#### 细节填充 Prompt 模板 (中文为例)
```markdown
你是一个专业的文档编写分析师。请为下面给定的大纲章节分支补充详细的写作指导、检索提示和核心要点。

## 整体文档背景与需求摘要:
{fullRequirementsText}

## 待填充的大纲章节分支:
{chapterJsonBranch}

## 输入指令
请对该分支中的每一个叶子节点（即没有 children 或 children 为空的节点）补充以下字段：
1. "keyPoints": [字符串数组，2-4个核心写作要点]
2. "writingRequirements": "写作指令，说明覆盖范围、论述角度、章节边界和风格要求"
3. "retrievalQuery": "知识库检索查询语句"
4. "referenceHints": [参考框架、规范或实体]

## 输出要求
保持原分支结构和已有字段（num, title, description, estimatedWords）不变，仅对叶子节点进行上述字段的填充。

## 输出 JSON 格式 (仅返回补充完整后的 JSON 分支，结构与输入完全相同)
```

---

### 3.4 队列 Worker (outline-worker.ts) 重构伪代码

我们将在 [outline-worker.ts](file:///E:/project01/src/lib/queue/workers/outline-worker.ts) 中重构核心逻辑。

```typescript
export async function generateOutline(
  payload: TaskPayload,
  onProgress: (progress: number) => void
): Promise<TaskResult> {
  const { sessionId, userId, locale } = payload;

  // 1. 会话摘要提取 (Phase A)
  onProgress(15);
  const summaryResult = await summarizeConversation(provider, modelId, docLocale, conversation);
  const summary = summaryResult.summary;
  onProgress(30);

  // 2. Stage 1: 生成骨架结构
  const skeletonPrompt = buildSkeletonOutlinePrompt(summary.archetype, docLocale);
  let skeleton = await generateSkeletonFromPrompt(skeletonPrompt, userMessage);

  // 执行大纲骨架质量评估 (evaluateOutlineQuality 只需评估结构，无需关心细节)
  let quality = evaluateOutlineQuality(skeleton, { lengthHint: summary.constraints?.lengthHint });
  if (!quality.ok) {
    const feedback = `生成的大纲骨架未达标。问题: ${quality.issues.join("; ")}。请重新设计结构。`;
    skeleton = await generateSkeletonFromPrompt(skeletonPrompt, `${userMessage}\n\n${feedback}`);
  }
  onProgress(55);

  // 3. Stage 2: 并发填充细节字段
  // 3.1 获取所有一级章节
  const chapters = skeleton.sections;
  
  // 3.2 限制并发数（避免瞬间触发模型厂商 Rate Limit，一般限制为 3-5 个并发）
  const enrichedChapters = await Promise.all(
    chapters.map(async (chapter, index) => {
      const enrichmentPrompt = buildEnrichmentPrompt(
        JSON.stringify(chapter, null, 2),
        userMessage,
        docLocale
      );
      // 调用 LLM 填充细节
      const enrichedChapter = await callLLMEnrichment(enrichmentPrompt);
      
      // 更新并发进度
      const stepProgress = 55 + Math.floor(((index + 1) / chapters.length) * 35);
      onProgress(Math.min(stepProgress, 90));
      
      return enrichedChapter;
    })
  );

  onProgress(92);

  // 4. 合并组装大纲
  const finalOutline = {
    title: skeleton.title,
    documentType: skeleton.documentType,
    sections: enrichedChapters
  };

  // 5. 写入数据库与后续流程 (Phase C)
  await db.brainstormSession.update({
    where: { id: sessionId },
    data: { outline: JSON.stringify(finalOutline), title: finalOutline.title || session.title },
  });
  
  onProgress(100);
  return { outline: finalOutline, title: finalOutline.title };
}
```

---

## 4. 效益与风险评估

### 4.1 核心效益 (Expected Benefits)
- **耗时减幅约 80%**：骨架生成仅需 5-8 秒。Stage 2 并发填充同样在 8-10 秒内完成。整体耗时将降至 **15～20 秒**。
- **重试成本骤减**：骨架阶段体积小，若不合格，重试反馈生成只需 5 秒。且避免了长 JSON 在填充细节时因内容错位导致格式损坏的重试。
- **质量显著提升**：大模型由于上下文分阶段聚焦，其微观写作指导（`writingRequirements`）及宏观骨架（`skeleton`）的质量都将达到最优解。

### 4.2 潜在风险与应对预案 (Risks & Mitigations)
- **并发调用 Rate Limit（速率限制）**
  - *风险*：如果大纲有 8 个一级章节，瞬间发送 8 个 LLM 请求可能触发 API 限流。
  - *应对*：在 [outline-worker.ts](file:///E:/project01/src/lib/queue/workers/outline-worker.ts) 中引入限流控制（如使用 P-Limit，控制最大并发数 `concurrency: 3`），兼顾速度与稳定性。
- **章节上下文丢失**
  - *风险*：在 Stage 2 为某单一章节填充时，LLM 可能会遗漏其他章节的信息，导致段落间内容出现重合或割裂。
  - *应对*：在 Stage 2 的输入中，除了包含全量需求上下文，还提供完整的大纲骨架列表（Skeleton List），让 LLM 明确自身所在的具体章节位置及与其他章节的关系。
