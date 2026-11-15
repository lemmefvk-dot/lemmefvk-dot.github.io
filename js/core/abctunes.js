/* ============================================================
   abctunes.js — tunes to start from in Sheet Music.

   Every one is a traditional or composed-before-1900 melody that is in the
   public domain, and every one was typed out here as ABC notation, by hand,
   for this app: none is copied from a book, a site or a recording. Where
   there are many versions of a folk tune this is one plain version of the
   melody, with no harmony. `year` is the earliest date the tune is known from.
   ============================================================ */

export const TUNES = [
  {
    id: 'ode', name: 'Ode to Joy', by: 'Ludwig van Beethoven', year: 1824,
    abc: `X:1
T:Ode to Joy
C:Ludwig van Beethoven, 1824
M:4/4
L:1/4
Q:1/4=108
K:C
E E F G | G F E D | C C D E | E3/2 D/ D2 |
E E F G | G F E D | C C D E | D3/2 C/ C2 |
D D E C | D E/F/ E C | D E/F/ E D | C D G,2 |
E E F G | G F E D | C C D E | D3/2 C/ C2 |]
`,
  },
  {
    id: 'twinkle', name: 'Twinkle, Twinkle, Little Star', by: 'a French folk tune', year: 1761,
    abc: `X:2
T:Twinkle, Twinkle, Little Star
C:French folk tune, 1761
M:4/4
L:1/4
Q:1/4=100
K:C
C C G G | A A G2 | F F E E | D D C2 |
G G F F | E E D2 | G G F F | E E D2 |
C C G G | A A G2 | F F E E | D D C2 |]
`,
  },
  {
    id: 'jacques', name: 'Frère Jacques', by: 'a French round', year: 1780,
    abc: `X:3
T:Frère Jacques
C:French round, about 1780
M:4/4
L:1/4
Q:1/4=112
K:C
C D E C | C D E C | E F G2 | E F G2 |
G/A/G/F/ E C | G/A/G/F/ E C | C G, C2 | C G, C2 |]
`,
  },
  {
    id: 'susanna', name: 'Oh! Susanna (the verse)', by: 'Stephen Foster', year: 1848,
    abc: `X:4
T:Oh! Susanna (the verse)
C:Stephen Foster, 1848
M:2/4
L:1/8
Q:1/4=120
K:C
C D E G | G2 A G | E2 C D | E2 E D | C D E G | G2 A G | E2 C D | E D C2 |]
`,
  },
  {
    id: 'auldlangsyne', name: 'Auld Lang Syne', by: 'a Scottish song', year: 1788,
    abc: `X:5
T:Auld Lang Syne
C:Scottish song, 1788
M:4/4
L:1/4
Q:1/4=88
K:G
D | G3/2 G/ G B | A3/2 G/ A B | G3/2 A/ B B | d3 B |
d3/2 B/ B G | A3/2 G/ A B | G3/2 E/ E D | G3 |]
`,
  },
  {
    id: 'greensleeves', name: 'Greensleeves (a simple version)', by: 'an English ballad', year: 1580,
    abc: `X:6
T:Greensleeves (a simple version)
C:English ballad, 1580
M:6/8
L:1/8
Q:3/8=84
K:Am
A | c2 d e2 f | e2 d B2 G | A2 B c2 A | A2 ^G A2 B | ^G2 E E2 A |
c2 d e2 f | e2 d B2 G | A2 B c B A | ^G2 F G2 A | A3- A2 |]
`,
  },
  {
    id: 'scale', name: 'A scale to try (with repeats)', by: 'written for this app', year: 2026,
    abc: `X:7
T:A scale to try
M:4/4
L:1/8
Q:1/4=120
K:G
|: G A B c d e f g | a g f e d c B A |1 G8 :|2 G4 z4 |]
`,
  },
];

export default TUNES;
