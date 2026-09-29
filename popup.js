const DEFAULTS = {
  enabled: true,
  twitchChannel: '',
  youtubeChannel: '',
  closeBackupAfterReturn: false
};

const $ = (id) => document.getElementById(id);

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('enabled').checked = Boolean(settings.enabled);
  $('twitchChannel').value = settings.twitchChannel || '';
  $('youtubeChannel').value = settings.youtubeChannel || '';
  $('closeBackupAfterReturn').checked = Boolean(settings.closeBackupAfterReturn);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('https://www.twitch.tv/')) {
    const channel = new URL(tab.url).pathname.split('/').filter(Boolean)[0];
    if (channel && !$('twitchChannel').value) $('twitchChannel').value = channel.split('?')[0];
  }

  $('status').textContent = settings.enabled ? 'Ready' : 'Disabled';
}

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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await chrome.storage.local.set({
    twitchChannel: $('twitchChannel').value.trim(),
    youtubeChannel: $('youtubeChannel').value.trim()
  });

  const response = await chrome.tabs.sendMessage(tab.id, { type: 'ping-streamswitch' }).catch(() => null);
  if (!response) {
    $('status').textContent = 'Open a Twitch channel first';
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 'prepare-backup' });
  $('status').textContent = result?.ok ? 'Backup prepared' : 'Could not prepare backup';
});

load().catch(() => {
  $('status').textContent = 'Unable to load settings';
});
