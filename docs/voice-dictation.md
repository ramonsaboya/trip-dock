# Voice dictation

The initial **Describe your trip** composer and the AI follow-up composer both have a **Speak** control. Dictation is input only: it does not submit a message, create a trip, or speak an AI response.

## Interaction

- Click **Speak**, allow microphone access when prompted, and start talking once **Listening…** appears. Dictation appends to the end of the existing text, regardless of the cursor position.
- Words appear progressively in the textarea. Interim words can be revised or removed by the browser. Completed segments are not appended twice when later results arrive.
- Click **Stop dictation** to request the final result. Submission stays disabled while starting, listening, and finishing. Then edit the text and explicitly click the existing draft/update button.
- Typing, pasting, or starting an input-method composition stops dictation immediately and preserves the visible text plus the edit. Click **Speak** again to append more. This avoids racing speech corrections against manual edits.
- Switching away from the tab, leaving the page, opening a dialog over the home composer, or unmounting the composer stops recognition. There is no automatic restart after a pause or error.
- The existing limits remain 5,000 characters for the initial prompt and 1,500 for a follow-up. Reaching the limit stops dictation. If the browser ends or errors before finalizing, the last visible hypothesis remains editable and should be reviewed.

## Approach, configuration, and privacy

The client uses the browser's Web Speech API, selecting `SpeechRecognition` or `webkitSpeechRecognition` at runtime, with `continuous` and `interimResults` enabled. Each session combines a fixed copy of the existing text with the complete current recognition result list. A fresh recognition instance per session and guarded callbacks prevent stale events from overwriting edits or another session. Explicit stop waits up to two seconds for finalization; startup has a 15-second timeout, after which the user can retry.

No package, backend endpoint, provider account, key, database migration, or environment variable is needed for dictation. Recognition uses `navigator.language`, falling back to `en-GB`; the speech service determines which languages actually work. TripDock does not download language packs or require experimental on-device recognition.

The browser may send microphone audio to its own speech service; offline recognition is not promised. The composer discloses this before starting. TripDock does not receive or store audio. Recognized text stays in component memory until the user explicitly sends the normal AI draft request, which uses the existing server-only OpenAI configuration. Draft persistence still requires explicit trip creation. No transcription logging or telemetry is added.

This implementation follows the [Web Speech API specification](https://webaudio.github.io/web-speech-api/), [MDN result-list semantics](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results), and [stop/abort lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

## Browser availability

Serve the app on HTTPS or localhost. In insecure contexts or when neither constructor exists, **Speak** is disabled and a typing fallback is explained. Constructor availability does not prove that a browser's speech service, system permissions, language, or network will work.

Documentation checked on 10 September 2026:

| Browser family | Documented API availability; actual audio verification still required |
| --- | --- |
| Chrome desktop / Android | Standard constructor in newer versions (139+); prefixed recognition in older versions (33+). Browser speech service/network required in common configurations. |
| Safari macOS / iOS | Prefixed recognition since Safari 14.1 and corresponding iOS support. WebKit documents that Siri must be enabled. |
| Edge / other Chromium browsers | MDN mirrors much of Chromium's API support, but service availability can differ. Detect at runtime and handle service/network denial; not certified by this change. |
| Firefox | Recognition is still preference-gated in the current compatibility data. Normal installations should use typing; TripDock does not ask users to enable experimental flags. |
| Embedded browsers / webviews | Not guaranteed. An exposed constructor can still fail to capture audio or reach a service. |

Sources: [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json), [WebKit's Safari speech-recognition announcement](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/). These are upstream availability statements, not a claim of device testing.

## Isolated verification preview

From this feature worktree, install the locked dependencies and run:

```sh
pnpm install --frozen-lockfile
pnpm dev:voice-preview
```

Open [http://127.0.0.1:3201](http://127.0.0.1:3201). The dedicated Vite test entry renders the real TripDock components with simulated speech and intercepted draft requests. It never requests microphone access, connects to a database, or calls an AI provider. Its strict port binding fails rather than displacing an existing server. Ctrl+C stops only this preview. The harness is under `apps/web/tests/voice-preview`, outside production entry points; it does not load application environment files.

The preview's links select normal progressive speech, permission denial, network failure, unsupported API, or a 390px iframe viewport. In speech mode, **Speak** progressively emits a Japan phrase; **Stop** adds the final punctuation. An explicit **Build a trip draft** opens a simulated dates clarification so the follow-up composer can also be exercised. Other application mutations are deliberately rejected. The banner counts simulated requests and aborts.

## Checks and remaining manual verification

Verification on 10 September 2026 used Node 24.21.0 and pnpm 11.19.0 on Windows. `pnpm check` passed: 79 web tests, 72 API tests, lint, typechecking, and both production builds. The optional real-PostgreSQL test was skipped as designed. The Sites web build also passed. The test-only harness strings were absent from production output.

In-app browser checks used the real composers with simulated recognition under React Strict Mode: typed prefixes, progressive text, edit-to-stop, repeated sessions, finalization with submission disabled, explicit submission into a follow-up, follow-up dictation, dialog-close abort, permission-denial recovery, unsupported typing fallback, and the 390px mobile listening layout. The preview's draft counter confirmed that speech alone did not call the draft operation. These are simulated UI checks, not real microphone or speech-provider verification.

`pnpm check` is the repository gate. `pnpm --filter @tripdock/web test` includes deterministic recognition lifecycle tests for result corrections/removal, repeated sessions, typed prefixes, stale callbacks, errors, timeouts, limits, and disposal. These use simulated recognition events and do not measure real audio accuracy or latency.

For a real microphone smoke, run the ordinary app with its own API/database and server-only AI configuration as described in the README. Use separate ports, `WEB_ORIGIN`, `NEXT_PUBLIC_GRAPHQL_URL`, and a dedicated `DATABASE_URL` if other previews are running. Before submitting anything, test a supported browser with: typed prefix → Speak → allow mic → dictate and pause → Stop → edit → second session. Check permission denial, tab switching, dialog close, and microphone indicator cleanup. Sending to AI is optional for verifying speech input and uses the existing provider configuration.

Real microphone capture, recognition-service connectivity, speech quality, language coverage, Safari/iOS behavior, and device-specific stop timing have not been verified in this automated environment. No live OpenAI call or real-PostgreSQL smoke is required for this client-only change.
