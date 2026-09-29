# Stream Bridge

Stream Bridge detects Twitch ad breaks and temporarily opens a configured YouTube live stream in a separate browser tab.

## v0.8.0

Version 0.8 focuses on making **real Twitch ad detection** more resilient. The v0.7 switching behavior remains in place.

### Detection

Stream Bridge now combines multiple real-world signals:

- Twitch player Worker HLS inspection.
- Main-page HLS inspection.
- Structured Twitch ad metadata including `twitch-stitched-ad`, `stitched-ad-*`, `MIDROLL`, and `X-TV-TWITCH-AD-ROLL-TYPE`.
- Visible Twitch ad UI/countdown elements such as `video-ad-countdown`, `video-ad-label`, `ad-countdown`, and `ad-banner-default-text`.

The detector does not modify or strip the Twitch ad. It only observes the player/page state and reports when an ad starts or ends.

### Behavior

- The active Twitch streamer is detected automatically when the popup is opened.
- The user pastes the actual YouTube live-video URL.
- When Twitch enters an ad, Stream Bridge opens that YouTube video in a separate tab and switches to it.
- The original Twitch tab remains open and is muted while YouTube is active.
- When the ad ends, Stream Bridge closes the temporary YouTube tab, returns to Twitch, and restores the Twitch tab's previous mute state.
- The test button uses the same switching path and treats the test ad as exactly 12 seconds long.
- There is no backup preparation step and no enable/disable toggle.

### Test

1. Reload the extension from `chrome://extensions/`.
2. Open a Twitch livestream.
3. Open Stream Bridge. The Twitch streamer field should already show the current channel.
4. Paste the actual YouTube live-stream video URL and click **Save**.
5. Click **Simulate ad**.
6. The YouTube video should open in a separate tab.
7. After 12 seconds, the YouTube tab should close and the Twitch tab should become active again.

### Current limitation

Twitch changes its player implementation regularly. The detector is therefore deliberately built with several independent signals so that a change in one mechanism does not necessarily break detection.