import dns from 'node:dns';
import net from 'node:net';
import { loadEnv } from '../config/env';

/**
 * SSRF protection for a product whose entire job is making outbound requests
 * on behalf of users.
 *
 *  - Only http/https schemes
 *  - Hostnames are resolved and *every* returned address is checked
 *  - The connection itself is pinned to a validated address through a custom
 *    DNS lookup function (defeats DNS rebinding between check and connect)
 *  - The connected socket's remote address is re-verified after connect
 *  - Redirects are followed manually and re-validated at each hop
 */

export class UnsafeTargetError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'UnsafeTargetError';
    this.reason = reason;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

/** Ports that must never be reachable from a monitoring check. */
export const BLOCKED_PORTS = new Set([22, 25, 111, 135, 137, 138, 139, 445, 512, 513, 514, 587, 993, 995, 2375, 2376, 3306, 5432, 5601, 6379, 7001, 8020, 9042, 9200, 9300, 11211, 27017, 27018]);

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isBlockedIPv4(ip: string): boolean {
  return BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits));
}

/** Expands an IPv6 address into 8 numeric groups, resolving :: and embedded IPv4. */
function expandIPv6(ip: string): number[] | null {
  let address = ip.trim().toLowerCase();
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);

  // Convert trailing IPv4 notation to two hex groups.
  const v4Match = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4 = v4Match[1];
    if (!net.isIPv4(v4)) return null;
    const n = ipv4ToInt(v4);
    const hi = ((n >>> 16) & 0xffff).toString(16);
    const lo = (n & 0xffff).toString(16);
    address = address.replace(v4, `${hi}:${lo}`);
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array.from({ length: fill }, () => '0'), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g || '0', 16));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

export function isBlockedIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (!groups) return true; // unparseable — fail closed

  const isZeroPrefix = (count: number) => groups.slice(0, count).every((g) => g === 0);

  // :: and ::1
  if (isZeroPrefix(8)) return true;
  if (isZeroPrefix(7) && groups[7] === 1) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — evaluate the embedded v4.
  if (isZeroPrefix(5) && groups[5] === 0xffff) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isBlockedIPv4(v4);
  }
  if (isZeroPrefix(6)) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isBlockedIPv4(v4) || v4 === '0.0.0.0';
  }

  // NAT64 64:ff9b::/96
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isBlockedIPv4(v4);
  }

  // Unique local fc00::/7
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // Link local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // Multicast ff00::/8
  if ((groups[0] & 0xff00) === 0xff00) return true;
  // Documentation 2001:db8::/32
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  // Discard 100::/64
  if (groups[0] === 0x0100 && groups.slice(1, 4).every((g) => g === 0)) return true;

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIPv4(address);
  if (version === 6) return isBlockedIPv6(address);
  return true; // not an IP — fail closed
}

/**
 * Cloud metadata endpoints are blocked unconditionally — even in development
 * with ALLOW_PRIVATE_TARGETS enabled, there is no legitimate reason for a
 * monitoring check to reach them.
 */
const ALWAYS_BLOCKED_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '169.254.169.123',
  '100.100.100.200',
  'fd00:ec2::254',
  'fd00:ec2:0:0:0:0:0:254',
]);

/** Rewrites IPv4-mapped IPv6 (`::ffff:169.254.169.254`) to dotted form. */
function dottedAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return mapped[1];
  return normalized;
}

export function isAlwaysBlockedAddress(address: string): boolean {
  return ALWAYS_BLOCKED_ADDRESSES.has(dottedAddress(address));
}

export function privateTargetsAllowed(): boolean {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') return false; // never in production
  return env.ALLOW_PRIVATE_TARGETS;
}

export interface ValidatedTarget {
  url: URL;
  hostname: string;
  port: number;
  addresses: string[];
  allowedPrivate: boolean;
}

export function assertUrlStructure(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError('The URL could not be parsed. Include the scheme, for example https://example.com');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeTargetError('Only http:// and https:// URLs can be monitored.');
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeTargetError('URLs with embedded credentials are not allowed. Use an encrypted credential instead.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) throw new UnsafeTargetError('The URL is missing a hostname.');

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeTargetError('Internal hostnames cannot be monitored from a public worker.');
  }

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (BLOCKED_PORTS.has(port)) {
    throw new UnsafeTargetError(`Port ${port} is reserved for internal services and cannot be monitored.`);
  }
  return parsed;
}

/** Resolves a hostname and validates every returned address. */
export async function resolveAndValidate(rawUrl: string): Promise<ValidatedTarget> {
  const url = assertUrlStructure(rawUrl);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const allowPrivate = privateTargetsAllowed();

  if (isAlwaysBlockedAddress(hostname)) {
    throw new UnsafeTargetError('Cloud metadata endpoints can never be monitored.');
  }

  if (net.isIP(hostname)) {
    if (!allowPrivate && isBlockedAddress(hostname)) {
      throw new UnsafeTargetError(
        `The address ${hostname} is a private, loopback, link-local or reserved address and cannot be monitored.`,
      );
    }
    return { url, hostname, port, addresses: [hostname], allowedPrivate: allowPrivate };
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeTargetError(`DNS lookup for ${hostname} failed.`);
  }

  if (!records.length) throw new UnsafeTargetError(`DNS lookup for ${hostname} returned no addresses.`);

  const metadata = records.find((record) => isAlwaysBlockedAddress(record.address));
  if (metadata) {
    throw new UnsafeTargetError('The host resolves to a cloud metadata endpoint, which can never be monitored.');
  }

  const blocked = records.find((record) => !allowPrivate && isBlockedAddress(record.address));
  if (blocked) {
    throw new UnsafeTargetError(
      `${hostname} resolves to a private or reserved address (${blocked.address}) and cannot be monitored.`,
    );
  }

  return {
    url,
    hostname,
    port,
    addresses: records.map((record) => record.address),
    allowedPrivate: allowPrivate,
  };
}

/**
 * A `lookup` implementation for net.connect that only ever yields addresses
 * already validated for this target. If DNS changes between validation and
 * connection (rebinding), the connection fails instead of hitting an internal
 * address.
 */
export function pinnedLookup(validated: ValidatedTarget) {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ) => {
    const wantsAll = Boolean(options && (options as { all?: boolean }).all);
    const candidates = validated.addresses
      .map((address) => ({ address, family: net.isIP(address) }))
      .filter((entry) => (options?.family === 4 || options?.family === 6 ? entry.family === options.family : true));

    if (!candidates.length) {
      const error: NodeJS.ErrnoException = new Error(`No validated address available for ${hostname}`);
      error.code = 'ENOTFOUND';
      callback(error, []);
      return;
    }

    const fresh = candidates.filter((entry) => !validated.allowedPrivate && !isBlockedAddress(entry.address));
    if (!fresh.length && !validated.allowedPrivate) {
      const error: NodeJS.ErrnoException = new Error(`Blocked address for ${hostname}`);
      error.code = 'EACCES';
      callback(error, []);
      return;
    }

    if (wantsAll) callback(null, fresh as dns.LookupAddress[]);
    else callback(null, fresh[0].address, fresh[0].family);
  };
}

/** Re-checks the address a socket actually connected to. */
export function assertConnectedSocketAllowed(socket: { remoteAddress?: string }): void {
  if (privateTargetsAllowed()) return;
  const remote = socket?.remoteAddress;
  if (!remote) return;
  const normalized = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  if (isAlwaysBlockedAddress(normalized)) {
    throw new UnsafeTargetError('Connection resolved to a cloud metadata address and was aborted.');
  }
  if (isBlockedAddress(normalized)) {
    throw new UnsafeTargetError(`Connection resolved to a blocked address (${normalized}).`);
  }
}
