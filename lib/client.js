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
      const [health, setHealth] = React.useState("unknown");
      React.useEffect(() => {
        let alive = true;
        const check = async () => {
          try {
            const response = await fetch("dutang/health", { cache: "no-store", credentials: "same-origin" });
            const data = await response.json();
            if (alive) setHealth(data.ok ? "ok" : "down");
          } catch {
            if (alive) setHealth("down");
          }
        };
        check();
        const timer = setInterval(check, 30000);
        return () => { alive = false; clearInterval(timer); };
      }, []);
      const dot = health === "ok" ? "#4d7a5c" : health === "down" ? "#a33b2a" : "#8a7b62";
      const label = health === "ok" ? "都堂服务正常" : health === "down" ? "都堂服务不可达" : "检查中";
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
