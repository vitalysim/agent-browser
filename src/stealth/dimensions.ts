/**
 * Screen and window dimension fixes for stealth mode.
 * Fixes detection vectors related to window dimensions in headless mode.
 */

import type { StealthProfile } from './profiles.js';

/**
 * Generate script to fix window.outerWidth/outerHeight.
 * In headless mode, these return 0 which is a detection vector.
 */
export function generateDimensionsScript(profile: StealthProfile): string {
  const { screenWidth, screenHeight, screenAvailWidth, screenAvailHeight, colorDepth, pixelDepth } =
    profile;

  return `
(function() {
  // Get actual inner dimensions or use profile defaults
  const innerWidth = window.innerWidth || ${screenWidth};
  const innerHeight = window.innerHeight || ${screenHeight};

  // Browser chrome height (typical values: 74-100px for address bar, tabs, etc.)
  const chromeHeight = 85;
  const chromeWidth = 0; // Usually no horizontal chrome

  // Calculate outer dimensions
  const outerWidth = innerWidth + chromeWidth;
  const outerHeight = innerHeight + chromeHeight;

  // Override outerWidth (headless mode returns 0)
  const outerWidthGetter = function() { return outerWidth; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(outerWidthGetter);
  }
  Object.defineProperty(window, 'outerWidth', {
    get: outerWidthGetter,
    configurable: true,
    enumerable: true,
  });

  // Override outerHeight (headless mode returns 0)
  const outerHeightGetter = function() { return outerHeight; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(outerHeightGetter);
  }
  Object.defineProperty(window, 'outerHeight', {
    get: outerHeightGetter,
    configurable: true,
    enumerable: true,
  });

  // Screen dimensions - use profile values for consistency
  const screenWidthGetter = function() { return ${screenWidth}; };
  const screenHeightGetter = function() { return ${screenHeight}; };
  const availWidthGetter = function() { return ${screenAvailWidth}; };
  const availHeightGetter = function() { return ${screenAvailHeight}; };
  const colorDepthGetter = function() { return ${colorDepth}; };
  const pixelDepthGetter = function() { return ${pixelDepth}; };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(screenWidthGetter);
    window.__stealthPatchedFunctions.add(screenHeightGetter);
    window.__stealthPatchedFunctions.add(availWidthGetter);
    window.__stealthPatchedFunctions.add(availHeightGetter);
    window.__stealthPatchedFunctions.add(colorDepthGetter);
    window.__stealthPatchedFunctions.add(pixelDepthGetter);
  }

  Object.defineProperty(screen, 'width', {
    get: screenWidthGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(screen, 'height', {
    get: screenHeightGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(screen, 'availWidth', {
    get: availWidthGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(screen, 'availHeight', {
    get: availHeightGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(screen, 'colorDepth', {
    get: colorDepthGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(screen, 'pixelDepth', {
    get: pixelDepthGetter,
    configurable: true,
    enumerable: true,
  });

  // Window screenX/screenY - position on screen (use reasonable defaults)
  const screenXGetter = function() { return 0; };
  const screenYGetter = function() { return 0; };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(screenXGetter);
    window.__stealthPatchedFunctions.add(screenYGetter);
  }

  Object.defineProperty(window, 'screenX', {
    get: screenXGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(window, 'screenY', {
    get: screenYGetter,
    configurable: true,
    enumerable: true,
  });

  // Legacy screen position properties
  Object.defineProperty(window, 'screenLeft', {
    get: screenXGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(window, 'screenTop', {
    get: screenYGetter,
    configurable: true,
    enumerable: true,
  });
})();
`;
}

/**
 * Generate script to fix devicePixelRatio.
 */
export function generatePixelRatioScript(): string {
  return `
(function() {
  // Ensure devicePixelRatio has a reasonable value
  // Most desktop monitors are 1 or 2, mobile devices can be 2-3
  const currentRatio = window.devicePixelRatio;

  // Only fix if it's 0 or undefined (which shouldn't happen but just in case)
  if (!currentRatio || currentRatio === 0) {
    const ratioGetter = function() { return 1; };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(ratioGetter);
    }

    Object.defineProperty(window, 'devicePixelRatio', {
      get: ratioGetter,
      configurable: true,
      enumerable: true,
    });
  }
})();
`;
}

/**
 * Get all dimension-related stealth scripts.
 */
export function generateAllDimensionScripts(profile: StealthProfile): string {
  return [generateDimensionsScript(profile), generatePixelRatioScript()].join('\n');
}
