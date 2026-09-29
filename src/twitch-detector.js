(() => {
  if (window.__streamBridgeDetectorInstalled) return;
  window.__streamBridgeDetectorInstalled = true;

  const HLS_PATTERN = /\.m3u8(?:[?#]|$)/i;
  const AD_MARKERS = [
    /\bstitched\b/i,
    /"MIDROLL"/i,
    /"midroll"/i
  ];

  const state = {
    active: false,
    lastAdPlaylistAt: 0,
    clearTimer: null
  };

  function emit(active, source, url) {
    if (state.active === active && source === 'hls') return;
    state.active = active;

    window.postMessage({
      source: 'streambridge',
      type: 'twitch-ad-state',
      active,
      sourceType: source,
      url: url || location.href,
      timestamp: Date.now()
    }, '*');
  }

  function scheduleAdEnd(url) {
    clearTimeout(state.clearTimer);
    state.clearTimer = setTimeout(() => {
      if (Date.now() - state.lastAdPlaylistAt >= 1200) {
        emit(false, 'hls', url);
      }
    }, 1300);
  }

  function inspectPlaylist(url, text) {
    if (typeof text !== 'string' || !HLS_PATTERN.test(url)) return;

    const isAd = AD_MARKERS.some((marker) => marker.test(text));

    if (isAd) {
      state.lastAdPlaylistAt = Date.now();
      clearTimeout(state.clearTimer);
      emit(true, 'hls', url);
    } else if (state.active) {
      scheduleAdEnd(url);
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

  try {
    const nativeFetch = window.fetch;
    window.fetch = function streamBridgeFetch(input, init, ...rest) {
      const url = getUrl(input);
      const responsePromise = nativeFetch.call(this, input, init, ...rest);

      if (HLS_PATTERN.test(url)) {
        responsePromise.then((response) => {
          try {
            response.clone().text().then((text) => inspectPlaylist(url, text)).catch(() => {});
          } catch {}
        }).catch(() => {});
      }

      return responsePromise;
    };
  } catch {}

  try {
    const NativeWorker = window.Worker;

    function buildWorkerUrl(originalUrl, isModuleWorker) {
      const workerLines = [
        '(() => {',
        '  const nativeFetch = self.fetch;',
        '  const hlsPattern = /\\.m3u8(?:[?#]|$)/i;',
        '  const adMarkers = [/\\bstitched\\b/i, /"MIDROLL"/i, /"midroll"/i];',
        '  function inspect(url, text) {',
        '    if (typeof text !== "string" || !hlsPattern.test(url)) return;',
        '    const active = adMarkers.some((marker) => marker.test(text));',
        '    self.postMessage({ __streamBridge: true, type: "twitch-ad-state", active, sourceType: "worker-hls", url, timestamp: Date.now() });',
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
        '',
        isModuleWorker ? 'import(' + JSON.stringify(originalUrl) + ');' : 'importScripts(' + JSON.stringify(originalUrl) + ');'
      ].join('\n');

      return URL.createObjectURL(new Blob([workerLines], { type: 'application/javascript' }));
    }

    window.Worker = new Proxy(NativeWorker, {
      construct(Target, args, NewTarget) {
        const originalUrl = String(args?.[0] || '');
        let isTwitchWorker = false;

        try {
          const parsed = new URL(originalUrl, location.href);
          isTwitchWorker = parsed.origin.endsWith('.twitch.tv') || parsed.origin === 'https://www.twitch.tv';
        } catch {}

        if (!isTwitchWorker) return Reflect.construct(Target, args, NewTarget);

        const isModuleWorker = args?.[1]?.type === 'module';
        const wrappedUrl = buildWorkerUrl(new URL(originalUrl, location.href).href, isModuleWorker);
        const worker = Reflect.construct(Target, [wrappedUrl, args?.[1]], NewTarget);

        worker.addEventListener('message', (event) => {
          const data = event?.data;
          if (!data?.__streamBridge) return;

          window.postMessage({
            source: 'streambridge',
            type: data.type,
            active: Boolean(data.active),
            sourceType: data.sourceType,
            url: data.url,
            timestamp: data.timestamp
          }, '*');
        });

        return worker;
      }
    });
  } catch {}
})();