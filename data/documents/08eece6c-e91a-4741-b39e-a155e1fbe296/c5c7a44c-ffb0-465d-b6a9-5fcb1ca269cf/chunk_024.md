MongoDB Operator 负责根据用户的配置信息来完成部署对应的 MongoDB 集群、更新集群状态、删除集群等操作。

Operator 的设计与 MongoDB 副本控制器的 Percona server 紧密相连，如下图所示。

[![图示  描述已自动生成](data:image/jpeg;base64...)](https://demo.at-servicecenter.com/console-acp/docs/img/ds/11mongodb2.png)

MongoDB产品架构

一个副本集由一个主服务器和几个辅助服务器(图中有两个)组成，客户端应用程序通过驱动程序访问这些服务器。

为了提供高可用性，Operator 尽可能使用 [节点亲和性](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) 运行 MongoDB 实例，并且数据库集群被部署为一个至少有三个节点的副本集。如果某个节点发生故障，则在另一个节点上自动重新创建带有 mongod 进程的 Pod。如果失败的节点承载主服务器，则复制集启动选择新主服务器的选举。如果失败的节点正在运行 Operator，Kubernetes 将在另一个节点上重新启动 Operator，因此正常操作不会被中断。

客户端应用程序应该使用 mongo+srv URI 作为连接。这允许驱动程序（3.6 及以上）从 DNS SRV 条目中检索副本集成员的列表，而不必列出动态分配节点的主机名。

为了为有状态应用程序提供数据存储，Kubernetes 使用了持久卷。使用 PersistentVolumeClaim （PVC）实现对 Pods 的自动存储配置。如果发生故障，容器存储接口（CSI）应该能够在不同的节点上重新挂载存储。PVC StorageClass 必须支持这个特性（Kubernetes 和 OpenShift 在版本 1.9 和 3.9 中分别支持这个特性）。

[![图示  中度可信度描述已自动生成](data:image/jpeg;base64...)](https://demo.at-servicecenter.com/console-acp/docs/img/ds/11mongodb3.png)

MongoDB产品架构

Operator 通过 PerconaServerMongoDB 实例扩展了 Kubernetes API，它被实现为一个 golang 应用程序。Operator 侦听所创建对象上的所有事件，当一个新的 PerconaServerMongoDB 实例被创建时，或者一个已有的对象被修改或删除时，Operator 会自动创建/修改/删除所有需要的 Kubernetes 对象，并设置适当的配置来提供一个正确操作的副本集。



* 创建MongoDB实例

支持配置RabbitMQ实例，以使用轻量、高效，且支持多种消息协议的开源消息代理。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

创建MongoDB实例

* 用户管理

平台创建MongoDB时默认创建的四类用户权限较高，支持连接数据库的主节点创建用户设置合理的权限。

![电脑软件截图  描述已自动生成](data:image/png;base64...)

用户管理

* 监控告警

平台内嵌了Grafana面板中的监控数据可用于从资源、性能等方面进行MongoDB监控与告警，且支持配置通知策略。

直观呈现的监控数据可用于为运维巡检或性能调优提供决策支持，完善的告警和通知机制也将帮助保障数据库稳定运行。

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

监控告警

* 日志

平台提供从容器层面了解实例运行过程中的日志，例如MongoDB错误日志。妥善使用日志能帮助用户快速定位问题，处理故障和异常。

![图形用户界面, 应用程序  中度可信度描述已自动生成](data:image/png;base64...)

日志



MongoDB Operator部署架构图：

![图示  描述已自动生成](data:image/png;base64...)

MongoDB部署架构





ACP全栈云平台具备PostgreSQL数据服务能力，PostgreSQ经过30多年的积极开发演进，PostgreSQL以可靠性、丰富功能和强大性能而著称，被业界誉为“最先进的开源关系型数据库”。PostgreSQL支持大部分的SQL标准并且提供了很多其他现代特性，如复杂查询、外键、触发器、视图、事务完整性、多版本并发控制等。Postgres Operator提供了在Kubernetes上自动创建、更新和管理 Postgres集群的功能。



Postgres Operator 通过 Patroni 能够简单地在 Kubernetes 上运行高可用的 PostgreSQL 集群。仅通过 Postgres 清单文件（CRD）对其进行配置，以简化与自动 CI/CD 管道的集成，无需直接访问 Kubernetes API，从而很简单地集成进自动化 CI/CD 流水线。

下图描述了当提交一个新的 Postgres CRD 时，Operator 创建数据库实例的过程。

![图示  描述已自动生成](data:image/png;base64...)

PostgreSQL架构

下图将为您展示单个集群 Pod 内的组件：

[![图示  描述已自动生成](data:image/png;base64...)](https://demo.at-servicecenter.com/console-acp/docs/img/ds/11postgres1.png)

单Pod架构



ACP全栈云云平台支持PostgreSQL 9.6、10、11、12版本,支持的功能如下：

* 免运维: 通过 PostgreSQL 资源配置集群。
* 可伸缩: 通过 Patroni 实现 Postgres 集群高可用。
* 滚动更新 Postgres 集群，包括：小版本更新。
* 使用 PGBouncer 作为数据库连接池。
* 还原和克隆 Postgres 集群（包括大版本升级）。
* 可以配置 S3 bucket 的逻辑备份。
* 使用 S3 WAL 备份集群。
* 可为非云环境配置。
* K8s 上的基本凭证和用户管理，简化了应用程序部署。
* 用于创建和编辑 Postgres集群的 UI。
* 创建PostgreSQL实例

配置PostgreSQL实例，以使用可靠且高性能的开源对象关系数据库。。

![图形用户界面, 文本, 应用程序, Word, 电子邮件  描述已自动生成](data:image/png;base64...)

创建PostgreSQL实例

* 监控告警

平台内嵌了Grafana面板中的监控数据可用于从资源、性能等方面进行PostgreSQL监控与告警，且支持配置通知策略。

直观呈现的监控数据可用于为运维巡检或性能调优提供决策支持，完善的告警和通知机制也将帮助保障数据库稳定运行。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

监控告警

* 日志

平台提供从容器层面了解实例运行过程中的日志，例如PostgreSQL错误日志。妥善使用日志能帮助用户快速定位问题，处理故障和异常。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

日志



Postgres集群的部署架构如下图所示：

![图形用户界面, 图示  描述已自动生成](data:image/png;base64...)

Postgres集群部署架构