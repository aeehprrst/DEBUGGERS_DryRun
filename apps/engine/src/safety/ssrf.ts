// CR-10 / CLAUDE.md §8 — "SSRF guard: resolve the target host; reject private
// and loopback ranges unless ALLOW_PRIVATE_TARGETS=1."
//
// The load-bearing word is **resolve**. A string check on the URL is not a
// guard: `http://localtest.me/`, `http://127.0.0.1.nip.io/` and any attacker's
// own domain with an A record of 10.0.0.1 all read as ordinary public
// hostnames and all reach the internal network. So the hostname goes through
// DNS and every address it answers with is checked — not just the first, since
// a name may return one public and one private address.
//
// What this does NOT defend against, stated plainly rather than implied away:
//
//  * DNS rebinding. We resolve here and Chromium resolves again when it
//    navigates; a record with a one-second TTL can answer differently to the
//    two lookups. Closing that needs the crawl pinned to the address we
//    checked (a resolver hook or a per-request address assertion), which is
//    more than this hour holds. It is a real hole and it is written down.
//  * Redirects. The guard covers the URL the operator submitted. A 302 from a
//    public host to 169.254.169.254 is followed by the browser without passing
//    through here again.
//
// Both are narrowed considerably by the fact that an operator must attest to
// owning the target before a run exists at all (S1), which makes this a guard
// against mistakes and casual misuse rather than a determined attacker.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type TargetCheck =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

// [first, last, human-readable reason]. Ordered widest-first only for
// readability; every range is tested.
const IPV4_BLOCKED: [string, string, string][] = [
  ["0.0.0.0", "0.255.255.255", "this-network range"],
  ["10.0.0.0", "10.255.255.255", "private range (10/8)"],
  ["100.64.0.0", "100.127.255.255", "carrier-grade NAT range (100.64/10)"],
  ["127.0.0.0", "127.255.255.255", "loopback range (127/8)"],
  ["169.254.0.0", "169.254.255.255", "link-local range (169.254/16) — this is the cloud metadata address"],
  ["172.16.0.0", "172.31.255.255", "private range (172.16/12)"],
  ["192.0.0.0", "192.0.0.255", "IETF protocol assignments range"],
  ["192.168.0.0", "192.168.255.255", "private range (192.168/16)"],
  ["198.18.0.0", "198.19.255.255", "benchmarking range (198.18/15)"],
  ["224.0.0.0", "239.255.255.255", "multicast range (224/4)"],
  ["240.0.0.0", "255.255.255.255", "reserved range (240/4)"],
];

function classifyIpv4(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) return null;
  for (const [first, last, reason] of IPV4_BLOCKED) {
    const lo = ipv4ToInt(first);
    const hi = ipv4ToInt(last);
    if (lo !== null && hi !== null && value >= lo && value <= hi) return reason;
  }
  return null;
}

function classifyIpv6(ip: string): string | null {
  const address = ip.toLowerCase().split("%")[0]; // strip any zone index

  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms are v4 addresses
  // wearing a v6 costume; classify the v4 or they walk through every v6 test.
  const mapped = address.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIpv4(mapped[1]);

  if (address === "::1") return "IPv6 loopback (::1)";
  if (address === "::") return "IPv6 unspecified address (::)";

  const head = address.split(":")[0];
  if (/^f[cd][0-9a-f]{2}$/.test(head)) return "IPv6 unique-local range (fc00::/7)";
  if (/^fe[89ab][0-9a-f]$/.test(head)) return "IPv6 link-local range (fe80::/10)";
  if (/^ff[0-9a-f]{2}$/.test(head)) return "IPv6 multicast range (ff00::/8)";
  return null;
}

function classify(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return classifyIpv4(ip);
  if (family === 6) return classifyIpv6(ip);
  return null;
}

/**
 * Resolves `targetUrl`'s hostname and reports whether it is safe to crawl.
 *
 * Never throws for a bad target — a rejection is a normal answer here and the
 * caller turns it into a 400 with the reason attached, because an operator who
 * pointed at the wrong host deserves to be told which host and why.
 */
export async function checkTargetUrl(targetUrl: string): Promise<TargetCheck> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { ok: false, reason: `${targetUrl} is not a valid URL` };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `protocol ${parsed.protocol} is not crawlable — only http and https are`,
    };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // IPv6 literals arrive bracketed

  // A literal address needs no DNS. Checking it directly also means a target
  // written as an IP cannot slip past on a resolver that refuses to look up
  // numeric names.
  if (isIP(hostname)) {
    const reason = classify(hostname);
    return reason
      ? { ok: false, reason: `${hostname} is in the ${reason}` }
      : { ok: true, addresses: [hostname] };
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    // Unresolvable is not "safe": it is unknown, and a crawl would fail
    // anyway. Refusing here gives the operator the real reason instead of a
    // navigation error thrown from inside the browser ten seconds later.
    return { ok: false, reason: `${hostname} could not be resolved by DNS` };
  }

  if (resolved.length === 0) {
    return { ok: false, reason: `${hostname} resolved to no addresses` };
  }

  // EVERY address, not the first. A hostname that answers with one public and
  // one private address is exactly the shape of a deliberate bypass, and
  // checking only `resolved[0]` would pass it whenever the order came out
  // favourably — which is to say, intermittently.
  for (const { address } of resolved) {
    const reason = classify(address);
    if (reason) {
      return {
        ok: false,
        reason: `${hostname} resolves to ${address}, which is in the ${reason}`,
      };
    }
  }

  return { ok: true, addresses: resolved.map((r) => r.address) };
}

/**
 * CLAUDE.md §8 — "unless `ALLOW_PRIVATE_TARGETS=1` (set locally for Meridian,
 * never in a shipped default)". Read at call time rather than at module load
 * so a test or a script can set it without import-order mattering.
 */
export function privateTargetsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_TARGETS === "1";
}
