const DEFAULTS = {
  youtubeVideoUrl: ''
};

const STATE_KEY = 'streamBridgeTabState';
const tabState = new Map();
const preparationLocks = new Map();
const extensionClosingTabs = new Set();
const simulationTimers = new Map();
const SIMULATION_DURATION_MS = 12000;

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
      return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
    }

    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(url.searchParams.get('v'))}`;
    }

    if (/^\/live\//i.test(url.pathname)) {
      return `https://www.youtube.com${url.pathname}`;
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
        lastEventWasSimulated: false
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

  // Mute Twitch before opening/focusing YouTube so ad audio cannot leak through.
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

  return { ok: true, action: 'switched-to-youtube' };
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

  if (state.youtubeTabId) {
    extensionClosingTabs.add(state.youtubeTabId);
    try {
      await chrome.tabs.remove(state.youtubeTabId);
    } catch {}
  }

  await chrome.windows.update(twitchTab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(twitchTab.id, { active: true }).catch(() => {});
  if (!state.twitchWasMuted) {
    await chrome.tabs.update(twitchTab.id, { muted: false }).catch(() => {});
  }

  clearTimeout(simulationTimers.get(twitchTabId));
  simulationTimers.delete(twitchTabId);

  state.youtubeTabId = null;
  state.switched = false;
  state.manuallyClosed = false;
  state.twitchWasMuted = false;
  state.lastEventWasSimulated = false;
  tabState.set(twitchTabId, state);
  await persistState();

  return { ok: true, action: 'returned-to-twitch' };
}

async function handleAdState({ tab, active, simulated = false }) {
  if (!tab?.id) return { ok: false, reason: 'no-twitch-tab' };

  if (active) {
    const state = tabState.get(tab.id) || {};
    state.lastEventWasSimulated = simulated;
    tabState.set(tab.id, state);
    await persistState();

    const result = await switchToYoutube(tab.id);

    if (simulated && result.ok) {
      clearTimeout(simulationTimers.get(tab.id));
      const timer = setTimeout(() => {
        simulationTimers.delete(tab.id);
        returnToTwitch(tab.id).catch(() => {});
      }, SIMULATION_DURATION_MS);
      simulationTimers.set(tab.id, timer);
    }

    return result;
  }

  return returnToTwitch(tab.id);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'twitch-ad-state') {
    (async () => {
      if (!sender.tab?.id) return { ok: false, reason: 'no-twitch-tab' };
      return handleAdState({
        tab: sender.tab,
        active: Boolean(message.active),
        simulated: false
      });
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'simulate-ad') {
    (async () => {
      if (!message.twitchTabId) return { ok: false, reason: 'no-twitch-tab' };

      let twitchTab;
      try {
        twitchTab = await chrome.tabs.get(message.twitchTabId);
      } catch {
        return { ok: false, reason: 'twitch-tab-missing' };
      }

      const settings = await getSettings();
      if (!normalizeYoutubeVideoUrl(settings.youtubeVideoUrl)) {
        return { ok: false, reason: 'invalid-youtube-video-url' };
      }

      return handleAdState({ tab: twitchTab, active: true, simulated: true });
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (extensionClosingTabs.delete(tabId)) return;

  for (const [twitchTabId, state] of tabState.entries()) {
    if (twitchTabId === tabId) {
      clearTimeout(simulationTimers.get(tabId));
      simulationTimers.delete(tabId);
      tabState.delete(tabId);
      continue;
    }

    if (state.youtubeTabId === tabId && state.switched) {
      state.youtubeTabId = null;
      state.manuallyClosed = true;
      state.switched = false;
      state.lastEventWasSimulated = false;
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