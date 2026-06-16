# Synthetix 文档编写功能设计分析

> 基于 v0.5.3.0 版本源码分析，未修改任何代码。

---

## 一、整体架构概览

Synthetix 是一个自托管的 AI 长文档写作工作台，核心工作流为：

```
上传参考资料 → 转换为 Markdown → 分块并索引到 RAG → 头脑风暴/对话 → 生成大纲 → 按章节逐节写作 → 模型对比 → 拟人化润色 → 导出
```

### 核心模块划分

| 模块 | 路径 | 职责 |
|------|------|------|
| 写作引擎 | `src/lib/writing/` | 上下文组装、内容生成、摘要、拟人化 |
| 语义搜索 | `src/lib/search/` | 语义检索（LightRAG 优先，直接向量回退） |
| RAG 客户端 | `src/lib/rag/` | 知识图谱管理（实体 CRUD、子图导出） |
| LLM 集成 | `src/lib/llm/` | 模型解析、Provider 适配、Token 计费 |
| 头脑风暴 API | `src/app/api/v1/brainstorm/` | 对话、大纲生成 |
| 草稿 API | `src/app/api/v1/drafts/` | 草稿 CRUD、章节生成/对比/确认/回滚/拟人化 |
| Python Worker | `workers/python/` | 文档转换、RAG 索引/查询/管理、导出 |

---

## 二、数据库模型设计

### 2.1 核心实体关系

```
User ──< Draft ──< Section ──< SectionVersion
                   │           └──< SectionReference
                   │
BrainstormSession ──< Message
         │
         └── outline (JSON)
```

### 2.2 Draft（草稿）

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | String | 文档标题 |
| `outline` | String (JSON) | 完整大纲结构（含递归 children） |
| `status` | String | `drafting` → `assembling` → `completed` |
| `sessionId` | String? | 关联的头脑风暴会话 |

### 2.3 Section（章节）

| 字段 | 类型 | 说明 |
|------|------|------|
| `parentId` | String? | 父章节 ID（支持 N 级嵌套） |
| `index` | Int | 全局排序索引 |
| `title` | String | 章节标题 |
| `keyPoints` | String? | JSON 数组，需要覆盖的要点 |
| `estimatedWords` | Int? | 目标字数 |
| `status` | String | 章节生命周期状态（见下文） |
| `content` | String? | 最终选定的内容 |
| `summary` | String? | AI 生成的摘要（用于上下文传递） |
| `contentA` / `contentB` | String? | 模型 A/B 对比的内容 |
| `modelA` / `modelB` | String? | 对比使用的模型标识 |
| `constraints` | String? | 用户自定义约束 |

### 2.4 Section 状态机

```
pending → retrieving → generating → reviewing → locked → summarized
                    ↘ comparing → reviewing → locked → summarized
                    ↘ failed
```

| 状态 | 含义 |
|------|------|
| `pending` | 等待生成 |
| `retrieving` | 正在检索 RAG 上下文 |
| `generating` | 正在生成内容 |
| `comparing` | 正在进行 A/B 模型对比 |
| `reviewing` | 生成完成，等待用户审阅 |
| `locked` | 用户已确认，内容锁定 |
| `summarized` | 已生成摘要（后台异步） |
| `failed` | 生成失败 |

### 2.5 SectionVersion（版本快照）

每次用户确认章节时自动创建版本快照，记录来源（`generated_a`、`generated_b`、`edited`、`merged`），支持回滚到任意版本。

### 2.6 SectionReference（引用追踪）

记录每个章节引用了哪些文档/块，以及相关性分数，确保生成内容的可溯源。

---

## 三、知识库关联机制

### 3.1 文档入库流程

1. **上传** → 文件存储到 `data/uploads/`
2. **转换** → Python Worker (`convert.py`) 将 PDF/DOCX 等转为 Markdown
3. **分块** → 按 heading 路径、token 估算拆分为 `DocumentChunk`
4. **向量化** → 调用 Embedding 模型生成向量，存入 `document_chunks.embedding`
5. **RAG 索引** → Python Worker (`rag_index.py`) 将 chunks 推入 LightRAG，构建知识图谱

### 3.2 语义搜索（双路回退）

文件：`src/lib/search/semantic.ts`

**第一路：LightRAG 查询**（优先）
- 调用 `workers/python/rag_query.py`
- 支持 `hybrid`（混合）、`local`（局部）、`global`（全局）、`naive`（朴素）模式
- 返回 chunks + 实体 + 关系

**第二路：直接向量余弦相似度**（回退）
- 当 LightRAG 不可用时
- 用 Embedding 模型对 query 向量化
- 对数据库中所有 chunks 做余弦相似度排序
- 分数归一化到 0.7-1.0 范围

### 3.3 知识图谱管理

文件：`src/lib/rag/client.ts`

通过 `workers/python/rag_manage.py` 提供：
- 实体列表查询（按关键词）
- 实体详情（含子图）
- 实体创建/删除/合并
- 按文档删除 RAG 数据
- 子图导出

---

## 四、按章节生成内容的控制流程

### 4.1 大纲生成

文件：`src/app/api/v1/brainstorm/sessions/[id]/generate-outline/route.ts`

从头脑风暴对话中提取大纲，输出 JSON 结构：
```json
{
  "title": "文档标题",
  "sections": [
    {
      "num": "1",
      "title": "章节名",
      "keyPoints": ["要点1", "要点2"],
      "estimatedWords": 1500,
      "children": [
        { "num": "1.1", "title": "子章节", "keyPoints": [...], "estimatedWords": 500 }
      ]
    }
  ]
}
```

**规则**：3-8 个顶级章节，超过 800 字的章节拆分子章节，支持无限层级嵌套。

### 4.2 大纲到草稿的转换

文件：`src/app/api/v1/drafts/route.ts`

`flattenRecursive()` 将嵌套大纲递归展平为 `FlatSectionInput[]`，保持 `parentId` 关系，按深度优先顺序赋予全局 `index`。

### 4.3 单章节生成流程

文件：`src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`

```
1. 获取 draft 和 section 数据
2. 查询该 draft 下所有 status 为 "locked"/"summarized" 的已完成章节
3. 调用 generateSectionStream()：
   a. resolveDefaultWritingModel() — 解析写作模型
   b. fetchRagReferences() — 语义搜索获取最多 20 条 RAG 引用
   c. assembleContext() — 组装完整提示词（见下文）
   d. 流式调用 LLM
4. 删除该章节旧引用 → 写入新引用到 SectionReference
5. 章节状态：pending → retrieving → generating → reviewing
6. 记录 Token 用量
```

### 4.4 上下文组装（核心提示词构造）

文件：`src/lib/writing/context.ts` — `assembleContext()`

最终发送给 LLM 的消息由两部分组成：

#### System Message（系统提示词）

```
You are a professional academic and technical writer producing long-form, reference-traceable documents.

Writing guidelines:
- Write in a clear, professional, and authoritative tone.
- Support claims with specific references to the provided source material.
- When citing information from reference chunks, attribute it naturally in the text.
- Maintain logical flow and coherence with previously completed sections.
- Use precise language; avoid vagueness, hedging, or filler.
- Structure content with appropriate headings, paragraphs, and transitions.
- Do not fabricate references. Only cite material explicitly provided in the context.
- Produce output as plain text with Markdown formatting for structure.
- Match the estimated word count as closely as possible without sacrificing quality.

Anti-AI writing rules (produce human-quality output):
- Never use: delve, tapestry, realm, pivotal, foster, seamless, empower, robust, multifaceted, nuanced (as filler), leverage (as verb).
- Never use filler transitions: "it's worth noting", "importantly", "in conclusion", "to summarize", "navigating the landscape".
- Vary paragraph lengths — some should be 1-2 sentences, others longer. Break symmetry.
- Make direct claims. Do not hedge with "While it may seem..." or "It could be argued that..." before every point.
- Use specific numbers, names, dates, and examples — never "various methods" or "multiple approaches".
- Do not pad with 3-item lists when a single strong statement suffices.
- Write like a senior expert explaining to a colleague, not an encyclopedia.
```

#### User Message（用户消息）

按以下顺序组装：

1. **文档大纲摘要** (`buildOutlineSummary`)
   - 文档标题、描述
   - 从 outline JSON 解析出章节标题列表

2. **已完成章节摘要** (`buildCompletedSectionsSummary`)
   - 只包含 status 为 "completed" 且有 summary 的章节
   - 格式：`### 章节标题\n摘要内容`
   - **目的：让模型理解已写内容，保持连贯性**

3. **RAG 参考材料** (`buildRagReferencesSection`)
   - 按相关性分数降序排列
   - 格式：`### Reference N [Source: 文档名, Relevance: XX%]\n内容`
   - **目的：提供可引用的源材料**

4. **目标章节** (`buildTargetSectionBlock`)
   - 标题、描述、要点（keyPoints）、目标字数

5. **额外约束** (`buildConstraintsBlock`)
   - 字数限制
   - 优先参考的章节
   - 用户自定义要求

6. **结尾指令**
   - "Write the complete content for the target section now. Follow all guidelines from the system instructions."

---

## 五、所有提示词清单

### 5.1 头脑风暴对话提示词

**文件**：`src/lib/prompts/locales/*-prompts.ts`
**加载入口**：`src/lib/prompts/builders/facilitator.ts` 的 `buildFacilitatorPrompt()`

**原文**：
```
You are a top-tier Document Architect. Your goal is to help the user build a high-quality document outline.

Your job is to build the skeleton, not fill in the content! Do not let the user write specific content!

## Core Process (strictly follow)

### Phase 1: Understand Requirements (1-2 rounds of dialogue)
When the user first describes their idea, quickly gather the following key information (skip if already provided):
- Writing context: What is the purpose of this document? Who is the target audience?
- Core requirements: What topics or chapters must be covered? Any special requirements?
- Length expectations: Roughly how many words? Is it a report, white paper, thesis, or other format?

Note: Use brief, natural dialogue to gather info. Don't throw all questions at once! Respond to the user's idea first, then ask 1-2 targeted questions.
If the user uploaded a document, extract this information directly from the document content without asking.

### Phase 2: Generate Outline
Once you fully understand the requirements, provide an initial outline suggestion.
- Use Markdown lists for chapter titles and brief descriptions.
- At the end, ask: "Is this structure direction right? Do you want to add or remove any chapters, or should I generate the final outline?"

### Phase 3: Iterative Revision
The user will suggest modifications to your outline. Adjust based on their feedback and show the complete revised version again.

## Trigger Condition
When the workflow reaches a transition point, append the corresponding marker at the end of your reply, such as `NEEDS_GATHERED`, `DIRECTION_CONFIRMED`, `GENERATE_DIRECT`, `SECTION_BY_SECTION`, or `ALL_SECTIONS_CONFIRMED`.

If the user confirms the current outline, proceed to generation mode selection or final generation confirmation.

## Response Principles
- Keep each reply concise and clear, avoid lengthy responses
- Use chapter-level Markdown lists for the outline, do not expand into content
- Always reply in the SAME LANGUAGE as the user's input. If the user speaks Chinese, you MUST reply in Chinese. If English, reply in English. Maintain a professional and efficient tone.
```

**触发机制**：当 AI 回复包含 `GENERATE_DIRECT` 或 `ALL_SECTIONS_CONFIRMED` 标记时，前端自动触发大纲生成；其他 marker 用于切换头脑风暴阶段。

---

### 5.2 大纲生成提示词

**文件**：`src/app/api/v1/brainstorm/sessions/[id]/generate-outline/route.ts`
**入口**：`buildLightweightOutlinePrompt()`

**原文**：
```
Based on the conversation above, generate a complete document outline.

Requirements:
1. Extract the confirmed document structure, chapter divisions, and key points from the conversation
2. Each chapter must include specific keyPoints (2-4), cannot be empty
3. Reasonably estimate word count (estimatedWords) for each chapter based on content complexity
4. 3-8 top-level chapters total, flexibly adjusted based on content needs
5. Multi-level headings with unlimited depth: For chapters with substantial content, split into sub-sections (children). Sub-sections may themselves have children, forming a hierarchy of any depth (2, 3, 4+ levels). Use as many levels as needed to properly organize the content.
6. Num format reflects hierarchy: "1", "1.1", "1.1.1", "1.1.1.1", etc.
7. Generally, sections expected to exceed 800 words should be split into sub-sections
8. Leaf sections (deepest level) should each cover a coherent topic that can be written as a unit

Output format is JSON (strictly follow, do not add any other text):
{
  "title": "Document Title",
  "sections": [
    {
      "num": "1",
      "title": "Chapter Name",
      "keyPoints": ["Point 1", "Point 2"],
      "estimatedWords": 1500,
      "children": [...]
    }
  ]
}

Ensure the outline comprehensively covers all topics discussed in the conversation, with logical chapter ordering.
```

---

### 5.3 章节内容生成提示词

**文件**：`src/lib/writing/context.ts`
**函数**：`buildSystemMessage()` + `assembleContext()`

**System Message 原文**：
```
You are a professional academic and technical writer producing long-form, reference-traceable documents.

Writing guidelines:
- Write in a clear, professional, and authoritative tone.
- Support claims with specific references to the provided source material.
- When citing information from reference chunks, attribute it naturally in the text (e.g., "According to [Document Name]...").
- Maintain logical flow and coherence with previously completed sections.
- Use precise language; avoid vagueness, hedging, or filler.
- Structure content with appropriate headings, paragraphs, and transitions.
- Do not fabricate references. Only cite material explicitly provided in the context.
- Produce output as plain text with Markdown formatting for structure.
- Match the estimated word count as closely as possible without sacrificing quality.

Anti-AI writing rules (produce human-quality output):
- Never use: delve, tapestry, realm, pivotal, foster, seamless, empower, robust, multifaceted, nuanced (as filler), leverage (as verb).
- Never use filler transitions: "it's worth noting", "importantly", "in conclusion", "to summarize", "navigating the landscape".
- Vary paragraph lengths — some should be 1-2 sentences, others longer. Break symmetry.
- Make direct claims. Do not hedge with "While it may seem..." or "It could be argued that..." before every point.
- Use specific numbers, names, dates, and examples — never "various methods" or "multiple approaches".
- Do not pad with 3-item lists when a single strong statement suffices.
- Write like a senior expert explaining to a colleague, not an encyclopedia.
```

**User Message 模板**（动态组装）：
```
Document: "文档标题"
Description: 文档描述
Outline:
  1. 第一章标题
  2. 第二章标题
  ...

## Previously Completed Sections (for continuity)

### 已完成章节A
该章节的摘要内容...

## Reference Material

### Reference 1 [Source: 源文档名, Relevance: 92%]
引用块内容...

## Target Section to Write

Title: 当前章节标题
Description: 章节描述
Key Points to Cover:
- 要点1
- 要点2
Target Word Count: approximately 500 words

## Additional Constraints
Word Limit: Do not exceed 600 words.
Requirements: 用户自定义要求

Write the complete content for the target section now. Follow all guidelines from the system instructions.
```

**关键参数**：
- Temperature: `0.7`
- RAG 引用上限: `20` 条

---

### 5.4 章节摘要生成提示词

**文件**：`src/lib/writing/summarizer.ts`
**函数**：`buildSummaryMessages()`

**System Message 原文**：
```
You are a precise summarizer. Your task is to produce a compressed summary of a document section.

Requirements:
- Maximum 150 words.
- Capture the key arguments, findings, or narrative points.
- Preserve factual accuracy. Do not add information not present in the source.
- Write in third person, present tense.
- Output plain text without markdown formatting.
```

**User Message**：
```
Summarize the following section titled "章节标题":

章节完整内容...
```

**关键参数**：
- Temperature: `0.3`
- Max Tokens: `300`

**触发时机**：用户确认章节后异步生成（`confirm/route.ts` → `generateSummaryBackground()`），摘要存入 `section.summary`，供后续章节上下文使用。

---

### 5.5 拟人化（Humanizer）提示词

**文件**：`src/lib/writing/humanizer.ts`

拟人化采用**两轮处理**：审计 → 重写。

#### Pass 1：审计提示词 (`AUDIT_PROMPT`)

```
You are an expert editor detecting AI-generated writing patterns. Analyze the text below and identify which of these 29 patterns appear:

**Content Patterns:**
1. Hedging language ("it's worth noting", "it's important to consider", "importantly")
2. Laundry-list structure (numbered lists replacing narrative flow)
3. Generic examples instead of specific ones
4. "In conclusion" / "In summary" / "To summarize" mechanical wrap-ups
5. Symmetrical paragraph lengths throughout
6. Safe, balanced takes that avoid commitment

**Language/Grammar Patterns:**
7. "Delve" / "delves"
8. "Tapestry" / "rich tapestry" / "intricate tapestry"
9. "Navigating [abstract concept]"
10. "Realm" / "realm of"
11. "Pivotal" / "paramount" / "crucial" overuse
12. "Foster" / "fostered" / "fostering"
13. "Underscores" / "highlights" / "emphasizes" repeated
14. "Leverage" used as verb for everything
15. "Multifaceted" / "nuanced" / "comprehensive"
16. "Seamless" / "seamlessly"
17. "Empower" / "empowering"
18. "Innovative" / "cutting-edge" / "groundbreaking"
19. "Robust" / "scalable" / "dynamic"

**Style Patterns:**
20. Every paragraph starts with a topic sentence
21. Transition sentences between every paragraph
22. Lists of exactly 3 items everywhere
23. Definitions followed by examples in the same rigid pattern
24. No voice — reads like an encyclopedia entry
25. Perfect grammar with zero personality

**Communication Patterns:**
26. Over-explaining obvious concepts
27. Restating the same point with different words
28. Apologizing or hedging before making a point
29. Ending with a call-to-action or inspirational note

For each pattern found, quote the specific text and explain why it feels AI-generated. Be thorough.

Output format:
## Detected Patterns
For each found pattern:
- **Pattern [number]: [name]** — Quote: "..." — Why: [explanation]

## Summary
Overall AI feel: [Low/Medium/High]
Top 3 patterns to fix: [list]
```

#### Pass 2：重写提示词 (`REWRITE_PROMPT`)

```
You are an expert human writer. Rewrite the following text to eliminate all AI-generated patterns identified in the audit.

## Writing Rules
- Write like a real person who knows their subject deeply
- Have opinions — don't hedge every statement
- Vary sentence and paragraph length dramatically
- Use concrete details, specific examples, real numbers
- Drop filler words and get to the point
- Let some sentences be short. Even one word.
- Use the active voice aggressively
- Break patterns — if three paragraphs are similar length, make one a single line
- Reference specific tools, dates, people, places — not "various methods"
- Maintain all factual content and technical accuracy from the original
- Preserve all citations and references from source material
- Keep the same language (Chinese/English) as the original

## Tone
- Authoritative but conversational
- Like a senior expert explaining to a colleague, not a textbook
- Direct statements over qualifications
- Specific details over generalizations

## Anti-Pattern Checklist
Before finalizing, verify NONE of these remain:
- "delve", "tapestry", "realm", "pivotal", "foster", "seamless", "empower", "robust", "multifaceted"
- "it's worth noting", "importantly", "in conclusion"
- Every paragraph starting with a topic sentence
- Lists of exactly 3 items
- Hedging before every claim
- Symmetrical paragraph lengths

Produce the rewritten text only — no meta-commentary, no explanations of what you changed.
```

**关键参数**：
- Temperature: `0.75`（两轮均相同）

---

## 六、完整写作流程时序图

```
用户上传文档 → 文档分块 → 向量化 → RAG索引
                                    ↓
用户创建头脑风暴会话 ←→ localized facilitator prompt 对话（Phase 1-3）
                                    ↓
                        触发 GENERATE_DIRECT / ALL_SECTIONS_CONFIRMED
                                    ↓
                    buildLightweightOutlinePrompt() 生成 JSON 大纲
                                    ↓
                    大纲展平 → 创建 Draft + Section 记录
                                    ↓
            ┌───── 对每个 Section 循环 ─────┐
            ↓                                ↓
    fetchRagReferences()          semanticSearch() 查知识库
            ↓                                ↓
    assembleContext()    ← system + user prompt 组装
            ↓
    LLM 流式生成 (temperature=0.7)
            ↓
    用户审阅 → 满意？
         ↓ 是          ↓ 否
    confirm()       编辑/回滚/重新生成
         ↓
    异步生成 summary (temperature=0.3)
    供后续章节上下文使用
            ↓
    ─────── 下一个 Section ───────
                                    ↓
                所有章节完成 → assemble 拼接
                                    ↓
                    export (md/pdf/docx)
```

---

## 七、关键设计要点总结

### 7.1 上下文传递机制

- 每个章节确认后**异步生成摘要**（150 字以内，temperature 0.3）
- 后续章节生成时，已完成章节的摘要作为 `Previously Completed Sections` 传入
- 这确保了长文档的**章节间连贯性**

### 7.2 知识库检索策略

- 查询由 `draft.title + section.title + section.description` 组合
- 优先使用 LightRAG（hybrid 模式），回退到直接向量余弦相似度
- 最多取 20 条引用，按相关性降序传给 LLM
- 引用记录持久化到 `SectionReference`，支持拓扑可视化

### 7.3 章节状态流转

- 严格的单向状态机：`pending → retrieving → generating → reviewing → locked`
- 确认后自动异步生成摘要，状态变为 `locked`/`summarized`
- 只有 `locked`/`summarized` 的章节才参与后续章节的上下文

### 7.4 版本控制

- 每次确认自动创建版本快照
- 支持 A/B 模型对比（`contentA`/`contentB`）
- 支持回滚到任意历史版本

### 7.5 拟人化

- 两轮处理：审计（检测 29 种 AI 模式） → 重写（消除模式）
- 审计结果作为重写的上下文输入
- 基于 Humanizer 开源项目的模式库
