import { describe, it, expect } from "vitest";
import {
  detectPhp,
  assess,
  renderReport,
  compareVersion,
  probeUrl,
  checkWebsite,
  UnsafeUrlError,
  type Probe,
} from "../src/phpcheck.js";

const NOW = new Date("2026-10-22T00:00:00Z");

const probe = (p: Partial<Probe>): Probe => ({
  finalUrl: "https://example.com/",
  status: 200,
  server: null,
  poweredBy: null,
  setCookie: [],
  ...p,
});

describe("compareVersion", () => {
  it("orders dotted versions", () => {
    expect(compareVersion("8.2.10", "8.2.35")).toBe(-1);
    expect(compareVersion("8.3.36", "8.3.36")).toBe(0);
    expect(compareVersion("8.5.12", "8.4.27")).toBe(1);
    expect(compareVersion("8.2", "8.2.0")).toBe(0);
  });
});

describe("detectPhp", () => {
  it("reads the version from X-Powered-By", () => {
    const d = detectPhp(probe({ poweredBy: "PHP/8.2.10" }));
    expect(d.isPhp).toBe(true);
    expect(d.version).toBe("8.2.10");
    expect(d.branch).toBe("8.2");
    expect(d.versionSource).toBe("x-powered-by");
  });

  it("falls back to the Server header", () => {
    const d = detectPhp(probe({ server: "Apache/2.4.58 (Debian) PHP/8.1.2" }));
    expect(d.version).toBe("8.1.2");
    expect(d.versionSource).toBe("server");
  });

  it("detects PHP from a PHPSESSID cookie without a version", () => {
    const d = detectPhp(probe({ setCookie: ["PHPSESSID=abc123; path=/; HttpOnly"] }));
    expect(d.isPhp).toBe(true);
    expect(d.version).toBeNull();
  });

  it("reports no PHP when nothing matches", () => {
    const d = detectPhp(probe({ server: "nginx", setCookie: ["session=x"] }));
    expect(d.isPhp).toBe(false);
  });

  it("flags a Windows/IIS banner", () => {
    const d = detectPhp(probe({ server: "Microsoft-IIS/10.0", poweredBy: "PHP/8.3.1" }));
    expect(d.os).toBe("windows");
  });
});

describe("assess", () => {
  it("flags a supported branch below the php2shell fix as CRITICAL", () => {
    const a = assess(detectPhp(probe({ poweredBy: "PHP/8.3.10" })), NOW);
    expect(a.verdict).toBe("CRITICAL_PHP2SHELL");
    expect(a.risk).toBe("critical");
    expect(a.findings.join(" ")).toContain("8.3.36");
    expect(a.remediation.join(" ")).toContain("8.3.36");
  });

  it("treats an end-of-life branch as CRITICAL regardless of patch", () => {
    const a = assess(detectPhp(probe({ poweredBy: "PHP/8.1.33" })), NOW);
    expect(a.verdict).toBe("CRITICAL_EOL");
    expect(a.findings.join(" ")).toContain("end of security support");
  });

  it("warns when a patched branch is near end-of-life", () => {
    const a = assess(detectPhp(probe({ poweredBy: "PHP/8.2.35" })), NOW);
    expect(a.verdict).toBe("WARN_NEAR_EOL");
    expect(a.risk).toBe("medium");
  });

  it("accepts a current, patched branch", () => {
    const a = assess(detectPhp(probe({ poweredBy: "PHP/8.4.27" })), NOW);
    expect(a.verdict).toBe("OK_BANNER_CURRENT");
    expect(a.risk).toBe("info");
  });

  it("handles a hidden version", () => {
    const a = assess(detectPhp(probe({ setCookie: ["PHPSESSID=x"] })), NOW);
    expect(a.verdict).toBe("UNKNOWN_VERSION_HIDDEN");
  });

  it("handles no PHP detected", () => {
    const a = assess(detectPhp(probe({ server: "nginx" })), NOW);
    expect(a.verdict).toBe("UNKNOWN_NO_PHP");
  });

  it("adds a CVE-2024-4577 note on vulnerable Windows CGI banners", () => {
    const a = assess(detectPhp(probe({ server: "Microsoft-IIS/10.0", poweredBy: "PHP/8.3.1" })), NOW);
    expect(a.findings.join(" ")).toContain("CVE-2024-4577");
  });
});

describe("renderReport", () => {
  it("includes the risk label and the Rimas Logic CTA", () => {
    const d = detectPhp(probe({ poweredBy: "PHP/8.1.33" }));
    const report = renderReport("https://example.com/", d, assess(d, NOW));
    expect(report).toContain("CRITICAL");
    expect(report).toContain("cal.com");
    expect(report).toContain("What to do");
  });
});

describe("probeUrl SSRF guard", () => {
  const dummyFetch: typeof fetch = (async () => new Response(null)) as typeof fetch;

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://192.168.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
  ])("rejects internal target %s", async (u) => {
    await expect(probeUrl(u, dummyFetch)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects a host with no dot", async () => {
    await expect(probeUrl("http://intranet/", dummyFetch)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("probeUrl + checkWebsite with a mock fetch", () => {
  const mk = (headers: Record<string, string>, setCookie: string[] = []): typeof fetch =>
    (async (url: string) => {
      const h = new Headers(headers);
      for (const c of setCookie) h.append("set-cookie", c);
      const res = new Response(null, { status: 200, headers: h });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as typeof fetch;

  it("adds https:// when the scheme is missing and parses headers", async () => {
    const p = await probeUrl("example.com", mk({ "x-powered-by": "PHP/8.3.10", server: "nginx" }));
    expect(p.finalUrl).toBe("https://example.com/");
    expect(p.poweredBy).toBe("PHP/8.3.10");
  });

  it("runs the full pipeline to a report", async () => {
    const { assessment, report } = await checkWebsite(
      "https://example.com",
      mk({ "x-powered-by": "PHP/8.3.10" }),
      () => NOW,
    );
    expect(assessment.verdict).toBe("CRITICAL_PHP2SHELL");
    expect(report).toContain("# PHP security check");
  });
});
