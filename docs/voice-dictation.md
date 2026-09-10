# Voice dictation

Both **Describe your trip** and the draft follow-up composer use OpenAI **`gpt-live-transcribe`**, configured with **`delay: "minimal"`**, the model's lowest-delay setting. Dictation only fills the editable text box; it never submits or creates a trip automatically. Production does not fall back to Chrome's speech recognition.

## Run the real app in Chrome

From this worktree:

```powershell
pnpm dev:voice
```

Open **http://localhost:3202 in Chrome**. The footer under each composer should say **GPT Live Transcribe · fastest mode**. Click **Speak**, allow microphone access, and wait for **Listening…** before talking. Words appear while you speak. Click **Stop dictation**, review or edit the text, then click the normal draft/update button. You can explicitly create a persisted trip after reviewing its draft.

The launcher runs the normal web app (3202), API (4202), and dedicated PostgreSQL database (55436), using the separate `tripdock-voice_voice_data` Docker volume. It starts Docker if needed and runs migrations. Existing databases and app servers are preserved. If a port is occupied by your previous run, stop that run with Ctrl+C before restarting; the launcher never kills unrelated applications. Keep the terminal open. Ctrl+C stops its app servers and preserves the database. `docker compose -f compose.voice.yaml stop` stops only this database and retains data.

The ignored root `.env` needs the existing server-only `OPENAI_API_KEY`. `OPENAI_MODEL` still selects the separate trip-drafting model; it does not change the fixed dictation model. The prepared local configuration uses this worktree's dedicated ports and existing TripDock AI access. Never expose the durable key in browser code or commit `.env`.

## Latency and context

- Microphone permission/setup and the session-credential request run concurrently. Audio is muted until the connection is ready and the UI shows Listening.
- Audio streams directly from the browser to OpenAI through WebRTC. TripDock's API only issues a short-lived session credential; it does not relay the audio.
- Each transcription delta is displayed immediately. There is no debounce, pause detection, extra formatting-model call, or automatic submit between the service and the text box.
- Stop closes the microphone immediately, allows 150 ms for audio in transit, and commits the turn. A final transcript can replace the interim text; the composer waits at most five seconds for it. This bound does not delay live words.
- The model receives a travel-planning prompt, the current text, and (for follow-ups) the original trip request, capped to the last 2,000 context characters. These hints help with ambiguous travel terms while explicitly allowing spoken corrections. The browser's base language supplies a language hint.
- The lowest-delay setting can trade accuracy for speed. Exact formatting such as “fifth of September” → “5th September” is not guaranteed. No date rewriting is added in this version; review before submitting. Context hints cannot guarantee recognition accuracy.

The published rate checked on 10 September 2026 is **$0.017 per audio minute** (about **$1.02 for 60 audio minutes**), separate from trip-drafting charges. Network, region, microphone quality and service load affect observed latency; no universal millisecond guarantee is implied. Sources: [model and price](https://developers.openai.com/api/docs/models/gpt-live-transcribe), [live transcription and delay settings](https://developers.openai.com/api/docs/guides/realtime-transcription), [WebRTC connection](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime).

## Editing, lifecycle and privacy

Dictation appends to the current text, regardless of cursor position. Typing, pasting or starting an input-method composition stops the session and preserves the edit. Tab hiding, page exit, composer unmount and opening a dialog over the home composer also stop it. Late results from a cancelled session cannot overwrite edits. Submission remains disabled during starting, listening and finishing. There is no automatic restart.

The existing text limits remain 5,000 characters initially and 1,500 for follow-ups. Reaching the limit stops dictation. Startup times out after 15 seconds; active sessions have a five-minute cap. Interrupted sessions retain their last visible text for review. Speak can start another session.

The UI discloses that audio is sent to OpenAI. Context is sent when you click Speak. TripDock does not store or log microphone audio or transcription events. Recognized text stays in component memory until you explicitly submit the ordinary AI draft request; persisting a trip still requires explicit creation. Provider processing follows your OpenAI API account's terms and settings.

The local API validates the configured web Origin, bounds context, limits session creation to 12 attempts/minute and two concurrent requests, times out upstream requests, and returns a credential with a 60-second connection window. Durable keys and raw provider errors never reach the browser. This endpoint inherits the app's local-only scope; these controls are not user authentication for a public deployment.

Use HTTPS or localhost with microphone and WebRTC support. Unsupported browsers retain typing. Permission denial, missing microphones, connection failures and model/account access errors produce actionable messages. Browser availability does not imply that every device/network has been tested.

## Verification

`pnpm check` passes the web/API tests, lint, typechecking and both production builds. The additional tests cover immediate deltas, final replacement, cancellation during permission, stale callbacks, microphone cleanup, provider failures, exact session settings, origin/input validation and bounded credential requests. The optional PostgreSQL integration test remains opt-in. The Sites production-build check also passes.

A real OpenAI WebRTC smoke on 10 September 2026 used locally generated speech through the production adapter and session handler, without recording a microphone. It received live words before Stop, finalized successfully, and closed its audio track: approximately 2.8 seconds to connect and 0.6 seconds from speech start to first words in one run. The phrase included Tokyo, the fifth of September, and Kyoto. These are individual observations, not an accuracy benchmark or a promise of user-device latency. Real microphone quality and device-specific behavior still require the Chrome trial above.

`pnpm dev:voice-preview` remains a separate simulated UI harness at http://127.0.0.1:3201. It aliases the live adapter only inside its test entry and never requests a microphone, credential, provider response or database. Use `dev:voice` for actual speech and persisted trips.
