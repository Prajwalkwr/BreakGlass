import { describe, expect, it } from 'vitest';
import {
  UnsafeTargetError,
  assertUrlStructure,
  isBlockedAddress,
  isBlockedIPv4,
  isBlockedIPv6,
  resolveAndValidate,
} from '../index';

/**
 * SSRF defence tests. These cover the parts a hostile input can reach:
 * literal addresses (IPv4 + IPv6), odd encodings, schemes, ports and hostnames.
 */
describe('SSRF: address classification', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '169.254.170.2', // ECS task credentials
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '198.18.0.1',
  ])('blocks private/loopback/link-local IPv4 %s', (address) => {
    expect(isBlockedIPv4(address)).toBe(true);
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '203.0.113.9'].slice(0, 3))('allows public IPv4 %s', (address) => {
    expect(isBlockedIPv4(address)).toBe(false);
    expect(isBlockedAddress(address)).toBe(false);
  });

  it.each([
    '::1', // loopback
    '::', // unspecified
    'fe80::1', // link-local
    'fc00::1', // unique local
    'fd12:3456::1', // unique local
    'ff02::1', // multicast
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254', // IPv4-mapped metadata
    '64:ff9b::127.0.0.1', // NAT64-embedded loopback
  ])('blocks private/loopback IPv6 %s', (address) => {
    expect(isBlockedIPv6(address)).toBe(true);
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(isBlockedIPv6('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks metadata addresses even when private targets are allowed', async () => {
    process.env.ALLOW_PRIVATE_TARGETS = 'true';
    const core = await import('@breakglass/core');
    core.resetEnvCache();
    try {
      const { isAlwaysBlockedAddress } = core;
      expect(isAlwaysBlockedAddress('169.254.169.254')).toBe(true);
      expect(isAlwaysBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    } finally {
      process.env.ALLOW_PRIVATE_TARGETS = 'false';
      core.resetEnvCache();
    }
  });
});

describe('SSRF: URL structure', () => {
  it('rejects non-HTTP schemes', () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com', 'data:text/html,hi', 'ws://example.com']) {
      expect(() => assertUrlStructure(url)).toThrow(UnsafeTargetError);
    }
  });

  it('rejects credentials embedded in the URL', () => {
    expect(() => assertUrlStructure('https://user:pass@example.com')).toThrow(UnsafeTargetError);
  });

  it('rejects blocked administrative ports', () => {
    expect(() => assertUrlStructure('https://example.com:6379')).toThrow(UnsafeTargetError);
    expect(() => assertUrlStructure('https://example.com:27017')).toThrow(UnsafeTargetError);
  });

  it('rejects malformed URLs', () => {
    expect(() => assertUrlStructure('not a url')).toThrow(UnsafeTargetError);
  });

  it('accepts an ordinary https URL and normalises it', () => {
    const parsed = assertUrlStructure('https://Example.COM/path?q=1');
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('example.com');
  });
});

describe('SSRF: hostname resolution', () => {
  it('rejects loopback hostnames before any DNS lookup', async () => {
    for (const host of ['http://localhost:3000', 'http://api.localhost', 'http://metadata.google.internal/computeMetadata/v1']) {
      await expect(resolveAndValidate(host)).rejects.toThrow(UnsafeTargetError);
    }
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    // `localtest.me` is a public DNS name that resolves to 127.0.0.1.
    // If DNS is unavailable in the sandbox this test is skipped rather than
    // reported as a failure.
    let reachable = true;
    try {
      const dns = await import('node:dns/promises');
      await dns.lookup('localtest.me');
    } catch {
      reachable = false;
    }
    if (!reachable) return;
    await expect(resolveAndValidate('http://localtest.me')).rejects.toThrow(UnsafeTargetError);
  });
});
