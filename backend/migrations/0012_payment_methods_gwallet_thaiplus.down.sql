-- PostgreSQL cannot drop a value from an enum type. Rolling back would mean rebuilding
-- payment_method and every column that uses it, which is not worth it for two unused labels.
SELECT 1;
