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
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import z from "@deepseek-ai/schemastery";

const PREFIX = "/dutang";
const DEFAULT_UPSTREAM = "http://127.0.0.1:18793";

export const name = "dutang";
export const inject = ["webServer", "connection", "tools"];

/** DSH plugin configuration; the upstream is editable from the Plugins page. */
export const Config = z.object({
  upstream: z.string().default(DEFAULT_UPSTREAM),
  submitApproval: z.boolean().default(true),
});

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
  const upstream = new URL(config?.upstream || DEFAULT_UPSTREAM);
  const configToken = typeof config?.token === "string" ? config.token.trim() : "";
  const token = () => configToken || String(process.env.DUTANG_TOKEN || "").trim();

  function signalFor(exec, timeout = 20000) {
    const timeoutSignal = AbortSignal.timeout(timeout);
    return exec?.signal ? AbortSignal.any([exec.signal, timeoutSignal]) : timeoutSignal;
  }

  async function call(path, options = {}) {
    const value = token();
    if (!value) throw new Error(READ_TOKEN_HINT);
    const response = await fetch(new URL(path, upstream), {
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
        forward(req, res, upstream);
      },
    }), "dutang: proxy route");

    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/dutang/health",
      handler: async (req, res) => {
        const rejection = requestRejection(connection, req);
        if (rejection) { reject(res, rejection); return; }
        const started = Date.now();
        try {
          const response = await fetch(new URL("/", upstream), { signal: AbortSignal.timeout(3000) });
          const body = {
            ok: response.ok,
            status: response.status,
            upstream: upstream.origin,
            latencyMs: Date.now() - started,
          };
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify(body));
        } catch (error) {
          res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ ok: false, upstream: upstream.origin, error: String(error?.message || error) }));
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
    description: "向都堂呈交一条新请求。仅入卷待办，不自动执行、不代替董事会签名；需要配置都堂验符。",
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
      return `已入队：${result.id}\n状态：${result.status || "queued"}\n说明：等待独立执行器处理；需要董事会签名时仍需人工离线签署。`;
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
