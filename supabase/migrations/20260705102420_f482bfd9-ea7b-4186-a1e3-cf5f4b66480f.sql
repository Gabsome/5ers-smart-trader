ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS amy_personality text NOT NULL DEFAULT 'fun',
  ADD COLUMN IF NOT EXISTS amy_humor_level integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS amy_context_trades boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS amy_style_notes text;