// Quick script to seed test Wiki entries for E2E verification.
// Run: npx tsx scripts/seed-wiki-test.mjs
import { db } from "../src/lib/db";

const db_ = db;

async function main() {
  const user = await db.user.findFirst({ where: { username: "admin" } });
  if (!user) { console.error("admin user not found"); process.exit(1); }
  console.log("Seeding Wiki entries for user:", user.id);

  const now = new Date();
  const entries = [
    {
      userId: user.id,
      type: "doc_summary",
      title: "云原生金融系统架构概览",
      slug: "云原生金融系统架构概览",
      content: "本文档描述了一个面向金融行业的云原生系统架构方案，涵盖微服务拆分、容器编排、数据一致性、安全合规等核心主题。系统采用 Kubernetes 作为容器编排平台，通过 Istio 实现服务网格，利用 Kafka 处理异步事件，并遵循 PCI-DSS 和等保三级合规要求。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-1", chunkIndex: 0 }, { documentId: "test-doc-1", chunkIndex: 3 }]),
      confidence: 0.92,
      status: "active",
      createdAt: now, updatedAt: now,
    },
    {
      userId: user.id,
      type: "topic",
      title: "微服务通信模式",
      slug: "微服务通信模式",
      content: "系统采用同步与异步混合通信模式。内部服务间的高频调用使用 gRPC（低延迟、强类型），对外 API 使用 REST。事件驱动的场景（如交易通知、风控告警）通过 Kafka 异步解耦。这种分层设计在保证性能的同时提供了良好的可扩展性。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-1", chunkIndex: 5 }, { documentId: "test-doc-2", chunkIndex: 2 }]),
      confidence: 0.88,
      status: "active",
      createdAt: new Date(now.getTime() - 86400000), updatedAt: now,
    },
    {
      userId: user.id,
      type: "topic",
      title: "安全与合规设计",
      slug: "安全与合规设计",
      content: "安全架构涵盖传输层加密（mTLS）、身份认证（OAuth 2.0 + JWT）、数据加密（AES-256-GCM at rest）。合规方面遵循 PCI-DSS 3.2.1（支付卡数据保护）和中国等保三级要求，包括审计日志、访问控制、数据本地化存储。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-1", chunkIndex: 8 }]),
      confidence: 0.85,
      status: "active",
      createdAt: new Date(now.getTime() - 172800000), updatedAt: new Date(now.getTime() - 3600000),
    },
    {
      userId: user.id,
      type: "concept",
      title: "服务发现机制",
      slug: "服务发现机制",
      content: "服务发现是指微服务架构中，服务实例动态注册和发现彼此的机制。本系统使用 Kubernetes 原生的 Service + DNS 实现服务发现，配合 Istio 的 Pilot 组件进行流量管理。客户端通过 DNS 名称访问服务，由 kube-proxy 负责负载均衡。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-2", chunkIndex: 1 }]),
      confidence: 0.90,
      status: "active",
      createdAt: new Date(now.getTime() - 259200000), updatedAt: new Date(now.getTime() - 7200000),
    },
    {
      userId: user.id,
      type: "concept",
      title: "分布式事务",
      slug: "分布式事务",
      content: "在微服务环境下，跨服务的数据一致性通过 Saga 模式实现。每个业务操作被分解为一系列本地事务，通过补偿机制处理失败场景。对于强一致性要求的场景（如资金转账），使用两阶段提交（2PC）协议。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-1", chunkIndex: 10 }, { documentId: "test-doc-2", chunkIndex: 5 }]),
      confidence: 0.82,
      status: "active",
      createdAt: new Date(now.getTime() - 345600000), updatedAt: new Date(now.getTime() - 86400000),
    },
    {
      userId: user.id,
      type: "claim",
      title: "gRPC 在金融系统中的性能优势",
      slug: "grpc-在金融系统中的性能优势",
      content: "相比 REST + JSON，gRPC 基于 HTTP/2 和 Protocol Buffers，在高频内部调用场景下延迟降低约 40%，序列化开销减少 60% 以上。在每秒万级调用的风控引擎场景中，这一性能差异具有决定性意义。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-1", chunkIndex: 6 }]),
      confidence: 0.75,
      status: "active",
      createdAt: new Date(now.getTime() - 432000000), updatedAt: new Date(now.getTime() - 432000000),
    },
    {
      userId: user.id,
      type: "claim",
      title: "Kafka 在事件溯源中的应用",
      slug: "kafka-在事件溯源中的应用",
      content: "系统使用 Kafka 作为事件溯源（Event Sourcing）的持久化存储，所有领域事件以 append-only 方式写入。通过保留事件日志，系统能够重建任意时刻的状态，满足金融审计的回溯要求。",
      sourceRefs: JSON.stringify([{ documentId: "test-doc-2", chunkIndex: 8 }]),
      confidence: 0.87,
      status: "active",
      createdAt: new Date(now.getTime() - 518400000), updatedAt: new Date(now.getTime() - 172800000),
    },
  ];

  // Clear existing test entries first
  await db.wikiEntry.deleteMany({ where: { userId: user.id } });

  for (const entry of entries) {
    await db.wikiEntry.create({ data: entry });
  }

  // Add some links between entries
  const microComm = await db.wikiEntry.findFirst({ where: { userId: user.id, slug: "微服务通信模式" } });
  const grpc = await db.wikiEntry.findFirst({ where: { userId: user.id, slug: "grpc-在金融系统中的性能优势" } });
  const svcDisc = await db.wikiEntry.findFirst({ where: { userId: user.id, slug: "服务发现机制" } });
  const docSummary = await db.wikiEntry.findFirst({ where: { userId: user.id, slug: "云原生金融系统架构概览" } });

  if (microComm && grpc) {
    await db.wikiLink.create({ data: { fromId: microComm.id, toId: grpc.id, relation: "supports" } }).catch(() => {});
  }
  if (microComm && svcDisc) {
    await db.wikiLink.create({ data: { fromId: microComm.id, toId: svcDisc.id, relation: "relates" } }).catch(() => {});
  }
  if (docSummary && microComm) {
    await db.wikiLink.create({ data: { fromId: docSummary.id, toId: microComm.id, relation: "derived_from" } }).catch(() => {});
  }

  // Add change log entries
  for (const entry of entries) {
    await db.wikiChangeLog.create({
      data: { userId: user.id, entryId: null, action: "create", summary: `Created ${entry.type} "${entry.title}"` },
    });
  }

  console.log(`Seeded ${entries.length} wiki entries + links + change log`);
}

main().catch(console.error).finally(() => db_.$disconnect());
