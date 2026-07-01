# LLM 自适应并发限流器设计方案

日期：2026-06-26
范围：为文档处理管线（Wiki 提取、Graph 图谱抽取、Embedding）引入一个 per-provider 的自适应并发控制层，在不依赖厂商提供并发上限的前提下，安全地逼近真实容量、规避封禁风险，并在容量已知时零成本运行。

---

## 1. 背景与问题陈述

### 1.1 当前的并发现状

文档处理管线中真正消耗 LLM 的三个阶段，并发控制各自为政、且粒度错误：

| 阶段 | 代码位置 | 当前并发 | 调用者进程 |
|------|---------|---------|-----------|
| Wiki 提取 | `src/lib/wiki/synthesizer.ts:128` | **纯串行 for 循环 = 1** | Node |
| Embedding | `src/lib/documents/pipeline.ts:386` | `CONCURRENT_EMBED_BATCHES = 3`（写死） | Node |
| Graph 图谱抽取 | `workers/python/rag_index.py:264` | `asyncio.Semaphore(2)`（写死） | Python |

三个独立的并发数字，互不感知，也都不感知 provider 的真实容量。

### 1.2 核心约束：容量未知且差异巨大

> 很多模型服务商并不直接提供并发能力，而且每个模型服务商的并发能力差异很大。

这是本方案的根本出发点。它意味着：

1. **不能用静态定值。** 猜低了浪费吞吐（Wiki 串行就是极端案例）；猜高了触发 429。
2. **不能用单一全局窗口。** 不同 provider 容量不同，弱 provider 会把强 provider 的窗口一起压下去。
3. **不能朴素套 AIMD。** 朴素 AIMD 的"撞 429 才知道到顶"在付费 API 上代价过高，且部分厂商（火山、严格 OpenAI 代理）频繁 429 会触发临时封禁。

### 1.3 设计目标

1. **在不依赖厂商公布并发上限的前提下，安全逼近真实容量。**
2. **对发 `x-ratelimit-*` 头的厂商，零 429 运行**（前馈配速，不需要探测）。
3. **对不发头的厂商，用无损信号（延迟梯度）尽量不打 429**；必须探测时，slow-start 快速逼近且只付一次学费。
4. **消除封禁风险**：严格按 `Retry-After` 停 + per-provider single-flight 冷却。
5. **Node 与 Python 两个调用者共享同一个 provider 容量认知。**
6. **per-provider 分桶**，互不干扰。

### 1.4 非目标

1. 不重写整个管线；
2. 不改变 chunk / 文档 / 任务的数据模型；
3. 不引入外部分布式协调服务（Redis 等）；跨进程协调用 DB 持久化 + 宽松同步。
4. 第一阶段不实现延迟梯度的全部精化，先落地 header 配速 + AIMD 兜底。

---

## 2. 核心洞察：按信号成本分层，而非单一 AIMD

朴素 AIMD 假设信道是黑箱，唯一信号是丢包（429）。但 LLM API 不是黑箱——它在**每个成功响应里**都带容量信息，还有更早的信号能在 429 前预警。本方案按信号成本从低到高组合四种机制：

| 信号源 | 成本 | 覆盖场景 | 机制 |
|--------|------|---------|------|
| `x-ratelimit-remaining-*` 头 | **零** | 发头的厂商（OpenAI/Anthropic/Azure） | 前馈配速：看见 remaining 下降就减速，永远不撞墙 |
| 响应延迟梯度 | **零**（每个请求本就产生） | 所有厂商 | P95 延迟爬升 = provider 在排队，429 前主动降窗 |
| 429 本身 | **高**（浪费配额 + 封禁风险） | 不发头的厂商的最后兜底 | AIMD multiplicative decrease |
| `Retry-After` 头 | 零 | 429 已发生时 | 严格按时间停，防封禁 |

**关键结论**：发头的厂商完全不需要 AIMD 探测，运行成本为零；AIMD/延迟梯度只服务"完全不透明"的厂商，且此时配合 slow-start + 持久化，把"撞墙学费"降到每个 provider 一次。

---

## 3. 架构总览

### 3.1 per-provider 分桶

限流器按 provider 分桶，桶 key = `providerType + ":" + normalizedApiBaseUrl`（复用 `adapter.ts` 已有的 `normalizeProviderBaseUrl`）。

- 同一个 provider 的所有调用者（Wiki、Embed、Graph、Draft）共享该 provider 的窗口与容量认知——因为厂商限制本来就是跨调用者共享的。
- 不同 provider 的窗口互相独立，弱 provider 不会拖累强 provider。

### 3.2 两个调用者进程，共享容量认知

```
        ┌─────────────────────────────────────────────┐
        │  ProviderCapacityStore (DB / JSON 持久化)    │
        │  per-provider: 当前安全并发、最近 429 时间、   │
        │  是否发 rate-limit 头、测得的 TPM             │
        └───────────────┬─────────────────┬───────────┘
                        │ 读/写            │ 读/写
            ┌───────────▼───────┐   ┌──────▼──────────────┐
            │  Node 限流器       │   │  Python 限流器       │
            │  AdaptiveLimiter   │   │  (rag_index.py 内)   │
            │  覆盖 wiki/embed/  │   │  覆盖 graph 抽取      │
            │  draft/autotagger  │   │                      │
            └─────────┬──────────┘   └──────────┬──────────┘
                      │ 发 HTTP                  │ 发 HTTP
                      ▼                          ▼
               ┌────────────────────────────────────┐
               │       LLM Provider API              │
               └────────────────────────────────────┘
```

- **两个进程各自运行一个 in-process 限流器实例**（不做实时跨进程锁，代价过高）。
- **共享的是"学到的容量"**：每个进程把探测到的安全并发写入 `ProviderCapacityStore`；另一个进程启动/周期性读取，以已知值起步。
- 实时双重计数风险低：graph 与 wiki 同时高并发打同一个 provider 的场景不常见，且持久化的 floor/ceiling 提供安全基线。若未来需要更紧的协调，可升级为 DB 行级 advisory lock（第三阶段）。

### 3.3 Node 侧单一注入点

所有 Node 端 LLM 调用都经过 `createLLMProvider(config)`（`src/lib/llm/factory.ts`）。在此注入：返回的 adapter 内部持有 `AdaptiveLimiter`，`chat` / `chatStream` / `embed` 每次调用前 acquire、响应后 release。**无需改动各个 worker。**

### 3.4 Python 侧

`rag_index.py` 的 `llm_func` 内部把固定 `Semaphore(2)` 换成一个等价的 Python 自适应限流器，同样读写 `ProviderCapacityStore`（通过约定路径的 JSON 文件，与 Node 侧格式一致——避免给 Python 加 DB 依赖）。

---

## 4. 核心原语：加权动态并发限流器

### 4.1 为什么是"加权"而非"计数"

厂商真正卡你的是 **TPM（tokens/min）**，不是并发数。一个长输出的 graph 抽取请求单个就可能吃掉整分钟 TPM 配额。如果限流器只数"在飞请求数"，并发砍到 2，TPM 还是超，还是 429。

因此核心原语是一个**按 token 加权的动态并发窗口**：

```
窗口 = 允许的"在飞 token 总预算"（不是请求数）
acquire(estimatedTokens)  → 预扣预算，阻塞到有额度
release(actualTokens)     → 按真实 token 归还（多退少补）
```

这样：
- 一个大请求占一个"大槽"，自动串行化，不会打穿 TPM。
- AIMD 调整的是**总预算**，无论请求大小都安全。
- `estimateTokens`（`adapter.ts:35` 已有）用于预扣；响应的 `usage.prompt_tokens / completion_tokens` 用于归还校准。

### 4.2 两层维度

| 维度 | 控制什么 | 机制 | 信号 |
|------|---------|------|------|
| **并发预算（加权窗口）** | 同时在飞的 token 量 | AIMD 动态调整总预算 | 成功/429/延迟 |
| **速率（TPM 补充）** | 每分钟 token 量 | 令牌桶，按测得/头给的 TPM 补充 | `remaining-tokens` 头 / 观测 |

v1 先实现**加权并发窗口**（这是 Wiki 串行循环提速的核心），令牌桶速率层作为 TPM 安全网在 v1.5 加入（见 §10 阶段）。

---

## 5. 控制算法

### 5.1 启动：慢启动（slow-start），而非线性 AIMD

发现天花板不需要海量探测请求。借鉴 TCP：从 floor 开始**翻倍**直到首次受阻，用 log(N) 次逼近：

```
budget = floor（如 2 个请求的 token 量）
每连续成功 K 个请求 → budget *= 2 （翻倍）
直到：首次 429，或延迟梯度触发，或到达 slow-start 阈值
→ 切入加性增长阶段
```

### 5.2 加性增长（AI）

慢启动结束后，温和探测：

```
每连续成功 K 个请求 → budget += step（一个请求的 token 量）
```

K 与 step 可配，默认 K=20、step = 1 个中等请求的 token 量。

### 5.3 乘性下降（MD），但要温和 + 优先读头

下降触发时，**按信号优先级选择动作**：

1. **429 且带 `Retry-After`** → **single-flight 全局冻结该 provider**：所有在飞请求到达后不再发出新请求，直到 `Retry-After` 时间到。这是防封禁的关键。budget 不动（冻结期间无消耗）。
2. **429 不带 `Retry-After`** → budget *= 0.75（不用经典 0.5，对长任务过激），且 floor 兜底。
3. **延迟梯度触发**（P95 > baseline × 1.5）→ budget *= 0.9（更温和，因为还没真 429，只是排队迹象）。

**floor**：budget 永远不低于 floor（默认 = 2 个请求的 token 量），避免长期饿死。

### 5.4 探测结果持久化：只付一次学费

每次 budget 变化（尤其首次受阻测得的 ceiling）写入 `ProviderCapacityStore`。重启 / 新进程以**已知 ceiling × 0.8（headroom）起步**，不再重新探测。只有再次出现 429 才重新校准。

> 主动 headroom：发现到天花板后只运行在 ~80%，放弃 ~20% 吞吐换接近零 429。考虑到 429 既浪费配额又有封禁风险，这笔账划得来。

### 5.5 延迟梯度（无损预警，v1 简化版）

v1 只做最简单的：per-provider 维护响应延迟 EWMA 基线 + 最近窗口 P95。当 P95 超过基线 1.5×，判定为排队迹象，执行温和下降（×0.9）。不实现完整的 Vegas/LEDBAT，够用即可。

---

## 6. 防封禁纪律（独立于探测，但同等重要）

**封禁几乎从不是单个 429 触发的，而是"429 后的疯狂重试"触发的。** provider 看到你 429 了还 2 秒后又来、而且多个并发请求同时这么干——这是封禁直接诱因。

### 6.1 当前代码的封禁风险（必须先修）

`src/lib/llm/adapter.ts:108-113`：

```ts
const retryable = response.status === 429 || response.status >= 500;
if (retryable && remaining > 0) {
  const delay = Math.pow(2, 4 - remaining) * 1000; // 2s, 4s, 8s
  await new Promise((resolve) => setTimeout(resolve, delay));
  return this.chatWithRetry(params, remaining - 1);
}
```

问题：**不读 `Retry-After`**，用固定指数退避；每个并发请求各自独立退避、互不协调。对严格 provider，provider 让你等 30s 你 2s 就重试，而且多个请求同时这么干——封禁风险源。`embedWithRetry`（`adapter.ts:316-320`）同样问题。

### 6.2 修复要求

1. **严格读 `Retry-After`**：429/503 响应优先解析该头（秒数或 HTTP-date），按它停，绝不在它之前重试。无该头才退化为指数退避。
2. **single-flight 冷却**：一个请求 429 → 该 provider 的**所有**调用者（通过 AdaptiveLimiter）立即进入冷却，共享同一个 `Retry-After`。不要让剩余在飞请求各自按自己的定时器重试（惊群）。
3. 退避上限 + jitter，避免重试风暴同步。

---

## 7. 数据模型：ProviderCapacityStore

per-provider 持久化学到的容量。两种存储后端，二选一：

### 7.1 选项 A（推荐 v1）：JSON 文件

路径：`{DB_PATH 或 ~/.synthetix-data}/provider-capacity.json`

格式：
```json
{
  "openai_compatible:https://api.openai.com/v1": {
    "concurrencyBudgetTokens": 60000,
    "discoveredCeiling": 75000,
    "emitsRateLimitHeaders": true,
    "last429At": "2026-06-26T10:00:00Z",
    "lastUpdated": "2026-06-26T10:05:00Z"
  }
}
```

- Node 侧直接读写。
- Python 侧（`rag_index.py`）读写同一文件（进程间无锁，最后写赢；容量是缓变值，偶发覆盖无害）。
- 优点：零依赖、Node/Python 对称。
- 缺点：不是事务性的，但容量是缓变统计值，可接受。

### 7.2 选项 B（v2）：DB 表

新增 `ProviderCapacity` 表，字段对应上述 JSON。需给 Python 加 DB 访问（或经 Node API 中转）。仅当多实例部署需要更强一致性时再升级。

---

## 8. 集成点（代码改动清单）

### 8.1 新增：`src/lib/llm/adaptive-limiter.ts`

核心模块，导出 `AdaptiveLimiter` 类：

```ts
export interface AcquireOptions {
  estimatedTokens: number;       // 预扣预算（estimateTokens 算）
  providerKey: string;           // "openai_compatible:https://..."
}

export interface ReleaseInfo {
  actualTokens: number;          // 真实 token（来自 usage）
  status: number;                // HTTP status
  rateLimitHeaders?: {           // 解析后的 x-ratelimit-*
    remainingRequests?: number;
    remainingTokens?: number;
    resetRequestsMs?: number;
    retryAfterMs?: number;
  };
}

export class AdaptiveLimiter {
  constructor(opts: { providerKey: string; store: ProviderCapacityStore });
  async acquire(opts: AcquireOptions): Promise<() => Promise<void>>;  // 返回 release
  // 内部实现：慢启动 / AI / MD / 延迟梯度 / single-flight 冷却
}
```

- 进程内单例 Map：`providerKey → AdaptiveLimiter`（`getLimiter(providerKey)`）。
- 读写 `ProviderCapacityStore`。

### 8.2 新增：`src/lib/llm/rate-limit-headers.ts`

解析 `x-ratelimit-*` / `Retry-After` 头的纯函数模块。不同厂商头命名差异（`x-ratelimit-remaining-requests` vs `x-ratelimit-remaining-requests` vs `retry-after`）统一归一化。

### 8.3 改动：`src/lib/llm/factory.ts`

`createLLMProvider` 内部构造 adapter 时，注入对应 provider 的 limiter。adapter 在 `chat` / `chatStream` / `embed` 的 fetch 调用前后 acquire/release。

**改动模式**（以 `chat` 为例）：
```ts
const limiter = getLimiter(providerKey);
const release = await limiter.acquire({ estimatedTokens, providerKey });
try {
  response = await fetchWithTimeout(url, ...);
  // 解析 rate-limit 头
  const rateLimitHeaders = parseRateLimitHeaders(response.headers);
  // ...
} finally {
  await release();
}
// release 内部：按实际 token 归还、按 status/header 反馈给 AIMD
```

### 8.4 改动：`src/lib/llm/adapter.ts`（429 重试）

- `chatWithRetry`（line 56）、`embedWithRetry`（line 287）：429/503 时解析 `Retry-After`，按它停。
- 退避不再各自为政：429 通过 limiter 触发 **single-flight 全局冷却**，其他在飞请求共享冻结期。

### 8.5 改动：`src/lib/wiki/synthesizer.ts:128`（最大收益点）

把串行 `for` 循环改成有界并发，复用现成的 `boundedAll`（`src/lib/documents/pipeline.ts:25`）或直接依赖 limiter 的 acquire 阻塞：

```ts
// 之前：for (const chunk of chunksToProcess) { ... await extractChunkKnowledge ... }
// 之后：boundedAll(chunksToProcess, processOneChunk, dynamicConcurrency)
//       dynamicConcurrency 由 limiter 决定，初值由 ProviderCapacityStore 给
```

**关键：保留 checkpoint 续跑语义。** 并发后 checkpoint 写入需要按 index 单调推进（用一个 atomic counter 跟踪"已连续完成到第几个"），不能简单按完成顺序写——否则失败重跑会跳过中间 chunk。这是并发化最需要小心的正确性点。

### 8.6 改动：`src/lib/documents/pipeline.ts:386`（embedding）

`CONCURRENT_EMBED_BATCHES = 3` 写死值改为由 limiter 决定，或保留批次大小但把"并发批次数"交给 limiter。

### 8.7 改动：`workers/python/rag_index.py:264`（Python graph）

`asyncio.Semaphore(2)` 换成 Python 版自适应限流器（同模块内实现，逻辑镜像 Node 的 AdaptiveLimiter），读写同一份 `provider-capacity.json`。

---

## 9. 配置与默认值

| 配置 | 默认 | 说明 |
|------|------|------|
| `LLM_LIMITER_ENABLED` | `true` | 总开关，false 时退回静态并发（安全网） |
| `LLM_LIMITER_FLOOR_TOKENS` | ~2 个中等请求 | 永不低于此预算 |
| `LLM_LIMITER_SLOW_START_K` | 8 | 翻倍前需连续成功的请求数 |
| `LLM_LIMITER_AI_K` | 20 | 加性增长 +1 前的连续成功数 |
| `LLM_LIMITER_MD_FACTOR` | 0.75 | 429 无 Retry-After 时的下降系数 |
| `LLM_LIMITER_LATENCY_FACTOR` | 0.9 | 延迟梯度触发时的下降系数 |
| `LLM_LIMITER_HEADROOM` | 0.8 | 探得 ceiling 后只运行在此比例 |
| `LLM_LIMITER_LATENCY_THRESHOLD` | 1.5 | P95 超基线多少倍触发降窗 |
| `LLM_LIMITER_DISABLED_PROVIDERS` | （空） | 指定 provider 关闭自适应（用于已知容量） |

---

## 10. 分阶段实施计划

### 阶段 0：防封禁修复（先做，1 天，独立可上线）

不依赖限流器，直接修 `adapter.ts` 的 429 退避：
1. 解析 `Retry-After` 头，严格按它停。
2. 加 jitter，避免重试风暴同步。

**收益**：立即消除封禁风险，且是后续限流器的必要前提。

### 阶段 1：核心限流器 + Wiki 并发（最大收益，3-5 天）

1. 实现 `adaptive-limiter.ts` + `rate-limit-headers.ts` + `ProviderCapacityStore`（JSON）。
2. 实现 slow-start + AI + MD + 持久化（不含延迟梯度）。
3. 接到 `createLLMProvider`。
4. 把 `synthesizer.ts:128` 串行循环改成并发（带 checkpoint 正确性处理）。

**收益**：Wiki 提取从并发=1 提到 provider 真实容量（实测通常 3-8 倍）；发头厂商零 429；不发头厂商 slow-start 一次探测后稳定运行。**这一步覆盖用户痛点的 70%+。**

### 阶段 2：Embedding + single-flight 冷却（2 天）

1. embedding 批次并发交给 limiter。
2. 实现 per-provider single-flight 冷却（一个 429 冻结该 provider 全部在飞）。
3. 阶段 0 的 Retry-After 接入 single-flight。

### 阶段 3：Python graph 侧（2-3 天）

1. Python 版自适应限流器，镜像 Node 逻辑。
2. 读写同一份 `provider-capacity.json`。
3. 替换 `rag_index.py` 的 `Semaphore(2)`。

### 阶段 4：延迟梯度（可选，2 天）

per-provider 延迟 EWMA + P95，温和提前降窗。让不发头厂商的 429 频次进一步下降。

### 阶段 5（可选）：TPM 令牌桶速率层

若加权并发窗口在实测中仍偶发 TPM 维度 429，再加令牌桶作为 TPM 安全网。

---

## 11. 风险与应对

### 风险 1：加权窗口让单个大请求串行化所有请求
**应对**：这是正确行为（不应超 TPM）。但设 floor 保证最低并发；若请求 token 极不均匀，可加"单请求预算上限"，超限则拆分或排队。

### 风险 2：Node 与 Python 双重计数导致短暂超并发
**应对**：v1 宽松同步（共享 JSON 容量 + headroom 0.8 已留余量）。若实测问题严重，v2 升级 DB 行级锁或令 Python 经 Node 代理发请求。

### 风险 3：checkpoint 在 Wiki 并发下错乱
**应对**：用 monotonic counter 记录"已连续完成的最大 index"，checkpoint 只在该值推进时写入；失败 chunk 不推进。阶段 1 重点测试。

### 风险 4：限流器自身成为单点 / 死锁
**应对**：acquire 必须可超时（避免无限阻塞管线）；release 必须幂等（复用现有 Semaphore 的 idempotent releaser 模式）；limiter 故障时降级为静态并发（`LLM_LIMITER_ENABLED=false`）。

### 风险 5：厂商头格式差异导致解析失败
**应对**：`rate-limit-headers.ts` 做归一化 + 容错（解析失败=当作不发头，走 AIMD 兜底）。不因头解析失败而崩溃。

---

## 12. 验证方案

### 12.1 单元测试
- `AdaptiveLimiter`：slow-start 翻倍、AI +1、MD ×0.75、floor 兜底、headroom 应用。
- `rate-limit-headers`：各厂商头格式归一化、Retry-After 秒/日期两种格式。
- checkpoint 并发正确性：模拟乱序完成，验证只单调推进。

### 12.2 集成测试（mock provider）
- 发头厂商：remaining 下降时验证提前减速、零 429。
- 不发头厂商：slow-start 到首次 429 后切 AI，且持久化 ceiling。
- single-flight：一个 429 验证同 provider 其他请求冻结。

### 12.3 真实负载验证
- Wiki 提取：对比改造前后单文档耗时（预期显著下降）。
- 观测 `provider-capacity.json` 中各 provider 测得的 ceiling 是否稳定、合理。
- 监控 429 频次：发头厂商应接近零。

---

## 13. 最终结论

本方案的核心判断：

1. **自适应并发是正确方向**——在"厂商容量未知且差异大"的约束下，静态定值必然次优。
2. **但朴素 AIMD 是错的工具**——LLM API 不是黑箱，有更便宜的信号（成功响应的头、延迟梯度）。
3. **分层信号**：发头厂商前馈配速（零成本）→ 不发头厂商延迟梯度无损预警 → AIMD 仅作兜底 → Retry-After + single-flight 防封禁。
4. **加权（token 计）窗口**而非计数窗口，才能正确反映 TPM 限制。
5. **per-provider 分桶 + 跨进程共享容量**，匹配"服务商差异大"和"Node/Python 双调用者"的现实。
6. **实施优先级**：先修封禁风险（阶段 0）→ 核心限流器 + Wiki 并发（阶段 1，覆盖 70% 痛点）→ 逐步扩展。

设计原则一句话：

> **不要用"撞墙"来发现墙在哪——用厂商在每个成功响应里主动告诉你的信息配速；只有当厂商什么都不告诉你时，才用最便宜的探测（slow-start），并把学费降到每个 provider 一次。**
