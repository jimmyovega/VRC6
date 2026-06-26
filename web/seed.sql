-- VRC6 seed data (M0). Apply with:
--   npx wrangler d1 execute vrc6-db --local  --file ./seed.sql
--   npx wrangler d1 execute vrc6-db --remote --file ./seed.sql
-- Idempotent-ish: clears the three seeded tables first.

DELETE FROM articles;
DELETE FROM categories;
DELETE FROM users WHERE username = 'admin';

-- Admin author (auth/password comes in M2; status active so articles can attribute).
INSERT INTO users (username, email, full_name, role, status, activated_at)
VALUES ('admin', 'admin@vrc6.com', 'VRC6 Editorial', 'admin', 'active', unixepoch() * 1000);

-- Categories (the 8 from datamodel.dbml, with browse slug + display label).
INSERT INTO categories (type, slug, label) VALUES
  ('art',        'art',        'Art'),
  ('locales',    'locales',    'Locales'),
  ('artists',    'artists',    'Artists'),
  ('events',     'events',     'Events'),
  ('interviews', 'interviews', 'Interviews'),
  ('opinions',   'opinions',   'Opinions'),
  ('games',      'games',      'Games'),
  ('photoshoots','photoshoots','Photoshoots');

-- Sample published articles.
INSERT INTO articles (title, excerpt, body, author_id, category_id, status, slug, published_at)
VALUES
  (
    'The Digital Underground: Exploring Virtual Subcultures',
    'Deep dive into the emerging online communities that are redefining identity and connection in the digital age.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Placeholder body — replaced by the block editor in M3."}]}',
    (SELECT id FROM users WHERE username = 'admin'),
    (SELECT id FROM categories WHERE slug = 'opinions'),
    'published', 'digital-underground-virtual-subcultures', unixepoch() * 1000
  ),
  (
    'Cyberspace Nomads',
    'Living between servers and screens — a look at the creators who call the network home.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Placeholder body."}]}',
    (SELECT id FROM users WHERE username = 'admin'),
    (SELECT id FROM categories WHERE slug = 'interviews'),
    'published', 'cyberspace-nomads', unixepoch() * 1000
  ),
  (
    'Neon Nights Guide',
    'Underground venues you need to know — the after-dark map of the city.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Placeholder body."}]}',
    (SELECT id FROM users WHERE username = 'admin'),
    (SELECT id FROM categories WHERE slug = 'events'),
    'published', 'neon-nights-guide', unixepoch() * 1000
  ),
  (
    'Encrypted Dreams',
    'Privacy in the age of surveillance, and the tools the underground actually uses.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Placeholder body."}]}',
    (SELECT id FROM users WHERE username = 'admin'),
    (SELECT id FROM categories WHERE slug = 'art'),
    'published', 'encrypted-dreams', unixepoch() * 1000
  );
