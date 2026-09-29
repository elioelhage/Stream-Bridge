const DEFAULTS = {
  enabled: true,
  twitchChannel: ''
};

const $ = (id) => document.getElementById(id);

async function getActiveTwitchTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.twitch.tv/')) return null;
  return tab;
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('enabled').checked = Boolean(settings.enabled);
  $('twitchChannel').value = settings.twitchChannel || '';

  const activeTab = await getActiveTwitchTab();
  if (activeTab && !$('twitchChannel').value) {
    const currentChannel = new URL(activeTab.url).pathname.split('/').filter(Boolean)[0]?.split('?')[0] || '';
    if (currentChannel) $('twitchChannel').value = currentChannel;
  }

  $('status').textContent = settings.enabled ? 'Ready to detect ads' : 'Detection disabled';
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    enabled: $('enabled').checked,
    twitchChannel: $('twitchChannel').value.trim()
  });
  $('status').textContent = 'Saved';
});

$('enabled').addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: $('enabled').checked });
  $('status').textContent = $('enabled').checked ? 'Ready to detect ads' : 'Detection disabled';
});

$('twitchChannel').addEventListener('change', async () => {
  await chrome.storage.local.set({
    twitchChannel: $('twitchChannel').value.trim()
  });
});

$('simulateStart').addEventListener('click', async () => {
  const activeTab = await getActiveTwitchTab();
  if (!activeTab) {
    $('status').textContent = 'Open a Twitch stream first';
    return;
  }

  const response = await chrome.tabs.sendMessage(activeTab.id, {
    type: 'simulate-ad'
  }).catch(() => null);

  if (response?.ok) {
    $('status').textContent = '12-second test started';
  } else {
    $('status').textContent = 'Reload the Twitch tab and try again';
  }
});

load().catch(() => {
  $('status').textContent = 'Unable to load settings';
});