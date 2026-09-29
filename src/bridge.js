(() => {
  const SCRIPT_ID = '__streamBridge_detector_script';
  const OVERLAY_ID = '__streamBridge_ad_overlay';
  const TEST_DURATION_MS = 12000;

  let adActive = false;
  let overlayTimer = null;
  let testTimer = null;

  function injectDetector() {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('src/twitch-detector.js');
    script.onload = () => script.remove();
    (document.documentElement || document.head).appendChild(script);
  }

  function ensureStyles() {
    if (document.getElementById('__streamBridge_overlay_styles')) return;

    const style = document.createElement('style');
    style.id = '__streamBridge_overlay_styles';
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        display: none;
        width: min(340px, calc(100vw - 40px));
        padding: 16px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 16px;
        background:
          radial-gradient(circle at 20% 0%, rgba(124,58,237,.28), transparent 45%),
          rgba(17,17,19,.94);
        box-shadow: 0 18px 50px rgba(0,0,0,.38);
        color: #fff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(16px);
        transform: translateY(-8px);
        opacity: 0;
        transition: opacity .18s ease, transform .18s ease;
      }

      #${OVERLAY_ID}.visible {
        opacity: 1;
        transform: translateY(0);
      }

      #${OVERLAY_ID} .sb-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      #${OVERLAY_ID} .sb-icon {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        border-radius: 12px;
        background: linear-gradient(135deg, #7c3aed, #a855f7);
        box-shadow: 0 8px 24px rgba(124,58,237,.28);
      }

      #${OVERLAY_ID} .sb-icon svg {
        width: 22px;
        height: 22px;
      }

      #${OVERLAY_ID} .sb-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -.01em;
      }

      #${OVERLAY_ID} .sb-subtitle {
        margin: 3px 0 0;
        color: #b4b4be;
        font-size: 12px;
        line-height: 1.35;
      }

      #${OVERLAY_ID} .sb-timer {
        margin-top: 12px;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,.08);
      }

      #${OVERLAY_ID} .sb-timer > span {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #7c3aed, #c084fc);
        transform-origin: left center;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function getOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    ensureStyles();

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="sb-row">
        <div class="sb-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 17.5h16M6.5 17.5v-6M17.5 17.5v-6M4.5 11.5h15M7 11.5 9.5 6h5l2.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 8.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <p class="sb-title">Twitch ad detected</p>
          <p class="sb-subtitle" data-sb-subtitle>Stream Bridge detected an ad break.</p>
        </div>
      </div>
      <div class="sb-timer"><span data-sb-timer></span></div>
    `;

    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  function showOverlay({ simulated = false, duration = 0 } = {}) {
    const overlay = getOverlay();
    const subtitle = overlay.querySelector('[data-sb-subtitle]');
    const timer = overlay.querySelector('[data-sb-timer]');

    subtitle.textContent = simulated
      ? 'Test mode • simulated 12-second ad'
      : 'Stream Bridge detected an ad break.';

    timer.style.transition = 'none';
    timer.style.transform = 'scaleX(1)';

    overlay.style.display = 'block';
    requestAnimationFrame(() => overlay.classList.add('visible'));

    clearTimeout(overlayTimer);

    if (simulated && duration > 0) {
      requestAnimationFrame(() => {
        timer.style.transition = `transform ${duration}ms linear`;
        timer.style.transform = 'scaleX(0)';
      });

      overlayTimer = setTimeout(() => {
        hideOverlay();
      }, duration);
    }
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    overlay.classList.remove('visible');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      overlay.style.display = 'none';
    }, 180);
  }

  function setRealAdState(active) {
    adActive = active;

    if (active) {
      showOverlay({ simulated: false });
    } else {
      hideOverlay();
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'streambridge' || data.type !== 'twitch-ad-state') return;

    setRealAdState(Boolean(data.active));
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'simulate-ad') {
      clearTimeout(testTimer);
      adActive = true;
      showOverlay({ simulated: true, duration: TEST_DURATION_MS });

      testTimer = setTimeout(() => {
        adActive = false;
        hideOverlay();
      }, TEST_DURATION_MS);

      sendResponse({ ok: true, durationMs: TEST_DURATION_MS });
      return true;
    }

    if (message?.type === 'get-ad-state') {
      sendResponse({ active: adActive });
    }
  });

  injectDetector();
  ensureStyles();
})();