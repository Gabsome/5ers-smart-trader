ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS profit_target_usd numeric NOT NULL DEFAULT 200;