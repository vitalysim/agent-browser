/**
 * Utility functions for stealth mode.
 * Contains helpers for function masking and prototype manipulation.
 */

import type { StealthProfile } from './profiles.js';

/**
 * Generate the Function.prototype.toString masking script.
 * This prevents detection of patched native functions by making them
 * return "[native code]" when converted to string.
 */
export function generateToStringMaskScript(): string {
  return `
(function() {
  // Store original toString before modification
  const originalToString = Function.prototype.toString;
  const nativeToStringStr = 'function toString() { [native code] }';

  // Track functions we've patched
  const patchedFunctions = new WeakSet();

  // Override toString to mask patched functions
  const newToString = function() {
    // If this is toString itself, return native string
    if (this === newToString) {
      return nativeToStringStr;
    }

    // If this function was patched by us, return native-looking string
    if (patchedFunctions.has(this)) {
      const name = this.name || '';
      return 'function ' + name + '() { [native code] }';
    }

    // Otherwise, use original toString
    return originalToString.call(this);
  };

  // Define it as non-enumerable to avoid detection
  Object.defineProperty(Function.prototype, 'toString', {
    value: newToString,
    writable: true,
    configurable: true,
    enumerable: false,
  });

  // Mark our own toString as patched so it returns native code
  patchedFunctions.add(newToString);

  // Export the registration function for other scripts to use
  window.__stealthPatchedFunctions = patchedFunctions;
})();
`;
}

/**
 * Generate a helper script that provides utilities for other stealth scripts.
 * This should be injected first, before other stealth scripts.
 */
export function generateStealthHelpersScript(): string {
  return `
(function() {
  // Helper to define a getter that looks native
  window.__defineStealthGetter = function(obj, prop, getter) {
    const patchedFunctions = window.__stealthPatchedFunctions;
    if (patchedFunctions) {
      patchedFunctions.add(getter);
    }

    Object.defineProperty(obj, prop, {
      get: getter,
      configurable: true,
      enumerable: true,
    });
  };

  // Helper to define a value property
  window.__defineStealthValue = function(obj, prop, value) {
    Object.defineProperty(obj, prop, {
      value: value,
      writable: false,
      configurable: true,
      enumerable: true,
    });
  };

  // Helper to proxy a method while masking it
  window.__proxyStealthMethod = function(obj, method, handler) {
    const original = obj[method];
    const patchedFunctions = window.__stealthPatchedFunctions;

    const proxy = new Proxy(original, handler);

    if (patchedFunctions) {
      patchedFunctions.add(proxy);
    }

    obj[method] = proxy;
    return original;
  };
})();
`;
}

/**
 * Generate a simple hash from a seed for consistent fingerprint noise.
 * Used to generate deterministic but unique-looking fingerprint values.
 */
export function generateHashScript(seed: number): string {
  return `
(function() {
  // Simple mulberry32 PRNG with the profile seed
  window.__stealthSeed = ${seed};
  window.__stealthRandom = function() {
    let t = window.__stealthSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
})();
`;
}

/**
 * Combine multiple script strings into a single IIFE.
 */
export function combineScripts(scripts: string[]): string {
  return scripts.join('\n');
}

/**
 * Get profile-specific values that need to be injected into scripts.
 */
export function getProfileScriptValues(profile: StealthProfile): Record<string, unknown> {
  return {
    userAgent: profile.userAgent,
    platform: profile.platform,
    vendor: profile.vendor,
    vendorSub: profile.vendorSub,
    languages: profile.languages,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    maxTouchPoints: profile.maxTouchPoints,
    screenWidth: profile.screenWidth,
    screenHeight: profile.screenHeight,
    screenAvailWidth: profile.screenAvailWidth,
    screenAvailHeight: profile.screenAvailHeight,
    colorDepth: profile.colorDepth,
    pixelDepth: profile.pixelDepth,
    webglVendor: profile.webglVendor,
    webglRenderer: profile.webglRenderer,
    fingerprintSeed: profile.fingerprintSeed,
  };
}
