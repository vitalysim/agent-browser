/**
 * Audio fingerprint protection for stealth mode.
 * Adds consistent noise to AudioContext operations used for fingerprinting.
 */

/**
 * Generate script to add noise to AudioContext fingerprinting.
 * Audio fingerprinting uses the subtle differences in audio processing
 * across different devices to create a unique identifier.
 */
export function generateAudioProtectionScript(): string {
  return `
(function() {
  // Get the seeded random function
  const random = window.__stealthRandom || Math.random;

  // Generate consistent noise based on seed
  const getAudioNoise = () => {
    return (random() - 0.5) * 0.0001; // Very small noise
  };

  // Patch AnalyserNode.getFloatFrequencyData
  const originalGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
  const noisedGetFloatFrequencyData = function(array) {
    originalGetFloatFrequencyData.call(this, array);
    // Add small noise to each value
    for (let i = 0; i < array.length; i++) {
      array[i] += getAudioNoise() * 100;
    }
  };

  // Patch AnalyserNode.getByteFrequencyData
  const originalGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
  const noisedGetByteFrequencyData = function(array) {
    originalGetByteFrequencyData.call(this, array);
    // Add small noise
    for (let i = 0; i < array.length; i++) {
      const noise = Math.floor(random() * 3) - 1;
      array[i] = Math.max(0, Math.min(255, array[i] + noise));
    }
  };

  // Patch AudioBuffer.getChannelData
  const originalGetChannelData = AudioBuffer.prototype.getChannelData;
  const noisedGetChannelData = function(channel) {
    const data = originalGetChannelData.call(this, channel);
    // Only add noise to small buffers (likely fingerprinting)
    if (data.length < 50000) {
      for (let i = 0; i < data.length; i++) {
        data[i] += getAudioNoise();
      }
    }
    return data;
  };

  // Patch OfflineAudioContext.startRendering
  const OriginalOfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  if (OriginalOfflineAudioContext) {
    const originalStartRendering = OriginalOfflineAudioContext.prototype.startRendering;

    const noisedStartRendering = function() {
      return originalStartRendering.call(this).then((buffer) => {
        // Add noise to all channels
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const data = buffer.getChannelData(ch);
          if (data.length < 50000) {
            for (let i = 0; i < data.length; i++) {
              data[i] += getAudioNoise();
            }
          }
        }
        return buffer;
      });
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(noisedStartRendering);
    }

    OriginalOfflineAudioContext.prototype.startRendering = noisedStartRendering;
  }

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(noisedGetFloatFrequencyData);
    window.__stealthPatchedFunctions.add(noisedGetByteFrequencyData);
    window.__stealthPatchedFunctions.add(noisedGetChannelData);
  }

  // Apply patches
  AnalyserNode.prototype.getFloatFrequencyData = noisedGetFloatFrequencyData;
  AnalyserNode.prototype.getByteFrequencyData = noisedGetByteFrequencyData;
  AudioBuffer.prototype.getChannelData = noisedGetChannelData;
})();
`;
}

/**
 * Get all audio-related stealth scripts.
 */
export function generateAllAudioScripts(): string {
  return generateAudioProtectionScript();
}
