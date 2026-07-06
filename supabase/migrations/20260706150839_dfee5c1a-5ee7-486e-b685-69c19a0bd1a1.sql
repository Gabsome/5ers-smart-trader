CREATE TABLE public.amy_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.amy_threads TO authenticated;
GRANT ALL ON public.amy_threads TO service_role;
ALTER TABLE public.amy_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own Amy threads" ON public.amy_threads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_amy_threads_updated_at BEFORE UPDATE ON public.amy_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.amy_messages ADD COLUMN thread_id UUID REFERENCES public.amy_threads ON DELETE CASCADE;
CREATE INDEX idx_amy_messages_thread ON public.amy_messages(thread_id, created_at);