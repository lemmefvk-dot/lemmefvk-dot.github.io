/* ============================================================
   catalog.js — Static's content, kept apart from the UI so it
   can be edited (or replaced by a proxy API response) without
   touching a single page module.

   GAMES come from the "big bros games" Google Sites export:
   each entry keeps the real embed URL that site used, so the
   in-page stage can actually load the game.

     host  'madkid'  -> https://www.madkidgames.com/full/<slug>
     host  'direct'  -> `embed` is already an absolute URL

   Some hosts send X-Frame-Options / frame-ancestors headers and
   will refuse to render in a frame. Each entry therefore also
   carries `open`, the URL to hand the user when framing fails.
   ============================================================ */

const madkid = slug => `https://www.madkidgames.com/full/${slug}`;
const madkidPage = slug => `https://www.madkidgames.com/game/${slug}`;
/* The host publishes a title card per game. We reference its URL, exactly as
   the old site's links did — nothing is copied into this project, and a card
   that fails to load falls back to the procedural art in providers.artFor(). */
const madkidArt = slug => `https://www.madkidgames.com/games/${slug}/thumb_1.jpg`;

/** title, slug/url, categories, tags, plays, rating */
const G = (title, source, cats, tags, _plays, _rating, note = '') => {
  const direct = /^https?:/.test(source);
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    kind: 'game',
    title,
    studio: direct ? new URL(source).hostname.replace(/^www\./, '') : 'madkidgames.com',
    host: direct ? 'direct' : 'madkid',
    embed: direct ? source : madkid(source),
    open: direct ? source : madkidPage(source),
    art: direct ? null : madkidArt(source),
    /* The play counts and ratings written in the rows below were never
       measured (see B), so they are not shown: 0 means "no stats". */
    cats, tags, plays: 0, rating: 0, note,
    playable: true,
  };
};

/**
 * Bulk rows harvested from the host's own tag pages: real titles, real slugs,
 * real title art. The `plays` and `rating` arguments are placeholder numbers
 * from an earlier build, never measured — so they are dropped here (0 = no
 * stats, and the UI shows none). Put real counts in only when a source
 * actually reports them.
 */
const B = (slug, title, cats, _plays, _rating) => ({
  id: slug, kind: 'game', title, studio: 'madkidgames.com', host: 'madkid',
  embed: madkid(slug), open: madkidPage(slug), art: madkidArt(slug),
  cats, tags: [], plays: 0, rating: 0, note: '', playable: true,
});

export const GAMES = [
  G('Subway Surfers',        'subway-surfers',                      ['action', 'featured'],            ['runner', 'endless'],      1240000, 4.6),
  G('Geometry Dash',         'geometry-dash',                       ['platformer', 'action', 'featured'], ['rhythm', 'hard'],      1180000, 4.8),
  G('Smash Karts',           'https://smashkarts.io',               ['racing', 'io', 'featured'],      ['karts', 'multiplayer'],   1010000, 4.7, 'Favourite'),
  G('Poly Track',            'https://polytrack.com/', ['racing', 'featured'], ['track', '3d'], 940000, 4.7),
  G('Shadow Fight 2',        'shadow-fight-2',                      ['action', 'fighting'],            ['ninja', 'rpg'],            880000, 4.6),
  G('Stick War: Legacy',     'stick-war-legacy',                    ['strategy', 'featured'],          ['army', 'tower'],           850000, 4.7),
  G('Granny',                'granny',                              ['horror'],                        ['escape', 'scary'],         790000, 4.3),
  G('Survivor.io',           'survivor-io',                         ['action', 'io'],                  ['survival', 'swarm'],       760000, 4.5),
  G('Racing Limits',         'racing-limits',                       ['racing'],                        ['traffic', '3d'],           710000, 4.5, 'Kinda good'),
  G('Speed Legends',         'speed-legends-car-driving-simulator',  ['racing'],                        ['open world', 'drift'],     690000, 4.5),
  G('Johnny Trigger',        'johnny-trigger-action-shooter',        ['shooter', 'action'],             ['slow-mo', 'levels'],       650000, 4.4),
  G('Grow Empire: Rome',     'grow-empire-rome',                    ['strategy'],                      ['defence', 'upgrade'],      620000, 4.5),
  G('Stunt Bike Xtreme',     'stunt-bike-extreme',                  ['racing'],                        ['bike', 'stunts'],          580000, 4.4, 'Looks fun'),
  G('Off Brand Rocket League','rocket-car-ball',                     ['sports', 'racing'],              ['cars', 'football'],        560000, 4.3),
  G('Sausage Run',           'run-sausage-run',                     ['action'],                        ['runner', 'silly'],         520000, 4.2),
  G('Stickman World Battle', 'stickman-world-battle',               ['action', 'fighting'],            ['stickman', 'arena'],       490000, 4.2),
  G('Bounce Tales',          'bounce-tales',                        ['platformer', 'retro'],           ['nokia', 'classic'],        460000, 4.5),
  G('Build a Bridge',        'build-a-bridge',                      ['puzzle'],                        ['physics', 'engineering'],  430000, 4.3),
  G('Bottle Flip 3D',        'bottle-flip-3d-tap-and-jump',         ['puzzle'],                        ['casual', 'precision'],     400000, 4.1),
  G('Drag Strip',            'drag-sim-2018',                       ['racing'],                        ['drag', 'tuning'],          370000, 4.2),

  /* ---- the rest of the shelf, harvested from the host's tag pages ---- */
  B("claws-and-feathers-3",                        "Claws and Feathers 3",                    ["puzzle"],                                   881883, 4.1),
  B("cheating-in-school",                          "Cheating In School",                      ["action"],                                   899819, 4.1),
  B("race-max-ultimate-racing-game",               "Race Max Ultimate Racing Game",           ["racing"],                                   891893, 4.9),
  B("extreme-bus-driver-simulator",                "Extreme Bus Driver Simulator",            ["sandbox"],                                  866397, 4.9),
  B("tower-defense-alien-war-td-2",                "Tower Defense Alien War TD 2",            ["strategy"],                                 891026, 4.6),
  B("carage-open-world-simulator-3d",              "CarAge Open World Simulator 3D",          ["adventure", "racing", "sandbox"],           841591, 4.5),
  B("mortician-tycoon-idle-empire",                "Mortician Tycoon - Idle Empire",          ["idle", "sandbox"],                          861613, 4.0),
  B("stick-destruction-2-annihilation",            "Stick Destruction 2 Annihilation",        ["platformer"],                               604352, 4.0),
  B("seashine",                                    "Seashine",                                ["horror"],                                   725240, 4.3),
  B("octopus-robot-car-game-3d",                   "Octopus Robot Car Robot Game 3D",         ["fighting", "racing", "sandbox"],            689846, 4.4),
  B("dark-vs-light-survival-strategy",             "Dark vs Light Survival Strategy",         ["2player", "strategy"],                      714199, 4.2),
  B("tennis-bits",                                 "Tennis Bits",                             ["sports"],                                   587664, 4.8),
  B("epic-runner-soldiers-shooting",               "Epic Runner Soldiers Shooting",           ["shooter"],                                  863870, 4.9),
  B("snake-iii",                                   "Snake III",                               ["retro"],                                    870823, 4.8),
  B("war-of-ships-io",                             "War of Ships IO",                         ["io", "strategy"],                           532870, 4.9),
  B("1010-block-puzzle-game",                      "1010 Block Puzzle Game",                  ["puzzle"],                                   867707, 4.6),
  B("toca-boca-life-office",                       "Toca Boca Life Office",                   ["action"],                                   898089, 4.0),
  B("offroad-jeep-4x4-car-driving-simulator",      "Offroad Jeep 4x4 Car Driving Simulator",  ["racing", "sandbox"],                        884935, 4.1),
  B("taxi-sim-2016",                               "Taxi Sim 2016",                           ["sandbox"],                                  808320, 4.3),
  B("king-of-defense-the-last-defender",           "King of Defense The Last Defender",       ["strategy"],                                 871806, 4.6),
  B("altos-adventure",                             "Altos Adventure",                         ["adventure"],                                829786, 4.9),
  B("outlets-rush-3d-idle-tycoon",                 "Outlets Rush 3D Idle Tycoon",             ["idle", "sandbox"],                          828249, 3.9),
  B("stick-destruction-4-annihilation",            "Stick Destruction 4 Annihilation",        ["platformer"],                               533442, 3.9),
  B("drive-or-die-zombie-apocalypse",              "Drive or Die Zombie Apocalypse",          ["horror", "racing"],                         580767, 3.9),
  B("samurai-ii-vengeance",                        "Samurai II Vengeance",                    ["fighting"],                                 503110, 4.0),
  B("bowmasters-archery-shooting",                 "Bowmasters Archery Shooting",             ["2player", "shooter"],                       481984, 4.1),
  B("golf-orbit-oneshot-golf-games",               "Golf Orbit Oneshot Golf Games",           ["sports"],                                   542206, 4.3),
  B("mad-day-2-shoot-the-aliens",                  "Mad Day 2 Shoot the Aliens",              ["shooter"],                                  390236, 4.2),
  B("octomaze-logic-puzzle-game",                  "Octomaze Logic Puzzle Game",              ["puzzle"],                                   811890, 4.1),
  B("keep-on-mining-worlds",                       "Keep on Mining Worlds",                   ["action"],                                   850708, 4.0),
  B("truck-simulator-17",                          "Truck Simulator 17",                      ["racing", "sandbox"],                        879116, 4.4),
  B("ice-guardian-simulator",                      "Ice Guardian Simulator",                  ["sandbox"],                                  786323, 4.3),
  B("grow-castle-tower-defense",                   "Grow Castle - Tower Defense",             ["strategy"],                                 827873, 4.4),
  B("survival-island-idle-game",                   "Survival Island Idle Game",               ["adventure", "idle", "sandbox"],             712809, 4.0),
  B("idle-miner-tycoon-gold-games",                "Idle Miner Tycoon Gold Games",            ["idle", "sandbox"],                          798717, 4.5),
  B("banana-kong",                                 "Banana Kong",                             ["platformer"],                               400941, 4.2),
  B("evil-mushroom-simulator",                     "Evil Mushroom Simulator",                 ["horror", "sandbox"],                        392420, 4.8),
  B("stickman-revenge-3-ninja-warrior",            "Stickman Revenge 3 Ninja Warrior",        ["fighting"],                                 381482, 4.3),
  B("zombie-rabbits-vs-sheldon",                   "Zombie Rabbits vs Sheldon",               ["2player", "horror"],                        291432, 4.7),
  B("free-kick-football-3d-soccer",                "Free Kick Football 3D Soccer",            ["sports"],                                   491912, 4.4),
  B("hit-expert-3d-shooting-game",                 "Hit Expert 3D Shooting Game",             ["shooter"],                                  316687, 4.6),
  B("lots-of-things-hidden-object",                "Lots of Things Hidden Object",            ["puzzle"],                                   803754, 4.8),
  B("toca-boca-life-hospital",                     "Toca Boca Life Hospital",                 ["action"],                                   819983, 3.9),
  B("euro-truck-driver-2018",                      "Euro Truck Driver 2018",                  ["racing", "sandbox"],                        830746, 4.8),
  B("farm-simulator-evo",                          "Farm Simulator Evo",                      ["sandbox"],                                  784272, 4.5),
  B("kingdom-defense-2-sword-hero",                "Kingdom Defense 2 Sword Hero",            ["strategy"],                                 798027, 4.7),
  B("jurassic-world-simulator",                    "Jurassic World Simulator",                ["adventure", "sandbox"],                     542916, 4.4),
  B("holyday-city-tycoon",                         "Holyday City Tycoon",                     ["idle", "sandbox"],                          679186, 4.8),
  B("stick-puzzle-stickman-clash",                 "Stick Puzzle Stickman Clash",             ["platformer", "puzzle"],                     303245, 4.3),
  B("mr-meat-horror-escape-room",                  "Mr Meat Horror Escape Room",              ["horror"],                                    94732, 4.8),
  B("food-fighter-clicker-games",                  "Food Fighter Clicker Games",              ["fighting", "idle", "sandbox"],              231199, 4.7),
  B("hot-wheels-race-off-multiplayer",             "Hot Wheels Race Off Multiplayer",         ["2player", "racing"],                        232679, 4.6),
  B("gully-cricket-game",                          "Gully Cricket Game",                      ["sports"],                                   269701, 4.5),
  B("squad-shooter",                               "Squad Shooter",                           ["shooter"],                                  261516, 4.2),
  B("brain-on-dot-physics",                        "Brain On Dot Physics",                    ["puzzle"],                                   796887, 4.1),
  B("art-by-numbers-3",                            "Art By Numbers 3",                        ["action"],                                   781767, 4.1),
  B("driving-school-2016",                         "Driving School 2016",                     ["racing", "sandbox"],                        796638, 4.4),
  B("carnivorous-plant-simulator",                 "Carnivorous Plant Simulator",             ["sandbox"],                                  760437, 4.2),
  B("tower-defense-galaxy-legend",                 "Tower Defense Galaxy Legend",             ["strategy"],                                 782943, 4.0),
  B("world-cricket-championship-lte",              "World Cricket Championship Lte",          ["adventure", "sports"],                      441983, 4.9),
  B("idle-guardians-idle-rpg-games",               "Idle Guardians Idle RPG Games",           ["idle", "sandbox"],                          569469, 4.6),
  B("stick-destruction-2-ragdoll",                 "Stick Destruction 2 Ragdoll",             ["platformer"],                               251904, 4.7),
  B("stickman-racer-survival-zombie",              "Stickman Racer Survival Zombie",          ["horror", "racing"],                          84755, 3.9),
  B("street-fighter-ii",                           "Street Fighter II",                       ["fighting"],                                 120001, 4.3),
  B("cat-slide-tiles",                             "Cat Slide Tiles",                         ["puzzle"],                                   793341, 4.5),
  B("ghost-pop",                                   "Ghost Pop",                               ["action"],                                   777392, 4.1),
  B("truck-racing-game-3d",                        "Truck Racing Game 3D",                    ["racing"],                                   787427, 4.7),
  B("bus-simulator-17",                            "Bus Simulator 17",                        ["sandbox"],                                  757003, 4.3),
  B("tower-crush-defense-td",                      "Tower Crush - Defense TD",                ["strategy"],                                 692959, 4.3),
  B("world-cricket-championship-wcc-lite",         "World Cricket Championship WCC Lite",     ["adventure", "sports"],                      407715, 4.6),
  B("fishing-inc",                                 "Fishing Inc",                             ["idle", "sandbox"],                          472873, 4.4),
  B("stick-guys-defense",                          "Stick Guys Defense",                      ["platformer", "strategy"],                   104328, 4.8),
  B("rune-lord-match-3-puzzle-game",               "Rune Lord Match 3 Puzzle Game",           ["puzzle"],                                   787545, 4.7),
  B("toca-boca-life-city",                         "Toca Boca Life City",                     ["action"],                                   762214, 4.7),
  B("bike-race-racing-game",                       "Bike Race Racing Game",                   ["racing"],                                   759737, 4.7),
  B("epic-battle-simulator-2",                     "Epic Battle Simulator 2",                 ["sandbox", "strategy"],                      726596, 4.3),
  B("defense-legend-5-survivor-td",                "Defense Legend 5 Survivor TD",            ["strategy"],                                 635404, 4.5),
  B("dragon-hills",                                "Dragon Hills",                            ["adventure"],                                396509, 4.7),
  B("happy-farm-day-farm-empire-idle-tycoon",      "Happy Farm Day Farm Empire Idle Tycoon",  ["idle", "sandbox"],                          442222, 4.8),
  B("wildlife-match-3-puzzle",                     "Wildlife Match 3 Puzzle",                 ["puzzle"],                                   782036, 4.2),
  B("seven-seas-jewels-2",                         "Seven Seas Jewels 2",                     ["action"],                                   762159, 4.0),
  B("driving-school-2017",                         "Driving School 2017",                     ["racing", "sandbox"],                        745457, 4.4),
  B("ultimate-motorcycle-simulator",               "Ultimate Motorcycle Simulator",           ["sandbox"],                                  656033, 4.7),
  B("game-of-warriors",                            "Game Of Warriors",                        ["strategy"],                                 625214, 4.1),
  B("five-nights-at-freddys",                      "Five Nights at Freddy's",                 ["adventure", "horror"],                      227827, 4.8),
  B("keep-on-mining",                              "Keep On Mining",                          ["idle"],                                     292961, 4.9),
  B("brain-it-on-physics-puzzles",                 "Brain It On! - Physics Puzzles",          ["puzzle"],                                   757324, 4.7),
  B("art-by-numbers-12",                           "Art By Numbers 12",                       ["action"],                                   673739, 4.7),
  B("cafe-racer",                                  "Cafe Racer",                              ["racing"],                                   737701, 4.4),
  B("fantasy-dragon-simulator-animal-survival-game", "Fantasy Dragon Simulator",                ["sandbox"],                                  542544, 4.2),
];

export const GAME_CATEGORIES = [
  { id: 'all',        name: 'All',        icon: 'grid-9' },
  { id: 'featured',   name: 'Featured',   icon: 'sparkles' },
  { id: 'action',     name: 'Action',     icon: 'flame' },
  { id: 'racing',     name: 'Racing',     icon: 'gauge' },
  { id: 'shooter',    name: 'Shooter',    icon: 'zap' },
  { id: 'fighting',   name: 'Fighting',   icon: 'shield' },
  { id: 'strategy',   name: 'Strategy',   icon: 'layers' },
  { id: 'platformer', name: 'Platformer', icon: 'trending-up' },
  { id: 'puzzle',     name: 'Puzzle',     icon: 'grid' },
  { id: 'sports',     name: 'Sports',     icon: 'activity' },
  { id: 'io',         name: '.io',        icon: 'globe' },
  { id: '2player',    name: '2 Player',   icon: 'users' },
  { id: 'adventure',  name: 'Adventure',  icon: 'compass' },
  { id: 'sandbox',    name: 'Simulation', icon: 'box' },
  { id: 'idle',       name: 'Idle',       icon: 'clock' },
  { id: 'horror',     name: 'Horror',     icon: 'moon' },
  { id: 'retro',      name: 'Retro',      icon: 'gamepad' },
];

/* ------------------------------------------------------------------ *
 *  Movies — metadata only. Static hosts nothing; every entry waits on
 *  providers.resolve() to hand back a stream once a proxy is wired up.
 * ------------------------------------------------------------------ */
const M = (title, year, runtime, genres, rating, synopsis, cats) => ({
  id: `${title}-${year}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  kind: 'movie', title, year, runtime, genres, rating, synopsis, cats,
  embed: null, playable: false,
});

export const MOVIES = [
  M('Dune: Part Two', 2024, 166, ['Sci-Fi', 'Adventure'], 8.5, 'Paul Atreides unites with the Fremen to wage war against House Harkonnen.', ['trending', 'movies', 'scifi', 'action']),
  M('Spider-Man: Across the Spider-Verse', 2023, 140, ['Animation', 'Action'], 8.6, 'Miles Morales is catapulted across the multiverse and clashes with a team of Spider-People.', ['trending', 'movies', 'animation', 'action']),
  M('Everything Everywhere All at Once', 2022, 139, ['Sci-Fi', 'Comedy'], 7.8, 'A laundromat owner is swept into saving existence by exploring other universes.', ['movies', 'scifi', 'comedy']),
  M('Interstellar', 2014, 169, ['Sci-Fi', 'Drama'], 8.7, 'Explorers travel through a wormhole in an attempt to ensure humanity’s survival.', ['movies', 'scifi']),
  M('Blade Runner 2049', 2017, 164, ['Sci-Fi', 'Drama'], 8.0, 'A young blade runner uncovers a secret that could tip the balance of what is left of society.', ['movies', 'scifi']),
  M('Mad Max: Fury Road', 2015, 120, ['Action', 'Adventure'], 8.1, 'In a stark desert landscape, two rebels run from a tyrant and his army.', ['movies', 'action']),
  M('The Matrix', 1999, 136, ['Sci-Fi', 'Action'], 8.7, 'A hacker learns the truth about his reality and his role in the war against its controllers.', ['movies', 'scifi', 'action']),
  M('Spirited Away', 2001, 125, ['Animation', 'Fantasy'], 8.6, 'A girl wanders into a world of spirits and must work to free her parents.', ['movies', 'animation', 'anime']),
  M('Akira', 1988, 124, ['Animation', 'Sci-Fi'], 8.0, 'A secret military project turns a biker gang member into a psionic psychopath.', ['movies', 'anime', 'scifi']),
  M('Parasite', 2019, 132, ['Thriller', 'Drama'], 8.5, 'Greed and class discrimination threaten the bond between two families.', ['movies']),
  M('Arrival', 2016, 116, ['Sci-Fi', 'Drama'], 7.9, 'A linguist is recruited to communicate with extraterrestrial visitors.', ['movies', 'scifi']),
  M('Hereditary', 2018, 127, ['Horror', 'Drama'], 7.3, 'A grieving family is haunted by tragic and disturbing occurrences.', ['movies', 'horror']),
  M('The Grand Budapest Hotel', 2014, 99, ['Comedy', 'Drama'], 8.1, 'A concierge and his protégé are caught up in the theft of a priceless painting.', ['movies', 'comedy']),
  M('Whiplash', 2014, 106, ['Drama', 'Music'], 8.5, 'A young drummer enrols at a cut-throat conservatory under a ruthless instructor.', ['movies']),
  M('Arcane', 2021, 44, ['Animation', 'Action'], 9.0, 'Two sisters end up on opposing sides of a war between rival cities.', ['trending', 'series', 'animation']),
  M('Severance', 2022, 50, ['Sci-Fi', 'Thriller'], 8.7, 'Employees undergo a procedure that severs their work and personal memories.', ['trending', 'series', 'scifi']),
  M('Frieren: Beyond Journey’s End', 2023, 24, ['Animation', 'Fantasy'], 8.9, 'An elven mage reckons with mortality long after the demon king has fallen.', ['trending', 'series', 'anime']),
  M('Cyberpunk: Edgerunners', 2022, 25, ['Animation', 'Sci-Fi'], 8.6, 'A street kid tries to survive in a body-modification-obsessed city.', ['series', 'anime', 'scifi']),
  M('The Bear', 2022, 30, ['Comedy', 'Drama'], 8.6, 'A fine-dining chef returns home to run his family’s sandwich shop.', ['series', 'comedy']),
  M('Chernobyl', 2019, 68, ['Drama', 'History'], 9.3, 'The story of the 1986 nuclear accident and the people who responded to it.', ['series']),
  M('Dark', 2017, 60, ['Sci-Fi', 'Mystery'], 8.7, 'Four families search for a missing child and uncover a time-travelling conspiracy.', ['series', 'scifi']),
  M('The Last of Us', 2023, 55, ['Drama', 'Horror'], 8.7, 'A smuggler escorts a teenage girl across a post-pandemic United States.', ['series', 'horror']),
];

export const MOVIE_CATEGORIES = [
  { id: 'all',       name: 'All',       icon: 'grid-9' },
  { id: 'trending',  name: 'Trending',  icon: 'trending-up' },
  { id: 'movies',    name: 'Movies',    icon: 'film' },
  { id: 'series',    name: 'Series',    icon: 'layers' },
  { id: 'action',    name: 'Action',    icon: 'flame' },
  { id: 'scifi',     name: 'Sci-Fi',    icon: 'sparkles' },
  { id: 'animation', name: 'Animation', icon: 'palette' },
  { id: 'anime',     name: 'Anime',     icon: 'star' },
  { id: 'comedy',    name: 'Comedy',    icon: 'message-circle' },
  { id: 'horror',    name: 'Horror',    icon: 'moon' },
];

/* ------------------------------------------------------------------ *
 *  Links carried over from the old site's proxy page. These are just
 *  bookmarks — Static does not proxy anything itself yet. When the
 *  Static proxy exists, point providers.config.endpoint at it instead.
 * ------------------------------------------------------------------ */
export const PROXY_LINKS = [
  { name: 'Blockaway',   url: 'https://blockaway.net',      note: 'Web proxy, no install' },
  { name: 'CroxyProxy',  url: 'https://croxyproxy.com',     note: 'Supports video sites' },
  { name: 'ProxyOrb',    url: 'https://proxyorb.com',       note: 'Lightweight' },
  { name: 'Chelmsford',  url: 'https://chelmsfordrfc.com',  note: 'From the old proxy page' },
];

/** The staff-application copy from the old site, kept as a real page. */
export const POSITIONS = [
  { role: 'Game Finder',   need: 'Find working game sources and check they still load.', open: 3 },
  { role: 'Page Builder',  need: 'Build and lay out new game pages in the Static shell.', open: 2 },
  { role: 'Tester',        need: 'Play everything on school hardware and report what breaks.', open: 4 },
  { role: 'Moderator',     need: 'Keep the Discord tidy and answer questions.', open: 2 },
];

export default { GAMES, GAME_CATEGORIES, MOVIES, MOVIE_CATEGORIES, PROXY_LINKS, POSITIONS };
