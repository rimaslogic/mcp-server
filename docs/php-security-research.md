# Recent critical PHP vulnerabilities — market research

_Compiled 2026-10-22. Background for the `check_php_security` MCP tool. PHP still runs the majority
of the web (WordPress, Laravel, Magento, Drupal, countless custom apps), so a PHP-core RCE is a
whole-internet event, not a niche one._

## TL;DR

- **The live crisis: "php2shell".** On **2026-10-21** the PHP project shipped an out-of-band release
  fixing two critical, **unauthenticated remote-code-execution** flaws in PHP core —
  **CVE-2026-109618** and **CVE-2026-109619**, both **CVSS 9.2**. They affect **every PHP install
  that serves web requests** (mod_php, PHP-FPM, php-cgi, FrankenPHP, LiteSpeed). Patch to
  **8.5.12 / 8.4.27 / 8.3.36 / 8.2.35**. CISA, NCSC-UK, CERT-EU, Google and Palo Alto Unit 42 all
  issued advisories within a day. Exploitation attempts were seen in the wild **from 2026-10-17 —
  four days before disclosure**.
- **The 2024 headline that is still being mass-exploited: CVE-2024-4577**, PHP-CGI argument
  injection on Windows, CVSS 9.8, in CISA's Known-Exploited-Vulnerabilities catalog.
- **The slow-burn risk: end-of-life.** As of today, **PHP 8.1 is unsupported** (security ended
  2025-12-31) and **PHP 8.2 goes EOL in ~2 months** (2026-12-31). EOL PHP gets no official security
  fixes — including for php2shell.

The common thread for a website owner: **"what PHP version am I actually running, and is it
patched?"** is the single highest-leverage security question, and most owners cannot answer it.

---

## 1. php2shell — CVE-2026-109618 & CVE-2026-109619 (2026-10-21)

The most serious PHP-core event in years: two bugs in the request/memory lifecycle, both reachable
by an **unauthenticated** attacker over a normal web request.

| | |
|---|---|
| CVEs | CVE-2026-109618 (GHSA-w8hw-w9fx-j79w), CVE-2026-109619 (GHSA-6wmf-4rv5-p3rp) |
| Severity | 9.2 CVSS v4.0 (a leaked "10.0" was incorrect, per the PHP Foundation) |
| Impact | Unauthenticated remote code execution; memory disclosure confirmed for 109619 |
| Disclosed | 2026-10-21, 13:30 UTC, out-of-band |
| Oldest affected code | back to PHP 5.4.0 |

**Mechanisms (plain language):**

- **CVE-2026-109618 — out-of-memory corruption.** If a request hits PHP's `memory_limit` at the
  wrong moment, PHP can leave request data only partly initialised and later treat it as valid,
  corrupting memory. RCE was demonstrated on **Apache + mod_php under default settings**.
- **CVE-2026-109619 — stale global state / use-after-free.** A fatal error at the wrong point leaves
  internal state pointing at memory from a *previous* request; a later request on the same worker
  reuses that freed memory. Use-after-free, worker crash and RCE against a real application were all
  confirmed.

**Affected / fixed versions:**

| Affected | Fixed |
|---|---|
| 8.5.x < 8.5.12 | **8.5.12** |
| 8.4.x < 8.4.27 | **8.4.27** |
| 8.3.x < 8.3.36 | **8.3.36** |
| 8.2.x < 8.2.35 | **8.2.35** |
| 7.4.x – 8.1.x | No official release — minimal **source backport** from the PHP security team |
| 5.4.x – 7.3.x | End-of-life — **no fix** |

**Exposure:** Palo Alto Unit 42 telemetry put **>22.6 million** PHP instances potentially exposed; one
estimate counted **~884,000 EOL hosts** that get no official fix at all.

**Exploitation:** Amazon Threat Intelligence saw an attempt against its MadPot honeypot on
**2026-10-17**, with more and varied payloads on 10-21 (multiple actors). Cloudflare reports "early
attacks emerging"; watchTowr reproduced both and is seeing attempts. The embargo reportedly leaked,
accelerating PoC development. PHP's own team said it had *not* identified a functional exploit at
release — that window has since closed.

**Mitigation:** patching is the only complete fix. Documented stopgaps:
- 109618 → set `memory_limit = -1` so applications cannot override it.
- 109619 → set `session.upload_progress.enabled = 0`; on **8.5** also `fatal_error_backtraces = 0`.
- Restart every PHP worker after changes. A container/cgroup memory cap is an availability boundary,
  not a fix. Cloudflare added free-tier WAF rules (stopgap, Cloudflare-routed traffic only).
  CERT-EU: isolate internet-facing apps from public networks until patched and verified.

---

## 2. CVE-2024-4577 — PHP-CGI argument injection (Windows), still mass-exploited

- **CVSS 9.8.** A bypass of the 2012 `CVE-2012-1823` fix: PHP escapes hyphens (`0x2D`) but not **soft
  hyphens (`0xAD`)**, which Windows "Best-Fit" code-page mapping converts back to a hyphen — letting
  an attacker inject command-line options into the PHP interpreter.
- **Conditions:** PHP running as **CGI on Windows**, especially under certain locales (Traditional/
  Simplified Chinese, Japanese code pages). **XAMPP's default configuration is affected.** Some
  research argues the exposure is broader on Windows.
- **Fixed:** 8.1.29 / 8.2.20 / 8.3.8 (June 2024).
- **Status:** CISA KEV since 2024-06-12. Used to drop **TellYouThePass ransomware**, cryptominers and
  botnet implants; Fofa counted ~215k candidate targets at disclosure. EPSS near the top of the scale.

The `check_php_security` tool raises this as a conditional note when a banner looks Windows/IIS and
the version predates the fix — because OS/SAPI cannot be confirmed from headers alone.

---

## 3. The September 2024 core batch (8.1.30 / 8.2.24 / 8.3.12)

Shipped ~2024-09-26; picked up by cPanel EasyApache and Debian DSA-5780-1 shortly after:

- **CVE-2024-8925** — erroneous parsing of multipart/form-data in HTTP POST (data silently dropped).
- **CVE-2024-8926** — Windows CGI code-page command injection (companion to 4577).
- **CVE-2024-8927** — `cgi.force_redirect` bypass via a client-influenced `HTTP_REDIRECT_STATUS`.
- **CVE-2024-9026** — PHP-FPM access-log manipulation (medium).

These, plus later 2024–2025 stream/filter and PDO fixes, reinforce the real lesson: **stay on the
latest patch of a supported branch.** Most owners are breached not by a zero-day but by a months-old
CVE on an unpatched or EOL install.

---

## 4. The end-of-life cliff (as of 2026-10-22)

PHP branches get ~2 years of active support, then ~2 years of security-only fixes, then nothing.

| Branch | Status today | Security support ends |
|---|---|---|
| 8.5 | Active (current) | 2029-12-31 |
| 8.4 | Active | 2028-12-31 |
| 8.3 | Security-only | 2027-12-31 |
| 8.2 | Security-only — **EOL in ~2 months** | 2026-12-31 |
| 8.1 | **End-of-life** | 2025-12-31 |
| 8.0 | End-of-life | 2023-11-26 |
| 7.4 and below | End-of-life | 2022-11-28 or earlier |

Running EOL PHP means **no security patches** — including no official php2shell fix. A huge share of
the live web is still on 8.1 or older. That is the recurring, sellable problem.

---

## 5. Why this matters commercially (the Rimas Logic angle)

- The vulnerable population is enormous and the fix is unglamorous ops work most SMB owners will not
  do themselves — exactly the "I want the result, not the plumbing" buyer Rimas Logic serves.
- A one-question hook ("paste your URL, I'll tell you if your PHP is exposed") is a legitimate,
  non-creepy lead magnet: it reads only public headers and gives real, dated, actionable advice.
- The honest framing is the differentiator: a banner is an **indicator, not proof** (distros
  backport; versions can be hidden), so the tool recommends verification and offers help rather than
  manufacturing false alarms.

---

## Sources

- The PHP Foundation — security release, 2026-10-21: <https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/>
- CISA alert, 2026-10-21: <https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching>
- Tenable php2shell FAQ: <https://www.tenable.com/blog/php2shell-cve-2026-109618-cve-2026-109619-frequently-asked-questions-about-critical-php-remote>
- Unit 42 threat brief: <https://unit42.paloaltonetworks.com/cve-2026-109618-cve-2026-109619/>
- Qualys write-up: <https://blog.qualys.com/vulnerabilities-threat-research/2026/10/20/php-announces-critical-security-release-for-two-vulnerabilities>
- CERT-EU advisory 2026-018: <https://cert.europa.eu/publications/security-advisories/2026-018/>
- NCSC-UK: <https://www.ncsc.gov.uk/news/critical-security-issue-affecting-php>
- Google Cloud response: <https://cloud.google.com/blog/products/identity-security/responding-to-core-php-vulnerabilities-cve-2026-109618-cve-2026-109619>
- CVE-2024-4577 (Qualys ThreatProtect): <https://threatprotect.qualys.com/2024/06/10/php-cgi-argument-injection-vulnerability-cve-2024-4577/>
- PHP 8.3.12 release (Sep 2024 batch): <https://discourse.thephp.foundation/t/announce-php-8-3-12-released/609>
- PHP supported versions: <https://www.php.net/supported-versions.php> · endoflife.date/PHP: <https://endoflife.date/PHP> · Zend PHP EOL: <https://www.zend.com/resources/php-eol>

_These are vendor/tracker summaries gathered 2026-10-22. Verify version numbers against php.net
before acting on them in production._
