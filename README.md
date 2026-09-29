# StreamSwitch

StreamSwitch is a browser extension prototype that keeps Twitch as the primary viewing experience and temporarily switches to a creator's YouTube live video when Twitch enters an ad break.

## v0.3.0

Version 0.3 replaces fragile YouTube channel-name discovery with an exact user-supplied YouTube video URL and fixes backup-tab creation races.

### What changed

- **Exact YouTube backup URL:** paste the live video's YouTube watch link (or a YouTube `/live/<id>` link). StreamSwitch opens that exact video instead of guessing a channel URL.
- **No channel-page fallback:** StreamSwitch no longer constructs `https://youtube.com/@name/live` and never intentionally sends the viewer to the creator's ordinary channel page.
- **Duplicate-tab fix:** backup preparation is serialized per Twitch tab, preventing concurrent Twitch events from creating multiple YouTube tabs.
- **Manual-close protection:** if the backup tab is manually closed while the extension is switched over, StreamSwitch will not recreate it repeatedly during that same ad. Use **Prepare backup** to explicitly reopen it.
- **Persistent state:** the Twitch → backup tab association remains stored in extension storage.
- **Test mode remains:** **Simulate ad** and **Return to Twitch** exercise the same switching/return logic used by real ad events.

## Setup

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository directory.
4. Open the Twitch stream you want to watch.
5. Open StreamSwitch. The Twitch channel is detected from the current Twitch tab when possible.
6. Paste the **current YouTube live video URL** into the backup field.
7. Click **Save**, then **Prepare backup**.
8. Once the popup says **Backup ready**, click **Simulate ad**.
9. The YouTube tab should become active. Reopen the extension popup and click **Return to Twitch**.

## Real ad detection

The detector observes Twitch's HLS `.m3u8` player traffic for the useful `stitched` / `MIDROLL` ad-state markers identified from the reference blocker supplied for this project. StreamSwitch does not strip or rewrite ad segments.

## Limitations of v0.3

- The backup URL is an exact video URL. When a creator starts a new live broadcast with a different video ID, the saved URL must be updated.
- Browser autoplay policy can affect whether the prepared YouTube player starts with sound.
- Twitch can change its player implementation or HLS markers, so the detector remains isolated for replacement.