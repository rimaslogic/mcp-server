import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Article, Corpus } from "./substack.js";
import { SubstackSource } from "./substack.js";
import { ABOUT } from "./links.js";
import { checkWebsite, renderError } from "./phpcheck.js";

const staleNote = (c: Corpus) =>
  c.stale ? "\n\n_Note: the source refresh failed; this content may be slightly out of date._" : "";

const line = (a: Article) =>
  `- ${a.number != null ? `#${a.number} ` : ""}${a.title} (${a.date.slice(0, 10)}) — slug: ${a.slug} — ${a.url}`;

function excerpt(md: string, query: string): string {
  const i = md.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, i - 120);
  const end = Math.min(md.length, i + query.length + 120);
  return `…${md.slice(start, end).replace(/\s+/g, " ")}…`;
}

export function buildServer(source: SubstackSource, fetchFn: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: "rimas-logic", version: "1.0.0", title: "Rimas Logic" });
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

  server.registerTool(
    "list_articles",
    {
      description:
        "List all published articles of The AI Logic newsletter, newest first. Returns issue number, title, date, slug, and canonical URL.",
      inputSchema: { limit: z.number().int().positive().optional().describe("Max articles to return (default: all)") },
    },
    async ({ limit }) => {
      const corpus = await source.getCorpus();
      const rows = corpus.articles.slice(0, limit ?? corpus.articles.length).map(line);
      return ok(`${rows.length} articles:\n${rows.join("\n")}${staleNote(corpus)}`);
    },
  );

  server.registerTool(
    "get_article",
    {
      description:
        'Read one article of The AI Logic in full, as markdown. Pass the article\'s slug (from list_articles or search_articles) or an issue number like "25".',
      inputSchema: { slug: z.string().describe("Article slug, or issue number as a string") },
    },
    async ({ slug }) => {
      const corpus = await source.getCorpus();
      const q = slug.trim().replace(/^#/, "");
      const article = /^\d+$/.test(q)
        ? corpus.articles.find((a) => a.number === Number(q))
        : corpus.articles.find((a) => a.slug === q);
      if (!article) {
        const near = corpus.articles.filter((a) => a.slug.includes(q)).slice(0, 3);
        const sug = (near.length ? near : corpus.articles.slice(0, 5)).map(line).join("\n");
        return fail(`No article matches "${slug}". Did you mean:\n${sug}`);
      }
      return ok(
        `# ${article.title}\n\n_${article.subtitle}_\n_Published ${article.date.slice(0, 10)} — ${article.url}_\n\n${article.markdown}${staleNote(corpus)}`,
      );
    },
  );

  server.registerTool(
    "search_articles",
    {
      description:
        "Search The AI Logic articles by keyword (case-insensitive, matches title, subtitle, and body). Returns matching articles with a short excerpt around the first hit.",
      inputSchema: { query: z.string().min(2).describe("Keyword or phrase to search for") },
    },
    async ({ query }) => {
      const corpus = await source.getCorpus();
      const q = query.toLowerCase();
      const hits = corpus.articles.filter((a) =>
        (a.title + "\n" + a.subtitle + "\n" + a.markdown).toLowerCase().includes(q),
      );
      if (!hits.length) return ok(`No articles match "${query}".${staleNote(corpus)}`);
      const rows = hits.map(
        (a) => `${line(a)}\n  ${excerpt(a.title + "\n" + a.subtitle + "\n" + a.markdown, query)}`,
      );
      return ok(`${hits.length} matching articles:\n${rows.join("\n")}${staleNote(corpus)}`);
    },
  );

  server.registerTool(
    "about_the_ai_logic",
    {
      description: "What The AI Logic newsletter is, who writes it, how to subscribe, and how to work with Rimas.",
      inputSchema: {},
    },
    async () => ok(ABOUT),
  );

  server.registerTool(
    "check_php_security",
    {
      title: "Check a website's PHP security",
      description:
        "Passively check whether a website looks exposed to a critical or end-of-life PHP problem — notably the " +
        "October 2026 'php2shell' unauthenticated RCE (CVE-2026-109618 / CVE-2026-109619) and end-of-life PHP " +
        "branches. It reads ONLY the public HTTP response headers the server already sends to every browser " +
        "(Server, X-Powered-By, Set-Cookie); it does not probe paths, send payloads, or attempt any exploit. " +
        "Returns a plain-language risk report with concrete next steps and how to get help from Rimas Logic. " +
        "Paste the URL of a site you own or are authorised to check, e.g. https://example.com. A banner is an " +
        "indicator, not proof: distributions backport fixes and versions can be hidden, so verdicts are 'worth verifying', not final.",
      inputSchema: { url: z.string().min(3).describe("Website URL to check, e.g. https://example.com") },
    },
    async ({ url }) => {
      try {
        const { report } = await checkWebsite(url, fetchFn);
        return ok(report);
      } catch (err) {
        return fail(renderError(url, err));
      }
    },
  );

  return server;
}
