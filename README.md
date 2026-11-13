# 都堂 · DSH 插件

把「都堂 · 三省六部可信执行台」接入 DeepSeek Harness：

- **Web 面板**：侧栏「都堂」入口，内嵌看板（`?embed=1` 紧凑模式，跟随 DSH 明暗主题）
- **6 个模型工具**：列案卷、读案卷、呈案、读功过簿、列成物、读成物
- **同源代理**：`/dutang/*` 代理到 fusion-server，不改 DSH CSP，也不把上游端口暴露给浏览器
- **安全**：`/dutang` 复用 DSH 浏览器会话鉴权（未登录 401）；呈案默认经 DSH approval；不提供董事会签名工具

当前版本 **0.4.1**（DSH bundle）。

## 前置条件（给别人用之前必须知道）

**这个插件不是自带服务的独立应用**，而是「都堂 fusion-server」的 DSH 客户端/看板适配器。
别人安装后必须自己提供 fusion-server 和验符；没有服务时面板会显示连接向导，而不是业务界面。

1. DSH `>= 0.2.1-rc.5`（在 `0.2.2-rc.2` 上验证）
2. 一个可达的 **都堂 fusion-server**
   - 默认上游：`http://127.0.0.1:18793`
   - 本机开发通常通过 SSH 隧道把 ljw-pc 的 8793 映射过来：
     ```bash
     ssh -N -L 18793:127.0.0.1:8793 ljw-pc
     ```
3. 都堂 API 验符，启动 DSH 前设置：
   ```bash
   export DUTANG_TOKEN='都堂「设置」里使用的 API 验符'
   ```

## 安装

### 从本地目录（开发/自用）

DSH **插件** 页面 → **添加插件** → 选择本目录；或在 Agent 中使用插件管理器的 `install_bundle`，目标传本目录绝对路径。

### 从插件市场索引

把下面这个索引 URL 加进 DSH 的 Discover 索引：

```text
https://raw.githubusercontent.com/0801ljw/dutang-dsh-plugin/main/market/index.json
```

然后搜索「都堂」安装。索引格式为 DSH 插件市场 format 1；源码以 git commit 固定。

## 配置

bundle patch 默认：

```yaml
- insert:
    - id: dutang
      name: '@dutang/dsh-plugin-dutang'
      config:
        upstream: http://127.0.0.1:18793
        submitApproval: true
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `upstream` | `http://127.0.0.1:18793` | 都堂 fusion-server 根地址；可在 **插件 → 已安装 → 都堂 → 配置** 修改 |
| `submitApproval` | `true` | 呈案前是否经 DSH approval |
| `DUTANG_TOKEN`（环境变量） | 无 | 都堂 API 验符；未设置时工具返回明确错误 |

服务不可达时，面板显示「连接不到都堂服务」的向导（含重新检测按钮），不会把原始
`ECONNREFUSED` 错误直接抛给用户。原始错误只出现在向导的诊断行里。

## 模型工具

| 工具 | 作用 | 副作用 |
|---|---|---|
| `dutang_list_cases` | 列案卷/最近运行 | 只读 |
| `dutang_get_case` | 读单个案卷的决策链、理由、成物清单 | 只读 |
| `dutang_submit_case` | 呈交一条请求（默认经 approval；10 分钟幂等，10 次/10 分钟限流） | 仅入队，不执行、不签名 |
| `dutang_merit` | 读功过簿 | 只读 |
| `dutang_list_artifacts` | 列某次运行的成物文件 | 只读 |
| `dutang_read_artifact` | 读可预览成物的文本（截断 20000 字） | 只读 |

没有 `approve` 工具：董事会签名必须人持私钥在离线设备完成。

## 面板

- `/dutang`、`/dutang/health` 都经过 DSH 会话鉴权；代理转发前剥离 DSH cookie。
- 切换 DSH 面板时 iframe 会重载，父帧内存桥恢复验符、选中案卷和滚动位置（不落盘）。
- 健康状态点：面板右上角绿/红点对应 `/dutang/health`。

## 开发与验证

```bash
node scripts/check-tools.mjs   # 6 个工具注册 + 审批/幂等/artifact
./scripts/smoke.sh             # 启动临时 DSH profile，验证 401 → 200 → health
```

本包是普通 DSH bundle：`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入 `dutang` 行，`dsh.client` 声明 web 客户端模块。

## 已知限制

- iframe 而非原生 React 面板；焦点/快捷键归 iframe。
- 代理不含 WebSocket 升级；都堂目前没有 WebSocket。
- 验符只在父帧内存，刷新 DSH 页面后需重新输入。
- 需要用户自备都堂服务；未连接时面板显示 502，健康点变红。

## License

MIT
