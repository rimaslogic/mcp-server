import TurndownService from "turndown";

export interface Article {
  number: number | null;
  title: string;
  subtitle: string;
  slug: string;
  date: string;
  url: string;
  markdown: string;
}

export interface Corpus {
  articles: Article[];
  fetchedAt: number;
  stale: boolean;
}

const td = new TurndownService({ headingStyle: "atx" });
const PAGE = 50;

interface RawPost {
  title?: string;
  subtitle?: string;
  slug: string;
  post_date: string;
  canonical_url: string;
  body_html?: string;
}

export function toArticle(p: RawPost): Article {
  const m = /#(\d+)/.exec(p.title ?? "");
  return {
    number: m ? Number(m[1]) : null,
    title: p.title ?? "",
    subtitle: p.subtitle ?? "",
    slug: p.slug,
    date: p.post_date,
    url: p.canonical_url,
    markdown: td.turndown(p.body_html ?? ""),
  };
}

export class SubstackSource {
  private cache: { articles: Article[]; fetchedAt: number } | null = null;

  constructor(
    private baseUrl: string,
    private ttlMs: number = 10 * 60_000,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  private async fetchAll(): Promise<Article[]> {
    const raw: RawPost[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.fetchFn(`${this.baseUrl}/api/v1/posts?limit=${PAGE}&offset=${offset}`);
      if (!res.ok) throw new Error(`Substack API returned ${res.status}`);
      const batch = (await res.json()) as RawPost[];
      raw.push(...batch);
      if (batch.length < PAGE) break;
    }
    return raw.map(toArticle);
  }

  async getCorpus(): Promise<Corpus> {
    const fresh = this.cache && this.now() - this.cache.fetchedAt < this.ttlMs;
    if (!fresh) {
      try {
        this.cache = { articles: await this.fetchAll(), fetchedAt: this.now() };
      } catch (err) {
        if (!this.cache) throw err;
        return { ...this.cache, stale: true };
      }
    }
    return { ...this.cache!, stale: false };
  }
}
