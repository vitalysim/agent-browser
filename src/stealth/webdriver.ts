/**
 * WebDriver property hiding for stealth mode.
 * Hides automation indicators that reveal the browser is controlled by WebDriver/Playwright.
 */

/**
 * Generate script to hide navigator.webdriver property.
 * This is one of the most common automation detection vectors.
 */
export function generateWebdriverHideScript(): string {
  return `
(function() {
  // Override navigator.webdriver to return undefined (like a real browser)
  // Use defineProperty to make it non-writable and harder to detect
  const getter = function() { return undefined; };

  // Register with stealth helpers if available
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(getter);
  }

  Object.defineProperty(navigator, 'webdriver', {
    get: getter,
    configurable: true,
    enumerable: true,
  });

  // Also delete any existing webdriver property that might have been set
  // before our script ran (edge case for some browsers)
  try {
    delete Navigator.prototype.webdriver;
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: getter,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    // Ignore errors - some browsers may not allow this
  }
})();
`;
}

/**
 * Generate script to remove automation-related properties.
 * Some detection methods look for properties that only exist in automated browsers.
 */
export function generateAutomationPropsHideScript(): string {
  return `
(function() {
  // Remove Playwright-specific properties
  const propsToRemove = [
    '__playwright',
    '__pw_manual',
    '__PW_inspect',
    '__pwInitScripts',
    '__playwright_evaluation_script__',
  ];

  for (const prop of propsToRemove) {
    try {
      if (prop in window) {
        delete window[prop];
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Remove CDP-related artifacts
  const cdpProps = [
    'cdc_adoQpoasnfa76pfcZLmcfl_Array',
    'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
    'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
  ];

  for (const prop of cdpProps) {
    try {
      if (prop in window) {
        delete window[prop];
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Hide document.$cdc_asdjflasutopfhvcZLmcfl_ pattern (ChromeDriver artifacts)
  // These are sometimes added as document properties
  try {
    for (const key of Object.keys(document)) {
      if (key.startsWith('$cdc_') || key.startsWith('$wdc_')) {
        delete document[key];
      }
    }
  } catch (e) {
    // Ignore errors
  }

  // Set up a MutationObserver to remove any dynamically added automation properties
  // This catches properties that Playwright might add after our initial cleanup
  try {
    const cleanupAutomationProps = function() {
      for (const prop of propsToRemove) {
        try {
          if (prop in window) {
            delete window[prop];
          }
        } catch (e) {
          // Ignore errors
        }
      }
    };

    // Run cleanup on DOM ready and after a small delay
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cleanupAutomationProps);
    } else {
      cleanupAutomationProps();
    }

    // Also run cleanup after a short delay to catch late additions
    setTimeout(cleanupAutomationProps, 100);
    setTimeout(cleanupAutomationProps, 500);
  } catch (e) {
    // Ignore errors
  }
})();
`;
}

/**
 * Generate script to hide document.hidden and visibilityState in headless mode.
 * Headless browsers often report document as hidden, which is a detection vector.
 */
export function generateVisibilityHideScript(): string {
  return `
(function() {
  // Make document appear visible even in headless mode
  const visibleGetter = function() { return false; };
  const visibilityStateGetter = function() { return 'visible'; };

  // Register with stealth helpers
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(visibleGetter);
    window.__stealthPatchedFunctions.add(visibilityStateGetter);
  }

  Object.defineProperty(document, 'hidden', {
    get: visibleGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(document, 'visibilityState', {
    get: visibilityStateGetter,
    configurable: true,
    enumerable: true,
  });

  // Also override Document.prototype for new documents
  try {
    Object.defineProperty(Document.prototype, 'hidden', {
      get: visibleGetter,
      configurable: true,
      enumerable: true,
    });

    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: visibilityStateGetter,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    // Ignore errors
  }
})();
`;
}

/**
 * Get all webdriver-related stealth scripts combined.
 */
export function generateAllWebdriverScripts(): string {
  return [
    generateWebdriverHideScript(),
    generateAutomationPropsHideScript(),
    generateVisibilityHideScript(),
  ].join('\n');
}
