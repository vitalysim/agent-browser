/**
 * WebGL fingerprint spoofing for stealth mode.
 * Provides consistent WebGL vendor/renderer strings that match the selected profile.
 */

import type { StealthProfile } from './profiles.js';

/**
 * Generate script to spoof WebGL vendor and renderer strings.
 * These are commonly used for fingerprinting and can reveal headless browsers.
 */
export function generateWebGLSpoofScript(profile: StealthProfile): string {
  const { webglVendor, webglRenderer } = profile;

  return `
(function() {
  const spoofedVendor = ${JSON.stringify(webglVendor)};
  const spoofedRenderer = ${JSON.stringify(webglRenderer)};

  // Store original getParameter
  const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
  const originalGetParameter2 = WebGL2RenderingContext?.prototype?.getParameter;

  // Create spoofed getParameter function
  const createSpoofedGetParameter = (original) => {
    return function(parameter) {
      // Get the debug info extension for vendor/renderer constants
      const debugInfo = this.getExtension('WEBGL_debug_renderer_info');

      if (debugInfo) {
        // UNMASKED_VENDOR_WEBGL = 0x9245
        if (parameter === debugInfo.UNMASKED_VENDOR_WEBGL || parameter === 0x9245) {
          return spoofedVendor;
        }
        // UNMASKED_RENDERER_WEBGL = 0x9246
        if (parameter === debugInfo.UNMASKED_RENDERER_WEBGL || parameter === 0x9246) {
          return spoofedRenderer;
        }
      }

      // For other parameters, use the original
      return original.call(this, parameter);
    };
  };

  // Create proxied versions
  const spoofedGetParameter = createSpoofedGetParameter(originalGetParameter);
  const spoofedGetParameter2 = originalGetParameter2
    ? createSpoofedGetParameter(originalGetParameter2)
    : null;

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(spoofedGetParameter);
    if (spoofedGetParameter2) {
      window.__stealthPatchedFunctions.add(spoofedGetParameter2);
    }
  }

  // Apply to WebGLRenderingContext
  WebGLRenderingContext.prototype.getParameter = spoofedGetParameter;

  // Apply to WebGL2RenderingContext if available
  if (WebGL2RenderingContext && spoofedGetParameter2) {
    WebGL2RenderingContext.prototype.getParameter = spoofedGetParameter2;
  }

  // Also handle getSupportedExtensions to ensure WEBGL_debug_renderer_info is present
  const originalGetSupportedExtensions = WebGLRenderingContext.prototype.getSupportedExtensions;

  const spoofedGetSupportedExtensions = function() {
    const extensions = originalGetSupportedExtensions.call(this) || [];
    // Ensure debug extension is in the list
    if (!extensions.includes('WEBGL_debug_renderer_info')) {
      extensions.push('WEBGL_debug_renderer_info');
    }
    return extensions;
  };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(spoofedGetSupportedExtensions);
  }

  WebGLRenderingContext.prototype.getSupportedExtensions = spoofedGetSupportedExtensions;

  if (WebGL2RenderingContext) {
    const originalGetSupportedExtensions2 = WebGL2RenderingContext.prototype.getSupportedExtensions;

    const spoofedGetSupportedExtensions2 = function() {
      const extensions = originalGetSupportedExtensions2.call(this) || [];
      if (!extensions.includes('WEBGL_debug_renderer_info')) {
        extensions.push('WEBGL_debug_renderer_info');
      }
      return extensions;
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(spoofedGetSupportedExtensions2);
    }

    WebGL2RenderingContext.prototype.getSupportedExtensions = spoofedGetSupportedExtensions2;
  }
})();
`;
}

/**
 * Generate script to add subtle noise to WebGL fingerprinting operations.
 */
export function generateWebGLNoiseScript(): string {
  return `
(function() {
  // Get the seeded random function
  const random = window.__stealthRandom || Math.random;

  // Store original readPixels
  const originalReadPixels = WebGLRenderingContext.prototype.readPixels;
  const originalReadPixels2 = WebGL2RenderingContext?.prototype?.readPixels;

  // Create noised version
  const createNoisedReadPixels = (original) => {
    return function(x, y, width, height, format, type, pixels) {
      original.call(this, x, y, width, height, format, type, pixels);

      // Add subtle noise to the pixel data if it looks like a fingerprinting attempt
      if (pixels && pixels.length > 0 && width <= 300 && height <= 300) {
        for (let i = 0; i < pixels.length; i += 4) {
          // Only modify non-zero pixels
          if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) {
            const noise = Math.floor(random() * 3) - 1; // -1, 0, or 1
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise));
          }
        }
      }
    };
  };

  const noisedReadPixels = createNoisedReadPixels(originalReadPixels);
  const noisedReadPixels2 = originalReadPixels2
    ? createNoisedReadPixels(originalReadPixels2)
    : null;

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(noisedReadPixels);
    if (noisedReadPixels2) {
      window.__stealthPatchedFunctions.add(noisedReadPixels2);
    }
  }

  WebGLRenderingContext.prototype.readPixels = noisedReadPixels;

  if (WebGL2RenderingContext && noisedReadPixels2) {
    WebGL2RenderingContext.prototype.readPixels = noisedReadPixels2;
  }
})();
`;
}

/**
 * Get all WebGL-related stealth scripts.
 */
export function generateAllWebGLScripts(profile: StealthProfile): string {
  return [generateWebGLSpoofScript(profile), generateWebGLNoiseScript()].join('\n');
}
