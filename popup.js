const DEFAULTS = {
  enabled: true,
  twitchChannel: '',
  youtubeChannel: '',
  closeBackupAfterReturn: false
};

const $ = (id) => document.getElementById(id);
let activeTab = null;

function deriveYoutubeDefault(twitchChannel) {
  const value = String(twitchChannel || '').trim().replace(/^@/, '');
  return value ? `@${value}` : '';
}

async function getActiveTwitchTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.twitch.tv/')) return null;
  return tab;
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('enabled').checked = Boolean(settings.enabled);
  $('twitchChannel').value = settings.twitchChannel || '';
  $('youtubeChannel').value = settings.youtubeChannel || '';
  $('closeBackupAfterReturn').checked = Boolean(settings.closeBackupAfterReturn);

  activeTab = await getActiveTwitchTab();
  if (activeTab) {
    const currentChannel = new URL(activeTab.url).pathname.split('/').filter(Boolean)[0]?.split('?')[0] || '';
    if (currentChannel && !$('twitchChannel').value) {
      $('twitchChannel').value = currentChannel;
    }
  }

  if (!$('youtubeChannel').value && $('twitchChannel').value) {
    $('youtubeChannel').value = deriveYoutubeDefault($('twitchChannel').value);
  }

  $('status').textContent = settings.enabled ? 'Ready' : 'Disabled';
}

$('twitchChannel').addEventListener('input', () => {
  if (!$('youtubeChannel').dataset.userEdited) {
    $('youtubeChannel').value = deriveYoutubeDefault($('twitchChannel').value);
  }
});

$('youtubeChannel').addEventListener('input', () => {
  $('youtubeChannel').dataset.userEdited = 'true';
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    enabled: $('enabled').checked,
    twitchChannel: $('twitchChannel').value.trim(),
    youtubeChannel: $('youtubeChannel').value.trim(),
    closeBackupAfterReturn: $('closeBackupAfterReturn').checked
  });
  $('status').textContent = 'Saved';
});

$('enabled').addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: $('enabled').checked });
  $('status').textContent = $('enabled').checked ? 'Ready' : 'Disabled';
});

$('prepare').addEventListener('click', async () => {
  activeTab = await getActiveTwitchTab();
  if (!activeTab) {
    $('status').textContent = 'Open the Twitch stream first';
    return;
  }

  await chrome.storage.local.set({
    twitchChannel: $('twitchChannel').value.trim(),
    youtubeChannel: $('youtubeChannel').value.trim()
  });

  const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'ping-streamswitch' }).catch(() => null);
  if (!response) {
    $('status').textContent = 'Reload the Twitch tab, then try again';
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 'prepare-backup' });
  if (result?.ok) {
    $('status').textContent = 'Backup ready';
  } else if (result?.url) {
    $('status').textContent = 'No live YouTube stream found';
  } else {
    $('status').textContent = 'Could not prepare backup';
  }
});

$('simulateStart').addEventListener('click', async () => {
  activeTab = await getActiveTwitchTab();
  if (!activeTab) {
    $('testState').textContent = 'Open Twitch first';
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 'simulate-ad' });
  $('testState').textContent = result?.ok
    ? 'Simulated ad active'
    : `Test failed: ${result?.reason || 'unknown'}`;
  $('status').textContent = result?.ok
    ? 'Testing backup switch…'
    : 'Backup not ready — use Prepare backup first';
});

$('simulateEnd').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'end-simulated-ad' });
  $('testState').textContent = result?.ok ? 'Returned to Twitch' : 'Nothing to return from';
  $('status').textContent = result?.ok ? 'Test complete' : 'No simulated switch active';
});

load().catch(() => {
  $('status').textContent = 'Unable to load settings';
});
