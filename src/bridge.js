(() => {
  const SCRIPT_ID = '__streamBridge_detector_script';

  function injectDetector() {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('src/twitch-detector.js');
    script.onload = () => script.remove();
    (document.documentElement || document.head).appendChild(script);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'streambridge' || data.type !== 'twitch-ad-state') return;

    chrome.runtime.sendMessage({
      type: 'twitch-ad-state',
      active: Boolean(data.active),
      sourceType: data.sourceType || 'unknown',
      url: data.url || location.href,
      timestamp: data.timestamp || Date.now()
    }).catch(() => {});
  });

  injectDetector();
})();