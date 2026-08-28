import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SubstackSource } from "../src/substack.js";

const posts = JSON.parse(readFileSync(new URL("./fixtures/posts.json", import.meta.url), "utf8"));
const okFetch = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

describe("SubstackSource", () => {
  it("maps posts to articles with markdown and issue number", async () => {
    const s = new SubstackSource("https://x", 600_000, okFetch(posts));
    const { articles, stale } = await s.getCorpus();
    expect(stale).toBe(false);
    expect(articles.length).toBe(3);
    expect(articles[0].number).toBe(25);
    expect(articles[0].slug).toBeTruthy();
    expect(articles[0].markdown).not.toMatch(/<\/?p>/);
    expect(articles[0].markdown.length).toBeGreaterThan(500);
  });

  it("caches within TTL and refetches after expiry", async () => {
    let calls = 0; let t = 0;
    const f: typeof fetch = (async () => { calls++; return new Response(JSON.stringify(posts)); }) as typeof fetch;
    const s = new SubstackSource("https://x", 600_000, f, () => t);
    await s.getCorpus(); await s.getCorpus();
    expect(calls).toBe(1);
    t = 600_001; await s.getCorpus();
    expect(calls).toBe(2);
  });

  it("serves stale on refresh failure, throws on cold-start failure", async () => {
    let fail = false; let t = 0;
    const f: typeof fetch = (async () => {
      if (fail) throw new Error("down");
      return new Response(JSON.stringify(posts));
    }) as typeof fetch;
    const s = new SubstackSource("https://x", 600_000, f, () => t);
    await s.getCorpus();
    fail = true; t = 600_001;
    const c = await s.getCorpus();
    expect(c.stale).toBe(true);
    expect(c.articles.length).toBe(3);
    const cold = new SubstackSource("https://x", 600_000, f, () => t);
    await expect(cold.getCorpus()).rejects.toThrow();
  });

  it("paginates until a short page", async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ ...posts[0], slug: `s${i}` }));
    let call = 0;
    const f: typeof fetch = (async (url: any) => {
      call++;
      return new Response(JSON.stringify(String(url).includes("offset=0") ? page(50) : page(2)));
    }) as typeof fetch;
    const s = new SubstackSource("https://x", 600_000, f);
    const { articles } = await s.getCorpus();
    expect(call).toBe(2);
    expect(articles.length).toBe(52);
  });
});
