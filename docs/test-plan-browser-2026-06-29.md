# Synthetix 浏览器端 E2E 测试方案

> 版本：v1.0 · 日期：2026-06-29
> 工具：Playwright · 测试目标：Synthetix v0.10.9（AI 文档创作平台）
> 状态：**待审核**（文末"待确认决策点"需你拍板）

---

## 一、概述与范围

本方案覆盖 Synthetix 全部页面与核心业务流程的浏览器端测试，重点验证三个高价值专项：

1. **文档处理四种方式**（standard/graph/wiki/full）的效率与流水线进度展示一致性
2. **文档删除级联清理**——删除后知识图谱、Wiki、向量、分块是否彻底清理
3. **端到端主链路**——上传→处理→头脑风暴→写作→导出的完整回归基线

测试为**真实环境执行**：真实 LLM 调用、真实 Python workers、保留现有 provider/嵌入模型配置，不使用 mock。

---

## 二、测试环境与前置条件

| 项 | 值 |
|---|---|
| 应用 URL | 本地 dev server（`npm run dev`） |
| 登录凭证 | admin / Admin@123 |
| LLM 依赖 | 保留现有已配置的多个 provider + 嵌入模型，真实调用 |
| Python workers | 依赖 `workers/python/`（convert / rag_index / rag_manage / export） |
| PDF 导出 | 依赖 Playwright Chromium |
| 测试工具 | Playwright（已在 devDependencies） |

**测试文档（按模式区分使用，节省耗时）**：

出于处理效率考虑，**仅 full（完整分析）使用大文档**，另三项（standard/graph/wiki）使用小文档。两份均为 docx、同类内容（容器/云原生平台建设方案），格式一致便于对比，且内容实体丰富保证 graph/wiki 有足够数据可抽取。

| 文档 | 路径 | 大小 | 预估档位 | 用于模式 |
|---|---|---|---|---|
| 大文档（真实业务文档） | `Z:\VM ShareFolder\test\烟台银行容器平台投标技术方案_260427.docx` | 94,351,487 字节（≈ 90 MB） | **heavy**（>50 MB） | **仅 full** |
| 小文档（真实业务文档） | `Z:\VM ShareFolder\test\河南农商银行容器云平台建设方案参考-20260305.docx` | 17,209,926 字节（≈ 16.4 MB） | **medium**（5–20 MB） | standard / graph / wiki |

**各模式预估处理时间区间**（依据 `src/lib/documents/estimate.ts`，graph 模式 ×1.5 / ×1.8）：

| KnowledgeMode | 文档 | 档位 | graphMode | 预估下限 | 预估上限 | 说明 |
|---|---|---|---|---|---|---|
| standard | 小(17MB) | medium | false | 2 min | 8 min | 仅基础检索，最快 |
| graph | 小(17MB) | medium | true | 3 min | 14 min | 检索 + 实体/关系图谱 |
| wiki | 小(17MB) | medium | false | 2 min | 8 min | 预估**不含 wiki 合成增量**（潜在不一致点，EFF-03 验证） |
| full | 大(90MB) | heavy | true | 30 min | 81 min | 全部，推荐档，最慢 |

> ⚠️ **效率对比说明**：因四模式分用两份不同尺寸文档，**跨尺寸的绝对耗时不可直接比较**。EFF 组调整为：
> - **小文档内**（standard/graph/wiki 同尺寸）可做同尺寸对比，验证 graph 倍率（1.5–1.8×）与 wiki 增量是否成立；
> - **full 单独**用大文档验证，不与前三项比绝对耗时，仅验证其预估区间（30–81 min）是否被真实耗时命中。
>
> ⚠️ 另三项总耗时约 20–40 min，full 单项 30–81 min。**完整套件总耗时约 1.5–2.5 小时**（相比四模式全用大文档的 3 小时+ 显著缩短）。方案设计两套执行策略（见第九章）。

---

## 三、测试策略与约束

| 约束 | 处理方式 |
|---|---|
| **LLM 不确定性** | 断言结构 / 状态 / 可见性，**不断言具体文本**。如：大纲项数>0、正文非空、任务终态 `completed`、SSE 事件序列正确 |
| **数据隔离** | 测试创建的资源统一加前缀 `[E2E]` + 标签 `e2e`；teardown 仅按前缀/标签清理，**绝不触碰原有数据** |
| **配置不动** | 模型管理全程只读或"临时建后即删"；改密码/默认模型用例执行后强制还原 |
| **异步任务** | 全局 `waitForTask(taskId, timeout)` 轮询 `/api/v1/tasks/[id]`；重型任务放宽超时 |
| **SSE 流式** | 用 Playwright 捕获单节生成/对比的事件流，验证事件类型与顺序 |
| **删除验证不可信返回值** | 删除 API 的 `verifyDocumentDeleted` 恒返回 ok，所有清理验证通过**独立渠道**复查（DB / 图谱 / Wiki 接口） |
| **登录态** | 全局 setup 登录一次，`storageState` 落盘复用 |

**优先级**：P0（冒烟/阻塞） · P1（核心） · P2（补充）

---

## 四、通用测试模块

### 模块 1 · 鉴权与会话（P0）
| 编号 | 用例 | 预期 |
|---|---|---|
| AUTH-01 | 正确凭证登录（admin/Admin@123） | 跳转仪表盘，侧边栏可见 |
| AUTH-02 | 错误密码登录 | 错误提示，停留登录页 |
| AUTH-03 | 未登录访问受保护路由 | 重定向到 /login |
| AUTH-04 | /setup 重定向 | 跳转 /login |
| AUTH-05 | 登出 | cookie 清除，回到登录页 |
| AUTH-06 | token 过期自动刷新 | 静默刷新后请求仍成功 |

### 模块 2 · 全局导航与外壳（P0）
| 编号 | 用例 | 预期 |
|---|---|---|
| NAV-01 | 侧边栏 10 个入口依次可达 | 每个路由加载无 500 |
| NAV-02 | 激活态高亮 | 当前项高亮 |
| NAV-03 | 深色/浅色主题切换 | 主题生效并持久 |
| NAV-04 | 中/英文切换 | 全站文案切换，无遗漏 key |
| NAV-05 | 关于弹窗 | 显示版本信息，可关闭 |
| NAV-06 | 窄屏响应式（P2） | 布局不溢出 |

### 模块 3 · 仪表盘（P0）
| 编号 | 用例 | 预期 |
|---|---|---|
| DASH-01 | 统计卡片加载 | 文档/草稿/Token/任务四卡片数值与对应 API 一致 |
| DASH-02 | 4 个快捷操作 | 点击跳转对应页 |
| DASH-03 | 最近文档/草稿列表 | 两栏渲染，点击进详情 |
| DASH-04 | 空态（P2） | 无数据时友好空态 |

### 模块 4 · 文档库与检索（P0/P1）
| 编号 | 用例 | 预期 |
|---|---|---|
| LIB-01 | 列表分页/排序/筛选 | 结果正确刷新 |
| LIB-02 | 文档详情 | 内容/分块/Token 统计展示 |
| LIB-03 | 关键词搜索 | FTS5 结果返回，命中高亮 |
| LIB-04 | 语义搜索（各 mode） | local/global/hybrid/mix/naive/bypass 不报错 |
| LIB-05 | 标签管理 | 增/删持久化 |

### 模块 5 · 文档处理流水线（P0）
> 与专项模块 5A、5B 合并执行。基础流水线用例：
| 编号 | 用例 | 预期 |
|---|---|---|
| PIPE-00 | 上传 90MB 文档 | 落盘成功，状态 pending |
| PIPE-02 | 上传去重 | 重复上传返回 409/DUPLICATE |
| PIPE-05 | 重复 reprocess 幂等 | 已处理文档再提交返回同一 taskId |
| PIPE-06 | 处理失败容错（P1） | 损坏文件状态置 failed |

### 模块 6 · 头脑风暴（P0，真实 LLM）
| 编号 | 用例 | 预期 |
|---|---|---|
| BS-01 | 新建会话 | 会话出现在列表 |
| BS-02 | 发消息（gathering） | AI 回复非空，首 2 条带 RAG 隐藏背景 |
| BS-03 | 阶段流转 | gathering→direction→mode_select→… 正确推进 |
| BS-04 | 篇幅硬门控 | 未确认篇幅阻止提前生成（近期修复点） |
| BS-05 | 上传参考文件 | 上传成功 |
| BS-06 | 生成大纲 | outline_generate 任务完成，大纲 4 级结构合法、项数>0 |
| BS-07 | 会话删除 | 从列表移除 |

### 模块 7 · 写作撰写（P0，最复杂）
| 编号 | 用例 | 预期 |
|---|---|---|
| WR-01 | 从会话/大纲建 draft | sections 正确拆分 |
| WR-02 | 大纲递归编辑 | 增删改/折叠展开持久化 |
| WR-03 | 单节 SSE 生成 | 事件序列 references→chunk*→done；正文非空 |
| WR-04 | 确认节 | 节锁定已确认 |
| WR-05 | A/B 双模型对比 | contentA/B 非空，可选定模型 |
| WR-06 | 人性化润色 | 返回润色后正文 |
| WR-07 | 审计 | 返回审计结果 |
| WR-08 | 版本回滚 | 内容回到历史版本 |
| WR-09 | 版本历史 | 多版本可见 |
| WR-10 | 资产生成 | diagram/image/mermaid 生成成功 |
| WR-11 | 批量生成 | 任务完成，所有节有正文 |
| WR-12 | 停止生成 | 中断生效，状态正确 |

### 模块 8 · 导出（P1）
| 编号 | 用例 | 预期 |
|---|---|---|
| EXP-01 | 导出 Markdown | 文件下载，含各节正文 |
| EXP-02 | 导出 PDF | Playwright 渲染，PDF 下载非空 |
| EXP-03 | 导出 DOCX | python-docx 生成，下载非空 |

### 模块 9 · Wiki（P1）
| 编号 | 用例 | 预期 |
|---|---|---|
| WIKI-01 | 列表分页/搜索/排序/筛选 | 结果正确 |
| WIKI-02 | 批量操作 | 批量生效 |
| WIKI-03 | 词条详情 | 内容展示 |
| WIKI-04 | 触发合成 | 任务完成，新词条出现 |
| WIKI-05 | 导出 | 文件下载 |
| WIKI-06 | 统计卡 | 摘要/主题/概念/论断计数显示 |

### 模块 10 · 知识图谱与拓扑（P1）
| 编号 | 用例 | 预期 |
|---|---|---|
| KG-01 | 知识图谱加载 | 实体/关系渲染，d3-force 布局正常 |
| KG-02 | 交互 | 缩放/拖拽/选中节点响应 |
| KG-03 | 拓扑图 | 选 draft 加载 topology，节点树渲染 |
| KG-04 | 实体证据 | 证据列表返回 |

### 模块 11 · 模型管理（P0，谨慎）
> 只读 + 临时建删，绝不改现有 provider。
| 编号 | 用例 | 预期 |
|---|---|---|
| MDL-01 | 读取现有 provider 列表 | 已配置 provider 全部可见（验证未受污染） |
| MDL-02 | 测试现有 provider 连接 | 返回成功 |
| MDL-03 | 新增临时 provider | 建一个 [E2E] provider，创建成功 |
| MDL-04 | 删除临时 provider | 删除成功，列表恢复 |
| MDL-05 | 设置默认模型槽位 | 生效（用后还原） |
| MDL-06 | 用量统计 | 数据展示 |

### 模块 12 · 用户与系统设置（P1/P2）
| 编号 | 用例 | 预期 |
|---|---|---|
| SET-01 | 修改资料 | 持久化 |
| SET-02 | 头像上传 | 显示新头像 |
| SET-03 | 修改密码（⚠️用后还原 Admin@123） | 用新密码可登录 |
| SET-04 | RAG/存储/数据库设置读取 | 配置回显 |

### 模块 13 · 端到端主链路（P0）
> **E2E-MASTER**：登录 → 上传 90MB 文档 → full 处理（轮询 ready）→ 建头脑风暴会话 → 发消息 → 确认篇幅 → 生成大纲 → 建 draft → 单节生成(SSE) → 确认 → 导出 MD/PDF → 验证拓扑图。

### 模块 14 · 非功能（P2）
| 编号 | 用例 | 预期 |
|---|---|---|
| NF-01 | 网络异常容错 | 断网/500 有错误提示，不白屏 |
| NF-02 | 控制台无未捕获错误 | 全程无 uncaught exception |
| NF-03 | 长任务超时处理 | 有合理提示 |
| NF-04 | 暗色主题全模块视觉抽查 | 无对比度问题 |

---

## 五、专项模块 5A：四种处理方式效率与流水线一致性 ⭐

### 5A.1 四模式定义（测试依据）

| KnowledgeMode | indexMode | wikiEnabled | 含义 | 推荐 |
|---|---|---|---|---|
| standard | basic | ❌ | 最快，仅基础检索 | — |
| graph | graph | ❌ | 检索 + 实体/关系图谱 | — |
| wiki | basic | ✅ | 检索 + 知识沉淀 | — |
| full | graph | ✅ | 全部 | ✅ |

> 分割策略/索引目标/自动分割三项目所有模式锁定为固定默认（structure-llm / full / autoSplit:true）。

### 5A.2 流水线展示规则（一致性基准）

详情页流水线 = 5 线性阶段（Upload→Convert→Split→Embed→Index）+ 条件分支：
- **Graph 分支**：仅 graphMode=true（graph/full）时出现
- **Wiki 分支**：仅 wikiEnabled=true（wiki/full）时出现

**每个模式最终展示的节点数必须不同**（核心断言）：

| 模式 | 线性 | Graph分支 | Wiki分支 | **总节点数** | 列表终态徽标 |
|---|---|---|---|---|---|
| standard | 5 | ❌ | ❌ | **5** | ready |
| graph | 5 | ✅ | ❌ | **6** | ready |
| wiki | 5 | ❌ | ✅ | **6** | ready |
| full | 5 | ✅ | ✅ | **7** | ready |

### 5A.3 效率估算规则（待验证的前端承诺）

预估公式来自 `estimate.ts`，**只区分 graphMode，不区分 wiki**：
- 基础模式（standard/wiki）：按文件大小分档
- 图谱模式（graph/full）：时间 ×1.5（下限）/ ×1.8（上限）

⚠️ **潜在不一致**：预估不含 wiki 合成耗时，但 wiki/full 真实处理会多一个 Wiki 分支。EFF-03 重点验证 wiki 预估是否偏乐观。

### 5A.4 用例

**A. 模式选择 UI 交互（P0，纯前端，快速）**
| 编号 | 用例 | 预期 |
|---|---|---|
| MODE-01 | 四卡片渲染 | standard/graph/wiki/full 可见，full 带推荐标 |
| MODE-02 | 切换模式 | 选中态高亮，详情文案更新 |
| MODE-03 | Graph 能力门控 | 选 dim<1536 嵌入模型，graph/full 置灰禁用（非隐藏）+ 原因提示，选中态降级 wiki |
| MODE-04 | 嵌入未选/未知 dim | graph/full 置灰 + 提示 |
| MODE-05 | 预估随模式变 | 切换 standard↔full，graph 类预估 ≈ 基础类 1.5–1.8 倍（同一文件） |

**B. 流水线节点一致性（P0，真实链路）⭐核心**
> 节点数与文档尺寸无关，仅验证各模式流水线分支展示是否与选项一致。standard/graph/wiki 用**小文档**（快），full 用**大文档**（顺带验证主链路）。
| 编号 | 用例 | 文档 | 预期（详情页流水线） |
|---|---|---|---|
| PIPE-01a | standard 流水线 | 小 | 仅 5 线性节点 done，无 Graph 无 Wiki，总节点 5 |
| PIPE-01b | graph 流水线 | 小 | 5 线性 + Graph 分支，无 Wiki，总节点 6 |
| PIPE-01c | wiki 流水线 | 小 | 5 线性 + Wiki 分支，无 Graph，总节点 6 |
| PIPE-01d | full 流水线 | 大(90MB) | 5 线性 + Graph + Wiki 双分支，总节点 7 |
| PIPE-02 | 分支并行性 | 小(wiki) + 大(full) | Graph 与 Wiki 同高并行，无前后依赖 |
| PIPE-03 | basicReady 中间态 | 大(full) | 线性链 done 后徽标 enhancing，分支仍 active |
| PIPE-04 | 列表↔详情一致 | 任一 | 列表徽标 = 详情徽标（processing/enhancing/ready） |
| PIPE-05 | 阶段实时推进 | 小(graph) | 阶段单调推进不回退（enforceMonotonic） |
| PIPE-06 | 失败态 | 损坏文件 | 失败阶段标红，徽标 failed |

**C. 处理效率对比（P1，真实链路，耗时）⭐**
> 因四模式分用两份文档，分两组对比：①小文档内 standard/graph/wiki 同尺寸对比；②full 单独验证。
| 编号 | 用例 | 文档 | 预期 |
|---|---|---|---|
| EFF-01 | 真实耗时计时 | 各自文档 | 记录各模式 convert→index→(graph)→(wiki) 各阶段耗时，产出对比表 |
| EFF-02 | 小文档内排序合理性 | 小(三模式) | standard ≤ wiki ≤ graph（同尺寸下，graph 因实体抽取最慢，wiki 因合成略慢于 standard） |
| EFF-03 | 预估 vs 真实偏差 | 各自文档 | 真实耗时落预估区间（或记录偏差率），重点验证 wiki 预估是否偏乐观（小文档 wiki） |
| EFF-04 | graph 倍率验证（小文档） | 小(standard vs graph) | graph 实际耗时落在 standard 的 1.5–1.8 倍区间附近 |
| EFF-05 | full 大文档命中预估 | 大(90MB full) | full 真实耗时落在 30–81 min 预估区间内（或记录偏差） |
| EFF-06 | 嵌入模型对 graph 影响 | 小(graph) | 高维模型 graph 可用完成；低维自动降级（联系 MODE-03） |

**EFF 输出物**：`四模式 × {预估下限, 预估上限, 真实耗时, 节点数, 是否含Graph/Wiki}` 对比表 + 偏差分析，落盘到 `docs/test-report-processing-modes-2026-06-29.md`。

---

## 六、专项模块 5B：文档删除级联清理验证 ⭐

### 6.1 删除链路事实（测试依据）

删除 `DELETE /api/v1/documents/[id]`：

**同步（API 返回时完成）**：取消进行中任务 + 删 DB 行（document/chunks/tags/images）

**异步（document_cleanup 任务，API 返回时仅 queued）⚠️**：
- 等待正在跑的 Python 任务退出（最长 10 分钟）
- `delete-by-doc` 删 LightRAG 中该文档实体/关系 + 失效图谱缓存
- 删磁盘文件
- 若用户已无文档：`resetUserRag` 清空整个 RAG 目录 + graphml
- 若仍有其他文档：`cleanupRagOrphans` 清理孤儿
- ⚠️ `verifyDocumentDeleted` **恒返回 ok，等于空校验**——测试必须自己独立验证

**Wiki 删除 ⚠️ 可选，默认不删**：必须显式传 `?deleteWiki=true`。逻辑：遍历 active 条目 sourceRefs，移除该文档引用；仅来自该文档的条目删除，多文档共引条目保留只移除引用。

### 6.2 识别的风险点（必须验证）

| # | 风险 | 验证用例 |
|---|---|---|
| R1 | Wiki 默认不删（不传 deleteWiki 则残留） | DEL-01/02 |
| R2 | 知识图谱非实时清除（缓存+Python未退出） | KG-DEL-01/02/03 |
| R3 | 处理中删除的 10min settle 竞态回写 | DEL-08 |
| R4 | verify 空校验，不可信返回值 | 全部用独立渠道复查 |
| R5 | 全量清理依赖"用户无文档"，多文档只做 orphan cleanup | DEL-05/07 |
| R6 | 重启遗漏，cleanup 任务无恢复机制 | （记录，不强制测） |

### 6.3 用例

> 前置约定：测试文档统一 **full 模式**处理至 ready（删除后才能同时验证知识图谱、Wiki、向量、分块四类残留）。为节省耗时，单文档级联用例（DEL-01~04、KG-DEL-*）用**小文档**；多文档场景（DEL-05~07）用两份小文档；处理中删除（DEL-08）用小文档（graph 阶段耗时可控）。删除后轮询 cleanup 任务终态再做残留断言。残留验证绕过空校验，走独立渠道。

**A. 基础级联删除（P0）⭐**
| 编号 | 用例 | 文档 | 操作 | 预期 |
|---|---|---|---|---|
| DEL-01 | 删除不带 deleteWiki | 小(full) | 删 full 文档（默认参数） | DB 行消失；**Wiki 残留**（R1，记录为已知行为/待确认缺陷）；知识图谱经等待后无该文档实体 |
| DEL-02 | 删除 + deleteWiki=true | 小(full) | 删 full 文档带参数 | DB 行消失；Wiki 全删；知识图谱无残留 |
| DEL-03 | 等 cleanup 完成再验证 | 小(full) | 轮询 cleanup 任务终态 | completed，记录 verification/issues |
| DEL-04 | 磁盘文件清理 | 小(full) | 查 data/documents/{userId}/{docId} | 目录已删（cleanup 后） |

**B. 知识图谱残留验证（P0）⭐核心**
| 编号 | 用例 | 文档 | 操作 | 预期 |
|---|---|---|---|---|
| KG-DEL-01 | 删除后实体清空 | 小(full) | 删 full 文档等 cleanup 完成查 /knowledge/entities | 无该文档实体，数量删除前>0 删除后=0 |
| KG-DEL-02 | 删除后无残留关系 | 小(full) | 查 /knowledge/graph | 不含该文档实体/关系 |
| KG-DEL-03 | 图谱缓存失效 | 小(full) | 删除后立即→稍后两次查 graph | 结果一致无残留（验证 invalidateUserGraph） |
| KG-DEL-04 | health 状态 | 小(full) | 查 /knowledge/health | staleRagDocIds 不含该文档 |

**C. 多文档场景（P1）——验证 R5**
| 编号 | 用例 | 文档 | 操作 | 预期 |
|---|---|---|---|---|
| DEL-05 | 删其一留其一 | 两份小(full) | 上传两份 full（都 ready）删 A 带 deleteWiki | A 专属 Wiki/实体删；B 保留完好；A 共引条目仅移除引用保留 |
| DEL-06 | 共享条目引用修剪 | 两份小(full) | 两文档共引一条目删其一 | 条目保留，sourceRefs 移除被删引用 |
| DEL-07 | 全删后 RAG 重置 | 两份小(full) | 删掉所有文档 | resetUserRag 触发，graphml 清空，entities 为空 |

**D. 处理中删除（P1）——验证 R3**
| 编号 | 用例 | 文档 | 操作 | 预期 |
|---|---|---|---|---|
| DEL-08 | 处理中删除 | 小(full) | 上传 full，处理到 graph 阶段时删 | 任务取消；cleanup 等 settle；最终图谱无残留；记录 cleanup 实际耗时 |
| DEL-09 | 处理中删除超时（P2） | 小(full) | graph 长时间运行时删 | 记录 settle 是否接近 10min 上限 |

**E. 边界删除（P2）**
| 编号 | 用例 | 预期 |
|---|---|---|
| DEL-10 | 重复删同一文档 | 404 |
| DEL-11 | 删不存在文档 | 404 |
| DEL-12 | 删 pending（未处理）文档 | DB 行删，无 RAG 残留 |

### 6.4 独立验证手段（绕过 R4 空校验）

| 验证对象 | 方法 | 清除口径 |
|---|---|---|
| DB 残留 | /api/v1/library/documents 列表 | 不应出现 |
| **知识图谱** | /knowledge/entities + /knowledge/graph + /knowledge/health(staleRagDocIds) | 无该文档实体/关系 |
| **Wiki** | /wiki/entries?documentId=... + 全量列表 | 无该文档条目 |
| 磁盘文件 | data/documents/{userId}/{docId} + data/rag/{userId} | 目录已删（若测试机有访问权限） |
| cleanup 任务 | /api/v1/tasks 过滤 type=document_cleanup | 终态 + verification + issues |

**验证时机**：删除后轮询 cleanup 任务到终态，再额外等 30s 让缓存失效生效，然后断言。处理中删除（DEL-08）放宽超时 ≥12 min。

---

## 七、测试辅助逻辑（helpers）

```
e2e/
├─ global-setup.ts          # 登录 admin/Admin@123 → storageState
├─ global-teardown.ts       # 按 [E2E] 前缀 + e2e 标签清理测试数据
├─ helpers/
│  ├─ api.ts                # 带鉴权 cookie 的 fetch 封装
│  ├─ task-poller.ts        # waitForTask(taskId, timeout)
│  ├─ pipeline.ts           # waitForPipelineStage / assertPipelineNodeSet / measureProcessingTime
│  ├─ delete-verify.ts      # 独立渠道残留验证（绕过空校验）
│  ├─ sse.ts                # SSE 事件流捕获/断言
│  └─ assertions.ts         # AI 友好断言（非空/结构/状态机）
├─ *.spec.ts                # 各通用模块用例
├─ processing-modes.spec.ts # 模块 5A
├─ delete-cascade.spec.ts   # 模块 5B
└─ master-flow.spec.ts      # 端到端主链路
```

关键 helper：
- `waitForTask(taskId, timeout)`：轮询 `/api/v1/tasks/[id]` 到终态
- `waitForPipelineStage(docId, stageKey, status, timeout)`：基于 `/api/v1/library/documents/[id]` 的 pipeline.stages/branches 断言
- `assertPipelineNodeSet(docId, expectedKeys[])`：断言详情页节点 key 集合与模式匹配
- `measureProcessingTime(docId, mode)`：记录 queued→ready 墙钟耗时 + 各阶段时间戳
- `verifyDeletionIndependent(docId)`：走 entities/graph/wiki/health 独立复查残留

---

## 八、数据隔离与清理策略

- **前缀/标签**：测试创建的文档/会话/草稿/wiki 统一带 `[E2E]` + `e2e` 标签
- **teardown**：每轮结束按前缀/标签仅删测试数据，扫描删除，不动其余
- **配置不动**：provider/嵌入模型只读或建后即删；改密码/默认模型用后强制还原
- **幂等可重跑**：重复上传走去重分支（90MB 文档上传一次后，重复上传验证 DUPLICATE）

---

## 九、执行策略（时间成本）

**文档分配已优化**：另三项（standard/graph/wiki）用小文档（8.7MB，medium 档，单项 2–14 min），仅 full 用大文档（90MB，heavy 档，30–81 min）。设计两套执行策略：

### 冒烟套件（日常/CI，约 30–50 min）
- 模块 1–4、11–12、14（前端 + 模型只读 + 导航）
- 5A 的 A 组（MODE-01~05，纯前端模式交互，不真实处理）
- 5B 的边界用例（DEL-10/11/12）
- **不跑**真实文档处理/写作/删除级联（避免长耗时与 token 消耗）

### 完整套件（按需/验收，约 1.5–2.5 小时）
- 全部模块
- 5A 的 B/C 组：小文档跑 standard/graph/wiki（约 20–40 min）+ 大文档跑 full 一次（30–81 min）
- 5B 全部：小文档级联删除（含 DEL-08 处理中删除，小文档 graph 阶段较短，约 5–15 min）
- 端到端主链路（full 大文档）

### 效率对比说明（EFF 组）
- **小文档内**（standard/graph/wiki 同尺寸）做 graph 倍率（1.5–1.8×）与 wiki 增量验证——数据可直接比较
- **full 单独**用大文档验证其预估区间是否被命中——不与前三项比绝对耗时（尺寸不同）
- 如需 full 与其他模式同尺寸对比，可额外用小文档跑一次 full（可选，EFF-05 已覆盖大文档命中验证）

---

## 十、交付物

1. 本方案文档（已完成落盘：`docs/test-plan-browser-2026-06-29.md`）
2. Playwright 脚本（已落盘到 `e2e/`，含 helpers + 11 个 spec 文件）
3. 效率对比报告：`docs/test-report-processing-modes-2026-06-29.md`（EFF 组产出，@full 执行后生成）
4. 执行报告：通过率 / 失败项 / 截图 / 录像（`pnpm e2e:report` 查看）

### 实际执行状态

**71 个用例（48 @smoke + 23 @full），全部模块已实现并验证。**

#### 已验证通过的关键用例

| 模块 | 用例 | 状态 | 实测证据 |
|---|---|---|---|
| 鉴权/导航/仪表盘/模型/设置/非功能 | 36 @smoke | ✅ passed | 2.5-2.8 min |
| **5A 四模式流水线** | standard/graph/wiki/full | ✅ passed | 节点数 5/6/6/7 一致；full-90MB 9.6min |
| **5A 流水线中间态** | PIPE-03 | ✅ passed | basicReady：分支 active 线性 done |
| **5B 删除级联** | DEL-01/02/05/KG-DEL | ✅ passed | DB/图谱/Wiki 独立复查全清 |
| **模块6 头脑风暴** | BS-01~04 | ✅ passed | BS-04 篇幅门控（GENERATE_DIRECT 不放行）✓ |
| **模块7 写作** | WR-01~05/11/12 | ✅ passed | WR-03 SSE 722 chunks done ✓；WR-04 confirm locked ✓ |
| **模块8 导出** | EXP-01/02/03 | ✅ passed | MD(1810B)/PDF(292KB)/DOCX(37KB) ✓ |
| **模块9/10 Wiki/拓扑** | WIKI/KG | ✅ passed | 7 @smoke passed |
| **模块13 E2E-MASTER** | 全链路 | ✅ passed | 上传→处理→头脑风暴→草稿→SSE生成→确认→导出 (3.4min) ✓ |

**全部核心验证点覆盖**：

1. **四模式流水线节点一致性**：standard=5 / graph=6 / wiki=6 / full=7 节点 ✓
2. **流水线中间态**：basicReady 时分支 active、线性 done（enhancing 徽标）✓
3. **文档删除级联清理**：默认不删 Wiki（设计行为）；deleteWiki=true 全清；多文档隔离 ✓
4. **头脑风暴篇幅硬门控**：gathering 阶段 GENERATE_DIRECT 不调用 LLM ✓
5. **写作 SSE 流式**：事件序列 references→reasoning*→chunk*→assets→done ✓
6. **导出三种格式**：MD/PDF/DOCX 均成功（Playwright + python-docx 外部依赖验证）✓
7. **端到端主链路**：六模块串联回归基线通过 ✓

**效率数据**（`e2e/.report/efficiency.json`）：
- graph 小文档：0.36 min | wiki 小文档：1.24 min | full 90MB：**9.6 min**
- 单节 SSE 生成：26-27s（722-976 chunks）

**工程规模**：17 个 spec 文件 + 9 个 helpers，71 个用例。测试文档已全部清理。

#### 运行命令
```bash
pnpm e2e:smoke   # 48 个冒烟用例（约 3 min）
pnpm e2e:full    # 23 个真实 LLM 用例（约 30-60 min）
pnpm e2e         # 全部 71 个
pnpm e2e:report  # HTML 报告 + 截图/录像
```

---

## 十一、待确认决策点

以下点我已采用默认处理（见各点说明），你可审核调整：

| # | 决策点 | 默认处理 | 备选 |
|---|---|---|---|
| D1 | DEL-01（默认不删 Wiki）判定 | 记录为"已知行为"，如实测试并在报告中标注，等你确认是预期还是缺陷 | 直接定为 bug |
| D2 | 磁盘文件验证 | 尝试访问 data/ 目录，能则加文件系统断言，不能则只走 API | 强制要求文件访问 |
| D3 | DEL-08 处理中删除（12min settle） | 保留为完整套件用例，冒烟套件跳过 | 移除 |
| D4 | SET-03 改密码用例（有还原风险） | 保留，用后强制还原 Admin@123 | 跳过 |
| D5 | 模型管理边界（MDL-05 改默认） | 保留，用后还原原默认 | 跳过 |

> 文档分配策略（full=90MB 大文档，standard/graph/wiki=17MB 小文档）已在第二章确定，不再作为决策点列出。

---

**审核完成后**：你确认或调整"待确认决策点"，我就开始写 Playwright 脚本（先冒烟套件，再完整套件与 5A/5B 专项）。
