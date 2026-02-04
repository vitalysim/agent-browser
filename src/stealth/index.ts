/**
 * Stealth mode orchestrator for agent-browser.
 *
 * This module provides comprehensive anti-detection capabilities for browser automation,
 * designed for authorized penetration testing and automated testing scenarios.
 *
 * Features:
 * - Navigator property patches (plugins, languages, hardwareConcurrency)
 * - Chrome runtime API emulation
 * - WebDriver property hiding
 * - Canvas fingerprint protection
 * - WebGL fingerprint spoofing
 * - Audio fingerprint noise
 * - Screen/window dimension fixes
 * - Permissions API consistency
 * - Function.prototype.toString masking
 * - User-Agent Client Hints spoofing (Phase 4)
 * - Input coordinates leak fix (Phase 4)
 * - WebRTC leak prevention (Phase 4)
 * - System Chrome binary detection (Phase 4)
 */

import type { StealthProfile } from './profiles.js';
import type { StealthOptions } from '../types.js';
import { getStealthProfile, listStealthProfiles } from './profiles.js';
import { generateToStringMaskScript, generateStealthHelpersScript, generateHashScript } from './utils.js';
import { generateAllWebdriverScripts } from './webdriver.js';
import { generateAllNavigatorScripts } from './navigator.js';
import { generateAllChromeRuntimeScripts } from './chrome-runtime.js';
import { generateAllCanvasScripts } from './canvas.js';
import { generateAllWebGLScripts } from './webgl.js';
import { generateAllAudioScripts } from './audio.js';
import { generateAllDimensionScripts } from './dimensions.js';
import { generateAllPermissionsScripts } from './permissions.js';
import { generateAllClientHintsScripts, getClientHintsHeaders, getFullClientHintsHeaders } from './client-hints.js';
import { generateAllInputCoordinatesScripts } from './input-coordinates.js';
import { generateAllWebRTCScripts, WEBRTC_DISABLE_ARGS } from './webrtc.js';
import { getStealthChromePath, hasSystemChrome, getChromeVersion } from './chrome-binary.js';

// Re-export profile utilities
export { getStealthProfile, listStealthProfiles, type StealthProfile };

// Re-export Phase 4 utilities
export {
  getClientHintsHeaders,
  getFullClientHintsHeaders,
  getStealthChromePath,
  hasSystemChrome,
  getChromeVersion,
  WEBRTC_DISABLE_ARGS,
};

/**
 * Stealth launch arguments for Chromium-based browsers.
 * These flags help avoid detection at the browser level.
 */
export const STEALTH_ARGS = [
  // Disable automation-related features
  '--disable-blink-features=AutomationControlled',

  // Disable shared memory usage (can help in some environments)
  '--disable-dev-shm-usage',

  // Skip first run wizards and default browser checks
  '--no-first-run',
  '--no-default-browser-check',

  // Disable some features that might reveal automation
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',

  // Disable background networking that might interfere
  '--disable-background-networking',
  '--disable-sync',

  // Disable features that aren't needed and might cause detection
  '--disable-translate',
  '--disable-extensions',

  // Disable infobars
  '--disable-infobars',

  // Don't show popup blocking UI
  '--disable-popup-blocking',

  // Disable GPU hardware acceleration when in headless mode
  // (some detection looks for GPU differences)
  '--disable-gpu',

  // Use English locale for consistency
  '--lang=en-US',
];

/**
 * Additional stealth args specifically for headless mode.
 */
export const STEALTH_HEADLESS_ARGS = [
  // Use a more standard window size
  '--window-size=1920,1080',

  // Start maximized to appear more natural
  '--start-maximized',
];

/**
 * Generate the complete stealth init script.
 * This script should be injected via addInitScript to run on every navigation.
 *
 * @param profileName - Name of the fingerprint profile to use
 * @param options - Optional stealth options for fine-grained control
 * @returns The combined stealth script
 */
export function generateStealthScript(profileName?: string, options?: StealthOptions): string {
  const profile = getStealthProfile(profileName);

  // Determine which features to enable (defaults to all when stealth is on)
  const enableClientHints = options?.clientHints !== false;
  const enableInputCoordinates = options?.inputCoordinates !== false;
  const enableWebRTCBlock = options?.blockWebRTC !== false;

  // Build the complete script in the correct order
  // Order matters: helpers and masking must come first
  const scripts = [
    // 1. Function.prototype.toString masking (must be first)
    generateToStringMaskScript(),

    // 2. Stealth helpers for other scripts
    generateStealthHelpersScript(),

    // 3. Seeded random number generator for consistent fingerprints
    generateHashScript(profile.fingerprintSeed),

    // 4. WebDriver property hiding (high priority detection vector)
    generateAllWebdriverScripts(),

    // 5. Chrome runtime emulation (major detection vector in headless)
    generateAllChromeRuntimeScripts(),

    // 6. Navigator property patches
    generateAllNavigatorScripts(profile),

    // 7. Screen/window dimension fixes
    generateAllDimensionScripts(profile),

    // 8. Canvas fingerprint protection
    generateAllCanvasScripts(),

    // 9. WebGL fingerprint spoofing
    generateAllWebGLScripts(profile),

    // 10. Audio fingerprint noise
    generateAllAudioScripts(),

    // 11. Permissions API consistency
    generateAllPermissionsScripts(),

    // 12. User-Agent Client Hints spoofing (Phase 4)
    enableClientHints ? generateAllClientHintsScripts(profile) : '',

    // 13. Input coordinates leak fix (Phase 4)
    enableInputCoordinates ? generateAllInputCoordinatesScripts() : '',

    // 14. WebRTC leak prevention (Phase 4)
    enableWebRTCBlock ? generateAllWebRTCScripts(true) : '',
  ].filter(Boolean);

  // Wrap in a try-catch to prevent errors from breaking the page
  return `
try {
  ${scripts.join('\n\n')}
} catch (e) {
  // Stealth script error - silently ignore to avoid detection
  console.debug('[stealth] Error in init script:', e.message);
}
`;
}

/**
 * Get stealth launch arguments based on headless mode and options.
 *
 * @param headless - Whether the browser is running in headless mode
 * @param options - Optional stealth options for fine-grained control
 * @returns Array of command-line arguments
 */
export function getStealthArgs(headless: boolean = true, options?: StealthOptions): string[] {
  const args = [...STEALTH_ARGS];

  if (headless) {
    args.push(...STEALTH_HEADLESS_ARGS);
  }

  // Add WebRTC disable args if blockWebRTC is enabled (default: true)
  if (options?.blockWebRTC !== false) {
    args.push(...WEBRTC_DISABLE_ARGS);
  }

  return args;
}

/**
 * Options for stealth configuration.
 */
export interface StealthConfigOptions {
  /** Enable stealth mode */
  enabled: boolean;
  /** Fingerprint profile to use */
  profile?: string;
  /** Whether the browser is headless */
  headless?: boolean;
  /** Advanced stealth options */
  stealthOptions?: StealthOptions;
}

/**
 * Get complete stealth configuration for browser launch.
 *
 * @param options - Stealth options
 * @returns Object with args, initScript, userAgent, and optional executablePath
 */
export function getStealthConfig(options: StealthConfigOptions): {
  args: string[];
  initScript: string;
  userAgent: string;
  executablePath?: string;
  clientHintsHeaders?: Record<string, string>;
} {
  if (!options.enabled) {
    return {
      args: [],
      initScript: '',
      userAgent: '',
    };
  }

  const profile = getStealthProfile(options.profile);
  const headless = options.headless ?? true;
  const stealthOptions = options.stealthOptions;

  // Determine if we should use system Chrome
  let executablePath: string | undefined;
  if (stealthOptions?.useSystemChrome) {
    executablePath = getStealthChromePath();
  }

  // Get client hints headers if enabled
  let clientHintsHeaders: Record<string, string> | undefined;
  if (stealthOptions?.clientHints !== false && profile.clientHints) {
    clientHintsHeaders = getFullClientHintsHeaders(profile);
  }

  return {
    args: getStealthArgs(headless, stealthOptions),
    initScript: generateStealthScript(options.profile, stealthOptions),
    userAgent: profile.userAgent,
    executablePath,
    clientHintsHeaders,
  };
}
