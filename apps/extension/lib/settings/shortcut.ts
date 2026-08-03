/**
 * The capture shortcut, as it actually is on this machine.
 *
 * The panel used to print `⌘⇧U`. That is the suggested binding on macOS and nowhere else: a
 * Windows user reads a key they do not have, and anybody who rebound the command at
 * `chrome://extensions/shortcuts` reads a key that no longer does anything. Chrome knows the
 * real answer, so ask it.
 *
 * Chrome also allows a command to have *no* binding — the suggested one may collide with
 * something already registered, in which case `shortcut` comes back empty. That is a real state
 * and the panel says so rather than printing a key that does nothing.
 */

import { CAPTURE_COMMAND_ID } from '../manifest';

export interface CommandBinding {
  name?: string;
  shortcut?: string;
}

/**
 * The display string for the capture command, or `null` when it has no binding.
 *
 * Chrome formats the string for the platform it is running on — symbols on macOS, words
 * elsewhere — so it is shown verbatim. Reformatting it here would mean re-deriving something
 * the browser has already got right, and getting it wrong on the next platform.
 */
export function captureShortcutFrom(commands: readonly CommandBinding[]): string | null {
  const binding = commands.find((command) => command.name === CAPTURE_COMMAND_ID);
  const shortcut = binding?.shortcut?.trim();
  return shortcut ? shortcut : null;
}

/** The part of `chrome.commands` this module uses. */
export interface CommandsApi {
  getAll(): Promise<CommandBinding[]>;
}

export async function readCaptureShortcut(commands?: CommandsApi): Promise<string | null> {
  if (!commands) return null;
  try {
    return captureShortcutFrom(await commands.getAll());
  } catch {
    return null;
  }
}
