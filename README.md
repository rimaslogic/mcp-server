# Rimas Logic MCP server

Open [MCP](https://modelcontextprotocol.io) server that serves
[The AI Logic](https://rimaslogic.substack.com/) newsletter, so anyone can read
the articles from their AI assistant. No signup, no API key.

**Endpoint:** `https://mcp.rimaslogic.pl/mcp`

## Add it to your client

- **Claude Code:** `claude mcp add --transport http rimas-logic https://mcp.rimaslogic.pl/mcp`
- **Claude.ai / ChatGPT / Cursor:** add a custom connector (remote MCP server) with the URL above.

## Tools

| Tool | What it does |
|------|--------------|
| `list_articles` | All published articles, newest first (number, title, date, slug, URL) |
| `get_article` | One article in full, as markdown — by slug or issue number |
| `search_articles` | Keyword search over titles, subtitles, and bodies, with excerpts |
| `about_the_ai_logic` | What the newsletter is, subscribe links, how to work with Rimas |

## How it works

One stateless Node/Express service. It fetches the publication's public
Substack API, converts articles to markdown, and holds the whole corpus in
memory with a 10-minute TTL. If a refresh fails it serves the cached copy and
says so. Each `POST /mcp` request gets a fresh MCP server instance over the
streamable HTTP transport. Rate limited to 60 requests/min per IP. The service
stores no data about callers and holds no secrets.

## Local development

```bash
npm install
npm test        # vitest, fixture-based, no network
npm run dev     # build + run on :3000
```

`GET /health` reports cache age and article count. Deployed on Railway.

## License

MIT
