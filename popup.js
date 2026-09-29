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

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('youtubeVideoUrl').value = settings.youtubeVideoUrl || '';

  const activeTab = await getActiveTwitchTab();
  const channel = activeTab ? getTwitchChannel(activeTab) : '';

  $('twitchChannel').value = channel || 'No Twitch stream detected';
  $('status').textContent = channel ? 'Ready' : 'Open a Twitch stream';
}

$('save').addEventListener('click', async () => {
  const value = $('youtubeVideoUrl').value.trim();

  if (!normalizeYoutubeVideoUrl(value)) {
    $('status').textContent = 'Enter a valid YouTube video or live link';
    $('youtubeVideoUrl').focus();
    return;
  }

  await chrome.storage.local.set({ youtubeVideoUrl: value });
  $('status').textContent = 'Saved';
});

load().catch(() => {
  $('status').textContent = 'Unable to load settings';
});