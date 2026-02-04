/**
 * Permissions API fixes for stealth mode.
 * Ensures consistency between different permission-related APIs.
 */

/**
 * Generate script to fix Permissions API inconsistencies.
 * Some detection methods check if Permissions API results match Notification.permission.
 */
export function generatePermissionsScript(): string {
  return `
(function() {
  // Store original query method
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);

  // Create patched query method
  const patchedQuery = async function(permissionDesc) {
    const result = await originalQuery(permissionDesc);

    // Ensure notification permission is consistent
    if (permissionDesc.name === 'notifications') {
      try {
        const notificationPermission = Notification.permission;

        // Create a proxy to intercept the state property
        return new Proxy(result, {
          get: function(target, prop) {
            if (prop === 'state') {
              // Map Notification.permission to PermissionState
              if (notificationPermission === 'granted') return 'granted';
              if (notificationPermission === 'denied') return 'denied';
              return 'prompt';
            }
            return target[prop];
          }
        });
      } catch (e) {
        // Return original result if we can't access Notification
        return result;
      }
    }

    return result;
  };

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(patchedQuery);
  }

  // Apply the patch
  navigator.permissions.query = patchedQuery;
})();
`;
}

/**
 * Generate script to ensure consistent battery API behavior.
 */
export function generateBatteryScript(): string {
  return `
(function() {
  // Battery API can be used for fingerprinting
  // In headless mode, getBattery might behave differently

  if (navigator.getBattery) {
    const originalGetBattery = navigator.getBattery.bind(navigator);

    const patchedGetBattery = function() {
      return originalGetBattery().then(function(battery) {
        // Ensure battery looks like a plugged-in desktop
        // This is the most common case for headless scenarios
        try {
          // We can't modify the battery object directly, but we can
          // return a proxy that reports desktop-like values
          return new Proxy(battery, {
            get: function(target, prop) {
              // Desktop computers typically show as charging with full battery
              if (prop === 'charging') return true;
              if (prop === 'level') return 1.0;
              if (prop === 'chargingTime') return 0;
              if (prop === 'dischargingTime') return Infinity;
              return target[prop];
            }
          });
        } catch (e) {
          return battery;
        }
      });
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(patchedGetBattery);
    }

    navigator.getBattery = patchedGetBattery;
  }
})();
`;
}

/**
 * Generate script to handle MediaDevices API.
 */
export function generateMediaDevicesScript(): string {
  return `
(function() {
  // MediaDevices.enumerateDevices can reveal virtual devices in headless mode
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices
    );

    const patchedEnumerateDevices = async function() {
      const devices = await originalEnumerateDevices();

      // Filter out obviously virtual devices and ensure at least one of each type exists
      // This prevents both "no devices" (headless) and "too many devices" (virtual) detection
      const hasAudioInput = devices.some(d => d.kind === 'audioinput');
      const hasAudioOutput = devices.some(d => d.kind === 'audiooutput');
      const hasVideoInput = devices.some(d => d.kind === 'videoinput');

      // If missing expected devices, add plausible placeholder entries
      const result = [...devices];

      if (!hasAudioInput) {
        result.push({
          deviceId: 'default',
          groupId: 'default',
          kind: 'audioinput',
          label: '', // Empty label when permission not granted
        });
      }

      if (!hasAudioOutput) {
        result.push({
          deviceId: 'default',
          groupId: 'default',
          kind: 'audiooutput',
          label: '',
        });
      }

      if (!hasVideoInput) {
        result.push({
          deviceId: 'default',
          groupId: 'default',
          kind: 'videoinput',
          label: '',
        });
      }

      return result;
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(patchedEnumerateDevices);
    }

    navigator.mediaDevices.enumerateDevices = patchedEnumerateDevices;
  }
})();
`;
}

/**
 * Get all permissions-related stealth scripts.
 */
export function generateAllPermissionsScripts(): string {
  return [
    generatePermissionsScript(),
    generateBatteryScript(),
    generateMediaDevicesScript(),
  ].join('\n');
}
