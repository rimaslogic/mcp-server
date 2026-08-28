import express from "express";
import { rateLimit } from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SubstackSource } from "./substack.js";
import { buildServer } from "./server.js";
import { LINKS } from "./links.js";

const LANDING = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rimas Logic MCP server</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#222}code,pre{background:#f4f4f4;padding:.15rem .35rem;border-radius:4px}pre{padding:.75rem;overflow-x:auto}</style>
</head><body>
<h1>Rimas Logic MCP server</h1>
<p>Read <strong>The AI Logic</strong> newsletter straight from your AI assistant.
This is an open <a href="https://modelcontextprotocol.io">MCP</a> server — no signup, no key.</p>
<h2>Add it to your client</h2>
<p>Endpoint: <code>https://mcp.rimaslogic.pl/mcp</code></p>
<p>Claude Code: <code>claude mcp add --transport http rimas-logic https://mcp.rimaslogic.pl/mcp</code></p>
<p>Claude.ai / ChatGPT / Cursor: add a custom connector (remote MCP server) with the URL above.</p>
<h2>Tools</h2>
<p><code>list_articles</code> · <code>get_article</code> · <code>search_articles</code> · <code>about_the_ai_logic</code></p>
<p>Prefer email? <a href="${LINKS.substack}">Subscribe on Substack</a>.
Work with Rimas: <a href="${LINKS.consult}">book a consultation</a>.</p>
</body></html>`;

export function buildApp(source: SubstackSource): express.Express {
  const app = express();
  app.set("trust proxy", 1); // Railway sits behind a proxy
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.type("html").send(LANDING);
  });

  app.get("/health", async (_req, res) => {
    try {
      const c = await source.getCorpus();
      res.json({ status: "ok", articles: c.articles.length, cacheAgeMs: Date.now() - c.fetchedAt, stale: c.stale });
    } catch {
      res.status(503).json({ status: "degraded", reason: "no cache and source unreachable" });
    }
  });

  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

  app.post("/mcp", limiter, async (req, res) => {
    const server = buildServer(source);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error" } });
      }
    }
  });

  const reject = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Method not allowed. This is a stateless MCP server; use POST." },
    });
  };
  app.get("/mcp", reject);
  app.delete("/mcp", reject);

  return app;
}
