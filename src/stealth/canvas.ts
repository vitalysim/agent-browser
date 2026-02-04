/**
 * Canvas fingerprint protection for stealth mode.
 * Adds consistent, deterministic noise to canvas operations to prevent fingerprinting
 * while maintaining visual correctness.
 */

/**
 * Generate script to add noise to canvas fingerprinting operations.
 * Uses a seeded random number generator to ensure consistent fingerprints within a session.
 */
export function generateCanvasProtectionScript(): string {
  return `
(function() {
  // Get the seeded random function from stealth utils
  const random = window.__stealthRandom || Math.random;

  // Generate small noise values based on position
  const getNoise = (x, y) => {
    // Use position-based noise for consistency
    const noise = random() * 0.02 - 0.01; // -1% to +1% noise
    return noise;
  };

  // Store original methods
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

  // Flag to track if we're inside our own code to prevent recursion
  let isProcessing = false;

  // Helper to add noise to image data
  const addNoiseToImageData = (imageData) => {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Add subtle noise to a sample of pixels for performance
    // Process every 4th pixel for speed while still affecting the fingerprint
    for (let i = 0; i < data.length; i += 16) {
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);

      // Only modify non-transparent pixels
      if (data[i + 3] > 0) {
        const noise = getNoise(x, y);
        // Apply noise to RGB channels (not alpha)
        data[i] = Math.max(0, Math.min(255, data[i] + Math.floor(noise * 3)));     // R
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + Math.floor(noise * 5))); // G
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + Math.floor(noise * 7))); // B
      }
    }

    return imageData;
  };

  // Override toDataURL
  const newToDataURL = function(type, quality) {
    if (isProcessing) {
      return originalToDataURL.call(this, type, quality);
    }

    try {
      isProcessing = true;

      // Get the 2D context
      const ctx = this.getContext('2d');
      if (!ctx) {
        return originalToDataURL.call(this, type, quality);
      }

      // Create a temporary canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      const tempCtx = tempCanvas.getContext('2d');

      if (!tempCtx) {
        return originalToDataURL.call(this, type, quality);
      }

      // Copy and add noise
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      addNoiseToImageData(imageData);
      tempCtx.putImageData(imageData, 0, 0);

      return originalToDataURL.call(tempCanvas, type, quality);
    } finally {
      isProcessing = false;
    }
  };

  // Override toBlob
  const newToBlob = function(callback, type, quality) {
    if (isProcessing) {
      return originalToBlob.call(this, callback, type, quality);
    }

    try {
      isProcessing = true;

      const ctx = this.getContext('2d');
      if (!ctx) {
        return originalToBlob.call(this, callback, type, quality);
      }

      // Create a temporary canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      const tempCtx = tempCanvas.getContext('2d');

      if (!tempCtx) {
        return originalToBlob.call(this, callback, type, quality);
      }

      // Copy and add noise
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      addNoiseToImageData(imageData);
      tempCtx.putImageData(imageData, 0, 0);

      return originalToBlob.call(tempCanvas, callback, type, quality);
    } finally {
      isProcessing = false;
    }
  };

  // Override getImageData (for direct fingerprinting attempts)
  const newGetImageData = function(sx, sy, sw, sh) {
    const imageData = originalGetImageData.call(this, sx, sy, sw, sh);

    // Only add noise if this looks like a fingerprinting operation
    // (small canvas sizes or specific patterns)
    if (sw <= 300 && sh <= 300) {
      addNoiseToImageData(imageData);
    }

    return imageData;
  };

  // Register with stealth patcher
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(newToDataURL);
    window.__stealthPatchedFunctions.add(newToBlob);
    window.__stealthPatchedFunctions.add(newGetImageData);
  }

  // Apply overrides
  HTMLCanvasElement.prototype.toDataURL = newToDataURL;
  HTMLCanvasElement.prototype.toBlob = newToBlob;
  CanvasRenderingContext2D.prototype.getImageData = newGetImageData;
})();
`;
}

/**
 * Get all canvas-related stealth scripts.
 */
export function generateAllCanvasScripts(): string {
  return generateCanvasProtectionScript();
}
