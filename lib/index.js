/**
 * 都堂 DSH host half.
 *
 * Two jobs:
 * 1. Register one same-origin prefix route (`/dutang`) and proxy it to a
 *    fusion-server instance, so the Web shell can embed the existing 都堂 UI
 *    in an iframe without changing CSP or exposing the fusion port.
 * 2. Register model-facing tools for reading/submitting 都堂 cases. Tools are
 *    read-mostly: submitting only queues a request, and nothing here signs a
 *    board approval (that stays a human, offline Ed25519 action).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import z from "@deepseek-ai/schemastery";

const PREFIX = "/dutang";
const DEFAULT_UPSTREAM = "http://127.0.0.1:8893";

export const name = "dutang";
export const inject = ["webServer", "connection", "tools"];

/** DSH plugin configuration; editable from the Plugins page or the profile patch. */
export const Config = z.object({
  // Set to "auto" to follow the desktop app's 0600 discovery file.
  upstream: z.string().default(DEFAULT_UPSTREAM),
  // Optional explicit discovery path; defaults to the macOS app location.
  discovery: z.string().default(""),
  submitApproval: z.boolean().default(true),
  // The 都堂 API token. Configure it here (Plugins → 都堂 → 配置) or set
  // DUTANG_TOKEN in the DSH environment; an empty value keeps the panel in
  // its manual-login mode and makes the tools explain how to set it.
  token: z.string().default(""),
  // Seed the configured token into the panel iframe so a DSH user does not
  // have to paste the 验符 or log in again. Disable to force manual login.
  autoAuth: z.boolean().default(true),
});

const BOOTSTRAP_PATH = "/~bootstrap.js";

function renderBootstrap(token) {
  const value = JSON.stringify(token);
  return `/* DSH 都堂：把配置的验符交给面板，免去重复登录。
 * 兼容两代 fusion 前端：
 *   - 旧版读 window.name 的 fusion_session:<token>
 *   - 新版读 #token 输入框，并用 fusion_auth=1 决定启动时自动 refresh
 * 脚本在 </body> 前执行，早于 defer 的 app.js，所以输入框已存在。 */
try { window.name = "fusion_session:" + ${value}; } catch (error) { /* cross-origin iframe */ }
try {
  document.cookie = "fusion_auth=1; Path=/dutang; SameSite=Strict; Max-Age=28800";
} catch (error) { /* cookie disabled */ }
try {
  var input = document.getElementById("token");
  if (input) {
    input.value = ${value};
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
} catch (error) { /* login/onboarding page without the token field */ }
`;
}

export function injectBootstrap(html) {
  const tag = `<script src="${PREFIX}${BOOTSTRAP_PATH}"></script>`;
  // Place it at the end of <body>: the token input exists by then, and the
  // inline tag runs before deferred app.js boot.
  const end = html.search(/<\/body>/i);
  if (end < 0) return html + tag;
  return html.slice(0, end) + tag + html.slice(end);
}

async function servePanel(req, res, upstream, token) {
  try {
    const response = await fetch(new URL("/", upstream), {
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const body = Buffer.from(injectBootstrap(await response.text()), "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(renderUnavailablePage(upstream, error));
  }
}

function serveBootstrap(res, token) {
  const body = Buffer.from(renderBootstrap(token), "utf8");
  res.writeHead(200, {
    "content-type": "application/javascript; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function reject(res, status) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(status === 403 ? "都堂面板：请求来源不受信任。" : "都堂面板：需要先登录 DSH Web。");
}

function requestRejection(connection, req) {
  if (!connection || typeof connection.admit !== "function") return undefined;
  try {
    const admission = connection.admit({ headers: req.headers });
    return admission && "rejection" in admission ? admission.rejection : undefined;
  } catch {
    return 401;
  }
}

function renderUnavailablePage(upstream, error) {
  const message = String(error?.message || error).replace(/[<>&]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character]);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>都堂服务不可达</title>
<style>
  :root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f1e8d6;color:#221c14;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
  main{max-width:560px;margin:32px;padding:28px 30px;background:#faf5e9;border:1px solid rgba(72,58,38,.18);border-radius:16px;box-shadow:0 20px 40px -30px rgba(60,44,22,.5)}
  h1{margin:0 0 10px;font:600 1.5rem/1.3 "Songti SC","STSong",serif} p{margin:10px 0;color:#514634} code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem}
  pre{white-space:pre-wrap;word-break:break-word;background:#f3ebd9;border:1px solid rgba(72,58,38,.14);border-radius:8px;padding:12px;color:#514634}
  ol{padding-left:1.3em;color:#514634} li{margin:6px 0} strong{color:#221c14}
</style></head><body><main>
<h1>连接不到都堂服务</h1>
<p>DSH 插件已经把请求转发到：<code>${upstream.origin}</code>，但没有服务响应。</p>
<pre>${message}</pre>
<p><strong>怎么修复</strong></p>
<ol>
  <li>确认都堂 <code>fusion-server</code> 正在运行，并且浏览器/DSH 所在机器能访问它。</li>
  <li>在 DSH 的 <strong>插件 → 已安装 → 都堂 → 配置</strong> 中把 <code>upstream</code> 改成实际地址；默认是 <code>${DEFAULT_UPSTREAM}</code>。</li>
  <li>启动 DSH 前设置都堂验符：<code>export DUTANG_TOKEN='...'</code>。</li>
  <li>改完后重新打开/刷新「都堂」面板。</li>
</ol>
<p style="margin-top:18px;font-size:.78rem;opacity:.65">该页面由都堂 DSH 插件的本地代理生成，不包含都堂业务数据。</p>
</main></body></html>`;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} upstream
 */
function forward(req, res, upstream) {
  if (req.url === PREFIX) {
    res.writeHead(302, { location: `${PREFIX}/` });
    res.end();
    return;
  }
  const target = (req.url || "/").slice(PREFIX.length) || "/";
  const transport = upstream.protocol === "https:" ? https : http;
  const headers = { ...req.headers };
  delete headers.connection;
  // The DSH browser session cookie authenticates this route, not fusion-server.
  delete headers.cookie;
  headers.host = upstream.host;

  const proxy = transport.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
    path: target,
    method: req.method,
    headers,
  }, response => {
    const outgoing = { ...response.headers };
    if (typeof outgoing.location === "string" && outgoing.location.startsWith("/")) {
      outgoing.location = PREFIX + outgoing.location;
    }
    res.writeHead(response.statusCode || 502, outgoing);
    response.pipe(res);
    response.on("error", () => res.destroy());
  });

  proxy.setTimeout(60000, () => proxy.destroy(new Error("dutang upstream timeout")));
  proxy.on("error", error => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    }
    res.end(renderUnavailablePage(upstream, error));
  });
  req.pipe(proxy);
  res.on("close", () => {
    if (!res.writableEnded) proxy.destroy();
  });
}

const TEXT_OUTPUT = Object.freeze({
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: String(value) }],
});

const READ_TOKEN_HINT = "都堂未配置验符：请在 DSH profile patch 的 dutang.config.token 或环境变量 DUTANG_TOKEN 中设置。";

function describeIssue(issue) {
  const id = issue.id || "unknown";
  const state = issue.state || "unknown";
  const assignee = issue.assignee || "—";
  const bound = issue.reviewer || issue.approver
    ? ` · review ${issue.reviewer || "—"} / approve ${issue.approver || "—"}` : "";
  return `- [${state}] ${issue.title || id}\n  id: ${id} · assignee: ${assignee}${bound}`;
}

function describeAgent(row) {
  const health = row.health || {};
  const state = row.ready ? "就绪"
    : health.state === "login_required" ? "需登录"
      : health.state === "not_configured" ? "未配置"
        : health.state === "not_installed" ? "未安装" : "不可用";
  const bound = row.bound_labels?.length ? `绑定：${row.bound_labels.join("、")}` : "未绑定";
  const rawVersion = row.version ? String(row.version).split("\n")[0].slice(0, 80) : "";
  const version = rawVersion ? ` · ${rawVersion}` : "";
  const hint = !row.ready && health.next_step ? ` · ${health.next_step}` : "";
  return `- [${state}] ${row.id}${version} · ${bound}${hint}`;
}

function describeTask(task) {
  const id = task.id || task.run_id || "unknown";
  const state = task.state || task.status || "—";
  const title = task.title || task.payload?.title || id;
  const when = task.updatedAt || task.updated_at || task.createdAt || "";
  return `- [${state}] ${title}\n  id: ${id}${when ? ` · 更新 ${when}` : ""}`;
}

/**
 * @param {any} ctx
 * @param {{ upstream?: string, token?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const discoveryEnabled = config?.upstream === "auto" || Boolean(config?.discovery);
  const configuredUpstream = new URL(
    config?.upstream && config.upstream !== "auto" ? config.upstream : DEFAULT_UPSTREAM,
  );
  const configToken = typeof config?.token === "string" ? config.token.trim() : "";
  const discoveryPath = config?.discovery
    || process.env.DUTANG_DISCOVERY
    || path.join(os.homedir(), "Library/Application Support/Hengjian/instance/discovery.json");

  function discovered() {
    try {
      const data = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
      if (Number.isInteger(data.port) && data.port > 0 && typeof data.token === "string" && data.token) {
        return { upstream: new URL(`http://127.0.0.1:${data.port}`), token: data.token };
      }
    } catch {
      // No running desktop app or stale discovery: use configured fallback.
    }
    return null;
  }

  function current() {
    const found = discoveryEnabled ? discovered() : null;
    if (found) return found;
    return {
      upstream: configuredUpstream,
      token: configToken || String(process.env.DUTANG_TOKEN || "").trim(),
    };
  }

  const token = () => current().token;
  const autoAuth = config?.autoAuth !== false;

  function signalFor(exec, timeout = 20000) {
    const timeoutSignal = AbortSignal.timeout(timeout);
    return exec?.signal ? AbortSignal.any([exec.signal, timeoutSignal]) : timeoutSignal;
  }

  async function call(path, options = {}) {
    const resolved = current();
    const value = resolved.token;
    if (!value) throw new Error(READ_TOKEN_HINT);
    const response = await fetch(new URL(path, resolved.upstream), {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${value}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      redirect: "error",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`都堂接口返回 HTTP ${response.status}：${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("都堂接口返回了非 JSON 响应。");
    }
  }

  // The panel proxy needs a browser surface; the tools do not.
  const webServer = ctx.get("webServer");
  const connection = ctx.get("connection");
  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: "prefix",
      path: PREFIX,
      handler: (req, res) => {
        // Reuse DSH's own browser-session admission so /dutang is not a public
        // side door into the workbench. The tools bypass HTTP and stay as-is.
        const rejection = requestRejection(connection, req);
        if (rejection) { reject(res, rejection); return; }
        const [pathname] = ((req.url || "/").slice(PREFIX.length) || "/").split("?", 1);
        const resolved = current();
        const value = resolved.token;
        if (req.method === "GET" && autoAuth && value) {
          if (pathname === BOOTSTRAP_PATH) { serveBootstrap(res, value); return; }
          if (pathname === "/" || pathname === "/index.html") {
            servePanel(req, res, resolved.upstream, value); return;
          }
        }
        forward(req, res, resolved.upstream);
      },
    }), "dutang: proxy route");

    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/dutang/health",
      handler: async (req, res) => {
        const rejection = requestRejection(connection, req);
        if (rejection) { reject(res, rejection); return; }
        const started = Date.now();
        const resolved = current();
        try {
          const response = await fetch(new URL("/", resolved.upstream), { signal: AbortSignal.timeout(3000) });
          const body = {
            ok: response.ok,
            status: response.status,
            upstream: resolved.upstream.origin,
            latencyMs: Date.now() - started,
          };
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify(body));
        } catch (error) {
          res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ ok: false, upstream: resolved.upstream.origin, error: String(error?.message || error) }));
        }
      },
    }), "dutang: health route");
  }

  const submissionCache = new Map();
  const attempts = [];

  ctx.effect(() => ctx.tools.register({
    name: "dutang_list_cases",
    description: "列出都堂（三省六部可信执行台）的案卷与最近运行。只读；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "最多返回多少条，默认 20，范围 1–100。" },
        include_runs: { type: "boolean", description: "是否并入 ai-runs 运行记录，默认 true。" },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(100, Number(args?.limit) || 20));
      const tasks = await call("/api/tasks", { signal: signalFor(exec) });
      let runs = { runs: [] };
      if (args?.include_runs !== false) {
        try {
          runs = await call("/api/ai-runs", { signal: signalFor(exec) });
        } catch {
          // Tasks alone are still useful when the run index is unavailable.
        }
      }
      const entries = new Map();
      for (const task of tasks.tasks || []) entries.set(task.id, task);
      for (const run of runs.runs || []) entries.set(run.id, { ...entries.get(run.id), ...run });
      const rows = [...entries.values()]
        .sort((left, right) => String(right.updatedAt || right.updated_at || "").localeCompare(String(left.updatedAt || left.updated_at || "")))
        .slice(0, limit);
      if (!rows.length) return "都堂暂无案卷或运行。";
      return `都堂案卷（${rows.length} 条，最多 ${limit} 条）\n${rows.map(describeTask).join("\n")}`;
    },
  }), "dutang: tool list");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_list_agents",
    description: "列出本机发现的 Agent、就绪状态与角色绑定。只读；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        ready_only: { type: "boolean", description: "只返回就绪的 Agent，默认 false。" },
        include_unavailable: { type: "boolean", description: "包含目录里未接入/未安装的条目，默认 false。" },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const data = await call("/api/agents/inventory", { signal: signalFor(exec) });
      let rows = Array.isArray(data.agents) ? data.agents : [];
      if (args?.include_unavailable !== true) {
        rows = rows.filter(row => row.found || row.bound_roles?.length);
      }
      if (args?.ready_only === true) rows = rows.filter(row => row.ready);
      if (!rows.length) return "没有发现 Agent。";
      return `本机 Agent（${rows.length} 个；${data.ready || 0} 就绪；${data.discovered || 0} 已发现）\n${rows.map(describeAgent).join("\n")}`;
    },
  }), "dutang: tool agents");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_list_issues",
    description: "列出都堂 Issue 队列（work queue）。只读；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", description: "可选状态：queued/blocked/running/review/done/cancelled。" },
        limit: { type: "integer", description: "最多返回多少条，默认 30。" },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(100, Number(args?.limit) || 30));
      const query = args?.state ? `?state=${encodeURIComponent(args.state)}` : "";
      const data = await call("/api/issues" + query, { signal: signalFor(exec) });
      const rows = (data.issues || []).slice(0, limit);
      if (!rows.length) return "都堂 Issue 队列为空。";
      return `都堂 Issue（${rows.length} 条）\n${rows.map(describeIssue).join("\n")}`;
    },
  }), "dutang: tool issues");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_create_issue",
    description: "把一个任务加入都堂 Issue 队列；只入队，不自动执行，也不代替签批。需要验符。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Issue 标题。" },
        assignee: { type: "string", description: "执行 Agent 或角色 id。" },
        body: { type: "string", description: "任务说明。" },
        reviewer: { type: "string", description: "可选评审人。" },
        approver: { type: "string", description: "可选人类审批人。" },
        blockers: { type: "array", items: { type: "string" }, description: "依赖的 Issue id。" },
        acceptance: { type: "array", items: { type: "string" }, description: "验收条件（自然语言）。" },
        checks: {
          type: "array",
          description: "可执行验收：file_exists / sha256 / contains。",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["file_exists", "sha256", "contains"] },
              path: { type: "string" },
              sha256: { type: "string" },
              contains: { type: "string" },
            },
            required: ["type", "path"],
          },
        },
      },
      required: ["title", "assignee"],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const issue = await call("/api/issues", {
        method: "POST",
        body: {
          title: args.title, assignee: args.assignee, body: args.body || "",
          reviewer: args.reviewer, approver: args.approver,
          blockers: args.blockers || [], acceptance: args.acceptance || [],
          checks: args.checks || [],
        },
        signal: signalFor(exec),
      });
      return `已入队：${issue.id}\n状态：${issue.state}\n${describeIssue(issue)}`;
    },
  }), "dutang: tool issue create");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_comment_issue",
    description: "在都堂 Issue 下追加评论；会记录唤醒事件，但不自动执行。需要验符。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Issue id。" },
        body: { type: "string", description: "评论内容。" },
      },
      required: ["id", "body"],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const issue = await call(`/api/issues/${encodeURIComponent(args.id)}/comment`, {
        method: "POST", body: { body: args.body }, signal: signalFor(exec),
      });
      return `已评论：${issue.id}（${issue.state}）`;
    },
  }), "dutang: tool issue comment");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_get_case",
    description: "读取都堂单个案卷的完整决策链与成物清单。只读；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "案卷或运行 id（例如 AI-...）。" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const id = String(args?.id || "").trim();
      if (!id) throw new Error("请提供案卷 id。");
      const view = await call(`/api/runs/${encodeURIComponent(id)}`, { signal: signalFor(exec) });
      const lines = [`案卷 ${id} · ${view.state || view.status || "—"}`, `来源：${view.source || "ledger"}`];
      const timeline = Array.isArray(view.timeline) ? view.timeline : [];
      if (!timeline.length) lines.push("暂无决策记录（可能仍在排队）。");
      for (const step of timeline) {
        const verdict = step.verdict === "reject" ? " · 封驳" : step.verdict === "approve" ? " · 通过" : "";
        lines.push(`- ${step.label || step.actor || "步骤"}${verdict} · ${step.timestamp || "时间未记录"}`);
        for (const reason of step.reasons || []) lines.push(`  理由：${reason}`);
        for (const change of step.required_changes || []) lines.push(`  修订：${change}`);
      }
      const artifacts = Array.isArray(view.artifacts) ? view.artifacts : [];
      lines.push(`成物（${artifacts.length}）`);
      for (const artifact of artifacts) {
        lines.push(`- ${artifact.name || artifact.path || "未命名"} · ${artifact.bytes ?? "?"} bytes · sha256 ${artifact.sha256 || "未记录"}`);
      }
      return lines.join("\n");
    },
  }), "dutang: tool get");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_submit_case",
    description: "向都堂呈交一条新请求。仅入卷待办，不自动执行、不代替签批处签章；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        request: { type: "string", description: "事由：所需、所限、所欲成之物，1–12000 字。" },
      },
      required: ["request"],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    async execute(args, exec) {
      const request = String(args?.request || "").trim();
      if (request.length < 1 || request.length > 12000) throw new Error("事由长度需在 1–12000 字之间。");
      const now = Date.now();
      while (attempts.length && now - attempts[0] > 10 * 60_000) attempts.shift();
      if (attempts.length >= 10) throw new Error("最近 10 分钟呈案次数已达上限（10 次），请稍后再试。");
      const key = createHash("sha256").update(request).digest("hex");
      const cached = submissionCache.get(key);
      if (cached && now - cached.at < 10 * 60_000) {
        return `已入队：${cached.id}（10 分钟内相同事由，未重复提交）\n状态：${cached.status || "queued"}`;
      }
      for (const [oldKey, value] of submissionCache) {
        if (now - value.at >= 10 * 60_000) submissionCache.delete(oldKey);
      }
      // Write actions can pause for the deployment's approval answerer. If the
      // service is absent (headless composition) the call proceeds; when the
      // service exists, a non-grant fails closed.
      if (config?.submitApproval !== false && exec.agent) {
        const approval = ctx.get("approval");
        if (approval && typeof approval.request === "function") {
          const outcome = await approval.request({
            agent: exec.agent,
            toolName: "dutang_submit_case",
            callId: exec.callId,
            reason: `向都堂呈交新案：${request.slice(0, 120)}`,
            signal: exec.signal,
          });
          if (outcome !== "allowed-once") {
            throw new Error(`都堂呈案未获批准（${outcome}）。`);
          }
        }
      }
      const result = await call("/api/requests", { method: "POST", body: { request }, signal: signalFor(exec) });
      attempts.push(now);
      submissionCache.set(key, { id: result.id, status: result.status, at: now });
      return `已入队：${result.id}\n状态：${result.status || "queued"}\n说明：等待独立执行器处理；需要签批处签章时仍需人工离线签署。`;
    },
  }), "dutang: tool submit");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_merit",
    description: "读取都堂功过簿（按角色的只读统计）。需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const data = await call("/api/merit", { signal: signalFor(exec) });
      const lines = [`功过簿 · 更新于 ${data.generated_at || "—"}`];
      for (const role of data.roles || []) {
        lines.push(`- ${role.name || role.role}｜参与 ${role.participated ?? 0} 案｜${role.badge || "—"}｜${role.summary || ""}`);
        if (role.reason) lines.push(`  判词：${role.reason}`);
      }
      const recent = data.recent || {};
      lines.push(`近 ${recent.days ?? 7} 日：完成 ${recent.done ?? 0}，失败 ${recent.failed_runs ?? 0}`);
      return lines.join("\n");
    },
  }), "dutang: tool merit");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_list_artifacts",
    description: "列出都堂某次运行的成物文件（名称、字节、是否可预览）。只读；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        run: { type: "string", description: "都堂运行 id（32 位十六进制）。" },
      },
      required: ["run"],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const run = String(args?.run || "").trim();
      if (!run) throw new Error("请提供 run id。");
      const data = await call(`/api/artifacts?run=${encodeURIComponent(run)}`, { signal: signalFor(exec) });
      const files = data.artifacts || [];
      if (!files.length) return "该运行没有可列出的成物。";
      return `成物（${files.length}）\n${files.map(file => `- ${file.relative} · ${file.bytes} bytes${file.previewable ? " · 可预览" : ""}`).join("\n")}`;
    },
  }), "dutang: tool artifacts");

  ctx.effect(() => ctx.tools.register({
    name: "dutang_read_artifact",
    description: "读取都堂某次运行中一个可预览成物的文本内容（截断到 20000 字符）。只读；需要配置都堂验符。",
    parameters: {
      type: "object",
      properties: {
        run: { type: "string", description: "都堂运行 id（32 位十六进制）。" },
        name: { type: "string", description: "成物相对路径，例如 report.md。" },
      },
      required: ["run", "name"],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const run = String(args?.run || "").trim();
      const name = String(args?.name || "").trim();
      if (!run || !name) throw new Error("请提供 run id 与成物名称。");
      const data = await call(`/api/artifact?run=${encodeURIComponent(run)}&name=${encodeURIComponent(name)}`, { signal: signalFor(exec) });
      const text = String(data.text ?? "");
      return text.length > 20000 ? text.slice(0, 20000) + "\n…（已截断）" : text;
    },
  }), "dutang: tool artifact");
}
