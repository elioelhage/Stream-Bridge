const DEFAULTS = {
  youtubeVideoUrl: ''
};

const $ = (id) => document.getElementById(id);

async function getActiveTwitchTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.twitch.tv/')) return null;
  return tab;
}

function getTwitchChannel(tab) {
  try {
    const parts = new URL(tab.url).pathname.split('/').filter(Boolean);
    if (!parts.length) return '';

    const reserved = new Set([
      'directory', 'downloads', 'jobs', 'search', 'settings', 'subscriptions',
      'inventory', 'drops', 'friends', 'videos', 'following', 'p', 'legal'
    ]);

    return reserved.has(parts[0].toLowerCase()) ? '' : parts[0];
  } catch {
    return '';
  }
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('youtubeVideoUrl').value = settings.youtubeVideoUrl || '';

  const activeTab = await getActiveTwitchTab();
  const channel = activeTab ? getTwitchChannel(activeTab) : '';

  $('twitchChannel').value = channel || 'Open a Twitch stream';
  $('status').textContent = channel ? 'Twitch stream detected' : 'Open a Twitch stream';
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    youtubeVideoUrl: $('youtubeVideoUrl').value.trim()
  });
  $('status').textContent = 'Saved';
});

$('simulateStart').addEventListener('click', async () => {
  const activeTab = await getActiveTwitchTab();
  if (!activeTab) {
    $('status').textContent = 'Open a Twitch stream first';
    return;
  }

  await chrome.storage.local.set({
    youtubeVideoUrl: $('youtubeVideoUrl').value.trim()
  });

  const result = await chrome.runtime.sendMessage({
    type: 'simulate-ad',
    twitchTabId: activeTab.id
  }).catch(() => null);

  if (result?.ok) {
    $('status').textContent = '12-second test started';
  } else if (result?.reason === 'invalid-youtube-video-url') {
    $('status').textContent = 'Enter a YouTube live-stream link';
  } else {
    $('status').textContent = 'Test could not start';
  }
});

load().catch(() => {
  $('status').textContent = 'Unable to load settings';
});