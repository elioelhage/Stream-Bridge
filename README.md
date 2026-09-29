# StreamSwitch

StreamSwitch is a browser extension prototype that keeps Twitch as the primary viewing experience and temporarily switches to a creator's YouTube **live stream** when Twitch enters an ad break.

## v0.2.0

Version 0.2 adds deterministic testing and makes YouTube backup discovery simpler.

### What changed

- **Test mode:** `Simulate ad` uses the same background switching path as a real detected ad. `Return to Twitch` ends the simulated ad so the return path can be tested immediately.
- **Automatic YouTube default:** the YouTube handle defaults to the Twitch streamer name. Example: Twitch `xqc` → YouTube `@xqc`.
- **Override supported:** when the creator uses a different YouTube handle, edit the YouTube field and save it.
- **Live-only backup target:** StreamSwitch opens the creator's YouTube `/live` route and only considers the backup ready after YouTube resolves to a likely live-video URL (`/watch...` or `/live/...`). It does not intentionally send you to the creator's ordinary channel page.
- **Persistent backup-tab state:** the backup tab association is stored in extension storage, so the service worker can restore it after being suspended.

### Setup

Load the repository as an unpacked Manifest V3 extension in Chrome/Chromium:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the repository directory.
4. Open the Twitch stream.
5. Open StreamSwitch. The Twitch channel is detected from the current Twitch tab when possible, and the YouTube field defaults to the same name.
6. Save, then click **Prepare backup**.
7. Once the popup says **Backup ready**, use **Simulate ad** to test the switch.
8. After the test switches tabs, reopen the StreamSwitch popup and press **Return to Twitch** to test the return path.

### Real ad detection

The detector observes Twitch's HLS `.m3u8` player traffic for the same useful ad-state markers identified in the reference blocker supplied for this project (`stitched` / `MIDROLL`). The blocker itself is not copied and StreamSwitch does not strip or rewrite ad segments.

### Limitations of v0.2

- The default same-name YouTube lookup assumes the Twitch name is also the creator's YouTube handle. Change the YouTube field when that is not true.
- `/live` is used as the discovery route because it is intended to resolve to the creator's current live broadcast; when there is no current live broadcast, StreamSwitch does not activate a non-live channel page.
- Browser autoplay policy can still affect whether the prepared YouTube player starts with sound.
- Twitch can change its player implementation or HLS markers, so the detector is isolated for replacement.
