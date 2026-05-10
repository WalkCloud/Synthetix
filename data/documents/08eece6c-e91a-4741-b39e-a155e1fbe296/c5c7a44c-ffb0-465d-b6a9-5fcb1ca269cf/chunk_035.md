管理集群使用kube-ovn网络模型。

每个业务集群可以根据实际的网络环境和管理需要，在创建时独立选择适应的网络模型，建议优先使用Kube-OVN或Calico网络。

* Global管理集群（管理控制面）平台四层转发规则

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| 目的IP | 目的端口 | 资源池 | 协议 | 源IP | 源端口 | 备注 |
| 第一台master的ip | 8080 | 第一台master | tcp | 操作人员的电脑 | any | 实施通过这个地址访问安装器，用于部署平台 |
| externalIP | 80 | 承载平台的Kubernetes集群的master节点 | tcp | 平台和操作人员的电脑 | any | 平台http服务，也就是集群的ingress |
| externalIP | 443 | 承载平台的Kubernetes集群的master节点 | tcp | 平台和操作人员的电脑 | any | 平台出口，也就是集群的ingress |
| globalVIP | 80 | 承载平台的Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群和调用api的设备 | any | 平台http服务，也就是集群的ingress |
| globalVIP | 443 | 承载平台的Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群和调用api的设备 | any | 平台出口，也就是集群的ingress |
| externalIP | 60080 | 承载平台的Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | 平台的镜像仓库和chart仓库，lb要加上会话保持 |
| externalIP | 30000 | 承载平台的Kubernetes集群上，添加了global=true标签的节点 | tcp | 平台和操作人员的电脑 | any | AMP（API管理平台）的kong，如果不部署AMP，就不需要 |
| externalIP | 30443 | 承载平台的Kubernetes集群上，添加了global=true标签的节点 | tcp | 平台和操作人员的电脑 | any | AMP的kong，如果不部署AMP，就不需要 |
| externalIP | 32305 | 承载平台的Kubernetes集群上，添加了global=true标签的节点 | tcp | 平台和操作人员的电脑 | any | AMP访问地址用来标识AMP入口开关，如果不部署AMP，就不需要 |
| externalIP | 31311 | 承载平台的Kubernetes集群的master节点 | tcp | 平台和操作人员的电脑 | any | AMP使用的minio的端口，如果不部署AMP，则不需要。 |
| externalIP | 32080 | 承载平台的Kubernetes集群的master节点 | tcp | 平台和操作人员的电脑 | any | 如果不部署AMP，则不需要。 |
| externalIP | 9200 | 平台跑es组件的节点 | tcp | 跑asm的业务服务集群 | any | asm平台调用链功能使用 |

Global管理集群（管理控制面）平台四层转发规则

* Region业务集群（数据面）平台四层转发规则

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| 目的IP | 目的端口 | 资源池 | 协议 | 源IP | 源端口 | 备注 |
| albVIP（部署在业务集群上的平台集群组件需要暴露部分端口，可以单独使用一个alb，也可以和承载客户自己的业务服务的alb复用） | 11780 | 客户业务服务集群的alb的所有节点 | tcp | 平台 | any | prometheus的端口 |
| 15012 | 客户业务服务集群的alb的所有节点 | tcp | 平台和业务集群 | any | istio-egressgateway，按照微服务的业务集群需要 |
| Kubernetes api的vip | 6443 | Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | Kubernetes集群api |
| Kubernetes api的vip | 30665 | 客户业务服务Kubernetes集群的master节点 | tcp | 访问istioingressgateway的客户端 | any | istio的网关，只有安装了微服务治理平台的集群才需要。 |
| Kubernetes api的vip | 30666 | 客户业务服务Kubernetes集群的master节点 | tcp | 访问istioingressgateway的客户端 | any | istio的网关，只有安装了微服务治理平台的集群才需要。 |
| Kubernetes api的vip | 30667 | 客户业务服务Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | asm-grafanan，如果不部署ASM，则不需要。 |
| Kubernetes api的vip | 30668 | 客户业务服务Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | asm-jaeger，如果不部署ASM，则不需要。 |
| 业务集群所有节点的ip | 22或其他ssh | 客户业务服务Kubernetes集群的所有节点 | tcp | Global集群的所有节点 | any | 集群管理组件会持续的ssh到各个node上同步信息 |
| 业务集群第一台master节点 | 6443 | 业务服务集群第一台master节点 | tcp | Global集群所有节点 | any | 在部署业务集群的时候，global会尝试链接kube-api判断第一台master是否成功部署，global不会链接vip，会尝试直连master节点，所以需要在部署集群期间放开，部署集群完毕之后就不需要了。 |

Region业务集群（数据面）平台四层转发规则

* 网络资源要求

|  |  |  |  |
| --- | --- | --- | --- |
| 资源 | 可选 | 数量 | 说明 |
| 证书 | 可选 | 1 | 如果不提供证书，部署脚本会自动生成一个证书，但是浏览器访问平台UI会提示安全警告，因为证书不是认证机构签发的。 |
| 平台访问地址(externalIP) | 必须 | 1 | 域名或ip地址，详细介绍请看本文档1.3章名词解释中“平台访问地址”的介绍。 |
| globalVIP | 必须 | 1 | 详细介绍请看本文档1.3章名词解释中“globalVIP”的介绍。 |
| KubernetesapiserverVIP | 必须 | 多个 | 生产环境必须，给高可用的Kubernetes集群的kube-api使用，每一个高可用的Kubernetes集群都需要一个vip。 |
| ALBVIP | 必须 | 多个 | 如果客户使用alb有高可用需求，这是必须的资源。每个客户业务服务集群的负载均衡器需要一个VIP（注意，是每个负载均衡器需要一个vip，不是每个alb实例需要一个vip）。 |
| 内网LB | 必须 | 1 | 生产环境必须，否则无法达到高可用要求。类似F5的负载均衡设备，Kubernetesapiservervip配置到这个负载均衡设备上，globalvip也配置到这个负载均衡上。 |
| 外网LB | 必须 | 1 | 生产环境必须，否则无法达到高可用要求。如果客户没有内外网区别，可以和内网lb复用。externaladdress配置到这个负载均衡设备上。 |
| 更多的访问地址 | 可选 | 多个 | 如果想通过externaladdress之外的更多的ip或域名访问global平台，请准备好域名和ip，部署平台的时候在安装页面的高级设置中添加。 |

网络资源要求表