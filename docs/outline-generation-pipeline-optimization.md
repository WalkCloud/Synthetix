# 大纲生成 Pipeline 优化方案

> 日期：2026-06-03
> 基于：代码全量分析 × `universal-document-outline-design.md` 设计文档 × `final-optimization-plan-2026-06-03.md` 路线图交叉检查

---

## 一、问题诊断

大纲生成耗时 30-90s（含修复调用可达 150s），根因分析：

| 瓶颈 | 延迟量级 | 触发概率 | 说明 |
|------|---------|---------|------|
| 巨型 prompt（120 行，含 8 种 archetype 骨架） | 输入 ~3000 token | 100% | 只需 1 种骨架却发送全部 8 种 |
| 输出 JSON 过于复杂（9 字段/section） | 输出 ~4000 token | 100% | 其中 3 个字段用户不可见，写作阶段才消费 |
| 修复调用（第二次 LLM） | +10~60s | 高 | 复杂文档几乎必触发 `needsOutlineRepair` |
| 对话全文未摘要 | 额外 ~2000 token 输入 | 100% | 长会话（15-30 条消息）全部拼接 |
| 轮询退火过慢 | +2~15s 感知延迟 | 100% | 初始 2s，最大 15s |

### 关键发现

设计文档 `universal-document-outline-design.md` 第 4 节已提出"先摘要后生成"的方向，但代码未实现。`outline-worker.ts` 仍直接拼接全部对话原文发送给 LLM。

---

## 二、方案设计：两阶段 Pipeline + 延迟富化

### 架构对比

```
当前 (1 次巨型调用 + 可能修复):
  全部对话原文 + 120行 prompt(8种archetype) → LLM → 完整JSON(9字段/section)
  若扁平 → 第二次修复调用
  总耗时: 30-90s，含修复可达 150s

优化后 (2 次轻量调用):
  Step 1 (~2s): 全部对话原文 + 摘要prompt(~30行) → LLM → 结构化摘要(~200 token)
  Step 2 (~10-15s): 摘要 + 匹配的单种archetype骨架(~40行) → LLM → 大纲(5字段/section)
  无修复调用
  总耗时: ~12-17s

富化 (移到写作阶段，按需):
  写作某 section 前: 标题+描述+keyPoints → LLM → retrievalQuery/referenceHints/writingRequirements
  延迟: +1-2s/section（融入写作流程，用户无感）
```

### 大纲质量不变

"轻量"仅指去掉了 3 个用户不可见的内部元数据字段，大纲的结构和质量完全不变：

| 字段 | 用户可见 | 生成阶段 |
|------|---------|---------|
| title | 是 | 大纲阶段（不变） |
| num | 是 | 大纲阶段（不变） |
| description | 是 | 大纲阶段（不变） |
| keyPoints | 是 | 大纲阶段（不变） |
| estimatedWords | 是 | 大纲阶段（不变） |
| children 嵌套 | 是 | 大纲阶段（不变） |
| writingRequirements | 否 | **写作时按需生成** |
| retrievalQuery | 否 | **写作时按需生成** |
| referenceHints | 否 | **写作时按需生成** |

### 预期性能提升

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| LLM 调用次数 | 1-2 次（含修复） | 固定 2 次（无修复） | 消除不确定修复 |
| 总输出 token | ~4000 | ~1700 | -57% |
| 大纲生成总耗时 | 30-90s（含修复 150s） | 12-17s | -70~85% |
| 用户首次反馈 | 等到完成 | ~2s 显示文档类型 | 即时反馈 |
| 修复调用概率 | 高 | 极低 | 基本消除 |

---

## 三、详细改动清单

### 改动 1: 新增 `src/lib/brainstorm/summary-prompt.ts`

新建摘要 prompt 文件，含中英文版本。

- 输入：全部对话原文
- 输出：结构化 JSON（~200 token）：archetype、summary、confirmedSections、constraints
- token 分析：prompt ~150 token + 对话 ~2000 token → 输出 ~200 token

### 改动 2: 重构 `src/lib/brainstorm/outline-prompt.ts`

将当前 120 行巨型 prompt 重构为动态 builder：

- 提取 8 种 archetype 骨架为独立常量 `ARCHETYPE_SKELETONS`
- 新增 `buildLightweightOutlinePrompt(archetype, locale)` 函数
- 只注入匹配的 1 种 archetype 骨架（非全部 8 种）
- 输出 JSON schema 从 9 字段/section 减到 5 字段/section
- Prompt 从 ~120 行降到 ~40 行

### 改动 3: 重写 `src/lib/queue/workers/outline-worker.ts`

改为两步 pipeline：

```
Phase A — 需求摘要 (进度 5% → 30%)
  1. 加载会话消息（不变）
  2. 解析 LLM 模型（不变）
  3. 构建对话字符串（不变）
  4. 非流式 LLM 调用：对话 → 结构化摘要
  5. 解析摘要 JSON，提取 archetype + confirmedSections + constraints

Phase B — 大纲生成 (进度 30% → 90%)
  6. 根据 archetype 选择骨架片段
  7. 流式 LLM 调用：摘要 + 匹配骨架 → 大纲
  8. 解析 + 规范化大纲（无需 repair）

Phase C — 存储 (进度 90% → 100%)
  9-12. 保存大纲、记录 token、创建系统消息（不变）
```

关键变化：
- 不再需要 repair 调用（prompt 简单 + 输出轻量 = 出错概率极低）
- Step 1 完成后进度更新到 30%，前端可展示"已识别文档类型"

### 改动 4: 轮询优化 `src/hooks/brainstorm/use-brainstorm-outline.ts`

- 初始间隔从 2000ms 降到 1000ms
- 最大退火从 15000ms 降到 12000ms

### 改动 5: 写作阶段按需富化 `src/lib/writing/generator.ts`

在 `generateSectionFull` 和 `generateSectionStream` 中，`fetchRagReferences` 之前新增：

- 新增 `enrichSectionContext()` 函数（~30 行）
- 输入：section 的 title + description + keyPoints
- 轻量 prompt（~20 行）→ LLM → `{ retrievalQuery, referenceHints, writingRequirements }`
- 输出 ~100 token，耗时 ~1-2s
- 结果写入 section.constraints 字段缓存，后续写作不再重复调用

### 改动 6: `src/lib/brainstorm/outline-normalizer.ts` — 无需改动

`writingRequirements`/`retrievalQuery`/`referenceHints` 已是可选字段，向下兼容。

---

## 四、兼容性保障

1. **数据库零迁移**：大纲以 JSON 字符串存储，schema 不变
2. **旧大纲兼容**：已有含完整 9 字段的 outline 正常工作
3. **前端无感**：`DisplayOutlineNode` 和 `EditOutlineNode` 只用 title/num/estimatedWords
4. **API 接口不变**：generate-outline、tasks/[id]、outlines/[id] 格式完全不变

---

## 五、与现有路线图关联

| 路线图项 | 关联 |
|---------|------|
| Batch 7-3: 拆 brainstorm/page.tsx | 互补：本次改后端 pipeline，Batch 7 改前端组件 |
| Batch 6-5: 提取 generator.ts 重复模型解析 | 受益：富化函数复用 helper |
| C11: queue.ts 原子 claim | 独立：任务更快完成降低竞态窗口 |

---

## 六、执行顺序

1. 新增 summary-prompt.ts
2. 重构 outline-prompt.ts（骨架片段 + 动态 builder）
3. 重写 outline-worker.ts（两步 pipeline）
4. 轮询优化 use-brainstorm-outline.ts
5. 写作阶段富化 generator.ts
6. 测试验证：`npm test` + `npm run build` + 手动验证

---

## 七、验证场景

1. 技术方案（technical_solution）— 应识别为建设方案型
2. 立项报告（proposal）— 应识别为论证立项型
3. 投标方案（bidding+technical_solution）— 应识别为混合型
4. 模糊短句 — 应退化为 general 类型
5. 长会话（20+ 条消息）— 摘要应正确提取关键信息
