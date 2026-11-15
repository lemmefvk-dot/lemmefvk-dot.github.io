/* ============================================================
   codesqldata.js — the sample databases in Static Code's SQL
   playground. Each is an SQL script that builds the tables and fills
   them; the playground runs it into a fresh in-memory SQLite database
   (core/codesql.js), so Reset always gives the same start.

   Written for StaticOS. The shop and the library's members and loans
   are made up. The library's books are real ones, with their real
   authors and first-publication years. The planets' figures are from
   NASA's Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet):
   equatorial diameter, length of day, orbital period, mean temperature
   and mean distance from the Sun.
   ============================================================ */

const SHOP = `CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL      -- in pounds
);
INSERT INTO products (id, name, category, price) VALUES
  (1, 'Apples (bag of 6)', 'Fruit', 1.80),
  (2, 'Bananas (bunch)', 'Fruit', 1.10),
  (3, 'Oranges (bag of 4)', 'Fruit', 2.00),
  (4, 'White bread', 'Bakery', 1.35),
  (5, 'Croissants (4)', 'Bakery', 2.25),
  (6, 'Milk (1 litre)', 'Dairy', 1.15),
  (7, 'Cheddar', 'Dairy', 3.40),
  (8, 'Eggs (12)', 'Dairy', 3.10),
  (9, 'Orange juice', 'Drinks', 1.95),
  (10, 'Sparkling water', 'Drinks', 0.75),
  (11, 'Pasta', 'Cupboard', 0.95),
  (12, 'Rice', 'Cupboard', 1.60),
  (13, 'Tea bags (80)', 'Cupboard', 2.80),
  (14, 'Crisps', 'Snacks', 0.85),
  (15, 'Chocolate bar', 'Snacks', 1.05);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  town TEXT NOT NULL,
  joined TEXT NOT NULL     -- YYYY-MM-DD
);
INSERT INTO customers (id, name, town, joined) VALUES
  (1, 'Ada', 'Riverside', '2025-01-14'),
  (2, 'Ben', 'Hilltop', '2025-02-03'),
  (3, 'Chloe', 'Riverside', '2025-03-22'),
  (4, 'Dev', 'Old Town', '2025-04-09'),
  (5, 'Ellie', 'Hilltop', '2025-05-30'),
  (6, 'Femi', 'Old Town', '2025-07-11'),
  (7, 'Grace', 'Riverside', '2025-08-25'),
  (8, 'Hamza', 'Hilltop', '2025-10-02');

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  ordered_on TEXT NOT NULL
);
INSERT INTO orders (customer_id, product_id, quantity, ordered_on) VALUES
  (1, 1, 2, '2025-09-01'), (1, 6, 1, '2025-09-01'), (1, 13, 1, '2025-09-08'),
  (2, 14, 3, '2025-09-02'), (2, 15, 2, '2025-09-02'), (2, 10, 6, '2025-09-15'),
  (3, 4, 1, '2025-09-03'), (3, 7, 1, '2025-09-03'), (3, 8, 1, '2025-09-17'),
  (4, 11, 2, '2025-09-05'), (4, 12, 1, '2025-09-05'), (4, 9, 2, '2025-09-21'),
  (5, 2, 1, '2025-09-06'), (5, 5, 2, '2025-09-06'),
  (6, 15, 4, '2025-09-10'), (6, 14, 2, '2025-09-10'), (6, 6, 2, '2025-09-24'),
  (7, 3, 1, '2025-09-12'), (7, 1, 1, '2025-09-12'), (7, 13, 2, '2025-09-26'),
  (8, 7, 2, '2025-09-14'), (8, 4, 2, '2025-09-14'), (8, 9, 1, '2025-09-28');
`;

const LIBRARY = `CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  year INTEGER NOT NULL,   -- first published
  genre TEXT NOT NULL,
  copies INTEGER NOT NULL
);
INSERT INTO books (id, title, author, year, genre, copies) VALUES
  (1, 'A Christmas Carol', 'Charles Dickens', 1843, 'Ghost story', 3),
  (2, 'Pride and Prejudice', 'Jane Austen', 1813, 'Romance', 2),
  (3, 'Frankenstein', 'Mary Shelley', 1818, 'Horror', 2),
  (4, 'Alice''s Adventures in Wonderland', 'Lewis Carroll', 1865, 'Fantasy', 4),
  (5, 'Little Women', 'Louisa May Alcott', 1868, 'Family', 2),
  (6, 'Around the World in Eighty Days', 'Jules Verne', 1872, 'Adventure', 3),
  (7, 'Black Beauty', 'Anna Sewell', 1877, 'Animals', 2),
  (8, 'Treasure Island', 'Robert Louis Stevenson', 1883, 'Adventure', 3),
  (9, 'The Jungle Book', 'Rudyard Kipling', 1894, 'Animals', 2),
  (10, 'The Time Machine', 'H. G. Wells', 1895, 'Science fiction', 2),
  (11, 'Dracula', 'Bram Stoker', 1897, 'Horror', 1),
  (12, 'The Hound of the Baskervilles', 'Arthur Conan Doyle', 1902, 'Mystery', 2),
  (13, 'Anne of Green Gables', 'L. M. Montgomery', 1908, 'Family', 2),
  (14, 'The Wind in the Willows', 'Kenneth Grahame', 1908, 'Animals', 3),
  (15, 'The Secret Garden', 'Frances Hodgson Burnett', 1911, 'Family', 2);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  form TEXT NOT NULL       -- class
);
INSERT INTO members (id, name, form) VALUES
  (1, 'Isla', '7A'), (2, 'Jamal', '7B'), (3, 'Keira', '8A'),
  (4, 'Leo', '8B'), (5, 'Maya', '9A'), (6, 'Noah', '9B');

CREATE TABLE loans (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  out_on TEXT NOT NULL,
  back_on TEXT             -- NULL while it is still out
);
INSERT INTO loans (book_id, member_id, out_on, back_on) VALUES
  (8, 1, '2025-09-02', '2025-09-16'), (4, 1, '2025-09-16', NULL),
  (3, 2, '2025-09-03', '2025-09-20'), (11, 2, '2025-09-20', NULL),
  (14, 3, '2025-09-04', '2025-09-11'), (7, 3, '2025-09-11', '2025-09-25'), (9, 3, '2025-09-25', NULL),
  (10, 4, '2025-09-05', NULL),
  (2, 5, '2025-09-06', '2025-09-27'), (12, 5, '2025-09-27', NULL),
  (6, 6, '2025-09-08', '2025-09-22'), (8, 6, '2025-09-22', NULL);
`;

const PLANETS = `CREATE TABLE planets (
  name TEXT PRIMARY KEY,
  from_sun INTEGER NOT NULL,     -- 1 = closest
  kind TEXT NOT NULL,
  diameter_km INTEGER NOT NULL,  -- at the equator
  day_hours REAL NOT NULL,       -- length of one day, sunrise to sunrise
  year_days REAL NOT NULL,       -- one trip round the Sun, in Earth days
  mean_temp_c INTEGER NOT NULL,
  distance_mkm REAL NOT NULL,    -- mean distance from the Sun, millions of km
  rings INTEGER NOT NULL         -- 1 = has rings
);
INSERT INTO planets VALUES
  ('Mercury', 1, 'Rocky', 4879, 4222.6, 88.0, 167, 57.9, 0),
  ('Venus', 2, 'Rocky', 12104, 2802.0, 224.7, 464, 108.2, 0),
  ('Earth', 3, 'Rocky', 12756, 24.0, 365.2, 15, 149.6, 0),
  ('Mars', 4, 'Rocky', 6792, 24.7, 687.0, -65, 227.9, 0),
  ('Jupiter', 5, 'Gas giant', 142984, 9.9, 4331, -110, 778.5, 1),
  ('Saturn', 6, 'Gas giant', 120536, 10.7, 10747, -140, 1432.0, 1),
  ('Uranus', 7, 'Ice giant', 51118, 17.2, 30589, -195, 2867.0, 1),
  ('Neptune', 8, 'Ice giant', 49528, 16.1, 59800, -200, 4515.0, 1);
`;

export const SAMPLES = [
  { id: 'shop', name: 'Corner shop', hint: 'products, customers, orders (made up)', sql: SHOP },
  { id: 'library', name: 'School library', hint: 'books, members, loans', sql: LIBRARY },
  { id: 'planets', name: 'Planets', hint: 'the eight planets, from NASA’s fact sheet', sql: PLANETS },
  { id: 'empty', name: 'Empty', hint: 'no tables: make your own', sql: '' },
];

export const sampleById = id => SAMPLES.find(s => s.id === id) || null;

export default { SAMPLES, sampleById };
