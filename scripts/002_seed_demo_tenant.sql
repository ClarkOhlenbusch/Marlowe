-- Seed a demo tenant for testing
INSERT INTO tenants (slug, name)
VALUES ('demo', 'Demo Agency')
ON CONFLICT (slug) DO NOTHING;
