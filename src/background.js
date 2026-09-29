const DEFAULTS = {
  enabled: true,
  twitchChannel: '',
  youtubeChannel: '',
  closeBackupAfterReturn: false
};

const STATE_KEY = 'streamSwitchTabState';
const tabState = new Map();

async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

async function persistState() {
  const serializable = {};
  for (const [twitchTabId, state] of tabState) {
    serializable[twitchTabId] = state;
  }
  await chrome.storage.local.set({ [STATE_KEY]: serializable });
}

async function restoreState() {
  const stored = await chrome.storage.local.get({ [STATE_KEY]: {} });
  const stateObject = stored[STATE_KEY] || {};
  for (const [key, value] of Object.entries(stateObject)) {
    const twitchTabId = Number(key);
    if (Number.isInteger(twitchTabId) && value && typeof value === 'object') {
      tabState.set(twitchTabId, value);
    }
  }
}

function normalizeChannel(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/www\.twitch\.tv\//i, '')
    .replace(/^@/, '')
    .replace(/^\/+|\/+$/g, '')
    .split(/[/?#]/, 1)[0]
    .toLowerCase();
}

function normalizeYoutubeHandle(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!['www.youtube.com', 'youtube.com'].includes(url.hostname)) return '';
    const match = url.pathname.match(/^\/@([^/]+)/i);
    if (match) return match[1];
    const channelMatch = url.pathname.match(/^\/channel\/([^/]+)/i);
    if (channelMatch) return channelMatch[1];
    const customMatch = url.pathname.match(/^\/c\/([^/]+)/i);
    if (customMatch) return customMatch[1];
    return '';
  } catch {
    return raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '').split(/[/?#]/, 1)[0];
  }
}

function buildYoutubeLiveUrl(youtubeValue, twitchChannel) {
  const explicit = normalizeYoutubeHandle(youtubeValue);
  const fallback = normalizeChannel(twitchChannel);
  const handle = explicit || fallback;
  if (!handle) return '';

  return `https://www.youtube.com/@${encodeURIComponent(handle)}/live`;
}

function isLikelyYoutubeLiveUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['www.youtube.com', 'youtube.com'].includes(parsed.hostname)) return false;
    return parsed.pathname.startsWith('/watch') || /^\/live\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function findExistingBackupTab(twitchTabId) {
  const state = tabState.get(twitchTabId);
  if (!state?.backupTabId) return null;

  try {
    const tab = await chrome.tabs.get(state.backupTabId);
    if (tab.url?.startsWith('https://www.youtube.com/')) return tab;
  } catch {}

  state.backupTabId = null;
  await persistState();
  return null;
}

async function waitForYoutubeNavigation(tabId, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete' && isLikelyYoutubeLiveUrl(tab.url || '')) return tab;
      if (tab.url && !tab.url.includes('/live')) return tab;
    } catch {
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function ensureBackupTab(twitchTab) {
  const settings = await getSettings();
  const target = buildYoutubeLiveUrl(settings.youtubeChannel, settings.twitchChannel);
  if (!target) return null;

  const state = tabState.get(twitchTab.id) || {
    switched: false,
    backupTabId: null,
    preparedUrl: '',
    closeBackupAfterReturn: Boolean(settings.closeBackupAfterReturn)
  };

  let backup = await findExistingBackupTab(twitchTab.id);

  if (!backup) {
    backup = await chrome.tabs.create({
      url: target,
      active: false,
      windowId: twitchTab.windowId,
      index: typeof twitchTab.index === 'number' ? twitchTab.index + 1 : undefined
    });
    state.backupTabId = backup.id;
    state.preparedUrl = target;
    tabState.set(twitchTab.id, state);
    await persistState();
  } else if (state.preparedUrl !== target && backup.url !== target) {
    await chrome.tabs.update(backup.id, { url: target, active: false });
    state.preparedUrl = target;
    tabState.set(twitchTab.id, state);
    await persistState();
  }

  const settled = await waitForYoutubeNavigation(backup.id);
  if (settled?.id === backup.id) {
    state.backupUrl = settled.url || target;
    state.backupReady = isLikelyYoutubeLiveUrl(settled.url || '');
    tabState.set(twitchTab.id, state);
    await persistState();
  }

  return backup;
}

async function activateBackup(twitchTabId) {
  let twitchTab;
  try {
    twitchTab = await chrome.tabs.get(twitchTabId);
  } catch {
    return false;
  }

  const backup = await ensureBackupTab(twitchTab);
  const state = tabState.get(twitchTabId) || {};
  if (!backup?.id || !state.backupReady) return false;

  try {
    await chrome.windows.update(twitchTab.windowId, { focused: true });
    await chrome.tabs.update(backup.id, { active: true });
  } catch {
    return false;
  }

  state.backupTabId = backup.id;
  state.switched = true;
  tabState.set(twitchTabId, state);
  await persistState();
  return true;
}

async function returnToTwitch(twitchTabId) {
  const state = tabState.get(twitchTabId);
  if (!state?.switched) return;

  try {
    const twitchTab = await chrome.tabs.get(twitchTabId);
    await chrome.windows.update(twitchTab.windowId, { focused: true });
    await chrome.tabs.update(twitchTabId, { active: true });
  } catch {}

  if (state.closeBackupAfterReturn && state.backupTabId) {
    try {
      await chrome.tabs.remove(state.backupTabId);
      state.backupTabId = null;
    } catch {}
  }

  state.switched = false;
  tabState.set(twitchTabId, state);
  await persistState();
}

function getCurrentChannelFromTab(tab) {
  try {
    return normalizeChannel(new URL(tab.url || '').pathname);
  } catch {
    return '';
  }
}

async function handleAdState({ tab, active, simulated = false }) {
  const settings = await getSettings();
  if (!settings.enabled || !tab?.id) return { ok: false, reason: 'disabled-or-no-tab' };

  const currentChannel = getCurrentChannelFromTab(tab);
  const configuredChannel = normalizeChannel(settings.twitchChannel);
  if (!configuredChannel || currentChannel !== configuredChannel) {
    return { ok: false, reason: 'channel-mismatch' };
  }

  const state = tabState.get(tab.id) || {
    switched: false,
    backupTabId: null,
    preparedUrl: '',
    closeBackupAfterReturn: Boolean(settings.closeBackupAfterReturn),
    lastEventWasSimulated: false
  };

  state.closeBackupAfterReturn = Boolean(settings.closeBackupAfterReturn);
  state.lastEventWasSimulated = simulated;
  tabState.set(tab.id, state);
  await persistState();

  if (active && !state.switched) {
    const switched = await activateBackup(tab.id);
    return { ok: switched, action: switched ? 'switched-to-backup' : 'backup-not-ready' };
  }

  if (!active && state.switched) {
    await returnToTwitch(tab.id);
    return { ok: true, action: 'returned-to-twitch' };
  }

  return { ok: true, action: 'no-op' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'twitch-ad-state') {
    handleAdState({
      tab: sender.tab,
      active: Boolean(message.active),
      simulated: false
    }).then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'prepare-backup') {
    (async () => {
      if (!sender.tab?.id) return { ok: false, reason: 'no-tab' };
      const settings = await getSettings();
      const target = buildYoutubeLiveUrl(settings.youtubeChannel, settings.twitchChannel);
      const backup = await ensureBackupTab(sender.tab);
      const state = tabState.get(sender.tab.id) || {};
      return {
        ok: Boolean(backup?.id && state.backupReady),
        tabId: backup?.id || null,
        url: state.backupUrl || target,
        ready: Boolean(state.backupReady)
      };
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'simulate-ad') {
    (async () => {
      if (!sender.tab?.id) return { ok: false, reason: 'no-tab' };
      return handleAdState({ tab: sender.tab, active: true, simulated: true });
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'end-simulated-ad') {
    (async () => {
      const switchedEntry = [...tabState.entries()].find(([, state]) => state?.switched);
      if (!switchedEntry) return { ok: false, reason: 'no-simulated-switch-active' };

      const [twitchTabId] = switchedEntry;
      try {
        const twitchTab = await chrome.tabs.get(twitchTabId);
        return handleAdState({ tab: twitchTab, active: false, simulated: true });
      } catch {
        return { ok: false, reason: 'twitch-tab-missing' };
      }
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'get-state') {
    (async () => {
      const settings = await getSettings();
      return {
        settings,
        tabState: sender.tab?.id ? tabState.get(sender.tab.id) || null : null
      };
    })().then(sendResponse).catch(() => sendResponse({ settings: DEFAULTS, tabState: null }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  let changed = false;
  if (tabState.delete(tabId)) changed = true;
  for (const state of tabState.values()) {
    if (state.backupTabId === tabId) {
      state.backupTabId = null;
      state.backupReady = false;
      changed = true;
    }
  }
  if (changed) persistState().catch(() => {});
});

restoreState().catch(() => {});
