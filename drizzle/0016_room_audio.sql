CREATE TABLE room_voices (
 room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 owner_id text NOT NULL,
 voice_id text NOT NULL,
 PRIMARY KEY(room_id,owner_id),
 UNIQUE(room_id,voice_id)
);
--> statement-breakpoint
CREATE TABLE reply_audio (
 response_id text PRIMARY KEY NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
 room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 voice_id text NOT NULL,
 characters integer NOT NULL,
 status text NOT NULL,
 audio blob,
 created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX reply_audio_budget ON reply_audio(created_at);
--> statement-breakpoint
CREATE INDEX reply_audio_room ON reply_audio(room_id,status,created_at);
--> statement-breakpoint
CREATE TABLE audio_usage (day integer PRIMARY KEY NOT NULL, characters integer NOT NULL);

--> statement-breakpoint
CREATE UNIQUE INDEX room_voices_room_voice ON room_voices(room_id,voice_id);
