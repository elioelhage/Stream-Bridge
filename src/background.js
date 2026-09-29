const DEFAULTS = {
  enabled: true,
  twitchChannel: '',
  youtubeVideoUrl: '',
  closeBackupAfterReturn: false
};

const STATE_KEY = 'streamSwitchTabState';
const tabState = new Map();
const preparationLocks = new Map();

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
    if (Number.isInteger(twitchTabId) && value && typeof value === 'object') tabState.set(twitchTabId, value);
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

    if (/^\/live\//i.test(url.pathname)) return `https://www.youtube.com${url.pathname}`;
    return '';
  } catch {
    return '';
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
  state.backupReady = false;
  tabState.set(twitchTabId, state);
  await persistState();
  return null;
}

async function getBackupTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function ensureBackupTab(twitchTab, { force = false } = {}) {
  if (!twitchTab?.id) return null;

  const existingLock = preparationLocks.get(twitchTab.id);
  if (existingLock) return existingLock;

  const preparation = (async () => {
    const settings = await getSettings();
    const target = normalizeYoutubeVideoUrl(settings.youtubeVideoUrl);
    if (!target) return null;

    let state = tabState.get(twitchTab.id);
    if (!state) {
      state = {
        switched: false,
        backupTabId: null,
        preparedUrl: '',
        backupUrl: '',
        backupReady: false,
        backupClosedByUser: false,
        closeBackupAfterReturn: Boolean(settings.closeBackupAfterReturn),
        lastEventWasSimulated: false
      };
      tabState.set(twitchTab.id, state);
    }

    if (state.backupClosedByUser && state.switched && !force) return null;

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
      state.backupReady = false;
      state.backupClosedByUser = false;
      tabState.set(twitchTab.id, state);
      await persistState();
    } else if (state.preparedUrl !== target || backup.url !== target) {
      await chrome.tabs.update(backup.id, { url: target, active: false });
      state.preparedUrl = target;
      state.backupReady = false;
      state.backupClosedByUser = false;
      tabState.set(twitchTab.id, state);
      await persistState();
    }

    const settled = await getBackupTab(backup.id);
    if (!settled?.id) return null;

    state.backupUrl = settled.url || target;
    // "Ready" means the backup tab exists and points at the configured video.
    // YouTube is allowed to continue loading in the background.
    state.backupReady = true;
    state.backupClosedByUser = false;
    tabState.set(twitchTab.id, state);
    await persistState();

    return backup;
  })();

  preparationLocks.set(twitchTab.id, preparation);
  try { return await preparation; }
  finally { preparationLocks.delete(twitchTab.id); }
}

async function activateBackup(twitchTabId) {
  let twitchTab;
  try { twitchTab = await chrome.tabs.get(twitchTabId); } catch { return false; }

  const state = tabState.get(twitchTabId);
  if (state?.backupClosedByUser && state.switched) return false;

  const backup = await ensureBackupTab(twitchTab);
  const currentState = tabState.get(twitchTabId) || {};
  if (!backup?.id || !currentState.backupReady) return false;

  try {
    await chrome.windows.update(twitchTab.windowId, { focused: true });
    await chrome.tabs.update(backup.id, { active: true });
  } catch { return false; }

  currentState.backupTabId = backup.id;
  currentState.switched = true;
  currentState.backupClosedByUser = false;
  tabState.set(twitchTabId, currentState);
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
    try { await chrome.tabs.remove(state.backupTabId); state.backupTabId = null; } catch {}
  }

  state.switched = false;
  state.backupClosedByUser = false;
  tabState.set(twitchTabId, state);
  await persistState();
}

function getCurrentChannelFromTab(tab) {
  try { return normalizeChannel(new URL(tab.url || '').pathname); }
  catch { return ''; }
}

async function handleAdState({ tab, active, simulated = false }) {
  const settings = await getSettings();
  if (!settings.enabled || !tab?.id) return { ok: false, reason: 'disabled-or-no-tab' };

  const currentChannel = getCurrentChannelFromTab(tab);
  const configuredChannel = normalizeChannel(settings.twitchChannel);
  if (!configuredChannel || currentChannel !== configuredChannel) return { ok: false, reason: 'channel-mismatch' };

  let state = tabState.get(tab.id);
  if (!state) {
    state = {
      switched: false,
      backupTabId: null,
      preparedUrl: '',
      backupUrl: '',
      backupReady: false,
      backupClosedByUser: false,
      closeBackupAfterReturn: Boolean(settings.closeBackupAfterReturn),
      lastEventWasSimulated: false
    };
  }

  state.closeBackupAfterReturn = Boolean(settings.closeBackupAfterReturn);
  state.lastEventWasSimulated = simulated;
  tabState.set(tab.id, state);
  await persistState();

  if (active && !state.switched) {
    if (state.backupClosedByUser) return { ok: false, reason: 'backup-closed-during-current-ad' };
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
    handleAdState({ tab: sender.tab, active: Boolean(message.active), simulated: false })
      .then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'prepare-backup') {
    (async () => {
      if (!message.twitchTabId) return { ok: false, reason: 'no-twitch-tab-id' };

      let twitchTab;
      try {
        twitchTab = await chrome.tabs.get(message.twitchTabId);
      } catch {
        return { ok: false, reason: 'twitch-tab-missing' };
      }

      const settings = await getSettings();
      const target = normalizeYoutubeVideoUrl(settings.youtubeVideoUrl);
      if (!target) return { ok: false, reason: 'invalid-youtube-video-url' };

      const backup = await ensureBackupTab(twitchTab, { force: true });
      const state = tabState.get(twitchTab.id) || {};
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
      if (!message.twitchTabId) return { ok: false, reason: 'no-twitch-tab-id' };

      let twitchTab;
      try {
        twitchTab = await chrome.tabs.get(message.twitchTabId);
      } catch {
        return { ok: false, reason: 'twitch-tab-missing' };
      }

      return handleAdState({ tab: twitchTab, active: true, simulated: true });
    })().then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'error' }));
    return true;
  }

  if (message?.type === 'end-simulated-ad') {
    (async () => {
      const switchedEntry = [...tabState.entries()].find(([, state]) => state?.switched && state?.lastEventWasSimulated);
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
      return { settings, tabState: sender.tab?.id ? tabState.get(sender.tab.id) || null : null };
    })().then(sendResponse).catch(() => sendResponse({ settings: DEFAULTS, tabState: null }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  let changed = false;

  for (const [twitchTabId, state] of tabState.entries()) {
    if (twitchTabId === tabId) {
      tabState.delete(tabId);
      changed = true;
      continue;
    }

    if (state.backupTabId === tabId) {
      state.backupTabId = null;
      state.backupReady = false;
      state.backupClosedByUser = true;
      tabState.set(twitchTabId, state);
      changed = true;
    }
  }

  if (changed) persistState().catch(() => {});
});

restoreState().catch(() => {});