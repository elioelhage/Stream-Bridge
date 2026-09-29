# Stream Bridge

Stream Bridge detects Twitch ad breaks and temporarily opens a configured YouTube video in a separate browser tab.

## v1.1.0

### Backup video
- The backup can now be **any YouTube video**, not only a live stream.
- Regular videos resume from the exact position reached during the Twitch ad.
- Live content is detected from YouTube's player metadata and is returned to the live edge instead of restoring a playback timestamp.

### Switching
- Twitch is muted before the YouTube tab is opened.
- When the ad ends, the YouTube tab closes and Twitch becomes active again.
- Twitch's original mute state is explicitly restored, fixing cases where Twitch stayed muted after the ad.
- The old **Simulate ad** test has been removed.

### Popup
- Simplified v1.1 settings UI.
- Clear Twitch source / YouTube backup sections.
- Version number is shown in the header and footer.
- Added a Stream Bridge extension icon.
