window.__ModuleLoader__.load({
  id: "@dutang/dsh-plugin-dutang",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    // Memory-only bridge: the iframe owns the 都堂 token, while this frame keeps
    // it across DSH panel switches so remounting the iframe does not log out.
    const bridge = { token: "", selection: "", scroll: 0, frame: null, theme: "paper" };
    function currentTheme() {
      return document.body && document.body.hasAttribute("data-ds-dark-theme") ? "wujin" : "paper";
    }
    function postRestore(target) {
      if (!target) return;
      try {
        target.postMessage({
          type: "dutang:restore",
          token: bridge.token,
          selection: bridge.selection,
          scroll: bridge.scroll,
          theme: currentTheme(),
        }, window.location.origin);
      } catch {
        // A closing iframe is not an error worth surfacing.
      }
    }
    function postTheme(target) {
      if (!target) return;
      try { target.postMessage({ type: "dutang:theme", theme: currentTheme() }, window.location.origin); } catch { /* ignore */ }
    }
    function installBridge() {
      if (typeof window === "undefined" || window.__dutangBridgeInstalled) return;
      window.__dutangBridgeInstalled = true;
      window.addEventListener("message", event => {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || typeof data.type !== "string") return;
        if (data.type === "dutang:token" && typeof data.token === "string") {
          bridge.token = data.token;
          return;
        }
        if (data.type === "dutang:selection" && typeof data.id === "string") {
          bridge.selection = data.id;
          return;
        }
        if (data.type === "dutang:scroll" && typeof data.scroll === "number") {
          bridge.scroll = data.scroll;
          return;
        }
        if (data.type === "dutang:ready") {
          postRestore(event.source);
          return;
        }
      });
      const syncTheme = () => { if (bridge.frame) postTheme(bridge.frame); };
      const observer = new MutationObserver(syncTheme);
      if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "class", "style"] });
      window.addEventListener("focus", syncTheme);
    }

    /** Full-height same-origin iframe around the 都堂 workbench. */
    function DutangPanel() {
      const [health, setHealth] = React.useState("checking");
      const [error, setError] = React.useState("");
      const runCheck = async () => {
        try {
          const response = await fetch("dutang/health", { cache: "no-store", credentials: "same-origin" });
          const data = await response.json();
          setHealth(data.ok ? "ok" : "down");
          setError(data.ok ? "" : (data.error || `upstream returned ${data.status || "an error"}`));
        } catch (cause) {
          setHealth("down");
          setError(String(cause && cause.message ? cause.message : cause));
        }
      };
      React.useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const response = await fetch("dutang/health", { cache: "no-store", credentials: "same-origin" });
            const data = await response.json();
            if (alive) {
              setHealth(data.ok ? "ok" : "down");
              setError(data.ok ? "" : (data.error || `upstream returned ${data.status || "an error"}`));
            }
          } catch (cause) {
            if (alive) {
              setHealth("down");
              setError(String(cause && cause.message ? cause.message : cause));
            }
          }
        };
        tick();
        const timer = setInterval(tick, 30000);
        return () => { alive = false; clearInterval(timer); };
      }, []);

      if (health !== "ok") {
        return h("div", {
          style: { height: "100%", minHeight: "100%", overflow: "auto", display: "grid", placeItems: "center", background: "#f1e8d6", color: "#221c14", padding: "24px" },
        }, h("div", {
          style: { maxWidth: "560px", padding: "26px 30px", background: "#faf5e9", border: "1px solid rgba(72,58,38,.18)", borderRadius: "16px", boxShadow: "0 20px 40px -30px rgba(60,44,22,.5)" },
        },
        h("p", { style: { margin: 0, fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#8a7a62" } }, "DSH plugin · 都堂"),
        h("h2", { style: { margin: "10px 0 8px", fontFamily: '"Songti SC","STSong",serif', fontSize: "24px", fontWeight: 600 } }, health === "checking" ? "正在连接都堂…" : "连接不到都堂服务"),
        h("p", { style: { margin: "0 0 12px", color: "#514634", lineHeight: 1.75 } },
          "这个插件是「都堂 fusion-server」的客户端；插件本身不带业务数据。需要先启动都堂服务，并让 DSH 能访问它。"),
        h("ol", { style: { margin: "0 0 14px", paddingLeft: "1.3em", color: "#514634", lineHeight: 1.9, fontSize: "14px" } },
          h("li", null, "启动都堂 fusion-server；本机默认地址是 http://127.0.0.1:8793。"),
          h("li", null, "在 DSH「插件 → 已安装 → 都堂 → 配置」里把 upstream 改成实际地址。"),
          h("li", null, "启动 DSH 前设置验符：export DUTANG_TOKEN='...'。"),
          h("li", null, "服务可达后点「重新检测」。")),
        health === "down" && error
          ? h("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "10px 12px", background: "#f3ebd9", border: "1px solid rgba(72,58,38,.14)", borderRadius: "8px", fontSize: "12px", color: "#6b5c47" } }, error)
          : null,
        h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "16px" } },
          h("button", {
            type: "button",
            onClick: runCheck,
            style: { border: "0", borderRadius: "999px", background: "#a33b2a", color: "#f7e9dd", padding: "10px 16px", cursor: "pointer", fontSize: "13px" },
          }, "重新检测"),
          h("span", { style: { fontSize: "12px", color: "#8a7a62" } }, health === "checking" ? "正在检查上游…" : "或者重启 DSH 后再试"))));
      }

      const dot = "#4d7a5c";
      const label = "都堂服务正常";
      return h("div", {
        style: { position: "relative", height: "100%", minHeight: "100%", display: "flex", background: "#f1e8d6" },
      },
      h("iframe", {
        src: "dutang/?embed=1",
        title: "都堂 · 三省六部可信执行台",
        onLoad: event => {
          bridge.frame = event.currentTarget.contentWindow;
          postRestore(bridge.frame);
        },
        style: { flex: "1 1 auto", width: "100%", height: "100%", border: "0", display: "block" },
      }),
      h("span", {
        title: label,
        style: {
          position: "absolute", right: "10px", top: "10px", width: "7px", height: "7px",
          borderRadius: "50%", background: dot, boxShadow: "0 0 0 3px rgba(0,0,0,0.08)",
          pointerEvents: "none",
        },
      }));
    }

    /** Sidebar glyph: a seal-like square with ruled lines. */
    function DutangIcon({ size = 16 } = {}) {
      return h("svg", {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        "aria-hidden": "true",
      },
      h("rect", {
        x: 3.5, y: 3.5, width: 17, height: 17, rx: 3,
        stroke: "currentColor", strokeWidth: 1.5,
      }),
      h("path", {
        d: "M7.5 8.5h9M7.5 12h9M7.5 15.5h5.5",
        stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
      }));
    }

    const inject = ["slots"];

    function apply(ctx) {
      installBridge();
      ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: "dutang",
      }, DutangPanel));
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: "dutang",
        order: 15,
        label: "都堂",
      }, DutangIcon));
    }

    module.exports = { apply, inject };
    return module.exports;
  },
});
