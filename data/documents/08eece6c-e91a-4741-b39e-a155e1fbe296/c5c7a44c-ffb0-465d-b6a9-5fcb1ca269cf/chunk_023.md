ACP全栈云平台使用Strimzi技术提供Kafka服务，Strimzi简化了在 Kubernetes 集群中运行 Apache Kafka 的过程。Strimzi 允许开发者在 Kubernetes 上运行 Apache Kafka 及其生态系统。它提供了用于运行 Apache Kafka 的容器镜像。Strimzi 由 CNCF（Cloud Native Computing Foundation，云原生计算基金会）托管。

Strimzi 使用 Operators 支持 Kafka 来部署和管理 Kafka 到 Kubernetes 的组件和依赖项。Kafka Operator 用于部署、管理和配置 Apache Kafka 集群。Strimzi 体系结构中的 Operator 如下图所示。

![图示  描述已自动生成](data:image/png;base64...)

Strimzi 体系结构中的 Operator



* 一键部署

支持通过创建 Kafka实例，创建Kafka集群。

![图形用户界面, 文本, 应用程序  描述已自动生成](data:image/png;base64...)

创建Kafka实例

* 用户配置

请按需配置 Kafka 用户。每个 Kafka 用户即一个 KafkaUser 实例。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

创建Kafka用户

* Topic管理

Topic即数据主题，平台支持生产者将信息写入Topic，消费者可从Topic中读取信息。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

创建Topic

同时Topic还划分了多个分区用于分布式存储消息，平台支持对分区进行更新、管理、扩展、删除等操作。

![图形用户界面, 应用程序, Teams  描述已自动生成](data:image/png;base64...)

管理分区

* 参数配置

Kafka实例中默认使用Kafka官方提供的系统参数，平台支持用户在界面便捷地配置参数。

![电脑屏幕截图  描述已自动生成](data:image/png;base64...)

更新参数

* 消息投递（从集群内）

平台支持从集群内使用生产者、消费者与 kafka 进行消息投递。

* 消息投递（从集群外）

平台支持从集群外使用生产者、消费者与 kafka 进行消息投递。

* 监控告警

平台内嵌了Grafana面板中的监控数据可用于从资源、性能等方面进行 Kafka 监控与告警，且支持配置通知策略。

直观呈现的监控数据可用于为运维巡检或性能调优提供决策支持，完善的告警和通知机制也将帮助保障数据库稳定运行。

![电脑截图  描述已自动生成](data:image/png;base64...)

监控告警

* 日志

平台提供从容器层面了解实例运行过程中的日志，例如 Kafka 错误日志。妥善使用日志能帮助用户快速定位问题，处理故障和异常。

![文本, 电子邮件  描述已自动生成](data:image/png;base64...)

日志



Kafka部署架构如下图所示：

![图片包含 图示  描述已自动生成](data:image/png;base64...)

Kafka部署架构

Kafka部署架构中一共包含了三个Operator：Cluster Operator、User Operator和Topic Operator。在用户提交了创建资源（Kafka CR）之后，Cluster Operator会部署出一个Kafka集群和一个ZooKeeper集群。用户也可以通过创建User CR和Topic CR来创建Kafka User和Kafka Topic。部署架构如下图所示。





ACP全栈云平台具备RabbitMQ数据服务能力，RabbitMQ是实现了高级消息队列协议（AMQP）的开源消息代理软件（亦称面向消息的中间件）。RabbitMQ 有成千上万的用户，是最受欢迎的开源消息代理之一。从 T-Mobile 到 Runtastic，RabbitMQ 在全球范围内的小型初创企业和大型企业中都得到使用。

ACP全栈云平台支持3.8.12版本，支持的功能如下：

* 可靠性：RabbitMQ 使用一些机制来保证可靠性，如持久化、传输确认及发布确认等。
* 灵活的路由：在消息进入队列之前，通过交换器来路由消息。对于典型的路由功能，RabbitMQ 已经提供了一些内置的交换器来实现。针对更复杂的路由功能，可以将多个交换器绑定在一起，也可以通过插件机制来实现自己的交换器。
* 扩展性：多个 RabbitMQ 节点可以组成一个集群，也可以根据实际业务情况动态地扩展集群中节点。
* 高可用性：队列可以在集群中的机器上设置镜像，使得在部分节点出现问题的情况下队列仍然可用。
* 多种协议：RabbitMQ 除了原生支持 AMQP 协议，还支持 STOMP、MQTT 等多种消息中间件协议。
* 多语言客户端：RabbitMQ 几乎支持所有常用语言，比如 Java、Python、Ruby、PHP、 C#、JavaScript 等。
* 管理界面：RabbitMQ 提供了一个易用的用户界面，使得用户可以监控和管理消息、集群中的节点等。
* 插件机制：RabbitMQ 提供了许多插件，以实现从多方面进行扩展，当然也可以编写自己的插件。



![图示  描述已自动生成](data:image/png;base64...)

RabbitMQ产品架构示意图



* 创建RabbitMQ实例

支持配置RabbitMQ实例，以使用轻量、高效，且支持多种消息协议的开源消息代理。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

创建RabbitMQ实例

* 参数配置

RabbitMQ 实例中默认使用 RabbitMQ 官方提供的系统参数。平台支持用户在界面便捷地配置参数。

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

更新参数

* 监控告警

平台内嵌了Grafana面板中的监控数据可用于从资源、性能等方面进行 Kafka 监控与告警，且支持配置通知策略。

直观呈现的监控数据可用于为运维巡检或性能调优提供决策支持，完善的告警和通知机制也将帮助保障数据库稳定运行。

![图形用户界面, 应用程序, 网站  描述已自动生成](data:image/png;base64...)

监控告警

* 日志

平台提供从容器层面了解实例运行过程中的日志，例如RabbitMQ错误日志。妥善使用日志能帮助用户快速定位问题，处理故障和异常。

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

日志



部署架构包含了以下四种：

* 主备模式 Warren
* 镜像模式 Mirror（重点）
* 远程模式 Shovel
* 多活模式 Federation

![图示  描述已自动生成](data:image/png;base64...)

![在这里插入图片描述](data:image/png;base64...)

RabbitMQ部署架构图





MongoDB是一个基于分布式文件存储的数据库，旨在为WEB应用提供可扩展的高性能数据存储解决方案，具有高性能、可扩展、易部署、易使用等特性，存取数据非常方便

MongoDB Operator支持版本：MongoDB 4.2，

* 集群扩展-通过改变size参数来增加和移除副本集成员。最小可用副本集成员大小建议为3.
* 监控-轻松部署 Percona监视和管理(PMM)，以监视Percon服务器的MongoDB副本集。安装过程推荐使用Helm(Kubernetes的软件包管理器)。
* 自动备份-配置自动备份使其按计划运行或随时按需运行。备份是使用Percona Backup for MongoDB（PBM）执行的，可以存储在本地PV上或任何与S3兼容的云存储提供商中。