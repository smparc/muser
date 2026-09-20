# Muse room audio

Room audio is opt-in on each visit. Click **Enable room audio** to hear new Muse replies automatically, one at a time. Existing history is silent. Muting, changing rooms, signing out, losing the room connection, or hiding the tab stops playback. Volume is adjustable. The speaking Muse is highlighted and its gestures follow playback duration (not phoneme-level lip sync).

## Server setup

Add this secret to the ignored `worker/.dev.vars` file for local development:

```dotenv
ELEVENLABS_API_KEY=your_key_here
```

Use a key with Text to Speech access and Voices read access. Do not put it in public files, browser code, Git, or chat. Restart the local server after changing secrets.

For the deployed Worker, enter the key at the secure Wrangler prompt:

```powershell
node node_modules/wrangler/bin/wrangler.js secret put ELEVENLABS_API_KEY --config worker/wrangler.jsonc
```

Apply the normal D1 migrations, including `0016_room_audio.sql`, before running the updated app. Deployment still requires the project's real D1 binding and Cloudflare login.

Optional server settings:

- `ELEVENLABS_VOICE_IDS`: comma-separated voice IDs from your account. Include at least one per room member. Otherwise the server discovers stock voices using the Voices API. Assignments persist per owner and room; voice availability must be maintained.
- `ELEVENLABS_MODEL_ID`: defaults to `eleven_multilingual_v2`.
- `ELEVENLABS_DAILY_CHARACTER_LIMIT`: defaults to 10000 across the app per UTC day. Set to 0 to disable new synthesis. This is an application character cap, not a dollar budget or account-wide ElevenLabs limit.

## Cost and access controls

Only authenticated, onboarded room members can request audio. The server loads the existing reply itself; clients cannot supply arbitrary text or voice IDs. Only reply text is sent to ElevenLabs. Each reply is synthesized once and cached in D1 for all listeners. Atomic reservations prevent duplicate concurrent synthesis. Failed attempts count toward the cap and are not automatically regenerated. The usage ledger survives room/reply deletion. At most two fresh requests per room may be in flight; the browser queues at most eight replies and stops on errors. Each reply is limited to 2000 characters and 1 MiB of audio.

Audio is generated on demand when a listener has enabled it; the conversation engine does not generate extra messages for speech. Cached audio is removed when its reply or room is deleted. A browser cancel cannot undo synthesis already accepted by the provider.

Provider references: [Text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [Voice discovery](https://elevenlabs.io/docs/api-reference/voices/search).
