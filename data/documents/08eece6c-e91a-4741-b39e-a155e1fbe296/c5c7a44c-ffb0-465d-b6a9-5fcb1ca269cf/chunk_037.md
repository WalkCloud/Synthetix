* 平台部署软件规划如下：

|  |  |  |
| --- | --- | --- |
| 需求项 | 具体要求 | 说明 |
| 操作系统 | X86CPU：支持在RedHat7.5，centos7.5、7.6、7.7、7.8，tlinux2.4，ubuntu18.04上部署  ARMCPU：支持在UOS2.0，银河麒麟v10上部署 | 最小安装，只需要最基础的软件包。  UOS需要手动修改配置文件，开始部署后，修改/cpaas/conf/check\_list.json文件，找到”type”:“os”这一行，在其上增加“enable”:false,如下图： |
| kernel版本 | Centos要求大于等于3.10.0-1127  RedHat要求大于等于3.10.0-898 | 1、ovn网络要求https://github.com/Tencent/TencentOS-kernel/pull/31  2、xfs碎片  3、kmem问题链接：  https://access.redhat.com/solutions/532663  <https://github.com/opencontainers/runc/issues/1725>  <https://github.com/kubernetes/kubernetes/issues/61937>  <https://github.com/kubernetes/kubernetes/issues/61937#issuecomment-567042968>  https://github.com/ACP/kube-ovn/wiki/%E5%87%86%E5%A4%87%E5%B7%A5%E4%BD%9C |
| grub启动参数1，解决kmem | 编辑/etc/default/grub（centos\redhat\tlinux）或/boot/efi/EFI/kylin/grub.cfg（麒麟）文件，在GRUB\_CMDLINE\_LINUX=这一行，找到crashkernel=auto后增加cgroup.memory=nokmem参数并执行grub2-mkconfig-o/boot/grub2/grub.cfg命令并重启后，能在/proc/cmdline中找到增加的，即代表更改成功 | https://github.com/opencontainers/runc/issues/1725https://github.com/kubernetes/kubernetes/issues/61937https://github.com/kubernetes/kubernetes/issues/61937#issuecomment-567042968 |
| grub启动参数2，关闭大页（arm环境必须） | 编辑/etc/default/grub（centos\redhat\tlinux）或/boot/efi/EFI/kylin/grub.cfg（麒麟）文件，在GRUB\_CMDLINE\_LINUX加入选项transparent\_hugepage=never，并执行grub2-mkconfig-o/boot/grub2/grub.cfg然后重启服务器。按说明这一列中的图片所述方式检查 | ![图片包含 图示  描述已自动生成](data:image/png;base64...)  图 15.8‑3  图表 十五‑5 |
| 内核模块 | 需要加载iptable\_nat模块 |  |
| 二进制程序 | sshpasssocatlspci | 在最小安装的centos下，配置好epel源，执行yuminstall-ychronypciutilsjqsshpasssocatbind-utilsnet-toolsntpdate即可保证依赖的程序都安装 |
| 用户权限 | root | 可以接受通过非root用户ssh登录，再su-成root用户 |
| sshd配置 | 各个服务器必须允许global集群的各个节点通过ssh远程登录 | 如果不是root用户，需要配置/etc/sudoers文件，做到这个用户执行sudo命令，不需要输入密码 |
| swap | 关闭 | 如果不满足，系统会有一定几率出现io飙升，造成docker卡死 |
| 防火墙 | 关闭 | Kubernetes官方要求 |
| selinux | 关闭 | Kubernetes官方要求 |
| 时间同步 | 所有服务器要求时间必须同步，误差不得超过2秒 | docker和Kubernetes官方要求 |
| 时区 | 所有服务器时区必须统一 | 设置为Asia/Shanghai |
| /etc/sysctl.conf内核参数 | vm.max\_map\_count=262144  net.ipv4.ip\_forward=1  vm.drop\_caches=3 | vm.max\_map\_count是es运行的服务器的要求  net.ipv4.ip\_forward是Kubernetes要求  关闭filecachehttps://cloud.tencent.com/developer/article/1637682 |
| hostname格式 | 字母开头，只能是字母、数字和短横线-组成，不能用短横线结尾，长度在4-23之间 |  |
| /etc/hosts | 所有服务器可以通过hostname解析成ip，可以将localhost解析成127.0.0.1注意：hosts文件内，不能有重复的hostname |  |
| 数据库 | 只在postgresql9.6.13上进行了充分测试，建议提供这个版本，并且创建ampfiledb、kongswagger和kong这三个库 | amp需求，如果不部署amp，可不提供 |
| core文件 | 关闭core文件的生成，执行ulimit-c0关闭，并且在/etc/profile文件内增加’ulimit-S-c0’这一行 | 某些情况下，pod内的进程重启，会在pod内创建core文件，大量占用磁盘空间，最终pod挂掉，甚至拖累宿主机 |
| /etc/resolv.conf的要求 | 如果有search域，可能会造成解析svc错误，需要删掉这个文件中search字段 |  |
| 使用nfs存储类 | 管理员在灵雀云ACP容器云平台管理视图上创建NFS存储类时，依赖每个节点上安装nfs客户端才能正常使用 | 在需要使用nfs存储类的集群的每个节点上执行yum-yinstallnfs-utilsrpcbind |

软件资源规划表