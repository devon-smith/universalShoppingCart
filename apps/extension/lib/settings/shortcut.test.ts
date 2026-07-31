import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_COMMAND_ID } from '../manifest';
import { captureShortcutFrom, readCaptureShortcut } from './shortcut';

describe('captureShortcutFrom', () => {
  it('finds the capture command among the others', () => {
    const shortcut = captureShortcutFrom([
      { name: '_execute_action', shortcut: 'Ctrl+Shift+K' },
      { name: CAPTURE_COMMAND_ID, shortcut: 'Ctrl+Shift+U' },
    ]);

    expect(shortcut).toBe('Ctrl+Shift+U');
  });

  it('passes the platform string through rather than reformatting it', () => {
    // macOS hands back symbols; reformatting would only be a chance to get it wrong.
    expect(captureShortcutFrom([{ name: CAPTURE_COMMAND_ID, shortcut: '⌘⇧U' }])).toBe('⌘⇧U');
  });

  it('reports no binding when the shortcut is empty, which Chrome does on a collision', () => {
    expect(captureShortcutFrom([{ name: CAPTURE_COMMAND_ID, shortcut: '' }])).toBeNull();
  });

  it('reports no binding when the command is absent', () => {
    expect(captureShortcutFrom([{ name: '_execute_action', shortcut: 'Ctrl+U' }])).toBeNull();
  });

  it('reports no binding for a whitespace-only shortcut', () => {
    expect(captureShortcutFrom([{ name: CAPTURE_COMMAND_ID, shortcut: '   ' }])).toBeNull();
  });
});

describe('readCaptureShortcut', () => {
  it('reads the binding from the commands api', async () => {
    const commands = {
      getAll: vi.fn().mockResolvedValue([{ name: CAPTURE_COMMAND_ID, shortcut: 'Alt+S' }]),
    };
    expect(await readCaptureShortcut(commands)).toBe('Alt+S');
  });

  it('returns null where the api is unavailable rather than throwing into the panel', async () => {
    expect(await readCaptureShortcut(undefined)).toBeNull();
  });

  it('returns null when the api rejects', async () => {
    const commands = { getAll: vi.fn().mockRejectedValue(new Error('no')) };
    expect(await readCaptureShortcut(commands)).toBeNull();
  });
});
