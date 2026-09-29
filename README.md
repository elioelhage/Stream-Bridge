# Stream Bridge

Stream Bridge is a browser extension prototype focused on reliable Twitch ad detection and an immediate on-page alert.

## v0.5.0

This version deliberately puts the YouTube backup system on hold. The current goal is to prove that Stream Bridge can detect an ad and immediately surface a clean visual signal inside Twitch.

### Current behavior

- Detects Twitch ad-state signals through the existing HLS/player observation mechanism.
- Shows an instant Stream Bridge alert overlay on the Twitch page when an ad is detected.
- Test mode uses the same in-page alert path and keeps the simulated alert visible for **12 seconds**.
- There is no automatic YouTube tab creation, preparation, or switching in v0.5.
- The popup is redesigned as a compact dark interface with Stream Bridge branding, status information, and an inline bridge icon.

### Test procedure

1. Reload the extension from `chrome://extensions/`.
2. Open a Twitch livestream.
3. Open Stream Bridge and make sure detection is enabled.
4. Click **Simulate ad**.
5. A Stream Bridge alert should appear immediately in the Twitch page and remain visible for 12 seconds.
6. The alert disappears automatically; there is no return button.

### Architecture

The background service-worker/backup-tab path is intentionally removed from the active extension architecture for this milestone. The Twitch content script receives real detector events directly and displays the alert immediately.

### Next stage

Once detection is proven reliable, the YouTube backup system can be reintroduced separately, without mixing it into the ad-detection debugging work.
