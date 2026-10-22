// Passive PHP security check.
//
// Reads only the HTTP response headers a server already sends to every browser
// (Server, X-Powered-By, Set-Cookie) and compares any disclosed PHP version
// against a small, dated knowledge base: the October 2026 "php2shell" critical
// RCE, end-of-life branch dates, and the 2024 PHP-CGI argument-injection bug.
//
// It never probes paths, sends payloads, or tries to exploit anything. A banner
// is an indicator, not proof: versions can be hidden or spoofed, and Linux
// distributions routinely backport security fixes without changing the visible
// version string. Treat every verdict as "worth verifying locally", not gospel.
//
// Sources (see docs/php-security-research.md):
//   - thephp.foundation security release, 2026-10-21 (php2shell)
//   - php.net/supported-versions and endoflife.date/PHP (lifecycle dates)
//   - CISA KEV / php.net advisory for CVE-2024-4577

import { LINKS } from "./links.js";

export interface PhpBranch {
  /** "8.2" */
  branch: string;
  /** ISO date security support ends (exclusive: on/after this date the branch is unsupported). */
  securityEol: string;
  /** Patch version that fixes php2shell on this branch, or null if the branch is EOL and got only a source backport / no official release. */
  php2shellFix: string | null;
}

/**
 * PHP branch lifecycle + php2shell fixed patch level per branch.
 * Ordered newest-first. Keep dates in sync with php.net/supported-versions.
 */
export const PHP_BRANCHES: PhpBranch[] = [
  { branch: "8.5", securityEol: "2029-12-31", php2shellFix: "8.5.12" },
  { branch: "8.4", securityEol: "2028-12-31", php2shellFix: "8.4.27" },
  { branch: "8.3", securityEol: "2027-12-31", php2shellFix: "8.3.36" },
  { branch: "8.2", securityEol: "2026-12-31", php2shellFix: "8.2.35" },
  { branch: "8.1", securityEol: "2025-12-31", php2shellFix: null }, // EOL; source backport only
  { branch: "8.0", securityEol: "2023-11-26", php2shellFix: null },
  { branch: "7.4", securityEol: "2022-11-28", php2shellFix: null }, // EOL; source backport only
  { branch: "7.3", securityEol: "2021-12-06", php2shellFix: null },
  { branch: "7.2", securityEol: "2020-11-30", php2shellFix: null },
  { branch: "7.1", securityEol: "2019-12-01", php2shellFix: null },
  { branch: "7.0", securityEol: "2019-01-10", php2shellFix: null },
];

/** CVE-2024-4577 (PHP-CGI argument injection, Windows only) fixed versions, by branch. */
const CVE_2024_4577_FIX: Record<string, string> = { "8.1": "8.1.29", "8.2": "8.2.20", "8.3": "8.3.8" };

export const PHP2SHELL = {
  cves: "CVE-2026-109618 & CVE-2026-109619",
  nick: "php2shell",
  cvss: "9.2 (CVSS v4.0)",
  released: "2026-10-21",
};

/** What we parsed out of the response headers. */
export interface Probe {
  /** URL after redirects. */
  finalUrl: string;
  status: number;
  server: string | null;
  poweredBy: string | null;
  setCookie: string[];
}

export interface Detection {
  isPhp: boolean;
  version: string | null; // full "8.2.10" when disclosed
  branch: string | null; // "8.2" when a major.minor is known
  versionSource: "x-powered-by" | "server" | null;
  os: "windows" | "unknown";
  signals: string[]; // human-readable fingerprint notes
}

export type Verdict =
  | "CRITICAL_EOL"
  | "CRITICAL_PHP2SHELL"
  | "WARN_NEAR_EOL"
  | "OK_BANNER_CURRENT"
  | "UNKNOWN_VERSION_HIDDEN"
  | "UNKNOWN_NO_PHP";

export interface Assessment {
  verdict: Verdict;
  risk: "critical" | "high" | "medium" | "info";
  headline: string;
  findings: string[];
  remediation: string[];
}

const PHP_VERSION_RE = /PHP\/(\d+)\.(\d+)(?:\.(\d+))?/i;

function parseVersion(h: string | null): { full: string; branch: string; major: number; minor: number; patch: number | null } | null {
  if (!h) return null;
  const m = PHP_VERSION_RE.exec(h);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] != null ? Number(m[3]) : null;
  return { full: `${major}.${minor}${patch != null ? "." + patch : ""}`, branch: `${major}.${minor}`, major, minor, patch };
}

/** -1 / 0 / 1 comparing dotted numeric versions "8.2.10" vs "8.2.35". */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function detectPhp(p: Probe): Detection {
  const signals: string[] = [];
  const fromPowered = parseVersion(p.poweredBy);
  const fromServer = parseVersion(p.server);
  const parsed = fromPowered ?? fromServer;
  const versionSource = fromPowered ? "x-powered-by" : fromServer ? "server" : null;

  const hasPhpCookie = p.setCookie.some((c) => /^PHPSESSID=/i.test(c.trim()));
  const poweredSaysPhp = /\bphp\b/i.test(p.poweredBy ?? "");
  const serverSaysPhp = /\bphp\b/i.test(p.server ?? "");
  const isPhp = Boolean(parsed) || hasPhpCookie || poweredSaysPhp || serverSaysPhp;

  if (parsed) signals.push(`version banner: PHP/${parsed.full} (from ${versionSource} header)`);
  else if (poweredSaysPhp || serverSaysPhp) signals.push("PHP named in headers, but no version disclosed");
  if (hasPhpCookie) signals.push("PHPSESSID cookie present");
  if (p.server) signals.push(`Server: ${p.server}`);

  const os: Detection["os"] = /win(dows|32|64)?|microsoft-iis/i.test(p.server ?? "") ? "windows" : "unknown";
  if (os === "windows") signals.push("server banner suggests Windows / IIS");

  return {
    isPhp,
    version: parsed?.full ?? null,
    branch: parsed?.branch ?? null,
    versionSource,
    os,
    signals,
  };
}

const CAVEAT =
  "This is a passive, banner-based check. A version string can be hidden or spoofed, and Linux " +
  "distributions often backport security fixes without changing the visible version. Confirm the real " +
  "build locally with `php -v` before drawing conclusions.";

export function assess(d: Detection, now: Date): Assessment {
  const findings: string[] = [];
  const remediation: string[] = [];

  // No PHP fingerprint at all.
  if (!d.isPhp) {
    return {
      verdict: "UNKNOWN_NO_PHP",
      risk: "info",
      headline: "No PHP detected in the public headers.",
      findings: [
        "Nothing in the response headers identifies PHP (no PHP version, no PHPSESSID cookie, no PHP in Server/X-Powered-By).",
        "That can mean the site is not PHP, or that it sits behind a CDN/proxy/reverse-proxy that strips these headers, or that PHP runs but the version is hidden.",
      ],
      remediation: [
        "If you do run PHP, run a local/authenticated check and confirm you are on a patched release (see below).",
        `Patch levels that fix the ${PHP2SHELL.nick} RCE (${PHP2SHELL.released}): PHP 8.5.12, 8.4.27, 8.3.36 or 8.2.35.`,
      ],
    };
  }

  // PHP present but no version visible.
  if (!d.version || !d.branch) {
    return {
      verdict: "UNKNOWN_VERSION_HIDDEN",
      risk: "info",
      headline: "PHP is present but the version is not disclosed — good hygiene, but it tells us nothing about patch level.",
      findings: [
        ...d.signals,
        "Hiding the version (expose_php = Off) is the right call, but it means a remote check cannot tell whether you are patched.",
      ],
      remediation: [
        "Confirm locally with `php -v` that you are on a patched release.",
        `${PHP2SHELL.nick} (${PHP2SHELL.cves}, ${PHP2SHELL.released}) hits every PHP serving web requests. Patched builds: 8.5.12, 8.4.27, 8.3.36, 8.2.35.`,
        "Keep the version hidden and add a WAF for defence in depth.",
      ],
    };
  }

  const branchInfo = PHP_BRANCHES.find((b) => b.branch === d.branch);
  const nowIso = now.toISOString().slice(0, 10);

  // Windows PHP-CGI note (CVE-2024-4577) — only relevant on Windows/IIS.
  if (d.os === "windows" && d.version) {
    const fix = CVE_2024_4577_FIX[d.branch];
    if (fix && compareVersion(d.version, fix) < 0) {
      findings.push(
        `Server looks like Windows and the banner (PHP/${d.version}) predates the CVE-2024-4577 fix (${fix}). If PHP runs in CGI mode, that is a separate critical, mass-exploited RCE (CISA KEV).`,
      );
    }
  }

  // Branch newer than our knowledge base (e.g. a future 8.6): don't guess.
  if (!branchInfo) {
    const isNewer = compareVersion(d.branch, "8.5") > 0;
    return {
      verdict: isNewer ? "OK_BANNER_CURRENT" : "CRITICAL_EOL",
      risk: isNewer ? "info" : "critical",
      headline: isNewer
        ? `PHP ${d.version} is newer than this tool's database — verify against php.net.`
        : `PHP ${d.version} is on a long-unsupported branch (${d.branch}).`,
      findings: isNewer
        ? [...d.signals, "This branch is newer than the tool's dated knowledge base; check php.net/supported-versions for its status."]
        : [...d.signals, `Branch ${d.branch} reached end-of-life years ago and receives no security fixes.`],
      remediation: isNewer
        ? ["Confirm you are on the latest patch for your branch.", CAVEAT]
        : [
            "Upgrade to a supported branch (8.3, 8.4 or 8.5) as a priority — EOL PHP gets no security patches.",
            `It is also exposed to ${PHP2SHELL.nick} (${PHP2SHELL.cves}) with no official fix for this branch.`,
            CAVEAT,
          ],
    };
  }

  const eol = nowIso >= branchInfo.securityEol;

  // End-of-life branch.
  if (eol) {
    findings.push(
      ...d.signals,
      `PHP branch ${d.branch} reached end of security support on ${branchInfo.securityEol}. It no longer receives security fixes.`,
      `${PHP2SHELL.nick} (${PHP2SHELL.cves}, unauthenticated RCE, ${PHP2SHELL.cvss}) affects it, and EOL branches got only a minimal source backport — not an official release.`,
    );
    remediation.push(
      "Upgrade to a supported branch (8.3, 8.4 or 8.5). This is the only durable fix.",
      "If you cannot upgrade today, CISA's guidance is to take internet-facing PHP offline until it is patched or upgraded.",
      "Apply the php2shell stopgaps below and put a WAF in front in the meantime.",
      CAVEAT,
    );
    return {
      verdict: "CRITICAL_EOL",
      risk: "critical",
      headline: `PHP ${d.version} is end-of-life (branch ${d.branch}, unsupported since ${branchInfo.securityEol}).`,
      findings,
      remediation: withStopgaps(remediation, d.branch),
    };
  }

  // Supported branch — compare against the php2shell fix.
  const fix = branchInfo.php2shellFix;
  if (fix && compareVersion(d.version, fix) < 0) {
    findings.push(
      ...d.signals,
      `The banner (PHP/${d.version}) predates the ${PHP2SHELL.nick} fix for this branch (${fix}, released ${PHP2SHELL.released}).`,
      `${PHP2SHELL.cves} is an unauthenticated remote-code-execution bug (${PHP2SHELL.cvss}) affecting every PHP serving web requests. Exploitation attempts were seen in the wild from 2026-10-17.`,
    );
    remediation.push(
      `Update to PHP ${fix} (or newer) now — patching is the only complete fix.`,
      "Prioritise internet-facing hosts; restart every PHP worker after updating.",
      CAVEAT,
    );
    return {
      verdict: "CRITICAL_PHP2SHELL",
      risk: "critical",
      headline: `PHP ${d.version} looks vulnerable to ${PHP2SHELL.nick} (${PHP2SHELL.cves}).`,
      findings,
      remediation: withStopgaps(remediation, d.branch),
    };
  }

  // Patched (per banner). Flag near-EOL branches.
  const nearEol = monthsUntil(nowIso, branchInfo.securityEol) <= 4;
  findings.push(...d.signals, `Branch ${d.branch} is supported until ${branchInfo.securityEol}.`);
  if (fix) findings.push(`The banner (PHP/${d.version}) is at or above the ${PHP2SHELL.nick} fix (${fix}).`);
  if (nearEol) findings.push(`Heads-up: branch ${d.branch} loses security support on ${branchInfo.securityEol} — plan an upgrade.`);

  remediation.push(
    "Keep automatic security updates on so you track the latest patch for your branch.",
    "Hide the version banner (expose_php = Off) so scanners cannot fingerprint you.",
    CAVEAT,
  );
  if (nearEol) remediation.unshift(`Plan an upgrade off ${d.branch} before ${branchInfo.securityEol}.`);

  return {
    verdict: nearEol ? "WARN_NEAR_EOL" : "OK_BANNER_CURRENT",
    risk: nearEol ? "medium" : "info",
    headline: nearEol
      ? `PHP ${d.version} looks patched, but branch ${d.branch} is near end-of-life.`
      : `PHP ${d.version} looks patched against the known critical issues (verify locally).`,
    findings,
    remediation,
  };
}

function withStopgaps(remediation: string[], branch: string): string[] {
  const stop = [
    "Interim php2shell mitigations (stopgaps, not a fix): set memory_limit = -1 so applications cannot override it; set session.upload_progress.enabled = 0" +
      (compareVersion(branch + ".0", "8.5.0") >= 0 ? "; on 8.5 also set fatal_error_backtraces = 0" : "") +
      "; then restart all PHP workers.",
  ];
  return [...remediation, ...stop];
}

function monthsUntil(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

const RISK_LABEL: Record<Assessment["risk"], string> = {
  critical: "🔴 CRITICAL",
  high: "🟠 HIGH",
  medium: "🟡 MEDIUM",
  info: "🔵 INFO",
};

export function renderReport(target: string, d: Detection, a: Assessment): string {
  const lines: string[] = [];
  lines.push(`# PHP security check — ${target}`);
  lines.push("");
  lines.push(`**Risk: ${RISK_LABEL[a.risk]}** — ${a.headline}`);
  lines.push("");
  if (d.version) lines.push(`- Detected PHP version: **${d.version}** (from \`${d.versionSource}\` header)`);
  else if (d.isPhp) lines.push("- PHP detected, version **not disclosed**");
  else lines.push("- PHP **not detected** in public headers");
  lines.push("");
  lines.push("## What we found");
  for (const f of a.findings) lines.push(`- ${f}`);
  lines.push("");
  lines.push("## What to do");
  a.remediation.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  lines.push("");
  lines.push("## Get help");
  lines.push(
    a.risk === "critical"
      ? `This looks urgent. If you want it handled for you — fast — Rimas Logic can audit your stack, patch it safely, and harden it against the next one. Book a call: ${LINKS.consult}`
      : `Want a second pair of eyes, or this done for you? Rimas Logic audits and hardens PHP/web stacks. Book a call: ${LINKS.consult}`,
  );
  lines.push("");
  lines.push(
    "_Passive check: it reads only headers the server already sends to every browser — no probing, no payloads. " +
      "A banner is an indicator, not proof. Run it only on sites you own or are authorised to check._",
  );
  return lines.join("\n");
}

export function renderError(target: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return [
    `# PHP security check — ${target}`,
    "",
    `Could not reach or read the site: ${msg}`,
    "",
    "- Check the URL is correct and publicly reachable (include https://).",
    "- Some sites block non-browser requests; that is not itself a vulnerability.",
    `- You can still confirm your PHP locally with \`php -v\` and compare against the ${PHP2SHELL.nick} fixes (8.5.12 / 8.4.27 / 8.3.36 / 8.2.35).`,
    "",
    `Need a hand? Rimas Logic: ${LINKS.consult}`,
  ].join("\n");
}

// ---- Network probe (the only part that touches the network) ----------------

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|\[?::1\]?$|.*\.internal$|.*\.local$)/i;

export class UnsafeUrlError extends Error {}

/** Normalise, validate (block internal/SSRF targets), then GET and read headers only. */
export async function probeUrl(input: string, fetchFn: typeof fetch = fetch, timeoutMs = 8000): Promise<Probe> {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("that does not look like a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UnsafeUrlError("only http(s) URLs are supported");
  if (!u.hostname.includes(".") && u.hostname !== "localhost") throw new UnsafeUrlError("that host does not look public");
  if (PRIVATE_HOST_RE.test(u.hostname)) throw new UnsafeUrlError("internal / private hosts are not allowed");

  const res = await fetchFn(u.toString(), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "RimasLogic-PHP-Check/1.0 (+https://mcp.rimaslogic.pl)" },
  });
  // We only care about headers; release the body.
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
  const setCookie = typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);

  return {
    finalUrl: res.url || u.toString(),
    status: res.status,
    server: res.headers.get("server"),
    poweredBy: res.headers.get("x-powered-by"),
    setCookie,
  };
}

/** One-shot: probe + detect + assess + render. Used by the MCP tool and the demo script. */
export async function checkWebsite(url: string, fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<{
  probe: Probe;
  detection: Detection;
  assessment: Assessment;
  report: string;
}> {
  const probe = await probeUrl(url, fetchFn);
  const detection = detectPhp(probe);
  const assessment = assess(detection, now());
  return { probe, detection, assessment, report: renderReport(probe.finalUrl, detection, assessment) };
}
