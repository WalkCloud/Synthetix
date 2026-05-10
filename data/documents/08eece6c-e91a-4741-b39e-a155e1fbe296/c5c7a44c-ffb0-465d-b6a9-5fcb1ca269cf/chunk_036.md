|  |  |
| --- | --- |
| 类型 | 要求说明 |
| 网络速率 | 不低于千兆，建议万兆。如果global平台和业务服务集群在不同的数据中心内或是混合云，global与业务服务集群之间网络速率不低于百兆，建议用千兆。如果没有搜集业务服务集群上的服务日志、审计等数据的需求，速度还可酌情降低。 |
| 网络时延 | 不大于2ms。如果global平台和业务服务集群在不同的数据中心内或是混合云，global与业务服务集群之间网络的延迟请保证在30ms内，最大不要超过100ms。 |
| 安全及防火墙 | Global平台的服务器之间无防火墙限制。  业务服务集群的服务器之间没有防火墙限制。  业务服务集群和平台之间建议无防火墙，如果有，请参考本章节转发规则，将端口在防火墙上放开。 |
| ip地址范围 | 部署平台的服务器，不得使用172.16-32网段的ip，如果已经使用，无法更改，就需要修改每一台服务器上的docker的配置，加上bip参数，躲过这个ip段，Kubernetes集群使用10.96.0.0/12作为clusterIP范围段，这段地址客户不能使用。10.199.0.0/16网段是global集群的cidr，如果有冲突，请在部署的时候增加–network-cidr参数指定其他网段 |
| 协议 | 支持ipv6。 |
| 路由 | 服务器有default或指向0.0.0.0这个地址的路由。 |

网络配置要求表



注意管理平台组件只支持四层转发。lb需要加上健康检查。

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

管理平台四层转发规则表



|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| 目的IP | 目的端口 | 资源池 | 协议 | 源IP | 源端口 | 备注 |
| albVIP | 80 | 客户业务服务集群的alb的所有节点 | tcp | 访问业务服务的设备 | any | 客户的http服务。 |
| albVIP | 443 | 客户业务服务集群的alb的所有节点 | tcp | 访问业务服务的设备 | any | 客户的https服务。 |
| Kubernetesapi的vip | 30900 | Kubernetes集群的所有节点 | tcp | 平台和操作人员的电 | any | 普罗米修斯 |
| Kubernetesapi的vip | 30902 | 运行Grafana的节点 | tcp | 平台和操作人员的电脑 | any | Grafana即普罗米修斯的节点 |
| Kubernetesapi的vip | 30903 | Kubernetes集群的所有节点 | tcp | 平台和操作人员的电脑 | any | alertmanager |
| Kubernetesapi的vip | 30895 | Kubernetes集群的所有节点 | tcp | 平台和集群 | any | prometheus-0的端口 |
| Kubernetesapi的vip | 30896 | Kubernetes集群的所有节点 | tcp | 平台和集群 | any | prometheus-1的端口 |
| Kubernetesapi的vip | 30897 | Kubernetes集群的所有节点 | tcp | 平台和集群 | any | prometheus-2的端口 |
| Kubernetesapi的vip | 6443 | Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | Kubernetes集群api |
| Kubernetesapi的vip | 30666 | 客户业务服务Kubernetes集群的master节点 | tcp | 访问istioingressgateway的客户端 | any | istio的网关，只有安装了微服务治理平台的集群才需要。 |
| Kubernetesapi的vip | 30667 | 客户业务服务Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | asm-grafanan，如果不部署ASM，则不需要。 |
| Kubernetesapi的vip | 30668 | 客户业务服务Kubernetes集群的master节点 | tcp | 平台、Kubernetes集群 | any | asm-jaeger，如果不部署ASM，则不需要。 |
| 业务集群所有节点的ip | 22或其他ssh | 客户业务服务Kubernetes集群的所有节点 | tcp | Global集群的所有节点 | any | 集群管理组件会持续的ssh到各个node上同步信息 |

业务集群转发规则表