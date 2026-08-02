'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Close-on-Escape and close-on-outside-click for a transient overlay.
 *
 * Both behaviours together, because shipping one without the other is the usual way a popover
 * becomes a trap: Escape alone leaves a mouse user clicking around it, and outside-click alone
 * leaves a keyboard user with no way out at all.
 *
 * Escape is bound on `keydown` at the document, so it works wherever focus currently is inside
 * the overlay — including in a `<select>`, which swallows the event on its own.
 */
export function useDismissable(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }

    function onPointerDown(event: MouseEvent) {
      const node = container.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    // `mousedown`, not `click`: a click that starts inside and ends outside should not close.
    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, container, onClose]);
}

/**
 * Keep Tab inside an open overlay, and put focus back where it came from on close.
 *
 * A popover the keyboard can tab out of, while it still visually covers the page, leaves focus
 * somewhere the user cannot see. The elements are re-read on every Tab rather than cached,
 * because the filter popover's contents change as filters are applied.
 */
export function useFocusTrap(open: boolean, container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    const node = container.current;

    // Focus the first control, so the keyboard lands inside rather than behind.
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;

      const elements = focusables();
      if (elements.length === 0) return;

      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [open, container]);
}

/**
 * Give focus back to the button that opened a popover, when the popover took it away.
 *
 * `useFocusTrap` already does this for the overlays it guards. A disclosure — the account
 * menu, a card's overflow — deliberately isn't trapped: it does not cover the page, and
 * trapping a non-modal popover is worse than leaving it open. But it still unmounts, and
 * anything focused inside it goes with it, so pressing Escape drops focus onto `<body>` and
 * the next Tab restarts from the top of the document.
 *
 * The test for "did the popover have focus" is that `document.activeElement` is now the body:
 * a removed element leaves focus there, whereas clicking another control moves focus to that
 * control before this runs. So a user who dismissed the popover by clicking elsewhere keeps
 * the focus they chose, and only a user who lost it gets it back.
 */
export function useReturnFocus(open: boolean, trigger: RefObject<HTMLElement | null>): void {
  const wasOpen = useRef(false);

  useEffect(() => {
    const closing = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closing) return;

    const active = document.activeElement;
    if (active === null || active === document.body) trigger.current?.focus();
  }, [open, trigger]);
}
