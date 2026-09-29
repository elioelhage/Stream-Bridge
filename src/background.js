const DEFAULTS = {
  youtubeVideoUrl: ''
};

const STATE_KEY = 'streamBridgeTabState';
const tabState = new Map();
const preparationLocks = new Map();
const extensionClosingTabs = new Set();

async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

async function persistState() {
  const serializable = {};
  for (const [twitchTabId, state] of tabState) serializable[twitchTabId] = state;
  await chrome.storage.local.set({ [STATE_KEY]: serializable });
}

async function restoreState() {
  const stored = await chrome.storage.local.get({ [STATE_KEY]: {} });
  for (const [key, value] of Object.entries(stored[STATE_KEY] || {})) {
    const twitchTabId = Number(key);
    if (Number.isInteger(twitchTabId) && value && typeof value === 'object') {
      tabState.set(twitchTabId, value);
    }
  }
}

function getTwitchChannel(tab) {
  try {
    const parts = new URL(tab?.url || '').pathname.split('/').filter(Boolean);
    if (!parts.length) return '';

    const reserved = new Set([
      'directory', 'downloads', 'jobs', 'search', 'settings', 'subscriptions',
      'inventory', 'drops', 'friends', 'videos', 'following', 'p', 'legal'
    ]);

    return reserved.has(parts[0].toLowerCase()) ? '' : parts[0].toLowerCase();
  } catch {
    return '';
  }
}

function normalizeYoutubeVideoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return '';

    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\/+/, '').split(/[/?#]/, 1)[0];
      return id ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(id) : '';
    }

    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      return 'https://www.youtube.com/watch?v=' + encodeURIComponent(url.searchParams.get('v'));
    }

    if (/^\/live\//i.test(url.pathname)) {
      return 'https://www.youtube.com' + url.pathname;
    }

    return '';
  } catch {
    return '';
  }
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function sendYoutubeMessage(tabId, message) {
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function ensureYoutubeTab(twitchTab) {
  if (!twitchTab?.id) return null;

  const existingLock = preparationLocks.get(twitchTab.id);
  if (existingLock) return existingLock;

  const operation = (async () => {
    const settings = await getSettings();
    const target = normalizeYoutubeVideoUrl(settings.youtubeVideoUrl);
    if (!target) return null;

    let state = tabState.get(twitchTab.id);
    if (!state) {
      state = {
        youtubeTabId: null,
        switched: false,
        manuallyClosed: false,
        youtubeUrl: target,
        youtubePosition: 0,
        youtubeIsLive: null
      };
      tabState.set(twitchTab.id, state);
    }

    if (state.manuallyClosed && state.switched) return null;

    let youtubeTab = await getTab(state.youtubeTabId);

    if (!youtubeTab) {
      youtubeTab = await chrome.tabs.create({
        url: target,
        active: true,
        windowId: twitchTab.windowId,
        index: typeof twitchTab.index === 'number' ? twitchTab.index + 1 : undefined
      });

      state.youtubeTabId = youtubeTab.id;
      state.youtubeUrl = target;
      state.manuallyClosed = false;
      tabState.set(twitchTab.id, state);
      await persistState();
    } else if (youtubeTab.url !== target) {
      await chrome.tabs.update(youtubeTab.id, { url: target, active: true });
      state.youtubeUrl = target;
      tabState.set(twitchTab.id, state);
      await persistState();
    } else {
      await chrome.tabs.update(youtubeTab.id, { active: true });
    }

    return youtubeTab;
  })();

  preparationLocks.set(twitchTab.id, operation);
  try {
    return await operation;
  } finally {
    preparationLocks.delete(twitchTab.id);
  }
}

async function switchToYoutube(twitchTabId) {
  let twitchTab;
  try {
    twitchTab = await chrome.tabs.get(twitchTabId);
  } catch {
    return { ok: false, reason: 'twitch-tab-missing' };
  }

  if (!getTwitchChannel(twitchTab)) {
    return { ok: false, reason: 'invalid-twitch-channel' };
  }

  let state = tabState.get(twitchTabId);
  if (state?.switched) return { ok: true, action: 'already-on-youtube' };
  if (state?.manuallyClosed) return { ok: false, reason: 'youtube-tab-closed' };

  state = tabState.get(twitchTabId) || {};
  if (typeof state.twitchWasMuted !== 'boolean') {
    state.twitchWasMuted = Boolean(twitchTab.mutedInfo?.muted);
  }

  await chrome.tabs.update(twitchTab.id, { muted: true }).catch(() => {});
  state.switched = false;
  state.manuallyClosed = false;
  tabState.set(twitchTabId, state);
  await persistState();

  const youtubeTab = await ensureYoutubeTab(twitchTab);
  if (!youtubeTab?.id) {
    if (!state.twitchWasMuted) {
      await chrome.tabs.update(twitchTab.id, { muted: false }).catch(() => {});
    }
    state.twitchWasMuted = false;
    tabState.set(twitchTabId, state);
    await persistState();
    return { ok: false, reason: 'invalid-youtube-video-url' };
  }

  state.youtubeTabId = youtubeTab.id;
  state.switched = true;
  state.manuallyClosed = false;
  tabState.set(twitchTabId, state);
  await persistState();

  await sendYoutubeMessage(youtubeTab.id, {
    type: 'streambridge-init-youtube',
    resumeTime: Number.isFinite(state.youtubePosition) ? state.youtubePosition : 0
  });

  return { ok: true, action: 'switched-to-youtube' };
}

async function captureYoutubeState(state) {
  if (!state?.youtubeTabId) return;

  const playback = await sendYoutubeMessage(state.youtubeTabId, {
    type: 'streambridge-get-youtube-state'
  });

  if (!playback) return;

  if (typeof playback.isLive === 'boolean') {
    state.youtubeIsLive = playback.isLive;
  }

  if (!playback.isLive && Number.isFinite(playback.currentTime)) {
    state.youtubePosition = Math.max(0, playback.currentTime);
  }
}

async function returnToTwitch(twitchTabId) {
  const state = tabState.get(twitchTabId);
  if (!state?.switched) return { ok: false, reason: 'not-switched' };

  let twitchTab;
  try {
    twitchTab = await chrome.tabs.get(twitchTabId);
  } catch {
    return { ok: false, reason: 'twitch-tab-missing' };
  }

  await captureYoutubeState(state);
  await persistState();

  if (state.youtubeTabId) {
    extensionClosingTabs.add(state.youtubeTabId);
    try {
      await chrome.tabs.remove(state.youtubeTabId);
    } catch {}
  }

  await chrome.windows.update(twitchTab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(twitchTab.id, { active: true }).catch(() => {});

  // Restore exactly the mute state Twitch had before the ad.
  await chrome.tabs.update(twitchTab.id, {
    muted: Boolean(state.twitchWasMuted)
  }).catch(() => {});

  state.youtubeTabId = null;
  state.switched = false;
  state.manuallyClosed = false;
  state.twitchWasMuted = false;
  tabState.set(twitchTabId, state);
  await persistState();

  return { ok: true, action: 'returned-to-twitch' };
}

async function handleAdState({ tab, active }) {
  if (!tab?.id) return { ok: false, reason: 'no-twitch-tab' };
  return active ? switchToYoutube(tab.id) : returnToTwitch(tab.id);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'twitch-ad-state') {
    (async () => {
      if (!sender.tab?.id) return { ok: false, reason: 'no-twitch-tab' };
      return handleAdState({
        tab: sender.tab,
        active: Boolean(message.active)
      });
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'youtube-state') {
    (async () => {
      const youtubeTabId = sender.tab?.id;
      if (!youtubeTabId) return { ok: false };

      for (const [twitchTabId, state] of tabState.entries()) {
        if (state.youtubeTabId !== youtubeTabId) continue;

        if (typeof message.isLive === 'boolean') {
          state.youtubeIsLive = message.isLive;
        }
        if (!message.isLive && Number.isFinite(message.currentTime)) {
          state.youtubePosition = Math.max(0, message.currentTime);
        }

        tabState.set(twitchTabId, state);
        return { ok: true };
      }

      return { ok: false };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'youtube-ready') {
    (async () => {
      const youtubeTabId = sender.tab?.id;
      if (!youtubeTabId) return { ok: false };

      for (const [twitchTabId, state] of tabState.entries()) {
        if (state.youtubeTabId !== youtubeTabId) continue;

        if (typeof message.isLive === 'boolean') {
          state.youtubeIsLive = message.isLive;
        }

        tabState.set(twitchTabId, state);
        await persistState();

        if (message.isLive) {
          await sendYoutubeMessage(youtubeTabId, {
            type: 'streambridge-go-live'
          });
        } else if (Number.isFinite(state.youtubePosition) && state.youtubePosition > 0) {
          await sendYoutubeMessage(youtubeTabId, {
            type: 'streambridge-seek',
            time: state.youtubePosition
          });
        }

        return { ok: true };
      }

      return { ok: false };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (extensionClosingTabs.delete(tabId)) return;

  for (const [twitchTabId, state] of tabState.entries()) {
    if (twitchTabId === tabId) {
      tabState.delete(tabId);
      continue;
    }

    if (state.youtubeTabId === tabId && state.switched) {
      state.youtubeTabId = null;
      state.manuallyClosed = true;
      state.switched = false;
      state.youtubeIsLive = null;
      if (!state.twitchWasMuted) {
        chrome.tabs.update(twitchTabId, { muted: false }).catch(() => {});
      }
      state.twitchWasMuted = false;
      tabState.set(twitchTabId, state);
      persistState().catch(() => {});
    }
  }

  persistState().catch(() => {});
});

restoreState().catch(() => {});