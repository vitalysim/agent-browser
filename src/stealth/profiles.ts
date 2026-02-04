/**
 * Stealth fingerprint profiles based on real browser configurations.
 * These profiles provide consistent, realistic browser fingerprints for various platforms.
 */

import type { ClientHintsData } from './client-hints.js';

export interface StealthProfile {
  userAgent: string;
  platform: string;
  vendor: string;
  vendorSub: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  screenAvailWidth: number;
  screenAvailHeight: number;
  colorDepth: number;
  pixelDepth: number;
  webglVendor: string;
  webglRenderer: string;
  /** Seed for consistent fingerprint noise (canvas, audio) */
  fingerprintSeed: number;
  /** User-Agent Client Hints data for modern browsers */
  clientHints?: ClientHintsData;
}

/**
 * Chrome on Windows 11 - Most common desktop configuration
 */
const chromeWindows: StealthProfile = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  platform: 'Win32',
  vendor: 'Google Inc.',
  vendorSub: '',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  screenAvailWidth: 1920,
  screenAvailHeight: 1040,
  colorDepth: 24,
  pixelDepth: 24,
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)',
  fingerprintSeed: 0x7f3c2d1e,
  clientHints: {
    brands: [
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Not_A Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '131.0.6778.69' },
      { brand: 'Google Chrome', version: '131.0.6778.69' },
      { brand: 'Not_A Brand', version: '24.0.0.0' },
    ],
    mobile: false,
    platform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    model: '',
  },
};

/**
 * Chrome on macOS - Common developer/creative configuration
 */
const chromeMac: StealthProfile = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  platform: 'MacIntel',
  vendor: 'Google Inc.',
  vendorSub: '',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 10,
  deviceMemory: 8,
  maxTouchPoints: 0,
  screenWidth: 1512,
  screenHeight: 982,
  screenAvailWidth: 1512,
  screenAvailHeight: 919,
  colorDepth: 30,
  pixelDepth: 30,
  webglVendor: 'Google Inc. (Apple)',
  webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
  fingerprintSeed: 0x4a5b6c7d,
  clientHints: {
    brands: [
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Not_A Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '131.0.6778.69' },
      { brand: 'Google Chrome', version: '131.0.6778.69' },
      { brand: 'Not_A Brand', version: '24.0.0.0' },
    ],
    mobile: false,
    platform: 'macOS',
    platformVersion: '10.15.7',
    architecture: 'arm',
    bitness: '64',
    model: '',
  },
};

/**
 * Chrome on Linux - Developer workstation configuration
 */
const chromeLinux: StealthProfile = {
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  platform: 'Linux x86_64',
  vendor: 'Google Inc.',
  vendorSub: '',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  screenAvailWidth: 1920,
  screenAvailHeight: 1053,
  colorDepth: 24,
  pixelDepth: 24,
  webglVendor: 'Google Inc. (Intel)',
  webglRenderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
  fingerprintSeed: 0x8e9f0a1b,
  clientHints: {
    brands: [
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Not_A Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '131.0.6778.69' },
      { brand: 'Google Chrome', version: '131.0.6778.69' },
      { brand: 'Not_A Brand', version: '24.0.0.0' },
    ],
    mobile: false,
    platform: 'Linux',
    platformVersion: '6.5.0',
    architecture: 'x86',
    bitness: '64',
    model: '',
  },
};

/**
 * Chrome on Android - Mobile phone configuration
 */
const mobileAndroid: StealthProfile = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv81',
  vendor: 'Google Inc.',
  vendorSub: '',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 5,
  screenWidth: 412,
  screenHeight: 915,
  screenAvailWidth: 412,
  screenAvailHeight: 857,
  colorDepth: 24,
  pixelDepth: 24,
  webglVendor: 'Qualcomm',
  webglRenderer: 'Adreno (TM) 750',
  fingerprintSeed: 0x2c3d4e5f,
  clientHints: {
    brands: [
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Not_A Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '131.0.6778.69' },
      { brand: 'Google Chrome', version: '131.0.6778.69' },
      { brand: 'Not_A Brand', version: '24.0.0.0' },
    ],
    mobile: true,
    platform: 'Android',
    platformVersion: '14.0.0',
    architecture: '',
    bitness: '',
    model: 'Pixel 8',
  },
};

/**
 * Safari on iOS - iPhone configuration
 * Note: Safari on iOS doesn't support User-Agent Client Hints, so no clientHints data
 */
const mobileIos: StealthProfile = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  vendor: 'Apple Computer, Inc.',
  vendorSub: '',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 6,
  deviceMemory: 4,
  maxTouchPoints: 5,
  screenWidth: 390,
  screenHeight: 844,
  screenAvailWidth: 390,
  screenAvailHeight: 844,
  colorDepth: 32,
  pixelDepth: 32,
  webglVendor: 'Apple Inc.',
  webglRenderer: 'Apple GPU',
  fingerprintSeed: 0x6f7e8d9c,
  // Safari doesn't support Client Hints, so this is undefined
  clientHints: undefined,
};

/**
 * Map of profile names to their configurations
 */
export const stealthProfiles: Record<string, StealthProfile> = {
  'chrome-windows': chromeWindows,
  'chrome-mac': chromeMac,
  'chrome-linux': chromeLinux,
  'mobile-android': mobileAndroid,
  'mobile-ios': mobileIos,
};

/**
 * Get a stealth profile by name
 * @param name Profile name or undefined for auto-detection based on platform
 * @returns The stealth profile configuration
 */
export function getStealthProfile(name?: string): StealthProfile {
  if (name && stealthProfiles[name]) {
    return stealthProfiles[name];
  }

  // Auto-detect based on current platform
  const platform = process.platform;
  if (platform === 'darwin') {
    return chromeMac;
  } else if (platform === 'win32') {
    return chromeWindows;
  } else {
    return chromeLinux;
  }
}

/**
 * List available profile names
 */
export function listStealthProfiles(): string[] {
  return Object.keys(stealthProfiles);
}
