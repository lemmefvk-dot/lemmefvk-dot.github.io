/* ============================================================
   quotes.data.js — the quote of the day (widget in shell/widgets.js).

   Every line is by a named author whose work is in the public domain
   (published before 1931, so free to quote in full), written in English
   by that author — no translations, which can carry their own copyright.
   Each has the real author and the work it comes from. Nothing here is
   "attributed to" someone on hearsay: lines that are only popularly
   credited to a famous person (and cannot be found in their writing) are
   left out on purpose. Add one only if you can name the page it is on.

   [text, author, work]
   ============================================================ */
export const QUOTES = [
  ['No man is an island, entire of itself.', 'John Donne', 'Devotions upon Emergent Occasions, 1624'],
  ['All that glisters is not gold.', 'William Shakespeare', 'The Merchant of Venice'],
  ['There is nothing either good or bad, but thinking makes it so.', 'William Shakespeare', 'Hamlet'],
  ['Better three hours too soon than a minute too late.', 'William Shakespeare', 'The Merry Wives of Windsor'],
  ['The best way out is always through.', 'Robert Frost', 'A Servant to Servants, 1914'],
  ['The woods are lovely, dark and deep, but I have promises to keep.', 'Robert Frost', 'Stopping by Woods on a Snowy Evening, 1923'],
  ['The only way to have a friend is to be one.', 'Ralph Waldo Emerson', 'Friendship, 1841'],
  ['Nothing great was ever achieved without enthusiasm.', 'Ralph Waldo Emerson', 'Circles, 1841'],
  ['Hitch your wagon to a star.', 'Ralph Waldo Emerson', 'Society and Solitude, 1870'],
  ['“Hope” is the thing with feathers that perches in the soul.', 'Emily Dickinson', 'Poems'],
  ['Courage is resistance to fear, mastery of fear — not absence of fear.', 'Mark Twain', 'Pudd’nhead Wilson, 1894'],
  ['Rise like lions after slumber in unvanquishable number.', 'Percy Bysshe Shelley', 'The Masque of Anarchy'],
  ['’Tis better to have loved and lost than never to have loved at all.', 'Alfred, Lord Tennyson', 'In Memoriam A.H.H., 1850'],
  ['The pen is mightier than the sword.', 'Edward Bulwer-Lytton', 'Richelieu, 1839'],
  ['If I have seen further, it is by standing on the shoulders of giants.', 'Isaac Newton', 'Letter to Robert Hooke, 1675'],
  ['A house divided against itself cannot stand.', 'Abraham Lincoln', 'Speech at Springfield, 1858'],
  ['Well done is better than well said.', 'Benjamin Franklin', 'Poor Richard’s Almanack, 1737'],
  ['The question is not what you look at, but what you see.', 'Henry David Thoreau', 'Journal, 1851'],
  ['No one is useless in this world who lightens the burden of it for anyone else.', 'Charles Dickens', 'Our Mutual Friend, 1865'],
  ['Why, sometimes I’ve believed as many as six impossible things before breakfast.', 'Lewis Carroll', 'Through the Looking-Glass, 1871'],
  ['There is no charm equal to tenderness of heart.', 'Jane Austen', 'Emma, 1815'],
  ['I am not afraid of storms, for I am learning how to sail my ship.', 'Louisa May Alcott', 'Little Women, 1868'],
  ['We are all in the gutter, but some of us are looking at the stars.', 'Oscar Wilde', 'Lady Windermere’s Fan, 1892'],
  ['I am large, I contain multitudes.', 'Walt Whitman', 'Song of Myself'],
  ['To err is human; to forgive, divine.', 'Alexander Pope', 'An Essay on Criticism, 1711'],
  ['Nothing will ever be attempted, if all possible objections must be first overcome.', 'Samuel Johnson', 'Rasselas, 1759'],
  ['In this world nothing can be said to be certain, except death and taxes.', 'Benjamin Franklin', 'Letter to Jean-Baptiste Le Roy, 1789'],
];

/** The day's quote: the same all day on this computer, a new one at midnight. */
export function quoteOfDay(d = new Date()) {
  const n = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const i = ((d.getFullYear() * 7 + n) % QUOTES.length + QUOTES.length) % QUOTES.length;
  const [text, author, work] = QUOTES[i];
  return { text, author, work };
}
