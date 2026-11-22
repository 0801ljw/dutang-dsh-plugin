# 都堂 · DSH 插件

把「都堂 · 三省六部可信执行台」接进 DeepSeek Harness：

- **侧栏面板**：内嵌都堂看板（`?embed=1` 紧凑模式，跟随 DSH 明暗主题）
- **10 个模型工具**：列本机 Agent、列/建/评论 Issue、列案卷、读案卷、呈案、读功过簿、列成物、读成物
- **同源代理**：`/dutang/*` 代理到 fusion-server，不改 DSH CSP，也不把上游端口暴露给浏览器
- **配置即用**：验符来自插件配置（或 `DUTANG_TOKEN`）；配好后**面板自动登录**，无需手输
- **安全**：`/dutang` 复用 DSH 浏览器会话鉴权（未登录 401）；呈案默认经 DSH approval；不提供签批处签章工具

当前版本 **0.5.5**（Issue 工具支持 checks；支持 `upstream: auto` 自动发现桌面 App 的 discovery）。

## 前置条件

**这个插件不是自带服务的独立应用**，而是「都堂 fusion-server」的 DSH 客户端/看板适配器。

1. DSH `>= 0.2.1-rc.5`（在 `0.2.1-rc.5` 上验证）
2. 一个可达的 **都堂 fusion-server**
   - 默认上游：`http://127.0.0.1:8893`（本机 Docker 常用；容器内 8793 → 宿主机 8893）
   - 远程实例可用 SSH 隧道：`ssh -N -L 8893:127.0.0.1:8793 ljw-pc`
3. 都堂 API 验符（fusion `tokens.json` 中的一条记录）


## 桌面 App 自动发现（0.5.1+）

桌面 App 启动本地 fusion 后，会写：

```text
~/Library/Application Support/Hengjian/instance/discovery.json   (0600)
```

插件配置改为 `upstream: auto` 即可自动读取其中的随机端口与 token， **不再手填 token/隧道**：

```yaml
- id: dutang
  name: "@dutang/dsh-plugin-dutang"
  config:
    upstream: auto
    autoAuth: true
```

- 也可用 `discovery: /absolute/path` 指定其他 discovery 文件。
- discovery 不可用时回退到 `upstream` 配置（默认 `http://127.0.0.1:8893`）和 `DUTANG_TOKEN`。
- App 未运行时插件不会自动拉起 App；先打开桌面 App 或显式配置 upstream。

## 三步用起来

### 1. 启动 fusion-server

已有 Docker 实例时确认健康：

```bash
curl -s http://127.0.0.1:8893/api/health
# {"ok": true, "service": "fusion"}
```

### 2. 给 fusion 发一条 DSH 专用验符

```bash
TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
echo "$TOKEN"                       # 复制到下一步

docker exec -i -u 10001 hengjian-docker-fusion-1 python3 - "$TOKEN" <<'PY'
import sys
from pathlib import Path
from fusion.core import Store
from fusion.httpapi import API
API(Store(Path('/data'))).add_token('dsh', sys.argv[1])
PY
```

> 容器内必须用 `-u 10001`（appuser）写入；用 root 会把 `tokens.json` 变成 root 0600，
> fusion-server 读不到，所有 token 都会 401。权限写坏了就 `chown 10001:10001 /data/tokens.json`。

### 3. 在 DSH 里填配置

**插件 → 已安装 → 都堂 → 配置**：

| 字段 | 值 |
|---|---|
| `upstream` | `http://127.0.0.1:8893` |
| `token` | 上一步的 `$TOKEN` |
| `autoAuth` | `true`（默认，面板自动登录） |
| `submitApproval` | `true`（默认，呈案经 DSH approval） |

改完配置后 DSH 会重启该插件行；打开侧栏「都堂」即可。

等价写法（profile patch，适合自动化）：

```yaml
- id: dutang
  name: "@dutang/dsh-plugin-dutang"
  config:
    upstream: http://127.0.0.1:8893
    autoAuth: true
    token: "<你的都堂验符>"
```

也支持环境变量（启动 DSH 前 `export DUTANG_TOKEN=...`）；配置里的 `token` 优先。

## 配置字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `upstream` | `http://127.0.0.1:8893` | fusion-server 根地址；设为 `auto` 时读桌面 App discovery |
| `discovery` | 空 | 显式 discovery 文件路径；空时用 `DUTANG_DISCOVERY` 或 macOS App 默认路径 |
| `token` | 空 | 都堂 API 验符；空时工具返回明确错误，面板保持手动登录 |
| `autoAuth` | `true` | 有 token 时把验符注入面板 iframe（`window.name`），面板自动登录；关掉则手动登录/输 token |
| `submitApproval` | `true` | 呈案前是否经 DSH approval |

服务不可达时，面板显示「连接不到都堂服务」的向导（含重新检测按钮），并在诊断行里给出原始错误；健康点变红。

## 面板

- `/dutang/`、`/dutang/health` 都经过 DSH 会话鉴权；代理转发前剥离 DSH cookie。
- `autoAuth` 开启时，插件在面板 HTML 的 `</body>` 前注入同源脚本 `/dutang/~bootstrap.js`；脚本在 `app.js` 之前执行，把配置的 token 写进 `#token` 输入框、设置 `fusion_auth=1` 提示，并保留旧版前端需要的 `window.name`，都堂面板因此自动连接。
- 该 token 是**机器验符**，权限与 fusion 的 machine token 相同：读案卷/功过簿/成物 + 呈案入队；**不含** agent 安装、模型 Key、用户管理等 admin 接口。
- 切换 DSH 面板时 iframe 会重载，父帧内存桥恢复选中案卷与滚动位置（不落盘）。
- 健康状态点：面板右上角绿/红点对应 `/dutang/health`。

## 模型工具

| 工具 | 作用 | 副作用 |
|---|---|---|
| `dutang_list_cases` | 列案卷/最近运行 | 只读 |
| `dutang_get_case` | 读单个案卷的决策链、理由、成物清单 | 只读 |
| `dutang_submit_case` | 呈交一条请求（默认经 approval；10 分钟幂等，10 次/10 分钟限流） | 仅入队，不执行、不签名 |
| `dutang_merit` | 读功过簿 | 只读 |
| `dutang_list_artifacts` | 列某次运行的成物文件 | 只读 |
| `dutang_read_artifact` | 读可预览成物的文本（截断 20000 字） | 只读 |

没有 `approve` 工具：签批处签章必须人持私钥在离线设备完成。

## 安装

### 从本地目录（本仓库）

DSH **插件** 页面 → **添加插件** → 选择本目录；或在 Agent 中使用插件管理器的 `install_bundle`，目标传本目录绝对路径。

### 从插件市场索引（0.4.2 公开版）

```text
https://raw.githubusercontent.com/0801ljw/dutang-dsh-plugin/main/market/index.json
```

> `market/index.json` 指向公开仓库的历史提交；本仓库的 0.5.0 是本地增强版，未发布到公共索引。

## 开发与验证

```bash
node --check lib/index.js
node --check lib/client.js
node scripts/test-autoauth.mjs   # 起本地假上游，验证面板注入 + bootstrap token + 6 工具
node scripts/check-tools.mjs     # 6 工具注册 + 审批/幂等/成物（需要可达的 fusion + token）
./scripts/smoke.sh               # 启动临时 DSH profile，验证 401 → 登录 → 200 → health
```

本包是普通 DSH bundle：`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入 `dutang` 行，`dsh.client` 声明 web 客户端模块。

## 已知限制

- iframe 而非原生 React 面板；焦点/快捷键归 iframe。
- 代理不含 WebSocket 升级；都堂目前没有 WebSocket。
- `autoAuth` 会把机器验符放进同源 iframe 的 `window.name`；这是本地优先部署的取舍。不要把 DSH 暴露给不可信用户，敏感环境可关掉它并手动登录。
- 验符以明文存于 DSH profile 配置（`cordis.patch.yml`）；生产多用户部署应改为 DSH credentials 或外部 secret manager。
- 新实例（尚未 onboarding）在嵌入模式下，`onboarding.html` 的绝对资源路径可能跳出 `/dutang` 前缀；建议先在浏览器打开 fusion 完成 onboarding，或先不经 DSH 完成初始化。
- 呈案只入队；实际执行需要 fusion 侧运行 worker 并配置模型通道，这不是本插件的能力。
- `autoAuth` 下点「登出」只在当前页面生效；刷新面板会再次自动连接。要保留登出状态，把 `autoAuth` 设为 `false` 并手动登录。

## License

MIT
