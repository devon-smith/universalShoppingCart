import { describe, expect, it } from 'vitest';

import { buildHostPermissions, buildPermissions, E2E_HOST_PERMISSION } from './manifest';

describe('buildPermissions', () => {
  it('requests exactly the permissions the implemented features need', () => {
    // This list is a promise to users. Changing it should require changing this test.
    expect([...buildPermissions()].sort()).toEqual([
      'activeTab',
      'identity',
      'scripting',
      'sidePanel',
      'storage',
    ]);
  });

  it('does not request tabs, webNavigation, or cookies', () => {
    const permissions = buildPermissions();
    expect(permissions).not.toContain('tabs');
    expect(permissions).not.toContain('webNavigation');
    expect(permissions).not.toContain('cookies');
    expect(permissions).not.toContain('history');
  });
});

describe('buildHostPermissions', () => {
  it('is empty for a release build', () => {
    expect(buildHostPermissions()).toEqual([]);
    expect(buildHostPermissions({ e2e: false })).toEqual([]);
  });

  it('adds only loopback access for the end-to-end build', () => {
    expect(buildHostPermissions({ e2e: true })).toEqual([E2E_HOST_PERMISSION]);
  });

  it('never grants broad host access, in any configuration', () => {
    for (const permissions of [buildHostPermissions(), buildHostPermissions({ e2e: true })]) {
      expect(permissions).not.toContain('<all_urls>');
      expect(permissions).not.toContain('*://*/*');
      expect(permissions).not.toContain('https://*/*');
    }
  });
});
