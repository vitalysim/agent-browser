/**
 * WebRTC leak prevention for stealth mode.
 *
 * WebRTC can leak real IP addresses even when using a proxy because it uses
 * STUN/TURN servers that bypass the proxy for peer-to-peer connections.
 *
 * This module provides options to:
 * 1. Completely disable WebRTC
 * 2. Mock WebRTC to appear like it's blocked by browser settings
 */

/**
 * Launch arguments to disable WebRTC at the browser level.
 */
export const WEBRTC_DISABLE_ARGS = [
  // Disable WebRTC completely
  '--disable-webrtc',
  // Disable WebRTC encryption (also helps with detection)
  '--disable-webrtc-encryption',
  // Disable WebRTC hardware video encoding
  '--disable-webrtc-hw-encoding',
  // Disable WebRTC hardware video decoding
  '--disable-webrtc-hw-decoding',
  // Enforce WebRTC IP handling policy to prevent leaks
  '--enforce-webrtc-ip-permission-check',
  // Force WebRTC to use only the default public interface
  '--force-webrtc-ip-handling-policy=default_public_interface_only',
];

/**
 * Generate script to disable or mock WebRTC APIs.
 * This prevents IP leaks when using proxies.
 */
export function generateWebRTCBlockScript(): string {
  return `
(function() {
  // Store originals for detection evasion
  const originalRTCPeerConnection = window.RTCPeerConnection;
  const originalWebkitRTCPeerConnection = window.webkitRTCPeerConnection;
  const originalMozRTCPeerConnection = window.mozRTCPeerConnection;

  // Option 1: Make RTCPeerConnection throw an error like when WebRTC is disabled
  // This is more realistic than returning undefined
  function BlockedRTCPeerConnection() {
    throw new DOMException(
      "Failed to construct 'RTCPeerConnection': WebRTC is disabled",
      'NotSupportedError'
    );
  }

  // Copy prototype to make it look more legitimate
  if (originalRTCPeerConnection) {
    BlockedRTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
  }

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(BlockedRTCPeerConnection);
  }

  // Replace RTCPeerConnection
  Object.defineProperty(window, 'RTCPeerConnection', {
    value: BlockedRTCPeerConnection,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  // Also handle webkit and moz prefixed versions
  if (originalWebkitRTCPeerConnection) {
    Object.defineProperty(window, 'webkitRTCPeerConnection', {
      value: BlockedRTCPeerConnection,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  if (originalMozRTCPeerConnection) {
    Object.defineProperty(window, 'mozRTCPeerConnection', {
      value: BlockedRTCPeerConnection,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  // Block RTCDataChannel
  if (typeof RTCDataChannel !== 'undefined') {
    function BlockedRTCDataChannel() {
      throw new DOMException(
        "Failed to construct 'RTCDataChannel': WebRTC is disabled",
        'NotSupportedError'
      );
    }

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(BlockedRTCDataChannel);
    }

    Object.defineProperty(window, 'RTCDataChannel', {
      value: BlockedRTCDataChannel,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  // Block RTCSessionDescription
  if (typeof RTCSessionDescription !== 'undefined') {
    function BlockedRTCSessionDescription() {
      throw new DOMException(
        "Failed to construct 'RTCSessionDescription': WebRTC is disabled",
        'NotSupportedError'
      );
    }

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(BlockedRTCSessionDescription);
    }

    Object.defineProperty(window, 'RTCSessionDescription', {
      value: BlockedRTCSessionDescription,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  // Patch navigator.mediaDevices to reject getUserMedia for video/audio
  // This is more realistic than completely removing it
  if (navigator.mediaDevices) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;

    const blockedGetUserMedia = function(constraints) {
      // Allow basic screen capture but block camera/microphone
      if (constraints && (constraints.video || constraints.audio)) {
        return Promise.reject(new DOMException(
          'Permission denied',
          'NotAllowedError'
        ));
      }
      // Fall through for other cases
      return originalGetUserMedia.call(navigator.mediaDevices, constraints);
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(blockedGetUserMedia);
    }

    navigator.mediaDevices.getUserMedia = blockedGetUserMedia;

    // Also patch enumerateDevices to return empty array
    const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;

    const blockedEnumerateDevices = function() {
      return Promise.resolve([]);
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(blockedEnumerateDevices);
    }

    navigator.mediaDevices.enumerateDevices = blockedEnumerateDevices;
  }

  // Patch deprecated navigator.getUserMedia
  if (navigator.getUserMedia) {
    const blockedLegacyGetUserMedia = function(constraints, successCallback, errorCallback) {
      if (errorCallback) {
        errorCallback(new DOMException('Permission denied', 'NotAllowedError'));
      }
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(blockedLegacyGetUserMedia);
    }

    navigator.getUserMedia = blockedLegacyGetUserMedia;
  }

  // Also handle webkit and moz prefixed versions
  if (navigator.webkitGetUserMedia) {
    navigator.webkitGetUserMedia = function(constraints, successCallback, errorCallback) {
      if (errorCallback) {
        errorCallback(new DOMException('Permission denied', 'NotAllowedError'));
      }
    };
  }

  if (navigator.mozGetUserMedia) {
    navigator.mozGetUserMedia = function(constraints, successCallback, errorCallback) {
      if (errorCallback) {
        errorCallback(new DOMException('Permission denied', 'NotAllowedError'));
      }
    };
  }
})();
`;
}

/**
 * Generate a softer WebRTC script that allows WebRTC but prevents IP leaks.
 * This uses the browser's built-in IP handling policy.
 */
export function generateWebRTCPrivacyScript(): string {
  return `
(function() {
  // Override RTCPeerConnection to prevent IP leaks without fully blocking
  const OriginalRTCPeerConnection = window.RTCPeerConnection;

  if (!OriginalRTCPeerConnection) return;

  function PrivateRTCPeerConnection(configuration) {
    // Force restrictive ICE transport policy
    const config = configuration || {};

    // Only allow relay (TURN) servers - no direct connections that leak IP
    config.iceTransportPolicy = 'relay';

    // Remove any STUN servers that could leak IP
    if (config.iceServers) {
      config.iceServers = config.iceServers.filter(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        // Keep only TURN servers, remove STUN
        return urls.every(url => url && url.startsWith('turn:'));
      });
    }

    return new OriginalRTCPeerConnection(config);
  }

  // Copy prototype and static properties
  PrivateRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
  Object.setPrototypeOf(PrivateRTCPeerConnection, OriginalRTCPeerConnection);

  for (const key of Object.getOwnPropertyNames(OriginalRTCPeerConnection)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name') {
      try {
        PrivateRTCPeerConnection[key] = OriginalRTCPeerConnection[key];
      } catch (e) {
        // Some properties may not be writable
      }
    }
  }

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(PrivateRTCPeerConnection);
  }

  window.RTCPeerConnection = PrivateRTCPeerConnection;
})();
`;
}

/**
 * Get all WebRTC-related stealth scripts combined.
 * @param block - If true, completely blocks WebRTC. If false, just prevents IP leaks.
 */
export function generateAllWebRTCScripts(block: boolean = true): string {
  if (block) {
    return generateWebRTCBlockScript();
  }
  return generateWebRTCPrivacyScript();
}
