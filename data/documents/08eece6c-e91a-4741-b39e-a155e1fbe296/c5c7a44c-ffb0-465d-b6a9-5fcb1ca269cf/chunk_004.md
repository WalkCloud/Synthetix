灵雀云ACP容器云平台采用开源组件均为社区发行，无自性修改，保持与开源社区一直，无厂商绑定。以下为灵雀云ACP(v3.8)使用的主要开源软件及版本：

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

![图形用户界面, 应用程序  描述已自动生成](data:image/png;base64...)

产品版本情况

ACP所使用的全部组件版本、用途及说明如下：

|  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 序号 | 组件名称 | 产品 | 部署位置 | 安装namespace | 部署方式 | 安装Chart | 安装operator | 来源 | 版本 | 开源协议  （链接协议地址） | 语言 | 业务功能 | 备注 |
| 1 | mc（minio-client） | - | global | kube-system | staticpod | - |  | 开源 | RELEASE.2020-11-25T23-04-07Z | Apache2.0开源协议 | go | minioclient |  |
| 2 | minio | - | global | kube-system | staticpod | - |  | 开源 | RELEASE.2020-12-03T00-03-10Z | Apache2.0开源协议 | go | registry用到的存储 |  |
| 3 | cert-manager-controller | Base | global | cert-manager | deployment | cert-manager |  | 开源 |  | [Apache2.0协议](https://github.com/jetstack/cert-manager/blob/master/LICENSE) | go | 证书管理Controller | 业务集群不再需要部署 |
| 4 | cert-manager-cainjector | Base | global | cert-manager | deployment | cert-manager |  | 开源 |  | [Apache2.0协议](https://github.com/jetstack/cert-manager/blob/master/LICENSE) | go | 证书Injector | 业务集群不再需要部署 |
| 5 | cert-manager-webhook | Base | global | cert-manager | deployment | cert-manager |  | 开源 |  | [Apache2.0协议](https://github.com/jetstack/cert-manager/blob/master/LICENSE) | go | 证书管理webhook | 业务集群不再需要部署 |
| 6 | dex | Base | global | cpaas-system | deployment | dex |  | 自研+开源 |  | [Apache2.0开源协议](https://github.com/dexidp/dex/blob/master/LICENSE) | go | 平台登录认证组件 |  |
| 7 | erebus | Base | global | cpaas-system | deployment | ACP-base |  | 自研 |  |  | go | 业务集群kube-apiserver的代理 |  |
| 8 | galaxycontroller | Base | cluster |  | deployment |  |  | 开源 |  |  | go | 网络管理组件 | addon |
| 9 | kubernetes-event-exporter | Base | global、cluster | cpaas-system | deployment | ACP-cluster-base |  | 开源 |  |  | go | k8s事件收集组件 |  |
| 10 | underlord | Base | global | cpaas-system | deployment | ACP-base |  | 自研 |  |  | ts、js | 平台管理、项目管理的UI |  |
| 11 | alertmanager-kube-prometheus | Base | global、cluster | cpaas-system | statefulset | proetheus-operator |  | 开源 |  | [Apache2.0开源协议](https://github.com/prometheus/alertmanager/blob/master/LICENSE) | go | apollo的数据后端 |  |
| 12 | courier | Base | global | cpaas-system | deployment | ACP-aiops |  | 自研 |  |  | go | 通知管理 |  |
| 137 | cpaas-elasticsearch | Base | global | cpaas-system | Deplo77yment | elasticsearch |  | 开源 | 6.7.1 | [Apache2.0开源协议](https://github.com/elastic/elasticsearch/blob/master/LICENSE.txt) | Java | 日志、事件、审计存储组件 | 官方组件 |
| 14 | cpaas-kafka | Base | global | cpaas-system | deployment | kafka-zookeeper |  | 开源 | 2.2.1 | [Apache2.0开源协议](https://github.com/apache/kafka/blob/trunk/LICENSE) | Java | 消息中间件 | 日志、事件、审计使用。官方组件 |
| 15 | cpaas-kibana | Base | global | cpaas-system | deployment | elasticsearch |  | 开源 | 6.7.1 | [Apache2.0开源协议](https://github.com/elastic/kibana/blob/master/LICENSE.txt) | ts | 第三方日志面板 | 官方组件 |
| 16 | cpaas-zookeeper | Base | global | cpaas-system | deployment | kafka-zookeeper |  | 开源 | 3.5.6 | [Apache2.0开源协议](https://github.com/apache/zookeeper/blob/master/LICENSE.txt) | Java | key-value存储，kafka使用 | 官方组件 |
| 77 | kube-prometheus-exporter-kube-state | Base | cluster | cpaas-system | deployment | kube-prometheus |  | 开源 |  | [Apache2.0开源协议](https://github.com/kubernetes/kube-state-metrics/blob/master/LICENSE) | go | k8s监控数据的exporter |  |
| 18 | kube-prometheus-exporter-node | Base | global、cluster | cpaas-system | daemonset | prometheus-operator |  | 开源 |  | [Apache2.0开源协议](https://github.com/prometheus/node_exporter/blob/master/LICENSE) | go | node节点监控的exporter |  |
| 19 | kube-prometheus-grafana | Base | cluster | cpaas-system | deployment | kube-prometheus |  | 开源 | 7.5.2 | [Apache2.0开源协议](https://github.com/grafana/grafana/blob/master/LICENSE) | go | grafana监控面板 |  |
| 20 | thanos | Base | global、cluster | cpaas-system | deployment | prometheus-operator |  | 开源 |  |  | go | prometheus高可用组件 | 如果不需要高可用，可以不部署 |
| 21 | manevermore | Base | cluster | cpaas-system | daemonset | ACP-log-agent |  | 自研+开源 | 1.10.2 | [Apache2.0开源协议](https://github.com/fluent/fluentd/blob/master/LICENSE) | ruby  go | 应用日志事件审计的采集agent  node异常事件收集，  node上k8s证书信息收集  文件指标采集 | 事件、审计通过落盘成日志文件，由nevermore收集。  node异常事件收集由nevermore中的npd容器实现。 |
| 22 | prometheus-kube-prometheus | Base | global、cluster | cpaas-system | statefulset | prometheus-operator |  | 开源 | 2.10 | [Apache2.0开源协议](https://github.com/prometheus/prometheus/blob/master/LICENSE) | go | 监控组件Prometheus | 官方组件 |
| 23 | prometheus-operator | Base | global、cluster | cpaas-system | deployment | prometheus-operator |  | 开源 |  | [Apache2.0开源协议](https://github.com/coreos/prometheus-operator/blob/master/LICENSE) | go | 监控组件PrometheusOperator | 官方组件 |
| 24 | olm-operator | ACP | global、cluster | olm | deployment | ACP-cluster-base |  | 开源 |  | [Apache2.0开源协议](https://github.com/tkestack/tke/blob/master/LICENSE) | go | Operator生命周期管理operator |  |
| 25 | catalog-opeartor | ACP | global、cluster | olm | deployment | ACP-cluster-base |  | 开源 |  | [Apache2.0开源协议](https://github.com/tkestack/tke/blob/master/LICENSE) | go | OperatorCatalog管理 |  |
| 26 | packageserver | ACP | global、cluster | olm | deployment | ACP-cluster-base |  | 开源 |  | [Apache2.0开源协议](https://github.com/tkestack/tke/blob/master/LICENSE) | go | olm相关组件 |  |
| 27 | ACP-devops-credentials-provider-plugin | DevOps | global、cluster | — | jenkins插件 | ACP-jenkins |  | 开源 |  | [MIT许可协议](https://github.com/jenkinsci/jenkins/blob/master/LICENSE.txt) | java | 同步凭据到jenkins的插件 |  |
| 28 | ACP-devops-pipeline-plugin | DevOps | global、cluster | — | jenkins插件 | ACP-jenkins |  | 开源 |  | [MIT许可协议](https://github.com/jenkinsci/jenkins/blob/master/LICENSE.txt) | java | 提供DSL的插件 |  |
| 29 | ACP-devops-sync-plugin | DevOps | global、cluster | — | jenkins插件 | ACP-jenkins |  | 开源 |  | [MIT许可协议](https://github.com/jenkinsci/jenkins/blob/master/LICENSE.txt) | java | 执行/同步流水线到jenkins |  |
| 30 | ACP-kubernetes-support-plugin | DevOps | global、cluster | — | jenkins插件 | ACP-jenkins |  | 开源 |  | [MIT许可协议](https://github.com/jenkinsci/jenkins/blob/master/LICENSE.txt) | java | 提供访问global集群的配置 |  |
| 31 | devops-api | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | go | DevOps高级API |  |
| 32 | devops-apiserver | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | go | DevOpsAPIServer |  |
| 33 | devops-controller | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | go | DevOpsController |  |
| 34 | devops-docs | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | md | ACPdevops用户手册文档 |  |
| 35 | devops-next-controller-manager | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | go | 第三方工具webhook事件处理 |  |
| 36 | devops-next-eventlistener | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | go | 第三方工具webhook事件接受 |  |
| 37 | devops-tool-operator | DevOps | cluster | cpaas-system | deployment | - |  | 自研 |  |  | go | DevOps工具链的operator |  |
| 38 | diablo-frontend | DevOps | global | cpaas-system | deployment | ACP-devops |  | 自研 |  |  | ts、js | DevOpsUI |  |
| 39 | harbor | DevOps | cluster | — | deployment | harbor |  | 开源 |  | [Apache2.0开源协议](https://github.com/goharbor/harbor/blob/master/LICENSE) | go | 镜像仓库，用operatorhub部署 |  |
| 40 | jenkins | DevOps | cluster | — | deployment | ACP-jenkins |  | 开源 |  | [MIT许可协议](https://github.com/jenkinsci/jenkins/blob/master/LICENSE.txt) | java | Jenkins服务，用operatorhub部署 | 配置/chart是我们提供的，jenkins源码没有改动，有自研的插件 |
| 41 | gitlab | DevOps | cluster | — | deployment | gitlab-ce |  | 开源 |  | [MIT许可协议](https://github.com/jenkinsci/jenkins/blob/master/LICENSE.txt) |  | 代码仓库，用operatorhub部署 |  |
| 42 | sonarqube | DevOps | cluster | — | deployment | sonarqube |  | 开源 |  | [LGPL协议](https://github.com/SonarSource/sonarqube/blob/master/LICENSE.txt) |  | 代码扫描，用operatorhub部署 | chart加了社区的一个插件 |
| 43 | nexus | DevOps | cluster | — | deployment | sonarqube |  | 开源 |  | [EPL-1.0协议](https://github.com/sonatype/nexus-public/blob/master/LICENSE.txt) | java,groovy | 制品仓库 |  |
| 44 | testlink | DevOps | cluster | — | deployment | testlink |  | 开源 |  |  | php | 测试管理工具 | 2.12新增 |
| 45 | grafana | ASM | cluster | istio-system | deployment |  | istio-operator | 开源 |  | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Istio官方组件 |  |
| 46 | asm-controller | ASM | cluster | cpaas-system | deployment |  | asm-operator | 自研 |  |  | go | ASMController |  |
| 47 | istio-operator | ASM | cluster | istio-system | deployment |  | operatorhub | 开源 | 1.6.5、1.8.3 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Istio官方组件 |  |
| 48 | istiod | ASM | cluster | istio-system | deployment |  | istio-operator | 开源 | 1.6.5、1.8.3 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Istio官方组件 |  |
| 49 | istio-egressgateway | ASM | cluster | istio-system | deployment |  | istio-operator | 开源 | 1.6.5、1.8.3 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Istio官方组件 |  |
| 50 | istio-ingressgateway | ASM | cluster | istio-system | deployment |  | istio-operator | 开源 | 1.6.5、1.8.3 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Istio官方组件 |  |
| 51 | flagger-operator | ASM | cluster | istio-system | deployment |  | operatorhub | 开源 |  |  |  |  |  |
| 52 | flagger | ASM | cluster | istio-system | deployment |  | flagger-operator | 自研+开源 |  | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | flagger官方组件 |  |
| 53 | jaeger-operator | ASM | cluster | istio-system | deployment |  | operator-hub | 开源 | 1.18.1 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Jaeger官方组件 |  |
| 54 | jaeger-prod-collector | ASM | cluster | istio-system | deployment |  | jaeger-operator | 开源 | 1.7 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | Jaeger官方组件 |  |
| 55 | jaeger-prod-query | ASM | cluster | istio-system | deployment |  | jaeger-operator | 自研+开源 |  | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | ts | Jaeger官方组件 |  |
| 56 | gpu-manager | ACP | cluster | kube-system | deployment | chart-gpu-manager |  | 开源 | 1.04 | [Apache2.0开源协议](https://github.com/helm/chartmuseum/blob/master/LICENSE) | go | GPU虚拟化组件 |  |