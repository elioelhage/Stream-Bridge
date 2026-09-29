# Stream Bridge

Stream Bridge detects Twitch ad breaks and temporarily opens a configured YouTube live stream in a separate browser tab.

## v0.8.0

Version 0.8 keeps the v0.7 switching behavior and strengthens **real Twitch ad detection**.

### Detection

Stream Bridge now combines several independent signals:

- Twitch player Worker HLS inspection.
- Main-page HLS inspection.
- Twitch ad metadata including `twitch-stitched-ad`, `stitched-ad-*`, `MIDROLL`, and `X-TV-TWITCH-AD-ROLL-TYPE`.
- Visible Twitch ad/countdown elements such as `video-ad-countdown`, `video-ad-label`, `ad-countdown`, and `ad-banner-default-text`.
- A resource-timing fallback for HLS playlists visible to the page.

The detector does not strip or rewrite the Twitch stream. It only reports ad start/end state to the existing Stream Bridge switching controller.

### Behavior

- The active Twitch streamer is detected automatically when the popup is opened.
- The user pastes the actual YouTube live-video URL.
- When Twitch enters an ad, Stream Bridge opens that YouTube video in a separate tab and switches to it.
- The original Twitch tab remains open and is muted while YouTube is active.
- When the ad ends, Stream Bridge closes the temporary YouTube tab, returns to Twitch, and restores the Twitch tab's previous mute state.
- The test button uses the same switching path and treats the test ad as exactly 12 seconds long.

### Test

1. Reload the extension from `chrome://extensions/`.
2. Open a Twitch livestream.
3. Open Stream Bridge and paste the actual YouTube live-stream URL, then click **Save**.
4. Click **Simulate ad** to verify the existing switching path.
5. Leave the extension running during a real Twitch ad to verify the live detector.

### Current limitation

Twitch changes its player implementation regularly. The detector is deliberately built with several independent signals so that a change in one mechanism does not necessarily break detection.