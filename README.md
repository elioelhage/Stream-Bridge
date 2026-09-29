# StreamSwitch

StreamSwitch is a browser extension prototype that keeps Twitch as the primary viewing experience and temporarily switches to a creator's YouTube live stream when Twitch enters an ad break.

## v0.1.0

The first version focuses on the core loop:

1. Watch a configured Twitch channel normally.
2. Observe Twitch's HLS .m3u8 playlists for the same ad-state signals used by established Twitch player tooling (stitched / MIDROLL).
3. When an ad is detected, activate the configured YouTube live tab.
4. When the ad signal clears, return focus to the Twitch tab.
5. Optionally close the backup tab after returning.

The extension does **not** strip ad segments, rewrite playlists, reload the Twitch player, or otherwise interfere with the Twitch stream. The reference blocker supplied for this project was used only to identify the useful detection mechanism.

## Setup

Load the repository as an unpacked extension in Chrome/Chromium:

1. Open chrome://extensions.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository directory.
4. Open a Twitch channel.
5. Open StreamSwitch and enter the Twitch channel and the creator's YouTube channel URL (for example https://www.youtube.com/@example).
6. Save, then choose **Prepare backup** to warm the YouTube tab.

## Limitations of v0.1

- Only one Twitch → YouTube mapping is supported at a time.
- The YouTube channel must have a public /live page that resolves to the desired broadcast.
- YouTube autoplay behavior depends on the browser's autoplay policy and whether the backup tab has already been interacted with.
- Twitch can change its player implementation or HLS markers, so the detector is intentionally isolated for easy replacement.
- The detector is based on player/network signals; it is not an official Twitch viewer ad-status API.

## Next logical work

The next iteration should improve backup-stream readiness, support multiple channel mappings, keep Twitch chat visible during YouTube fallback, and add stronger handling for worker implementations and stream synchronization.
