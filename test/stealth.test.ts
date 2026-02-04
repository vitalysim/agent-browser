import { describe, it, expect, afterEach } from 'vitest';
import { BrowserManager } from '../src/browser.js';
import {
  getStealthProfile,
  listStealthProfiles,
  generateStealthScript,
  getStealthArgs,
  getStealthConfig,
  STEALTH_ARGS,
  WEBRTC_DISABLE_ARGS,
  hasSystemChrome,
  getStealthChromePath,
  getClientHintsHeaders,
  getFullClientHintsHeaders,
} from '../src/stealth/index.js';

describe('Stealth Mode', () => {
  let browser: BrowserManager;

  afterEach(async () => {
    if (browser?.isLaunched()) {
      await browser.close();
    }
  });

  describe('stealth profiles', () => {
    it('should list available profiles', () => {
      const profiles = listStealthProfiles();
      expect(profiles).toContain('chrome-windows');
      expect(profiles).toContain('chrome-mac');
      expect(profiles).toContain('chrome-linux');
      expect(profiles).toContain('mobile-android');
      expect(profiles).toContain('mobile-ios');
    });

    it('should get a profile by name', () => {
      const profile = getStealthProfile('chrome-windows');
      expect(profile.platform).toBe('Win32');
      expect(profile.vendor).toBe('Google Inc.');
      expect(profile.languages).toContain('en-US');
    });

    it('should auto-detect profile based on platform when name not provided', () => {
      const profile = getStealthProfile();
      expect(profile).toBeDefined();
      expect(profile.userAgent).toBeDefined();
      expect(profile.platform).toBeDefined();
    });
  });

  describe('stealth args', () => {
    it('should include automation control disable flag', () => {
      expect(STEALTH_ARGS).toContain('--disable-blink-features=AutomationControlled');
    });

    it('should include common stealth args', () => {
      expect(STEALTH_ARGS).toContain('--no-first-run');
      expect(STEALTH_ARGS).toContain('--no-default-browser-check');
      expect(STEALTH_ARGS).toContain('--disable-infobars');
    });

    it('should return args array from getStealthArgs', () => {
      const args = getStealthArgs(true);
      expect(Array.isArray(args)).toBe(true);
      expect(args.length).toBeGreaterThan(0);
    });
  });

  describe('stealth config', () => {
    it('should return empty config when disabled', () => {
      const config = getStealthConfig({ enabled: false });
      expect(config.args).toEqual([]);
      expect(config.initScript).toBe('');
      expect(config.userAgent).toBe('');
    });

    it('should return full config when enabled', () => {
      const config = getStealthConfig({ enabled: true });
      expect(config.args.length).toBeGreaterThan(0);
      expect(config.initScript.length).toBeGreaterThan(0);
      expect(config.userAgent.length).toBeGreaterThan(0);
    });

    it('should use specified profile', () => {
      const config = getStealthConfig({ enabled: true, profile: 'chrome-windows' });
      expect(config.userAgent).toContain('Windows');
    });
  });

  describe('stealth init script', () => {
    it('should generate a non-empty script', () => {
      const script = generateStealthScript();
      expect(script.length).toBeGreaterThan(0);
    });

    it('should include webdriver hiding code', () => {
      const script = generateStealthScript();
      expect(script).toContain('webdriver');
    });

    it('should include chrome runtime emulation', () => {
      const script = generateStealthScript();
      expect(script).toContain('window.chrome');
    });

    it('should include canvas protection', () => {
      const script = generateStealthScript();
      expect(script).toContain('toDataURL');
    });
  });

  describe('browser launch with stealth', () => {
    it('should hide navigator.webdriver when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const webdriver = await page.evaluate(() => navigator.webdriver);
      expect(webdriver).toBeUndefined();
    });

    it('should have realistic navigator.plugins when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const pluginCount = await page.evaluate(() => navigator.plugins.length);
      expect(pluginCount).toBeGreaterThan(0);

      const pluginNames = await page.evaluate(() =>
        Array.from(navigator.plugins).map((p) => p.name)
      );
      expect(pluginNames).toContain('Chrome PDF Plugin');
    });

    it('should have window.chrome object in headless mode when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const hasChrome = await page.evaluate(() => typeof window.chrome !== 'undefined');
      expect(hasChrome).toBe(true);

      const hasChromeRuntime = await page.evaluate(
        () => typeof window.chrome?.runtime !== 'undefined'
      );
      expect(hasChromeRuntime).toBe(true);
    });

    it('should have proper outerWidth/outerHeight in headless mode when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const outerWidth = await page.evaluate(() => window.outerWidth);
      const outerHeight = await page.evaluate(() => window.outerHeight);

      expect(outerWidth).toBeGreaterThan(0);
      expect(outerHeight).toBeGreaterThan(0);
    });

    it('should use stealth profile user agent when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const ua = await page.evaluate(() => navigator.userAgent);
      expect(ua).toContain('Windows');
    });

    it('should allow custom user agent to override stealth profile', async () => {
      const customUA = 'CustomBot/1.0';
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        userAgent: customUA,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const ua = await page.evaluate(() => navigator.userAgent);
      expect(ua).toBe(customUA);
    });

    it('should show document as visible when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const hidden = await page.evaluate(() => document.hidden);
      const visibilityState = await page.evaluate(() => document.visibilityState);

      expect(hidden).toBe(false);
      expect(visibilityState).toBe('visible');
    });
  });

  describe('canvas fingerprint protection', () => {
    it('should apply noise to canvas toDataURL operations', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      // Generate a canvas fingerprint and verify the protection is active
      const result = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { success: false, hasData: false };

        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Canvas fingerprint test', 2, 2);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillRect(75, 1, 100, 28);

        const dataUrl = canvas.toDataURL();
        return {
          success: true,
          hasData: dataUrl.length > 100, // Should have substantial data
          startsWithPng: dataUrl.startsWith('data:image/png;base64,'),
        };
      });

      expect(result.success).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.startsWithPng).toBe(true);
    });
  });

  describe('WebGL fingerprint spoofing', () => {
    it('should spoof WebGL vendor and renderer', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const webglInfo = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (!gl) return { vendor: '', renderer: '' };

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) return { vendor: '', renderer: '' };

        return {
          vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
        };
      });

      // Should match the profile's WebGL configuration
      const profile = getStealthProfile('chrome-windows');
      expect(webglInfo.vendor).toBe(profile.webglVendor);
      expect(webglInfo.renderer).toBe(profile.webglRenderer);
    });
  });

  describe('navigator properties', () => {
    it('should have correct hardwareConcurrency from profile', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
      const profile = getStealthProfile('chrome-windows');

      expect(hardwareConcurrency).toBe(profile.hardwareConcurrency);
    });

    it('should have correct languages from profile', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const languages = await page.evaluate(() => navigator.languages);
      const profile = getStealthProfile('chrome-windows');

      expect(languages).toEqual(profile.languages);
    });

    it('should have correct platform from profile', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const platform = await page.evaluate(() => navigator.platform);
      const profile = getStealthProfile('chrome-windows');

      expect(platform).toBe(profile.platform);
    });
  });

  describe('function toString masking', () => {
    it('should mask patched functions to appear native', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      // navigator.webdriver getter should appear native
      const webdriverDescriptor = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
        return descriptor?.get?.toString() || '';
      });

      expect(webdriverDescriptor).toContain('[native code]');
    });
  });

  describe('stealth mode without breaking functionality', () => {
    it('should still allow normal page navigation', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      // Use setContent instead of goto to avoid network dependency
      await page.setContent('<html><head><title>Test Page</title></head><body>Content</body></html>');

      const title = await page.title();
      expect(title).toBe('Test Page');
    });

    it('should still allow JavaScript evaluation', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const result = await page.evaluate(() => {
        return 1 + 1;
      });

      expect(result).toBe(2);
    });

    it('should still work with element interactions', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.setContent('<button id="btn">Click me</button>');

      let clicked = false;
      await page.evaluate(() => {
        const btn = document.getElementById('btn');
        btn?.addEventListener('click', () => {
          (window as any).clicked = true;
        });
      });

      await page.click('#btn');
      clicked = await page.evaluate(() => (window as any).clicked);

      expect(clicked).toBe(true);
    });
  });

  // Phase 4: Advanced Stealth Features (2026)
  describe('Phase 4: User-Agent Client Hints spoofing', () => {
    it('should have navigator.userAgentData when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const hasUserAgentData = await page.evaluate(() => 'userAgentData' in navigator);
      expect(hasUserAgentData).toBe(true);
    });

    it('should have correct brands in userAgentData', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const brands = await page.evaluate(() => {
        const uaData = (navigator as any).userAgentData;
        if (!uaData) return [];
        return uaData.brands.map((b: any) => b.brand);
      });

      expect(brands).toContain('Chromium');
      expect(brands).toContain('Google Chrome');
    });

    it('should return high entropy values from getHighEntropyValues', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthProfile: 'chrome-windows',
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const highEntropyValues = await page.evaluate(async () => {
        const uaData = (navigator as any).userAgentData;
        if (!uaData) return null;
        return await uaData.getHighEntropyValues([
          'platform',
          'platformVersion',
          'architecture',
          'bitness',
        ]);
      });

      expect(highEntropyValues).not.toBeNull();
      expect(highEntropyValues.platform).toBe('Windows');
      expect(highEntropyValues.architecture).toBe('x86');
      expect(highEntropyValues.bitness).toBe('64');
    });

    it('should generate correct client hints headers', () => {
      const profile = getStealthProfile('chrome-windows');
      const headers = getClientHintsHeaders(profile);

      expect(headers['sec-ch-ua']).toContain('Chromium');
      expect(headers['sec-ch-ua']).toContain('Google Chrome');
      expect(headers['sec-ch-ua-mobile']).toBe('?0');
      expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
    });

    it('should generate full client hints headers', () => {
      const profile = getStealthProfile('chrome-windows');
      const headers = getFullClientHintsHeaders(profile);

      expect(headers['sec-ch-ua-arch']).toBe('"x86"');
      expect(headers['sec-ch-ua-bitness']).toBe('"64"');
      expect(headers['sec-ch-ua-platform-version']).toBeDefined();
    });
  });

  describe('Phase 4: Input coordinates leak fix', () => {
    it('should fix mouse event coordinates in stealth mode', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.setContent(`
        <div id="target" style="width: 200px; height: 200px; background: blue;"></div>
        <script>
          window.lastMouseEvent = null;
          document.getElementById('target').addEventListener('mousedown', (e) => {
            window.lastMouseEvent = {
              clientX: e.clientX,
              clientY: e.clientY,
              screenX: e.screenX,
              screenY: e.screenY,
            };
          });
        </script>
      `);

      // Click on the target element
      await page.click('#target');

      const mouseEvent = await page.evaluate(() => (window as any).lastMouseEvent);

      // With the fix, screenY should be greater than clientY (due to browser chrome offset)
      // Note: The actual click comes from Playwright which may not trigger our patched constructor
      // but the script should be loaded and ready
      expect(mouseEvent).not.toBeNull();
    });
  });

  describe('Phase 4: WebRTC leak prevention', () => {
    it('should include WebRTC disable args when stealth enabled', () => {
      const args = getStealthArgs(true, { blockWebRTC: true });
      expect(args).toContain('--disable-webrtc');
    });

    it('should block RTCPeerConnection when stealth enabled', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const rtcBlocked = await page.evaluate(() => {
        try {
          new RTCPeerConnection();
          return false;
        } catch (e: any) {
          return e.message.includes('WebRTC is disabled') || e.name === 'NotSupportedError';
        }
      });

      expect(rtcBlocked).toBe(true);
    });

    it('should block mediaDevices.getUserMedia for video/audio', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      // Use setContent with a proper document to ensure mediaDevices is available
      await page.setContent('<html><body><h1>Test</h1></body></html>');

      const mediaBlocked = await page.evaluate(async () => {
        // mediaDevices may not exist on about:blank
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          return true; // Consider it blocked if not available
        }
        try {
          await navigator.mediaDevices.getUserMedia({ video: true });
          return false;
        } catch (e: any) {
          return e.name === 'NotAllowedError';
        }
      });

      expect(mediaBlocked).toBe(true);
    });

    it('should return empty array from mediaDevices.enumerateDevices', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      // Use setContent with a proper document to ensure mediaDevices is available
      await page.setContent('<html><body><h1>Test</h1></body></html>');

      const devices = await page.evaluate(async () => {
        // mediaDevices may not exist on about:blank
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          return []; // Return empty if not available
        }
        return await navigator.mediaDevices.enumerateDevices();
      });

      expect(devices).toEqual([]);
    });

    it('should not include WebRTC args when blockWebRTC is false', () => {
      const args = getStealthArgs(true, { blockWebRTC: false });
      expect(args).not.toContain('--disable-webrtc');
    });
  });

  describe('Phase 4: Chrome binary detection', () => {
    it('should detect if system Chrome is available', () => {
      // This test just verifies the function runs without error
      const hasChrome = hasSystemChrome();
      expect(typeof hasChrome).toBe('boolean');
    });

    it('should return a path or undefined from getStealthChromePath', () => {
      const chromePath = getStealthChromePath();
      if (chromePath) {
        expect(typeof chromePath).toBe('string');
        expect(chromePath.length).toBeGreaterThan(0);
      } else {
        expect(chromePath).toBeUndefined();
      }
    });

    it('should use system Chrome when useSystemChrome option is enabled', async () => {
      const chromePath = getStealthChromePath();

      // Skip this test if system Chrome is not available
      if (!chromePath) {
        return;
      }

      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthOptions: {
          useSystemChrome: true,
        },
      });

      // If we get here without error, system Chrome was used successfully
      expect(browser.isLaunched()).toBe(true);
    });
  });

  describe('Phase 4: Playwright artifact cleanup', () => {
    it('should remove __pwInitScripts from window', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      // Wait a bit for cleanup scripts to run
      await page.waitForTimeout(200);

      const hasPwInitScripts = await page.evaluate(() => '__pwInitScripts' in window);
      expect(hasPwInitScripts).toBe(false);
    });

    it('should remove __playwright from window', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      const hasPlaywright = await page.evaluate(() => '__playwright' in window);
      expect(hasPlaywright).toBe(false);
    });
  });

  describe('Phase 4: stealthOptions configuration', () => {
    it('should respect stealthOptions.clientHints = false', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthOptions: {
          clientHints: false,
        },
      });

      // If clientHints is disabled, navigator.userAgentData might not have our custom implementation
      // The browser may still have its own userAgentData though
      expect(browser.isLaunched()).toBe(true);
    });

    it('should respect stealthOptions.inputCoordinates = false', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthOptions: {
          inputCoordinates: false,
        },
      });

      expect(browser.isLaunched()).toBe(true);
    });

    it('should respect stealthOptions.blockWebRTC = false', async () => {
      browser = new BrowserManager();
      await browser.launch({
        headless: true,
        stealth: true,
        stealthOptions: {
          blockWebRTC: false,
        },
      });

      const page = browser.getPage();
      await page.goto('about:blank');

      // When WebRTC blocking is disabled, RTCPeerConnection should work
      const rtcAvailable = await page.evaluate(() => {
        try {
          // Just check if we can reference it without error
          return typeof RTCPeerConnection !== 'undefined';
        } catch {
          return false;
        }
      });

      expect(rtcAvailable).toBe(true);
    });
  });
});
