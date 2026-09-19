-- Session rows outlive their cookie, and guest play creates one per visitor.
-- Run from the scheduled `prune-sessions` job; there is no TTL sweep in the app.
DELETE FROM "Session" WHERE "expire" < NOW();
