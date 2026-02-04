/**
 * Input coordinates leak fix for stealth mode.
 *
 * Chrome's CDP has a bug where screenX/screenY equals clientX/clientY during
 * automated input events - this never happens with real user input because
 * screen coordinates include the browser chrome and window position.
 *
 * Anti-bot systems detect this discrepancy to identify automation.
 */

/**
 * Generate script to fix mouse event coordinates.
 * Patches MouseEvent to add realistic screen offset when coordinates match.
 */
export function generateInputCoordinatesFixScript(): string {
  return `
(function() {
  // Store original MouseEvent constructor
  const OriginalMouseEvent = window.MouseEvent;

  // Browser chrome height (address bar, tabs, bookmarks) - typical value
  const TOOLBAR_HEIGHT = 85;
  // Estimated window position on screen
  const WINDOW_X = window.screenX || 0;
  const WINDOW_Y = window.screenY || 0;

  // Patched MouseEvent constructor that fixes coordinates
  function PatchedMouseEvent(type, eventInitDict) {
    if (eventInitDict) {
      const init = { ...eventInitDict };

      // If screenX/screenY equals clientX/clientY, it's likely automated
      // Real browsers have screen coordinates offset by window position + browser chrome
      const clientX = init.clientX || 0;
      const clientY = init.clientY || 0;
      const screenX = init.screenX;
      const screenY = init.screenY;

      // Check if coordinates are suspiciously equal (CDP leak)
      if (screenX === clientX && screenY === clientY) {
        // Add realistic offset for screen coordinates
        init.screenX = clientX + WINDOW_X;
        init.screenY = clientY + WINDOW_Y + TOOLBAR_HEIGHT;
      }

      return new OriginalMouseEvent(type, init);
    }

    return new OriginalMouseEvent(type, eventInitDict);
  }

  // Copy static properties and prototype
  PatchedMouseEvent.prototype = OriginalMouseEvent.prototype;
  Object.setPrototypeOf(PatchedMouseEvent, OriginalMouseEvent);

  // Copy NONE, CAPTURING_PHASE, etc. constants
  for (const key of Object.getOwnPropertyNames(OriginalMouseEvent)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name') {
      try {
        PatchedMouseEvent[key] = OriginalMouseEvent[key];
      } catch (e) {
        // Some properties may not be writable
      }
    }
  }

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(PatchedMouseEvent);
  }

  // Replace global MouseEvent
  window.MouseEvent = PatchedMouseEvent;

  // Also patch dispatchEvent to fix coordinates on events being dispatched
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;

  const patchedDispatchEvent = function(event) {
    // Only process mouse events with suspicious coordinates
    if (event instanceof MouseEvent && event.isTrusted === false) {
      const screenX = event.screenX;
      const screenY = event.screenY;
      const clientX = event.clientX;
      const clientY = event.clientY;

      // Check for CDP leak (screen coords equal client coords)
      if (screenX === clientX && screenY === clientY && (clientX !== 0 || clientY !== 0)) {
        // Create a new event with fixed coordinates
        const fixedEvent = new OriginalMouseEvent(event.type, {
          bubbles: event.bubbles,
          cancelable: event.cancelable,
          view: event.view,
          detail: event.detail,
          screenX: clientX + WINDOW_X,
          screenY: clientY + WINDOW_Y + TOOLBAR_HEIGHT,
          clientX: clientX,
          clientY: clientY,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          button: event.button,
          buttons: event.buttons,
          relatedTarget: event.relatedTarget,
        });

        return originalDispatchEvent.call(this, fixedEvent);
      }
    }

    return originalDispatchEvent.call(this, event);
  };

  // Register patched function
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(patchedDispatchEvent);
  }

  EventTarget.prototype.dispatchEvent = patchedDispatchEvent;

  // Patch PointerEvent as well (modern input events)
  if (typeof PointerEvent !== 'undefined') {
    const OriginalPointerEvent = window.PointerEvent;

    function PatchedPointerEvent(type, eventInitDict) {
      if (eventInitDict) {
        const init = { ...eventInitDict };

        const clientX = init.clientX || 0;
        const clientY = init.clientY || 0;
        const screenX = init.screenX;
        const screenY = init.screenY;

        if (screenX === clientX && screenY === clientY) {
          init.screenX = clientX + WINDOW_X;
          init.screenY = clientY + WINDOW_Y + TOOLBAR_HEIGHT;
        }

        return new OriginalPointerEvent(type, init);
      }

      return new OriginalPointerEvent(type, eventInitDict);
    }

    PatchedPointerEvent.prototype = OriginalPointerEvent.prototype;
    Object.setPrototypeOf(PatchedPointerEvent, OriginalPointerEvent);

    for (const key of Object.getOwnPropertyNames(OriginalPointerEvent)) {
      if (key !== 'prototype' && key !== 'length' && key !== 'name') {
        try {
          PatchedPointerEvent[key] = OriginalPointerEvent[key];
        } catch (e) {
          // Some properties may not be writable
        }
      }
    }

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(PatchedPointerEvent);
    }

    window.PointerEvent = PatchedPointerEvent;
  }
})();
`;
}

/**
 * Get all input coordinates-related stealth scripts combined.
 */
export function generateAllInputCoordinatesScripts(): string {
  return generateInputCoordinatesFixScript();
}
