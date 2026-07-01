-- VRC6 seed data (M1 expansion). Apply with:
--   npx wrangler d1 execute vrc6-db --local  --file ./seed.sql
--   npx wrangler d1 execute vrc6-db --remote --file ./seed.sql
-- Idempotent-ish: clears the seeded tables first.
--
-- Note: "Locales" is intentionally left with no published articles — it renders
-- the empty-state ("coming soon") and is the target of the E2E empty-state test.

DELETE FROM articles;
DELETE FROM categories;
DELETE FROM user WHERE id = 'seed-admin';

-- Seed author for article attribution (real login users are created via better-auth).
INSERT INTO user (id, name, email, email_verified, role, status, created_at, updated_at)
VALUES ('seed-admin', 'VRC6 Editorial', 'admin@vrc6.com', 1, 'admin', 'active', unixepoch(), unixepoch());

-- Categories (8 from the data model; browse slug + display label).
INSERT INTO categories (type, slug, label) VALUES
  ('art',        'art',        'Art'),
  ('locales',    'locales',    'Locales'),
  ('artists',    'artists',    'Artists'),
  ('events',     'events',     'Events'),
  ('interviews', 'interviews', 'Interviews'),
  ('opinions',   'opinions',   'Opinions'),
  ('games',      'games',      'Games'),
  ('photography','photography','Photography');

-- Published articles, staggered over the last ~2 weeks (newest = home "featured").
INSERT INTO articles (title, excerpt, body, author_id, category_id, status, slug, published_at)
VALUES
  (
    'Against the Algorithm',
    'Why the feed became the enemy of taste, and how to take it back.',
    '{"type":"doc","content":[{"type":"paragraph","text":"The feed promised us everything and delivered a slot machine. Somewhere between infinite scroll and the algorithmic shrug, curiosity got optimized into compliance."},{"type":"paragraph","text":"This piece is a small manifesto for choosing on purpose: subscriptions over suggestions, archives over feeds, and the slow joy of finding something nobody told you to like."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'opinions'),
    'published', 'against-the-algorithm', (unixepoch() - 0 * 86400) * 1000
  ),
  (
    'The Digital Underground: Exploring Virtual Subcultures',
    'Deep dive into the emerging online communities that are redefining identity and connection in the digital age.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Beneath the surface of the mainstream net, smaller worlds keep their own time. They have their own slang, their own heroes, and their own ideas about what a good life online looks like."},{"type":"paragraph","text":"We spent a month lurking, listening, and occasionally posting. What we found was less a trend and more a quiet rebellion against being legible to everyone at once."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'opinions'),
    'published', 'digital-underground-virtual-subcultures', (unixepoch() - 1 * 86400) * 1000
  ),
  (
    'Austin After Dark: The Spring Warehouse Series',
    'Six weekends, twelve venues, one map worth keeping.',
    '{"type":"doc","content":[{"type":"paragraph","text":"As the days warm up, the east-side warehouses light up. This spring brings a rotating series of all-ages shows, pop-up galleries, and the kind of sets that do not make it onto any official lineup."},{"type":"paragraph","text":"Here is our running guide to where to be, who is playing, and how to get home when the trains stop."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'events'),
    'published', 'austin-after-dark', (unixepoch() - 2 * 86400) * 1000
  ),
  (
    'Cyberspace Nomads',
    'Living between servers and screens — a look at the creators who call the network home.',
    '{"type":"doc","content":[{"type":"paragraph","text":"They move between Discords the way an earlier generation moved between cities. Home is a handle, a shared doc, a voice channel that never quite closes."},{"type":"paragraph","text":"We talked to three of them about belonging, burnout, and what it means to build a life in places that can vanish overnight."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'interviews'),
    'published', 'cyberspace-nomads', (unixepoch() - 3 * 86400) * 1000
  ),
  (
    'Night Film: Shooting Neon on 35mm',
    'Pushing film three stops to chase the city glow.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Digital sensors love the dark a little too much. Film fights back, and in that struggle you get grain, halation, and color that feels remembered rather than recorded."},{"type":"paragraph","text":"A practical field guide to stocks, pushing, and metering for the after-hours photographer."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'photography'),
    'published', 'night-film-neon-35mm', (unixepoch() - 4 * 86400) * 1000
  ),
  (
    'Voices from the Warehouse',
    'A late-night talk with the organizers keeping DIY spaces alive.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Every scene runs on a handful of people who answer the messages, sweep the floors, and eat the losses. We sat down with two of them after a long load-out."},{"type":"paragraph","text":"The conversation turned to rent, safety, and why they keep doing it anyway."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'interviews'),
    'published', 'voices-from-the-warehouse', (unixepoch() - 5 * 86400) * 1000
  ),
  (
    'Profile: The Pixel Painter of Bushwick',
    'Meet the artist turning dead CRTs into living canvases.',
    '{"type":"doc","content":[{"type":"paragraph","text":"In a studio stacked with salvaged televisions, every screen is a brush. The work flickers, drifts, and refuses to sit still for a photograph."},{"type":"paragraph","text":"We talked process, e-waste, and why the most modern medium might be the most obsolete one."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'artists'),
    'published', 'pixel-painter-of-bushwick', (unixepoch() - 6 * 86400) * 1000
  ),
  (
    'Neon Nights Guide',
    'Underground venues you need to know — the after-dark map of the city.',
    '{"type":"doc","content":[{"type":"paragraph","text":"The best rooms do not advertise. They pass by word of mouth, by a flyer taped to the right pole, by a friend who knows the door person."},{"type":"paragraph","text":"Consider this your starter map: the spaces, the nights, and the unspoken rules that keep them good."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'events'),
    'published', 'neon-nights-guide', (unixepoch() - 7 * 86400) * 1000
  ),
  (
    'Glitch as Medium',
    'How corrupted files became a fine-art movement.',
    '{"type":"doc","content":[{"type":"paragraph","text":"What starts as an error becomes an aesthetic. Datamoshing, bent circuits, and broken codecs all share a belief that the machine is most honest when it fails."},{"type":"paragraph","text":"A short history of glitch, from net-art curiosity to gallery wall."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'art'),
    'published', 'glitch-as-medium', (unixepoch() - 8 * 86400) * 1000
  ),
  (
    'Indie Spotlight: Moonlit',
    'A two-person love letter to 8-bit melancholy.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Moonlit is small, slow, and quietly devastating. Two developers spent four years on a game you can finish in three hours and think about for weeks."},{"type":"paragraph","text":"We played it twice and then called them to ask how they did it."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'games'),
    'published', 'indie-spotlight-moonlit', (unixepoch() - 9 * 86400) * 1000
  ),
  (
    'Encrypted Dreams',
    'Privacy in the age of surveillance, and the tools the underground actually uses.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Threat models are personal. The activist, the artist, and the insomniac scroller all want different things from the same handful of apps."},{"type":"paragraph","text":"A grounded look at what privacy means when everything is watching, and what is actually worth your effort."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'art'),
    'published', 'encrypted-dreams', (unixepoch() - 10 * 86400) * 1000
  ),
  (
    'Sound and Vision: A Studio Visit',
    'Inside the home studio of a self-taught chiptune composer.',
    '{"type":"doc","content":[{"type":"paragraph","text":"One bedroom, two trackers, and a stack of Game Boys wired into a mixer. The setup is humble; the catalog is enormous."},{"type":"paragraph","text":"A visit, a teardown of the rig, and a conversation about making maximal music with minimal tools."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'artists'),
    'published', 'sound-and-vision', (unixepoch() - 11 * 86400) * 1000
  ),
  (
    'The Lost Art of the Demoscene',
    'Kilobytes, cracktros, and the coders who made magic in 64k.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Long before the app store, a global underground competed to do the impossible in tiny files. A whole demo, with music and 3D, in less space than a single emoji today."},{"type":"paragraph","text":"We trace the scene from cracked floppies to modern 4k intros, and meet the people keeping it alive."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'games'),
    'published', 'lost-art-of-the-demoscene', (unixepoch() - 12 * 86400) * 1000
  ),
  (
    'Portraits of the In-Between',
    'A photo essay on the hours nobody documents.',
    '{"type":"doc","content":[{"type":"paragraph","text":"Not the party and not the morning after, but the strange tender stretch in between. Empty trains, closing diners, friends too tired to perform."},{"type":"paragraph","text":"A series shot over a year of late nights, with notes on each frame."}]}',
    'seed-admin',
    (SELECT id FROM categories WHERE slug = 'photography'),
    'published', 'portraits-of-the-in-between', (unixepoch() - 13 * 86400) * 1000
  );
