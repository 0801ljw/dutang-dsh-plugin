import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

const tools = [];
let webRegistered = false;
let approvals = 0;
let approvalOutcome = "allowed-once";
const ctx = {
  effect(fn) { return fn(); },
  get(name) {
    if (name === "approval") {
      return { request() { approvals += 1; return Promise.resolve(approvalOutcome); } };
    }
    if (name !== "webServer") return undefined;
    return { register() { webRegistered = true; return () => {}; } };
  },
  tools: { register(definition) { tools.push(definition); return () => {}; } },
};

global.fetch = async (url, options = {}) => {
  assert.ok(String(url).startsWith("http://127.0.0.1:18793/"));
  assert.equal(options.headers.Authorization, "Bearer test-token");
  const path = new URL(url).pathname;
  const body = {
    "/api/tasks": { tasks: [{ id: "AI-1", title: "测试案卷", state: "Review", updatedAt: "2026-11-12T10:00:00+08:00" }] },
    "/api/ai-runs": { runs: [] },
    "/api/runs/AI-1": { id: "AI-1", state: "Review", source: "audit", timeline: [{ label: "门下裁决", actor: "menxia", verdict: "approve", timestamp: "2026-11-12T10:01:00+08:00", reasons: ["通过"] }], artifacts: [{ name: "a.md", bytes: 10, sha256: "abc" }] },
    "/api/requests": { id: "AI-2", status: "queued" },
    "/api/merit": { generated_at: "2026-11-12T10:02:00+08:00", roles: [{ role: "gongbu", name: "工部", participated: 3, badge: "能臣", summary: "成功率 90%" }], recent: { days: 7, done: 9, failed_runs: 1 } },
    "/api/artifacts": { artifacts: [{ relative: "report.md", bytes: 12, previewable: true }] },
    "/api/artifact": { text: "hello artifact" },
  }[path];
  assert.ok(body, `unexpected path ${path}`);
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

apply(ctx, { upstream: "http://127.0.0.1:18793", token: "test-token" });
assert.equal(webRegistered, true);
assert.deepEqual(tools.map(tool => tool.name).sort(), ["dutang_get_case", "dutang_list_artifacts", "dutang_list_cases", "dutang_merit", "dutang_read_artifact", "dutang_submit_case"]);

const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
const list = await byName.dutang_list_cases.execute({ limit: 10 }, {});
assert.match(list, /测试案卷/);
const detail = await byName.dutang_get_case.execute({ id: "AI-1" }, {});
assert.match(detail, /门下裁决 · 通过/);
assert.match(detail, /a\.md/);
const submit = await byName.dutang_submit_case.execute({ request: "写一份测试报告" }, {});
assert.match(submit, /已入队：AI-2/);
const duplicate = await byName.dutang_submit_case.execute({ request: "写一份测试报告" }, {});
assert.match(duplicate, /未重复提交/);
const artifacts = await byName.dutang_list_artifacts.execute({ run: "a".repeat(32) }, {});
assert.match(artifacts, /report\.md/);
const artifact = await byName.dutang_read_artifact.execute({ run: "a".repeat(32), name: "report.md" }, {});
assert.match(artifact, /hello artifact/);

const approved = await byName.dutang_submit_case.execute({ request: "需要审批的呈案" }, { agent: {}, callId: "call-1" });
assert.match(approved, /已入队/);
assert.equal(approvals, 1);
approvalOutcome = "rejected";
let denied = false;
try {
  await byName.dutang_submit_case.execute({ request: "被拒绝的呈案" }, { agent: {}, callId: "call-2" });
} catch (error) {
  denied = /未获批准/.test(String(error.message));
}
assert.equal(denied, true);
assert.equal(approvals, 2);
const merit = await byName.dutang_merit.execute({}, {});
assert.match(merit, /工部/);
console.log(`dutang tools: OK (${tools.length} registered)`);
