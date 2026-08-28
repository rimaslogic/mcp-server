import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SubstackSource } from "../src/substack.js";
import { buildServer } from "../src/server.js";

const posts = JSON.parse(readFileSync(new URL("./fixtures/posts.json", import.meta.url), "utf8"));
const okFetch: typeof fetch = (async () => new Response(JSON.stringify(posts))) as typeof fetch;

let client: Client;
beforeEach(async () => {
  const server = buildServer(new SubstackSource("https://x", 600_000, okFetch));
  client = new Client({ name: "test", version: "0.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
});

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

describe("tools", () => {
  it("lists all four tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["about_the_ai_logic", "get_article", "list_articles", "search_articles"]);
  });

  it("list_articles returns rows with slug and url", async () => {
    const r = await client.callTool({ name: "list_articles", arguments: {} });
    expect(text(r)).toContain("#25");
    expect(text(r)).toContain("slug:");
    expect(text(r)).toContain("substack.com");
  });

  it("get_article by slug and by number", async () => {
    const bySlug = await client.callTool({ name: "get_article", arguments: { slug: posts[0].slug } });
    expect(text(bySlug).length).toBeGreaterThan(500);
    const byNum = await client.callTool({ name: "get_article", arguments: { slug: "25" } });
    expect(text(byNum)).toContain(posts[0].slug);
  });

  it("get_article unknown slug errors with suggestions", async () => {
    const r: any = await client.callTool({ name: "get_article", arguments: { slug: "nope-nope" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(posts[0].slug);
  });

  it("search_articles finds a term with excerpt", async () => {
    const r = await client.callTool({ name: "search_articles", arguments: { query: "credentials" } });
    expect(text(r)).toContain("#25");
    expect(text(r)).toContain("…");
  });

  it("about includes all three links", async () => {
    const r = await client.callTool({ name: "about_the_ai_logic", arguments: {} });
    const t = text(r);
    for (const s of ["rimaslogic.substack.com", "linkedin.com", "cal.com"]) expect(t).toContain(s);
  });
});
