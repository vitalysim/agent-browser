/**
 * Chrome runtime API emulation for stealth mode.
 * Adds window.chrome object that is present in real Chrome browsers but missing in headless mode.
 */

/**
 * Generate script to create a realistic window.chrome object.
 * This is a major detection vector as headless Chrome doesn't have window.chrome.
 */
export function generateChromeRuntimeScript(): string {
  return `
(function() {
  // Don't override if chrome already exists and looks complete
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) {
    return;
  }

  // Create the chrome object structure that matches a real Chrome browser
  const chrome = {
    app: {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
      getDetails: function() { return null; },
      getIsInstalled: function() { return false; },
      installState: function(callback) {
        if (callback) callback('not_installed');
      },
      runningState: function() { return 'cannot_run'; },
    },
    runtime: {
      OnInstalledReason: {
        CHROME_UPDATE: 'chrome_update',
        INSTALL: 'install',
        SHARED_MODULE_UPDATE: 'shared_module_update',
        UPDATE: 'update',
      },
      OnRestartRequiredReason: {
        APP_UPDATE: 'app_update',
        OS_UPDATE: 'os_update',
        PERIODIC: 'periodic',
      },
      PlatformArch: {
        ARM: 'arm',
        ARM64: 'arm64',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64',
      },
      PlatformNaclArch: {
        ARM: 'arm',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64',
      },
      PlatformOs: {
        ANDROID: 'android',
        CROS: 'cros',
        FUCHSIA: 'fuchsia',
        LINUX: 'linux',
        MAC: 'mac',
        OPENBSD: 'openbsd',
        WIN: 'win',
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: 'no_update',
        THROTTLED: 'throttled',
        UPDATE_AVAILABLE: 'update_available',
      },
      // These methods are expected to exist but return undefined in non-extension context
      connect: function() { return undefined; },
      sendMessage: function() { return undefined; },
      getManifest: function() { return undefined; },
      getURL: function(path) { return undefined; },
      id: undefined,
    },
    csi: function() {
      return {
        onloadT: Date.now(),
        pageT: Date.now() - performance.timing.navigationStart,
        startE: performance.timing.navigationStart,
        tran: 15, // Navigation type
      };
    },
    loadTimes: function() {
      const timing = performance.timing;
      return {
        commitLoadTime: timing.responseStart / 1000,
        connectionInfo: 'http/1.1',
        finishDocumentLoadTime: timing.domContentLoadedEventEnd / 1000,
        finishLoadTime: timing.loadEventEnd / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: timing.responseStart / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'unknown',
        requestTime: timing.requestStart / 1000,
        startLoadTime: timing.navigationStart / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
      };
    },
  };

  // Register methods with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(chrome.app.getDetails);
    window.__stealthPatchedFunctions.add(chrome.app.getIsInstalled);
    window.__stealthPatchedFunctions.add(chrome.app.installState);
    window.__stealthPatchedFunctions.add(chrome.app.runningState);
    window.__stealthPatchedFunctions.add(chrome.runtime.connect);
    window.__stealthPatchedFunctions.add(chrome.runtime.sendMessage);
    window.__stealthPatchedFunctions.add(chrome.runtime.getManifest);
    window.__stealthPatchedFunctions.add(chrome.runtime.getURL);
    window.__stealthPatchedFunctions.add(chrome.csi);
    window.__stealthPatchedFunctions.add(chrome.loadTimes);
  }

  // Make chrome non-writable to prevent accidental overwriting
  Object.defineProperty(window, 'chrome', {
    value: chrome,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
`;
}

/**
 * Generate script to handle Notification.permission consistency.
 * Some sites check if Notification.permission matches what the Permissions API returns.
 */
export function generateNotificationScript(): string {
  return `
(function() {
  // Store the real permission state
  let notificationPermission = 'default';

  // Try to get the real permission
  try {
    notificationPermission = Notification.permission;
  } catch (e) {
    // Use default if not available
  }

  // Make sure Notification.permission returns a consistent value
  try {
    Object.defineProperty(Notification, 'permission', {
      get: function() { return notificationPermission; },
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
 * Get all Chrome runtime-related stealth scripts combined.
 */
export function generateAllChromeRuntimeScripts(): string {
  return [generateChromeRuntimeScript(), generateNotificationScript()].join('\n');
}
