const DEFAULTS = {
  enabled: true,
  twitchChannel: '',
  youtubeChannel: '',
  autoPrepare: true,
  closeBackupAfterReturn: false
};

const tabState = new Map();

async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

function normalizeChannel(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/www\.twitch\.tv\//i, '')
    .replace(/^@/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function normalizeYoutubeLiveUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.hostname !== 'www.youtube.com' && url.hostname !== 'youtube.com') return '';

    if (url.pathname === '/live') return url.href;
    if (/^\/@[^/]+$/.test(url.pathname)) return `${url.origin}/${url.pathname}/live`;
    if (/^\/channel\/[^/]+$/.test(url.pathname)) return `${url.origin}/${url.pathname}/live`;
    if (/^\/c\/[^/]+$/.test(url.pathname)) return `${url.origin}/${url.pathname}/live`;
    return url.href;
  } catch {
    const handle = raw.replace(/^@/, '').replace(/\/$/, '');
    return `https://www.youtube.com/@${encodeURIComponent(handle)}/live`;
  }
}

async function ensureBackupTab(twitchTab) {
  const settings = await getSettings();
  const target = normalizeYoutubeLiveUrl(settings.youtubeChannel);
  if (!target) return null;

  let existing = null;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === twitchTab.id) continue;
    const state = tabState.get(twitchTab.id);
    if (state?.backupTabId === tab.id && tab.url?.startsWith('https://www.youtube.com/')) {
      existing = tab;
      break;
    }
  }

  const state = tabState.get(twitchTab.id) || {};

  if (!existing && state.backupTabId) {
    try {
      existing = await chrome.tabs.get(state.backupTabId);
    } catch {
      state.backupTabId = null;
    }
  }

  if (!existing) {
    existing = await chrome.tabs.create({
      url: target,
      active: false,
      windowId: twitchTab.windowId,
      index: typeof twitchTab.index === 'number' ? twitchTab.index + 1 : undefined
    });
    state.backupTabId = existing.id;
    state.preparedUrl = target;
    tabState.set(twitchTab.id, state);
    return existing;
  }

  if (existing.url !== target && state.preparedUrl !== target) {
    await chrome.tabs.update(existing.id, { url: target });
    state.preparedUrl = target;
    tabState.set(twitchTab.id, state);
  }

  return existing;
}

async function activateBackup(twitchTab) {
  const backup = await ensureBackupTab(twitchTab);
  if (!backup?.id) return;

  await chrome.windows.update(twitchTab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(backup.id, { active: true });

  const state = tabState.get(twitchTab.id) || {};
  state.backupTabId = backup.id;
  state.switched = true;
  tabState.set(twitchTab.id, state);
}

async function returnToTwitch(twitchTabId) {
  const state = tabState.get(twitchTabId);
  if (!state?.switched) return;

  let twitchTab;
  try {
    twitchTab = await chrome.tabs.get(twitchTabId);
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
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'twitch-ad-state' || !sender.tab?.id) return;

  (async () => {
    const settings = await getSettings();
    if (!settings.enabled) return;

    let currentChannel = '';
    try {
      currentChannel = normalizeChannel(new URL(sender.tab.url || '').pathname);
    } catch {}

    const configuredChannel = normalizeChannel(settings.twitchChannel);
    if (!configuredChannel || currentChannel !== configuredChannel) return;

    const state = tabState.get(sender.tab.id) || {
      switched: false,
      backupTabId: null,
      closeBackupAfterReturn: Boolean(settings.closeBackupAfterReturn)
    };
    state.closeBackupAfterReturn = Boolean(settings.closeBackupAfterReturn);
    tabState.set(sender.tab.id, state);

    if (message.active && !state.switched) {
      await activateBackup(sender.tab);
    } else if (!message.active && state.switched) {
      await returnToTwitch(sender.tab.id);
    }
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);

  for (const state of tabState.values()) {
    if (state.backupTabId === tabId) state.backupTabId = null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'prepare-backup') {
    (async () => {
      if (!sender.tab?.id) return { ok: false };
      const tab = await chrome.tabs.get(sender.tab.id);
      const backup = await ensureBackupTab(tab);
      return { ok: Boolean(backup?.id), tabId: backup?.id || null };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
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
