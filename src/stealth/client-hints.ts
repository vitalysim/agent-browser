/**
 * User-Agent Client Hints spoofing for stealth mode.
 * Modern browsers send sec-ch-ua headers that must match the User-Agent string.
 * Anti-bot systems check for consistency between these values.
 */

import type { StealthProfile } from './profiles.js';

/**
 * Client hints data that matches a browser profile.
 */
export interface ClientHintsData {
  brands: Array<{ brand: string; version: string }>;
  fullVersionList: Array<{ brand: string; version: string }>;
  mobile: boolean;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
}

/**
 * Generate the sec-ch-ua header value from brands.
 */
export function generateSecChUa(brands: Array<{ brand: string; version: string }>): string {
  return brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
}

/**
 * Generate script to spoof navigator.userAgentData.
 * This is the modern replacement for navigator.userAgent and must be consistent.
 */
export function generateUserAgentDataScript(profile: StealthProfile): string {
  const clientHints = profile.clientHints;
  if (!clientHints) {
    return '';
  }

  return `
(function() {
  const clientHintsData = ${JSON.stringify(clientHints)};

  // Create a NavigatorUAData-like object
  const userAgentData = {
    brands: clientHintsData.brands.map(b => Object.freeze({ brand: b.brand, version: b.version })),
    mobile: clientHintsData.mobile,
    platform: clientHintsData.platform,

    // getHighEntropyValues returns a promise with detailed information
    getHighEntropyValues: function(hints) {
      return Promise.resolve({
        brands: clientHintsData.brands.map(b => Object.freeze({ brand: b.brand, version: b.version })),
        fullVersionList: clientHintsData.fullVersionList.map(b => Object.freeze({ brand: b.brand, version: b.version })),
        mobile: clientHintsData.mobile,
        model: clientHintsData.model,
        platform: clientHintsData.platform,
        platformVersion: clientHintsData.platformVersion,
        architecture: clientHintsData.architecture,
        bitness: clientHintsData.bitness,
        // Include any requested hints
        ...(hints.includes('uaFullVersion') && { uaFullVersion: clientHintsData.fullVersionList[0]?.version || '' }),
      });
    },

    // toJSON returns the low-entropy data
    toJSON: function() {
      return {
        brands: clientHintsData.brands,
        mobile: clientHintsData.mobile,
        platform: clientHintsData.platform,
      };
    },
  };

  // Register functions with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(userAgentData.getHighEntropyValues);
    window.__stealthPatchedFunctions.add(userAgentData.toJSON);
  }

  // Make brands array frozen and immutable
  Object.freeze(userAgentData.brands);

  // Create the getter
  const userAgentDataGetter = function() { return userAgentData; };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(userAgentDataGetter);
  }

  // Override navigator.userAgentData
  Object.defineProperty(navigator, 'userAgentData', {
    get: userAgentDataGetter,
    configurable: true,
    enumerable: true,
  });

  // Also patch NavigatorUAData prototype if it exists
  try {
    if (typeof NavigatorUAData !== 'undefined') {
      const proto = NavigatorUAData.prototype;

      // Patch getHighEntropyValues on prototype
      const originalGetHighEntropyValues = proto.getHighEntropyValues;
      proto.getHighEntropyValues = function(hints) {
        return userAgentData.getHighEntropyValues(hints);
      };

      if (window.__stealthPatchedFunctions) {
        window.__stealthPatchedFunctions.add(proto.getHighEntropyValues);
      }
    }
  } catch (e) {
    // NavigatorUAData may not exist in all browsers
  }
})();
`;
}

/**
 * Get HTTP headers for client hints that should be sent with requests.
 */
export function getClientHintsHeaders(profile: StealthProfile): Record<string, string> {
  const clientHints = profile.clientHints;
  if (!clientHints) {
    return {};
  }

  return {
    'sec-ch-ua': generateSecChUa(clientHints.brands),
    'sec-ch-ua-mobile': clientHints.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${clientHints.platform}"`,
  };
}

/**
 * Get full client hints headers including high-entropy values.
 * These are sent when the server requests them via Accept-CH header.
 */
export function getFullClientHintsHeaders(profile: StealthProfile): Record<string, string> {
  const clientHints = profile.clientHints;
  if (!clientHints) {
    return {};
  }

  return {
    ...getClientHintsHeaders(profile),
    'sec-ch-ua-arch': `"${clientHints.architecture}"`,
    'sec-ch-ua-bitness': `"${clientHints.bitness}"`,
    'sec-ch-ua-full-version-list': generateSecChUa(clientHints.fullVersionList),
    'sec-ch-ua-model': `"${clientHints.model}"`,
    'sec-ch-ua-platform-version': `"${clientHints.platformVersion}"`,
  };
}

/**
 * Get all client hints-related stealth scripts combined.
 */
export function generateAllClientHintsScripts(profile: StealthProfile): string {
  return generateUserAgentDataScript(profile);
}
