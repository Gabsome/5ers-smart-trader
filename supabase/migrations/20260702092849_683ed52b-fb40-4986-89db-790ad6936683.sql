-- Restrict Realtime subscriptions so authenticated users can only receive
-- change events on their own per-user channel topic (e.g. "user:<their uid>").
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users receive only their own realtime topic" ON realtime.messages;
CREATE POLICY "Users receive only their own realtime topic"
ON realtime.messages
FOR SELECT
TO authenticated
USING ( realtime.topic() = 'user:' || auth.uid()::text );

DROP POLICY IF EXISTS "Users broadcast only on their own realtime topic" ON realtime.messages;
CREATE POLICY "Users broadcast only on their own realtime topic"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK ( realtime.topic() = 'user:' || auth.uid()::text );