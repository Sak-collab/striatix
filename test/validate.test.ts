import { describe, expect, it } from 'vitest';

import { clip, normalizeEmail, normalizePlan, normalizeSource } from '../src/lib/validate';

describe('normalizeEmail', () => {
  it.each([
    ['person@example.com', 'person@example.com'],
    ['  Person@Example.COM  ', 'person@example.com'],
    ['first.last+tag@sub.example.co.uk', 'first.last+tag@sub.example.co.uk'],
    ['o\'brien@example.ie', "o'brien@example.ie"],
  ])('accepts %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['plainaddress'],
    ['@example.com'],
    ['person@'],
    ['person@example'],
    ['person@example.c'],
    ['two@@example.com'],
    ['a@b@example.com'],
    ['has space@example.com'],
    ['person@exa mple.com'],
    ['person@example.com\nBcc: victim@example.com'],
    ['person@example.com\r'],
    ['tab\t@example.com'],
    ['person@.example.com'],
    ['person@example..com'],
  ])('rejects %j', (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });

  it('caps length at 254 characters', () => {
    const domain = '@example.com';
    expect(normalizeEmail('a'.repeat(254 - domain.length) + domain)).not.toBeNull();
    expect(normalizeEmail('a'.repeat(255 - domain.length) + domain)).toBeNull();
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 42, {}, ['a@b.co']]) expect(normalizeEmail(v)).toBeNull();
  });
});

describe('other fields', () => {
  it('only accepts known plan tiers', () => {
    expect(normalizePlan('once')).toBe('once');
    expect(normalizePlan('subscribe')).toBe('subscribe');
    expect(normalizePlan('trial')).toBe('trial');
    expect(normalizePlan('enterprise')).toBeNull();
    expect(normalizePlan(undefined)).toBeNull();
  });

  it('defaults source to section', () => {
    expect(normalizeSource('footer')).toBe('footer');
    expect(normalizeSource('evil')).toBe('section');
  });

  it('clips and strips control characters', () => {
    expect(clip('a'.repeat(500), 200)).toHaveLength(200);
    expect(clip('ok\u0000\nvalue', 50)).toBe('okvalue');
    expect(clip('   ', 50)).toBeNull();
  });
});
