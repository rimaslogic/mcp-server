#!/usr/bin/env node
// Passive PHP-exposure scan over a list of sites.
//
// Reads ONLY the public HTTP headers each server already sends to every browser
// (Server, X-Powered-By, Set-Cookie) and applies the same logic as the MCP
// `check_php_security` tool. No path probing, no payloads, no exploitation.
// Run it only against sites you own or are authorised to check.
//
//   npm run build && node scripts/scan.mjs                 # default demo list
//   npm run build && node scripts/scan.mjs https://a.pl https://b.pl ...
//
import { checkWebsite } from "../dist/phpcheck.js";

// Ten well-known Polish company sites, across sectors, as an illustrative demo.
const DEFAULT_TARGETS = [
  "https://allegro.pl",
  "https://www.orlen.pl",
  "https://www.pkobp.pl",
  "https://inpost.pl",
  "https://www.zabka.pl",
  "https://www.play.pl",
  "https://www.biedronka.pl",
  "https://www.ccc.eu",
  "https://www.lpp.com",
  "https://www.cdprojekt.com",
];

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS;

console.log("Passive PHP-exposure scan — reads public response headers only, no probing.");
console.log("A banner is an indicator, not proof (distros backport; versions can be hidden).\n");
console.log("SITE".padEnd(34), "RISK".padEnd(12), "VERDICT".padEnd(24), "VERSION");
console.log("-".repeat(90));

let critical = 0;
let php = 0;
for (const url of targets) {
  try {
    const { detection, assessment } = await checkWebsite(url);
    if (detection.isPhp) php++;
    if (assessment.risk === "critical") critical++;
    const ver = detection.version ?? (detection.isPhp ? "(hidden)" : "(no PHP)");
    console.log(
      url.replace(/^https?:\/\//, "").padEnd(34),
      assessment.risk.toUpperCase().padEnd(12),
      assessment.verdict.padEnd(24),
      ver,
    );
  } catch (err) {
    console.log(url.replace(/^https?:\/\//, "").padEnd(34), "ERROR".padEnd(12), String(err?.message ?? err));
  }
}

console.log("-".repeat(90));
console.log(`\n${targets.length} sites scanned · ${php} fingerprinted as PHP · ${critical} flagged critical (verify before acting).`);
console.log("Full per-site report: ask an MCP client to run check_php_security on a URL.");
