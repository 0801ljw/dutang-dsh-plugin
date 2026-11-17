/**
 * Offline check for the panel auto-login path:
 *   node scripts/test-autoauth.mjs
 *
 * It starts a tiny HTML upstream, applies the Host half with a fake Cordis
 * context, then asserts that GET /dutang/ injects the bootstrap tag and that
 * GET /dutang/~bootstrap.js serves the configured token as window.name.
 * No DSH, no fusion-server, no network beyond 127.0.0.1.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { apply, Config, injectBootstrap } from "../lib/index.js";

const HTML = "<!doctype html><html><head><title>t</title></head><body>ok</body></html>";

const upstream = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HTML);
});
await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
const { port } = upstream.address();

function fakeContext() {
  const routes = new Map();
  const tools = [];
  return {
    routes,
    registeredTools: tools,
    tools: { register(tool) { tools.push(tool); return () => {}; } },
    get(name) {
      if (name === "webServer") {
        return { register(route) { routes.set(route.path, route); return () => {}; } };
      }
      if (name === "connection") return { admit: () => ({}) };
      return undefined;
    },
    effect(fn) { fn(); },
  };
}

function call(handler, url) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url, headers: {}, pipe() {}, on() {} };
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { resolve({ status: this.status, headers: this.headers, body: body ? body.toString() : "" }); },
      on() {},
      destroy() {},
    };
    try { handler(req, res); } catch (error) { reject(error); }
  });
}

try {
  const ctx = fakeContext();
  apply(ctx, {
    upstream: `http://127.0.0.1:${port}`,
    token: "test-token",
    autoAuth: true,
    submitApproval: false,
  });

  assert.equal(ctx.registeredTools.length, 6, "six tools registered");
  assert.deepEqual(ctx.registeredTools.map(tool => tool.name).sort(), [
    "dutang_get_case", "dutang_list_artifacts", "dutang_list_cases",
    "dutang_merit", "dutang_read_artifact", "dutang_submit_case",
  ]);

  const prefix = ctx.routes.get("/dutang");
  assert.ok(prefix, "prefix route registered");

  const panel = await call(prefix.handler, "/dutang/?embed=1");
  assert.equal(panel.status, 200);
  assert.match(panel.body, /<script src="\/dutang\/~bootstrap\.js"><\/script>/);
  assert.match(panel.body, /ok<\/body>/);

  const bootstrap = await call(prefix.handler, "/dutang/~bootstrap.js");
  assert.equal(bootstrap.status, 200);
  assert.match(String(bootstrap.headers["content-type"]), /javascript/);
  assert.match(bootstrap.body, /fusion_session:test-token/);

  assert.equal(Config({}).token, "");
  assert.equal(Config({}).autoAuth, true);
  assert.match(injectBootstrap("<html><head></head></html>"), /bootstrap\.js/);

  console.log("autoauth OK: panel inject + bootstrap token + 6 tools");
} finally {
  upstream.close();
}
