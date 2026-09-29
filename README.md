# Stream Bridge

Stream Bridge detects Twitch ad breaks and temporarily opens a configured YouTube live stream in a separate browser tab.

## v0.6.0

This version uses the v0.4 interface as the baseline and changes only the behavior needed for the new ad-switch flow.

### Behavior

- The active Twitch streamer is detected automatically when the popup is opened.
- The user pastes the actual YouTube live-video URL.
- When Twitch enters an ad, Stream Bridge opens that YouTube video in a separate tab and switches to it.
- The original Twitch tab remains open.
- When Twitch reports that the ad has ended, Stream Bridge closes the temporary YouTube tab and activates the original Twitch tab again.
- The test button uses the same switching path and treats the test ad as exactly 12 seconds long.
- There is no backup preparation step and no enable/disable toggle.
- The test button remains a simple temporary control and is not part of the product's final UI.

### Test

1. Reload the extension from `chrome://extensions/`.
2. Open the Twitch livestream.
3. Open Stream Bridge. The Twitch streamer field should already show the current channel.
4. Paste the actual YouTube live-stream video URL and click **Save**.
5. Click **Simulate ad**.
6. The YouTube video should open in a separate tab.
7. After 12 seconds, the YouTube tab should close and the Twitch tab should become active again.

### Detection

The detector observes Twitch HLS `.m3u8` player traffic for the useful `stitched` / `MIDROLL` markers identified from the supplied reference extension. Stream Bridge does not remove or rewrite ad segments.

### Current limitation

The YouTube URL identifies a specific live broadcast. When the creator starts a new broadcast with a different video URL, the saved link needs to be updated.