# Stream Bridge

Stream Bridge detects Twitch ad breaks and temporarily opens a configured YouTube live stream in a separate browser tab.

## v0.9.0

Version 0.9 is a stability fix for the Twitch player regression introduced in v0.8.

### Stability

- Restores the previously stable `Worker` proxy architecture.
- Removes the v0.8 Worker subclass replacement.
- Removes the active resource-polling HLS fallback that could interfere with Twitch playback.
- Keeps HLS inspection observational: Stream Bridge does not rewrite HLS responses or modify the Twitch video player.

### Detection

The detector still recognizes multiple Twitch ad signals, including `twitch-stitched-ad`, `stitched-ad-*`, `MIDROLL`, Twitch ad metadata, and visible Twitch ad/countdown elements.

### Switching

The existing behavior remains unchanged: on a detected ad, Stream Bridge opens the configured YouTube live stream in a separate tab, mutes Twitch, and switches to YouTube. When the ad ends, the temporary tab closes, Twitch becomes active again, and its previous mute state is restored.

The **Simulate ad** test remains 12 seconds.

### Important

Because the detector touches Twitch's Worker construction path, the extension should be reloaded from `chrome://extensions/` after installing v0.9.