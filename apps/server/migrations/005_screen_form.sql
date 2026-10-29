-- What kind of screen opened each TV room (tv-app / tv / desktop / tablet / phone), so the operator can tell
-- real TVs from phones that tapped "This is the TV". Coarse class only, no user agent stored.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tv_form TEXT;
