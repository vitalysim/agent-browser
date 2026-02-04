/**
 * System Chrome binary detection for stealth mode.
 *
 * Playwright uses "Chrome for Testing" which has identifiable characteristics
 * that anti-bot systems can detect. Using the system-installed Chrome browser
 * reduces this detection vector.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Known paths for Chrome on different platforms.
 */
const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/google-chrome',
  ],
};

/**
 * Find the system Chrome executable path.
 *
 * @returns The path to Chrome if found, undefined otherwise.
 */
export function getStealthChromePath(): string | undefined {
  const platform = process.platform;
  const paths = CHROME_PATHS[platform];

  if (!paths) {
    return undefined;
  }

  // Check known paths
  for (const chromePath of paths) {
    if (chromePath && existsSync(chromePath)) {
      return chromePath;
    }
  }

  // On Linux, try 'which' command as fallback
  if (platform === 'linux') {
    try {
      const result = execSync('which google-chrome 2>/dev/null || which chromium 2>/dev/null', {
        encoding: 'utf8',
      }).trim();
      if (result && existsSync(result)) {
        return result;
      }
    } catch {
      // 'which' command failed, ignore
    }
  }

  // On macOS, try mdfind as fallback
  if (platform === 'darwin') {
    try {
      const result = execSync(
        'mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\'" 2>/dev/null | head -1',
        { encoding: 'utf8' }
      ).trim();
      if (result) {
        const chromePath = `${result}/Contents/MacOS/Google Chrome`;
        if (existsSync(chromePath)) {
          return chromePath;
        }
      }
    } catch {
      // mdfind command failed, ignore
    }
  }

  return undefined;
}

/**
 * Check if system Chrome is available.
 */
export function hasSystemChrome(): boolean {
  return getStealthChromePath() !== undefined;
}

/**
 * Get information about the detected Chrome binary.
 */
export function getChromeBinaryInfo(): {
  path: string | undefined;
  isSystemChrome: boolean;
  platform: string;
} {
  const chromePath = getStealthChromePath();

  return {
    path: chromePath,
    isSystemChrome: chromePath !== undefined,
    platform: process.platform,
  };
}

/**
 * Get Chrome version from the binary.
 * Useful for matching User-Agent strings.
 */
export function getChromeVersion(chromePath?: string): string | undefined {
  const path = chromePath || getStealthChromePath();
  if (!path) {
    return undefined;
  }

  try {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      // On macOS, use --version flag
      command = `"${path}" --version 2>/dev/null`;
    } else if (platform === 'win32') {
      // On Windows, use wmic or powershell
      command = `powershell -Command "(Get-Item '${path}').VersionInfo.FileVersion"`;
    } else {
      // On Linux, use --version flag
      command = `"${path}" --version 2>/dev/null`;
    }

    const result = execSync(command, { encoding: 'utf8' }).trim();

    // Extract version number from output like "Google Chrome 131.0.6778.69"
    const versionMatch = result.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    // Try simpler version pattern
    const simpleMatch = result.match(/(\d+\.\d+)/);
    if (simpleMatch) {
      return simpleMatch[1];
    }

    return undefined;
  } catch {
    return undefined;
  }
}
