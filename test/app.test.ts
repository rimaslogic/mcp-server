import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { SubstackSource } from "../src/substack.js";

const posts = JSON.parse(readFileSync(new URL("./fixtures/posts.json", import.meta.url), "utf8"));
const okFetch: typeof fetch = (async () => new Response(JSON.stringify(posts))) as typeof fetch;
const app = () => buildApp(new SubstackSource("https://x", 600_000, okFetch));

describe("http", () => {
  it("GET / serves a landing page mentioning the endpoint", async () => {
    const r = await request(app()).get("/");
    expect(r.status).toBe(200);
    expect(r.text).toContain("mcp.rimaslogic.pl/mcp");
  });

  it("GET /health reports ok", async () => {
    const r = await request(app()).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
  });

  it("POST /mcp answers an initialize request", async () => {
    const r = await request(app())
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect(r.status).toBe(200);
    expect(r.text).toContain("rimas-logic");
  });

  it("GET /mcp is rejected (stateless server)", async () => {
    const r = await request(app()).get("/mcp");
    expect(r.status).toBe(405);
  });
});
