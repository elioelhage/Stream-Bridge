(() => {
  if (window.__streamBridgeYoutubeControllerInstalled) return;
  window.__streamBridgeYoutubeControllerInstalled = true;

  let lastIsLive = null;
  let lastKnownTime = 0;

  function findPlayerResponse() {
    try {
      if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    } catch {}

    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        const match = text.match(/ytInitialPlayerResponse\s*=\s*({.*?});(?:\s*var|\s*<\/script>)/s);
        if (match) {
          try {
            return JSON.parse(match[1]);
          } catch {}
        }
      }
    } catch {}

    return null;
  }

  function classifyVideo() {
    const response = findPlayerResponse();
    const details = response?.videoDetails;
    const microformat = response?.microformat?.playerMicroformatRenderer;
    const liveDetails = microformat?.liveBroadcastDetails;

    if (details?.isLiveContent === true) return true;
    if (liveDetails && (liveDetails.startTimestamp || liveDetails.endTimestamp)) return true;

    return false;
  }

  function getVideo() {
    return document.querySelector('video.html5-main-video, video');
  }

  function reportState() {
    const video = getVideo();
    const isLive = classifyVideo();

    if (video && Number.isFinite(video.currentTime)) {
      lastKnownTime = video.currentTime;
    }

    if (isLive !== lastIsLive || video) {
      lastIsLive = isLive;
      chrome.runtime.sendMessage({
        type: 'youtube-state',
        isLive,
        currentTime: isLive ? 0 : lastKnownTime
      }).catch(() => {});
    }
  }

  function seekWhenReady(time) {
    if (!Number.isFinite(time) || time <= 0) return;

    const startedAt = Date.now();

    const trySeek = () => {
      const video = getVideo();
      if (classifyVideo()) return;

      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        const target = Math.min(time, Math.max(0, video.duration - 0.25));
        try {
          video.currentTime = target;
        } catch {}
        return;
      }

      if (Date.now() - startedAt < 15000) {
        setTimeout(trySeek, 250);
      }
    };

    trySeek();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'streambridge-get-youtube-state') {
      const video = getVideo();
      const isLive = classifyVideo();
      const currentTime = video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : lastKnownTime;

      sendResponse({
        isLive,
        currentTime: isLive ? 0 : currentTime
      });
      return false;
    }

    if (message?.type === 'streambridge-seek') {
      seekWhenReady(Number(message.time));
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'streambridge-init-youtube') {
      seekWhenReady(Number(message.resumeTime));
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  function announceReady() {
    const isLive = classifyVideo();
    lastIsLive = isLive;

    chrome.runtime.sendMessage({
      type: 'youtube-ready',
      isLive
    }).catch(() => {});
  }

  const observer = new MutationObserver(() => {
    const video = getVideo();
    if (video && !video.__streamBridgeBound) {
      video.__streamBridgeBound = true;
      video.addEventListener('timeupdate', () => {
        if (!classifyVideo() && Number.isFinite(video.currentTime)) {
          lastKnownTime = video.currentTime;
        }
      });
      video.addEventListener('loadedmetadata', reportState);
      announceReady();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('load', announceReady);
  setTimeout(announceReady, 1000);
  setTimeout(announceReady, 3000);
  setInterval(reportState, 2000);
})();