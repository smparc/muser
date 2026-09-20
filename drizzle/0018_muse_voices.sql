-- A voice chosen by the owner for one Muse. Keyed by the Muse's root connection id, so the
-- Muse keeps the same voice in every room it is brought into. No row means "pick one for me",
-- which is the original per-room automatic assignment in room_voices.
-- Deliberately not a foreign key: a Muse's root connection can be removed while links in other
-- rooms remain, and an orphan preference row is harmless.
CREATE TABLE muse_voices (
 muse_id text PRIMARY KEY NOT NULL,
 owner_id text NOT NULL,
 voice_id text NOT NULL,
 updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX muse_voices_owner ON muse_voices(owner_id);
