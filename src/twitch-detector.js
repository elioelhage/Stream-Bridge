(() => {
  if (window.__streamBridgeDetectorInstalled) return;
  window.__streamBridgeDetectorInstalled = true;

  const HLS_PATTERN = /\.m3u8(?:[?#]|$)/i;
  const DOM_AD_SELECTORS = [
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="video-ad-label"]',
    '[data-a-target="ad-countdown"]',
    '[data-test-selector="ad-banner-default-text"]',
    '.tw-ad-label',
    '.video-ad-label',
    '[class*="ad-countdown"]',
    '[class*="AdCountdown"]'
  ];
  const AD_MARKER_PATTERNS = [
    /\bstiched-ad-[^\s"']+/i,
    /\bstitched-ad-[^\s"']+/i,
    /\btwitch-stitched-ad\b/i,
    /\bstitched\b/i,
    /"MIDROLL"/i,
    /"midroll"/i,
    /X-TV-TWITCH-AD-ROLL-TYPE/i
  ];

  const state = {
    active: false,
    lastAdAt: 0,
    lastAdDurationMs: 0,
    clearTimer: null,
    cleanPlaylists: 0,
    inspectedUrls: new Set()
  };

  function extractAdDuration(text) {
    const patterns = [
      /X-TV-TWITCH-AD-POD-FILLED-DURATION="?([0-9.]+)"?/i,
      /DURATION="?([0-9.]+)"?/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const duration = Number(match[1]);
      if (Number.isFinite(duration) && duration > 0 && duration < 3600) return duration * 1000;
    }
    return 0;
  }

  function looksLikeAdPlaylist(text) {
    return typeof text === 'string' && AD_MARKER_PATTERNS.some((pattern) => pattern.test(text));
  }

  function emit(active, sourceType, url, extra = {}) {
    if (state.active === active && !active) return;
    state.active = active;

    window.postMessage({
      source: 'streambridge',
      type: 'twitch-ad-state',
      active,
      sourceType,
      url: url || location.href,
      timestamp: Date.now(),
      ...extra
    }, '*');
  }

  function scheduleDurationFallback(url) {
    if (!state.lastAdDurationMs) return;
    clearTimeout(state.clearTimer);
    state.clearTimer = setTimeout(() => {
      if (Date.now() - state.lastAdAt >= state.lastAdDurationMs) {
        state.cleanPlaylists = 0;
        state.lastAdDurationMs = 0;
        emit(false, 'hls-duration-fallback', url);
      }
    }, state.lastAdDurationMs + 3000);
  }

  function markAd(url, sourceType, durationMs = 0) {
    state.lastAdAt = Date.now();
    state.cleanPlaylists = 0;
    if (durationMs > 0) state.lastAdDurationMs = durationMs;
    clearTimeout(state.clearTimer);
    emit(true, sourceType, url);
    scheduleDurationFallback(url);
  }

  function inspectPlaylist(url, text, sourceType = 'hls') {
    if (!HLS_PATTERN.test(url) || typeof text !== 'string') return;

    if (looksLikeAdPlaylist(text)) {
      markAd(url, sourceType, extractAdDuration(text));
      return;
    }

    if (!state.active) return;

    state.cleanPlaylists += 1;
    if (state.cleanPlaylists >= 2 && Date.now() - state.lastAdAt >= 1800) {
      clearTimeout(state.clearTimer);
      state.cleanPlaylists = 0;
      state.lastAdDurationMs = 0;
      emit(false, sourceType, url);
    }
  }

  function getUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href).href;
      if (input instanceof Request) return input.url;
      return String(input?.url || '');
    } catch {
      return '';
    }
  }

  function inspectResponse(url, response, sourceType) {
    if (!response || !HLS_PATTERN.test(url)) return;
    try {
      response.clone().text().then((text) => inspectPlaylist(url, text, sourceType)).catch(() => {});
    } catch {}
  }

  try {
    const nativeFetch = window.fetch;
    window.fetch = function streamBridgeFetch(input, init, ...rest) {
      const url = getUrl(input);
      const responsePromise = nativeFetch.call(this, input, init, ...rest);
      if (HLS_PATTERN.test(url)) {
        responsePromise.then((response) => inspectResponse(url, response, 'window-hls')).catch(() => {});
      }
      return responsePromise;
    };
  } catch {}

  try {
    const OriginalWorker = window.Worker;

    function buildWorkerBlobCode(originalWorkerUrl, isModuleWorker) {
      const workerCode = [
        '(() => {',
        '  const nativeFetch = self.fetch;',
        '  const hlsPattern = /\\.m3u8(?:[?#]|$)/i;',
        '  const adPatterns = [',
        '    /\\bstiched-ad-[^\\s"\']+/i,',
        '    /\\bstitched-ad-[^\\s"\']+/i,',
        '    /\\btwitch-stitched-ad\\b/i,',
        '    /\\bstitched\\b/i,',
        '    /"MIDROLL"/i,',
        '    /"midroll"/i,',
        '    /X-TV-TWITCH-AD-ROLL-TYPE/i',
        '  ];',
        '  function duration(text) {',
        '    const patterns = [',
        '      /X-TV-TWITCH-AD-POD-FILLED-DURATION="?([0-9.]+)"?/i,',
        '      /DURATION="?([0-9.]+)"?/i',
        '    ];',
        '    for (const pattern of patterns) {',
        '      const match = text.match(pattern);',
        '      if (!match) continue;',
        '      const value = Number(match[1]);',
        '      if (Number.isFinite(value) && value > 0 && value < 3600) return value;',
        '    }',
        '    return 0;',
        '  }',
        '  function inspect(url, text) {',
        '    if (typeof text !== "string" || !hlsPattern.test(url)) return;',
        '    const active = adPatterns.some((pattern) => pattern.test(text));',
        '    self.postMessage({ __streamBridge: true, type: "twitch-ad-state", active, sourceType: "worker-hls", url, durationSeconds: active ? duration(text) : 0, timestamp: Date.now() });',
        '  }',
        '  self.fetch = function streamBridgeWorkerFetch(input, init, ...rest) {',
        '    let url = "";',
        '    try { url = typeof input === "string" ? new URL(input, self.location.href).href : input?.url || ""; } catch {}',
        '    const responsePromise = nativeFetch.call(this, input, init, ...rest);',
        '    if (hlsPattern.test(url)) {',
        '      responsePromise.then((response) => {',
        '        try { response.clone().text().then((text) => inspect(url, text)).catch(() => {}); } catch {}',
        '      }).catch(() => {});',
        '    }',
        '    return responsePromise;',
        '  };',
        '})();',
        isModuleWorker
          ? 'import(' + JSON.stringify(originalWorkerUrl) + ');'
          : 'importScripts(' + JSON.stringify(originalWorkerUrl) + ');'
      ].join('\n');

      return URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
    }

    window.Worker = class StreamBridgeWorker extends OriginalWorker {
      constructor(workerUrl, options) {
        let isTwitchWorker = false;
        try {
          const parsed = new URL(workerUrl, location.href);
          isTwitchWorker = parsed.origin.endsWith('.twitch.tv') || parsed.origin === 'https://www.twitch.tv';
        } catch {}

        if (!isTwitchWorker) {
          super(workerUrl, options);
          return;
        }

        const isModuleWorker = options?.type === 'module';
        const wrappedUrl = buildWorkerBlobCode(new URL(workerUrl, location.href).href, isModuleWorker);
        super(wrappedUrl, options);

        this.addEventListener('message', (event) => {
          const data = event?.data;
          if (!data?.__streamBridge) return;

          window.postMessage({
            source: 'streambridge',
            type: data.type,
            active: Boolean(data.active),
            sourceType: data.sourceType || 'worker-hls',
            url: data.url || location.href,
            durationSeconds: data.durationSeconds || 0,
            timestamp: data.timestamp || Date.now()
          }, '*');
        });
      }
    };
  } catch {}

  async function inspectResourceEntries() {
    try {
      const entries = performance.getEntriesByType('resource');

      for (const entry of entries) {
        const url = entry?.name || '';
        if (!HLS_PATTERN.test(url) || state.inspectedUrls.has(url)) continue;

        state.inspectedUrls.add(url);

        try {
          const response = await fetch(url, { credentials: 'include' });
          if (response.ok) inspectPlaylist(url, await response.text(), 'performance-hls');
        } catch {}
      }

      if (state.inspectedUrls.size > 200) {
        state.inspectedUrls = new Set(Array.from(state.inspectedUrls).slice(-100));
      }
    } catch {}
  }

  setInterval(inspectResourceEntries, 1000);

  function hasAdDomSignal() {
    for (const selector of DOM_AD_SELECTORS) {
      try {
        if (document.querySelector(selector)) return true;
      } catch {}
    }

    const player = document.querySelector('[data-a-target="video-player"], [class*="video-player"]');
    if (player) {
      const text = player.textContent || '';
      if (/\bAd\s*\(\d{1,2}:\d{2}\)/i.test(text)) return true;
      if (/ad break/i.test(text)) return true;
    }

    return false;
  }

  function pollDomAdState() {
    try {
      if (hasAdDomSignal()) markAd(location.href, 'dom');
    } catch {}
  }

  try {
    const observer = new MutationObserver(pollDomAdState);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    });
    setInterval(pollDomAdState, 250);
  } catch {}
})();