const DEFAULTS = {
  enabled: true,
  twitchChannel: '',
  youtubeVideoUrl: '',
  closeBackupAfterReturn: false
};

const $ = (id) => document.getElementById(id);

function getActiveTwitchTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id || !tab.url?.startsWith('https://www.twitch.tv/')) return null;
    return tab;
  });
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('enabled').checked = Boolean(settings.enabled);
  $('twitchChannel').value = settings.twitchChannel || '';
  $('youtubeVideoUrl').value = settings.youtubeVideoUrl || '';
  $('closeBackupAfterReturn').checked = Boolean(settings.closeBackupAfterReturn);

  const activeTab = await getActiveTwitchTab();
  if (activeTab && !$('twitchChannel').value) {
    const currentChannel = new URL(activeTab.url).pathname.split('/').filter(Boolean)[0]?.split('?')[0] || '';
    if (currentChannel) $('twitchChannel').value = currentChannel;
  }

  $('status').textContent = settings.enabled ? 'Ready' : 'Disabled';
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    enabled: $('enabled').checked,
    twitchChannel: $('twitchChannel').value.trim(),
    youtubeVideoUrl: $('youtubeVideoUrl').value.trim(),
    closeBackupAfterReturn: $('closeBackupAfterReturn').checked
  });
  $('status').textContent = 'Saved';
});

$('enabled').addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: $('enabled').checked });
  $('status').textContent = $('enabled').checked ? 'Ready' : 'Disabled';
});

$('prepare').addEventListener('click', async () => {
  const activeTab = await getActiveTwitchTab();
  if (!activeTab) {
    $('status').textContent = 'Open the Twitch stream first';
    return;
  }

  await chrome.storage.local.set({
    twitchChannel: $('twitchChannel').value.trim(),
    youtubeVideoUrl: $('youtubeVideoUrl').value.trim()
  });

  const result = await chrome.runtime.sendMessage({
    type: 'prepare-backup',
    twitchTabId: activeTab.id
  });
  if (result?.ok) {
    $('status').textContent = 'Backup ready';
  } else if (result?.reason === 'invalid-youtube-video-url') {
    $('status').textContent = 'Enter a YouTube video link';
  } else {
    $('status').textContent = 'Could not prepare backup';
  }
});

$('simulateStart').addEventListener('click', async () => {
  const activeTab = await getActiveTwitchTab();
  if (!activeTab) {
    $('testState').textContent = 'Open Twitch first';
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: 'simulate-ad',
    twitchTabId: activeTab.id
  });
  $('testState').textContent = result?.ok ? 'Simulated ad active' : `Test failed: ${result?.reason || 'unknown'}`;
  $('status').textContent = result?.ok ? 'Testing backup switch…' : 'Backup not ready — use Prepare backup first';
});

$('simulateEnd').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'end-simulated-ad' });
  $('testState').textContent = result?.ok ? 'Returned to Twitch' : 'Nothing to return from';
  $('status').textContent = result?.ok ? 'Test complete' : 'No simulated switch active';
});

load().catch(() => {
  $('status').textContent = 'Unable to load settings';
});