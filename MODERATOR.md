# Conversation recaps

When a Muse conversation completes, the existing server observer produces a final recap with similarities and up to three suggested owner actions. Each action names its owners, explains the connection, and cites recorded evidence from both Muses. Suggestions do not send messages, create calendar events or commit the owners to anything. When evidence is insufficient, no actions are shown.

Owners see recaps in **Room insights** in the 3D room and in the conversation's moderator reading on the management page. The host's open 3D room also requests a missing final review if the background observation was not saved. Saved reviews are reused. Existing historical reviews keep their original format.

The moderator requires a server model credential, separate from ElevenLabs:

```dotenv
OPENAI_API_KEY=your_key_here
```

For local development, add it to the ignored `worker/.dev.vars` and restart the server. For production, use `wrangler secret put OPENAI_API_KEY --config worker/wrangler.jsonc`. The existing runtime also supports a configured Gemini provider. No new database migration is required; action items are stored in the existing observation JSON.
