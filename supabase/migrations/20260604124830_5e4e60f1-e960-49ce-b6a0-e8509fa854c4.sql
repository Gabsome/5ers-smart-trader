CREATE TABLE public.amy_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.amy_messages TO authenticated;
GRANT ALL ON public.amy_messages TO service_role;

ALTER TABLE public.amy_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own Amy messages"
ON public.amy_messages FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_amy_messages_user_created ON public.amy_messages (user_id, created_at);