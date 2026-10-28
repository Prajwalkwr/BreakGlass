import { describe, expect, it } from 'vitest';
import { extractSameOriginPageLinks, planPageCheckSchedule } from './page-scan.service';
import { normalizeObservedApiPath } from '../monitoring/runners/browser';

describe('same-origin page discovery', () => {
  const origin = 'https://shops.example.test';
  const pageUrl = `${origin}/catalog/`;

  it('resolves relative links and removes fragments, queries and duplicate trailing slashes', () => {
    const links = extractSameOriginPageLinks(
      '<a href="/about#team">About</a><a href="../contact/?source=menu">Contact</a><a href="/about/">Again</a>',
      pageUrl,
      origin,
    );

    expect(links).toEqual([`${origin}/about`, `${origin}/contact`]);
  });

  describe('page check scheduling limits', () => {
    it('schedules available pages without exceeding project limit', () => {
      const pages = Array.from({ length: 50 }, (_, index) => ({ url: `https://shops.example.test/${index}` }));
      const existingByUrl = new Map([[pages[0].url, { enabled: true }]]);
      const plan = planPageCheckSchedule({
        pages,
        existingByUrl,
        existingCheckCount: 1,
        activeCheckCount: 1,
        projectCheckLimit: 50,
        activeCheckLimit: 100,
      });

      expect(plan.createUrls).toHaveLength(49);
      expect(plan.alreadyMonitoredUrls).toEqual([pages[0].url]);
      expect(plan.unscheduledUrls).toEqual([]);
      expect(plan.projectLimitExceeded).toBe(0);
    });

    it('allows a 50-page scan alongside existing project checks', () => {
      const pages = Array.from({ length: 50 }, (_, index) => ({ url: `https://shops.example.test/${index}` }));
      const existingByUrl = new Map<string, { enabled: boolean }>();
      const plan = planPageCheckSchedule({
        pages,
        existingByUrl,
        existingCheckCount: 1,
        activeCheckCount: 1,
        projectCheckLimit: 100,
        activeCheckLimit: 100,
      });

      expect(plan.createUrls).toHaveLength(50);
      expect(plan.unscheduledUrls).toEqual([]);
      expect(plan.projectLimitExceeded).toBe(0);
    });

    it('reports the pages that cannot fit while preserving existing checks', () => {
      const pages = Array.from({ length: 50 }, (_, index) => ({ url: `https://shops.example.test/${index}` }));
      const existingByUrl = new Map([[pages[0].url, { enabled: true }]]);
      const plan = planPageCheckSchedule({
        pages,
        existingByUrl,
        existingCheckCount: 50,
        activeCheckCount: 100,
        projectCheckLimit: 50,
        activeCheckLimit: 100,
      });

      expect(plan.createUrls).toEqual([]);
      expect(plan.unscheduledUrls).toHaveLength(49);
      expect(plan.projectLimitExceeded).toBe(49);
      expect(plan.workspaceLimitExceeded).toBe(0);
    });

    it('keeps already active pages and reports workspace-limited additions', () => {
      const pages = Array.from({ length: 3 }, (_, index) => ({ url: `https://shops.example.test/${index}` }));
      const existingByUrl = new Map([[pages[0].url, { enabled: true }]]);
      const plan = planPageCheckSchedule({
        pages,
        existingByUrl,
        existingCheckCount: 1,
        activeCheckCount: 9,
        projectCheckLimit: 50,
        activeCheckLimit: 10,
      });

      expect(plan.createUrls).toEqual([pages[1].url]);
      expect(plan.unscheduledUrls).toEqual([pages[2].url]);
      expect(plan.workspaceLimitExceeded).toBe(1);
    });
  });

  describe('observed API endpoint sanitization', () => {
    const origin = 'https://shops.example.test';

    it('keeps same-origin paths while removing query strings and masking opaque IDs', () => {
      expect(normalizeObservedApiPath(
        `${origin}/api/orders/550e8400-e29b-41d4-a716-446655440000?token=private`,
        origin,
      )).toBe('/api/orders/:id');
    });

    it('ignores API calls outside the monitored origin', () => {
      expect(normalizeObservedApiPath('https://api.example.test/v1/orders', origin)).toBeNull();
    });
  });

  it('ignores off-origin, non-web, empty, malformed and static-file links', () => {
    const links = extractSameOriginPageLinks(
      [
        '<a href="https://elsewhere.example.test/page">External</a>',
        '<a href="//elsewhere.example.test/page">Protocol-relative external</a>',
        '<a href="mailto:hello@example.test">Email</a>',
        '<a href="javascript:void(0)">Script</a>',
        '<a href="#section">Fragment</a>',
        '<a href="/assets/site.css">Stylesheet</a>',
        '<a href="/products">Products</a>',
      ].join(''),
      pageUrl,
      origin,
    );

    expect(links).toEqual([`${origin}/products`]);
  });

  it('decodes escaped ampersands before removing query parameters', () => {
    const links = extractSameOriginPageLinks('<a href="/offers?x=1&amp;y=2">Offers</a>', pageUrl, origin);
    expect(links).toEqual([`${origin}/offers`]);
  });
});
