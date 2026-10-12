# Docker 部署与 NOI Linux 2.0 编译环境

默认 Docker 镜像内置 Ubuntu 20.04 用户空间和以下工具链：

| 项目 | 镜像基线 |
| --- | --- |
| 架构 | x86_64，64 位 ABI |
| GCC / G++ | 9.3.0，APT 包版本 `9.3.0-10ubuntu2` |
| FPC | 3.0.4，包含 RTL、base、FCL |
| Python | 2.7 / 3.8 |
| 竞赛 C++14 | `-std=c++14 -O2 -static`，保留 `ONLINE_JUDGE` |
| judge 服务运行时 | Node 10.24.1 |

基线来自 [NOI Linux 2.0 官方环境说明](https://www.noi.cn/gynoi/jsgz/2021-07-16/732450.shtml)。
Ubuntu 和 Node 基础镜像固定 digest，GCC 及其开发包固定 9.3.0，避免随
Ubuntu 更新漂移为 9.4。系统库采用 Ubuntu 20.04 的更新包；这些包会得到该发行版
公开源提供的修补。容器共享宿主内核，运行耗时也由宿主硬件决定。

Docker 默认启用 `SYZOJ_JUDGE_LANGUAGE_PROFILE=noi-linux2`，提供 C、C++03/11/14/17、
原有 NOI C/C++ 标识、Pascal、Python 2/3。`cpp14` 和 `cpp-noilinux` 使用 C++14
竞赛配置。其他标准需明确选择对应语言。外置自定义 rootfs 可设置
`SYZOJ_JUDGE_LANGUAGE_PROFILE=legacy` 使用原有语言定义。
NOI profile 使用独立编译缓存 key，并检查二进制 metadata 的工具链标识；升级后会
重新编译同源码的旧产物。daemon 和 runner 应使用相同镜像及 profile。

## 构建

在包含本地 sandbox 提交的相邻目录布局中：

```text
12oj/
  simple-sandbox/
  judge-v3/
```

Windows PowerShell，在 `judge-v3` 内执行：

```powershell
.\docker\build-local.ps1
```

Linux 或手动构建：

```sh
docker buildx build --load --platform linux/amd64 \
  --build-context sandbox-source=../simple-sandbox \
  --build-arg SANDBOX_SOURCE=local \
  -t 12oj-judge:noilinux2 .
```

本地模式只在构建阶段把 sandbox 的 Git 地址映射到相邻 checkout，仍按
`package.json` 的精确 commit 和原始 `yarn.lock` 做 frozen install。
发布该 sandbox commit 后，普通远端构建可直接使用：

```sh
docker buildx build --load --platform linux/amd64 -t 12oj-judge:noilinux2 .
```

无内置 rootfs 版本可用 `--target judge-no-rootfs`，或兼容入口
`-f Dockerfile.NOROOTFS`。运行时在 `/rootfs` 挂载预先准备好的工具链；NOI profile
启动会检查实际版本。普通外置 rootfs 可选择 `legacy` profile。

## 运行

宿主 Docker Engine 应使用 cgroup v2，具备 `cpu`、`memory`、`pids` controller，以及
`memory.peak`、`memory.swap.max` 等接口；通常要求 Linux 5.19 或更新内核。
Docker Compose 2.15+ 支持本示例的 `cgroup: private`。

把服务配置放入 `config/`：

- `judge-daemon.json`：按 `daemon-config-example.json` 填写服务器和队列设置。
- `runner-shared.json`：按 `runner-shared-config-example.json` 填写 RabbitMQ、Redis、
  sandbox 用户等设置；镜像环境变量会覆盖 rootfs、工作目录和测试数据目录。
- `runner-instance-runner.json`：按 `runner-instance-config-example.json` 配置稳定
  parent 名 `syzoj-1`；镜像默认 cgroup root 是容器内 `/sys/fs/cgroup`。

```sh
docker compose up -d
```

`compose.yaml` 将 daemon 和 runner 分开。runner 使用私有 cgroup namespace，增加
`SYS_ADMIN`、`SYS_RESOURCE`，并设置对应 seccomp/AppArmor 选项。入口仅在私有 namespace
内把自己的 cgroup 挂载改为可写。Node 管理进程随后迁入 `.sandbox-manager`，每次
编译或执行使用独立测试组。无需挂载宿主 `/sys/fs/cgroup`，无需 Docker socket。

缺 controller、只读且无法重挂载、工具链版本错误或无授权的 namespace 会在启动时报错，
runner 的 cgroup 初始化在连接并消费任务队列前完成。Docker 默认 root 会拒绝 host
cgroup namespace。

## 验收

查看工具链无需额外 capability：

```sh
docker run --rm 12oj-judge:noilinux2 verify-toolchain
```

实际 sandbox 编译、运行与资源限制测试：

```sh
docker run --rm --cgroupns=private \
  --cap-add=SYS_ADMIN --cap-add=SYS_RESOURCE \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  12oj-judge:noilinux2 verify-sandbox
```

该入口调用 judge 的实际语言配置和锁定 sandbox，验证 GCC/G++ 9.3、C++14、静态链接、
64 位、C/Pascal/Python 编译运行，以及 TLE、OOM/MLE、子进程 OOM、`pids.max`、
父子 CPU、内存峰值、取消及 cgroup 清理。CI 使用同一镜像与入口。

资源判定保留原来的 25% native 内存检测余量；名义限制仍按 peak 和 OOM events
判定。`memory.oom.group` 让子进程 OOM 终止整个测试组。CPU 返回值仍为纳秒，
结果在清理完测试组后返回。

镜像和 sandbox 验收完成后，还需使用实际服务配置做服务器、队列和真实题目联调。

接口依据：[kernel cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)、
[Docker cgroup namespace](https://docs.docker.com/engine/containers/runmetrics/)、
[Compose services](https://docs.docker.com/reference/compose-file/services/#cgroup)。
