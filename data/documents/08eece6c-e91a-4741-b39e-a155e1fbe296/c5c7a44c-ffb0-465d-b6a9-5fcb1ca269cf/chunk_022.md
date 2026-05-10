* Operator部署
* 指定部署命名空间
* 一键部署MySQL

在平台管理中的应用商店管理下，选择Operator分类。挑选要部署的几千年模式，并确定安装模式，点击“部署”即可完成

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

部署MySQL

* 服务实例部署
* MySQL实例创建&管理

提供灵活的实例创建方式，支持通过表单形式或YAML形式，支持RDS界面

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

创建MySQL实例

![图形用户界面, 文本, 应用程序  描述已自动生成](data:image/png;base64...)

MySQL管理界面

* 备份与恢复管理

支持两种备份方式：

自动备份：比如每天、每周、每几小时备份。

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

创建数据备份

对已备份的数据进行全量恢复，支持一键恢复

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

恢复备份

* 日志管理（慢日志、运行日志）

可通过业务视图“有状态副本集”查看MySQL实例的日志

![表格  描述已自动生成](data:image/png;base64...)

日志管理

* 性能监控及报警通知

慢日志进行分析

![屏幕的截图  描述已自动生成](data:image/png;base64...)

日志分析

设置告警策略，然后可通过业务视图“有状态副本集”查看MySQL实例的指标监控和告警：

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

监控看板





ACP全栈云平台具备Redis数据服务能力，Redis (Remote Dictionary Server)，即远程字典服务，是一个使用 ANSI C 编写的开源、支持网络、基于内存、可选持久性的键值对存储数据库，并提供多种语言的 API。 Redis Operator 是一款基于 Kubernetes，创建、配置并管理 Redis 实例的 Redis Operator，支持集群、哨兵两种部署架构。

ACP全栈云平台支持Redis 4.0、 5.0、 6.0版本，支持的功能如下：

* 支持集群、哨兵两种部署架构
* 内置监控
* PVC 动态存储
* 支持备份恢复
* 资源配额
* 密码和无密码设置
* 节点选择和亲和性
* 优先类和管理部署优先级
* SecurityContext 支持



单节点：发生单点故障容易导致数据丢失，可用于个人学习。

主从模式： Redis 提供了复制（replication）功能，可以实现当一台数据库中的数据更新后，自动将更新的数据同步到其他数据库上。从数据库一般是只读的，并接受主数据库同步过来的数据。

集群模式： Redis 的哨兵模式基本已经可以实现高可用，读写分离 ，但是在这种模式下每台 Redis 服务器都存储相同的数据，很浪费内存，所以在redis3.0上加入了 Cluster 集群模式，实现了 Redis 的分布式存储，也就是说每台 Redis 节点上存储不同的内容。根据官方推荐，集群部署至少要 3 台以上的master节点，最好使用 3 主 3 从六个节点的模式。

![图示  描述已自动生成](data:image/png;base64...)

多种产品架构示意图

哨兵模式：哨兵模式是一种特殊的主从模式，Redis提供了哨兵的命令，哨兵是一个独立的进程，它会独立运行。哨兵通过发送命令，等待Redis服务器响应，从而监控运行的多个Redis实例。当哨兵监测到master宕机，会自动将slave切换成master，然后通过发布订阅模式通知其他的从服务器，修改配置文件，让它们切换主机。

![图示  描述已自动生成](data:image/png;base64...)

哨兵模式产品架构



* Operator部署
* 指定部署命名空间
* 一键部署Redis

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

部署Redis

* 服务实例部署
* Redis实例创建&管理

![图形用户界面, 文本, 应用程序, 电子邮件  描述已自动生成](data:image/png;base64...)

创建Redis实例

* 账号创建&管理
* 备份与恢复管理

可以添加多个定时备份，比如每天、每周、每几小时备份。keep 可以指定备份保留个数，能较少地占用存储，且删除老的备份

![图形用户界面, 文本, 应用程序  描述已自动生成](data:image/png;base64...)

![图形用户界面, 应用程序, Teams  描述已自动生成](data:image/png;base64...)

备份与恢复管理

* 日志管理（慢日志、运行日志）

可通过业务视图“有状态副本集”查看redis实例的日志

![图形用户界面, 文本, 应用程序  描述已自动生成](data:image/png;base64...)

日志管理

* 性能监控及报警通知

![图表  描述已自动生成](data:image/png;base64...)

监控与报警



Redis 的部署架构如下图所示：

![图示  描述已自动生成](data:image/png;base64...)

Redis部署架构





ACP全栈云平台具备Kafka数据服务能力，Kafka是由Apache软件基金会开发的一种高吞吐量的分布式发布订阅消息系统，可以高效的处理消费者在网站中的所有动作流数据。Kafka Operator 提供了一种在 Kubernete 上运行 Apache Kafka 集群的方法, 支持多种灵活部署配置。

ACP全栈云平台支持Kafka 2.4、2.4.1 和 2.5版本，支持的功能如下：

* 管理Kafka集群: 部署和管理此复杂应用程序的所有组件，包括传统上难以管理的依赖项，例如Apache ZooKeeper 。
* 包括Kafka Connect: 允许配置通用数据源和接收器，以将数据移入和移出Kafka集群。
* topic 管理: 在集群中创建和管理Kafka topic 。
* 用户管理: 在集群中创建和管理Kafka用户。
* 连接器管理: 创建和管理Kafka Connect连接器。
* 包括Kafka Mirror Maker 1和2: 允许在不同的Apache Kafka 集群之间存储数据。
* 包括HTTP Kafka Bridge: 允许客户端通过HTTP协议通过Apache Kafka 集群发送和接收消息。
* 集群重新平衡: 使用内置的Cruise Control，可以根据指定的目标重新分配分区副本，以实现最佳的集群性能。
* 监控: 使用Prometheus和提供的Grafana dashabords进行监控的内置支持。
* 内置的Cruise Control支持集群重新平衡
* HTTP bridge 中的CORS支持
* 改进了TLS的可配置性