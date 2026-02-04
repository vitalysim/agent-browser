/**
 * Navigator property patches for stealth mode.
 * Provides realistic navigator properties that match real browser fingerprints.
 */

import type { StealthProfile } from './profiles.js';

/**
 * Generate script to patch navigator.plugins with realistic values.
 * Headless browsers typically have no plugins, which is a detection vector.
 */
export function generatePluginsScript(): string {
  return `
(function() {
  // Create realistic plugin objects that match a real Chrome browser
  const pluginData = [
    {
      name: 'Chrome PDF Plugin',
      description: 'Portable Document Format',
      filename: 'internal-pdf-viewer',
      mimeTypes: [
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }
      ]
    },
    {
      name: 'Chrome PDF Viewer',
      description: '',
      filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
      mimeTypes: [
        { type: 'application/pdf', suffixes: 'pdf', description: '' }
      ]
    },
    {
      name: 'Native Client',
      description: '',
      filename: 'internal-nacl-plugin',
      mimeTypes: [
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
        { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }
      ]
    }
  ];

  // Create MimeType objects
  const createMimeType = (data, plugin) => {
    const mimeType = Object.create(MimeType.prototype);
    Object.defineProperties(mimeType, {
      type: { value: data.type, enumerable: true },
      suffixes: { value: data.suffixes, enumerable: true },
      description: { value: data.description, enumerable: true },
      enabledPlugin: { value: plugin, enumerable: true },
    });
    return mimeType;
  };

  // Create Plugin objects
  const plugins = [];
  const mimeTypes = [];

  for (const data of pluginData) {
    const plugin = Object.create(Plugin.prototype);

    // Create mime types for this plugin
    const pluginMimeTypes = [];
    for (const mimeData of data.mimeTypes) {
      const mimeType = createMimeType(mimeData, plugin);
      pluginMimeTypes.push(mimeType);
      mimeTypes.push(mimeType);
    }

    // Set up plugin properties
    Object.defineProperties(plugin, {
      name: { value: data.name, enumerable: true },
      description: { value: data.description, enumerable: true },
      filename: { value: data.filename, enumerable: true },
      length: { value: pluginMimeTypes.length, enumerable: true },
    });

    // Add mime types as indexed properties
    for (let i = 0; i < pluginMimeTypes.length; i++) {
      Object.defineProperty(plugin, i, {
        value: pluginMimeTypes[i],
        enumerable: true,
      });
      Object.defineProperty(plugin, pluginMimeTypes[i].type, {
        value: pluginMimeTypes[i],
        enumerable: false,
      });
    }

    // Add item and namedItem methods
    plugin.item = function(index) { return pluginMimeTypes[index] || null; };
    plugin.namedItem = function(name) {
      return pluginMimeTypes.find(m => m.type === name) || null;
    };
    plugin[Symbol.iterator] = function*() {
      for (const mt of pluginMimeTypes) yield mt;
    };

    if (window.__stealthPatchedFunctions) {
      window.__stealthPatchedFunctions.add(plugin.item);
      window.__stealthPatchedFunctions.add(plugin.namedItem);
    }

    plugins.push(plugin);
  }

  // Create PluginArray
  const pluginArray = Object.create(PluginArray.prototype);
  Object.defineProperty(pluginArray, 'length', {
    value: plugins.length,
    enumerable: true,
  });

  for (let i = 0; i < plugins.length; i++) {
    Object.defineProperty(pluginArray, i, {
      value: plugins[i],
      enumerable: true,
    });
    Object.defineProperty(pluginArray, plugins[i].name, {
      value: plugins[i],
      enumerable: false,
    });
  }

  pluginArray.item = function(index) { return plugins[index] || null; };
  pluginArray.namedItem = function(name) {
    return plugins.find(p => p.name === name) || null;
  };
  pluginArray.refresh = function() {};
  pluginArray[Symbol.iterator] = function*() {
    for (const p of plugins) yield p;
  };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(pluginArray.item);
    window.__stealthPatchedFunctions.add(pluginArray.namedItem);
    window.__stealthPatchedFunctions.add(pluginArray.refresh);
  }

  // Create MimeTypeArray
  const mimeTypeArray = Object.create(MimeTypeArray.prototype);
  Object.defineProperty(mimeTypeArray, 'length', {
    value: mimeTypes.length,
    enumerable: true,
  });

  for (let i = 0; i < mimeTypes.length; i++) {
    Object.defineProperty(mimeTypeArray, i, {
      value: mimeTypes[i],
      enumerable: true,
    });
    Object.defineProperty(mimeTypeArray, mimeTypes[i].type, {
      value: mimeTypes[i],
      enumerable: false,
    });
  }

  mimeTypeArray.item = function(index) { return mimeTypes[index] || null; };
  mimeTypeArray.namedItem = function(name) {
    return mimeTypes.find(m => m.type === name) || null;
  };
  mimeTypeArray[Symbol.iterator] = function*() {
    for (const m of mimeTypes) yield m;
  };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(mimeTypeArray.item);
    window.__stealthPatchedFunctions.add(mimeTypeArray.namedItem);
  }

  // Override navigator.plugins and navigator.mimeTypes
  const pluginsGetter = function() { return pluginArray; };
  const mimeTypesGetter = function() { return mimeTypeArray; };

  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(pluginsGetter);
    window.__stealthPatchedFunctions.add(mimeTypesGetter);
  }

  Object.defineProperty(navigator, 'plugins', {
    get: pluginsGetter,
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(navigator, 'mimeTypes', {
    get: mimeTypesGetter,
    configurable: true,
    enumerable: true,
  });
})();
`;
}

/**
 * Generate script to patch navigator properties with profile values.
 */
export function generateNavigatorPropsScript(profile: StealthProfile): string {
  return `
(function() {
  const profileData = ${JSON.stringify({
    platform: profile.platform,
    vendor: profile.vendor,
    vendorSub: profile.vendorSub,
    languages: profile.languages,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    maxTouchPoints: profile.maxTouchPoints,
  })};

  // Override platform
  const platformGetter = function() { return profileData.platform; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(platformGetter);
  }
  Object.defineProperty(navigator, 'platform', {
    get: platformGetter,
    configurable: true,
    enumerable: true,
  });

  // Override vendor
  const vendorGetter = function() { return profileData.vendor; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(vendorGetter);
  }
  Object.defineProperty(navigator, 'vendor', {
    get: vendorGetter,
    configurable: true,
    enumerable: true,
  });

  // Override vendorSub
  const vendorSubGetter = function() { return profileData.vendorSub; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(vendorSubGetter);
  }
  Object.defineProperty(navigator, 'vendorSub', {
    get: vendorSubGetter,
    configurable: true,
    enumerable: true,
  });

  // Override languages
  const languagesGetter = function() { return Object.freeze([...profileData.languages]); };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(languagesGetter);
  }
  Object.defineProperty(navigator, 'languages', {
    get: languagesGetter,
    configurable: true,
    enumerable: true,
  });

  // Override language (first language)
  const languageGetter = function() { return profileData.languages[0]; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(languageGetter);
  }
  Object.defineProperty(navigator, 'language', {
    get: languageGetter,
    configurable: true,
    enumerable: true,
  });

  // Override hardwareConcurrency
  const hardwareConcurrencyGetter = function() { return profileData.hardwareConcurrency; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(hardwareConcurrencyGetter);
  }
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: hardwareConcurrencyGetter,
    configurable: true,
    enumerable: true,
  });

  // Override deviceMemory
  const deviceMemoryGetter = function() { return profileData.deviceMemory; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(deviceMemoryGetter);
  }
  Object.defineProperty(navigator, 'deviceMemory', {
    get: deviceMemoryGetter,
    configurable: true,
    enumerable: true,
  });

  // Override maxTouchPoints
  const maxTouchPointsGetter = function() { return profileData.maxTouchPoints; };
  if (window.__stealthPatchedFunctions) {
    window.__stealthPatchedFunctions.add(maxTouchPointsGetter);
  }
  Object.defineProperty(navigator, 'maxTouchPoints', {
    get: maxTouchPointsGetter,
    configurable: true,
    enumerable: true,
  });
})();
`;
}

/**
 * Generate script to make navigator.connection look realistic.
 */
export function generateConnectionScript(): string {
  return `
(function() {
  // Create a realistic NetworkInformation object
  if ('connection' in navigator) {
    const connection = navigator.connection;

    // Set realistic values for a desktop connection
    try {
      Object.defineProperty(connection, 'effectiveType', {
        get: function() { return '4g'; },
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(connection, 'rtt', {
        get: function() { return 50; },
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(connection, 'downlink', {
        get: function() { return 10; },
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(connection, 'saveData', {
        get: function() { return false; },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      // Ignore errors - NetworkInformation may not be modifiable
    }
  }
})();
`;
}

/**
 * Get all navigator-related stealth scripts combined.
 */
export function generateAllNavigatorScripts(profile: StealthProfile): string {
  return [
    generatePluginsScript(),
    generateNavigatorPropsScript(profile),
    generateConnectionScript(),
  ].join('\n');
}
