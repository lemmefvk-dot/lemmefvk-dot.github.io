/* ============================================================
   arcade/hangman-words.js — Hangman's word lists, written for
   StaticOS. Plain lower-case a–z words, 5–11 letters, no
   spaces or hyphens. Every list has at least 40 words.
   ============================================================ */
export const CATEGORIES = {
  animals: {
    name: 'Animals', hue: 28,
    words: ['elephant', 'giraffe', 'penguin', 'dolphin', 'kangaroo', 'crocodile', 'butterfly', 'hedgehog', 'squirrel', 'octopus', 'flamingo', 'chameleon',
      'platypus', 'woodpecker', 'jellyfish', 'porcupine', 'seahorse', 'cheetah', 'gorilla', 'peacock', 'hamster', 'badger', 'beaver', 'lobster',
      'ostrich', 'panther', 'reindeer', 'scorpion', 'tortoise', 'walrus', 'antelope', 'buffalo', 'caterpillar', 'dragonfly', 'falcon', 'grasshopper',
      'hippopotamus', 'iguana', 'leopard', 'mongoose', 'narwhal', 'orangutan', 'pelican', 'raccoon', 'salamander', 'tarantula', 'vulture', 'wombat'],
  },
  food: {
    name: 'Food', hue: 12,
    words: ['sandwich', 'spaghetti', 'pancake', 'broccoli', 'avocado', 'blueberry', 'cinnamon', 'dumpling', 'hamburger', 'lemonade', 'macaroni', 'noodles',
      'omelette', 'pineapple', 'popcorn', 'pretzel', 'raspberry', 'strawberry', 'tortilla', 'watermelon', 'yoghurt', 'zucchini', 'cucumber', 'chocolate',
      'cupcake', 'doughnut', 'eggplant', 'gingerbread', 'honeycomb', 'jambalaya', 'lasagna', 'marshmallow', 'nachos', 'oatmeal', 'peanut', 'quesadilla',
      'radish', 'sausage', 'tangerine', 'vanilla', 'waffle', 'artichoke', 'burrito', 'cauliflower', 'granola', 'mushroom', 'pumpkin', 'cranberry'],
  },
  space: {
    name: 'Space', hue: 262,
    words: ['galaxy', 'planet', 'asteroid', 'astronaut', 'comet', 'eclipse', 'gravity', 'meteor', 'nebula', 'orbit', 'rocket', 'satellite',
      'telescope', 'universe', 'saturn', 'neptune', 'mercury', 'jupiter', 'constellation', 'cosmos', 'crater', 'launchpad', 'lunar', 'milkyway',
      'moonlight', 'payload', 'quasar', 'shuttle', 'spacesuit', 'sunspot', 'supernova', 'weightless', 'zenith', 'aurora', 'blackhole', 'capsule',
      'countdown', 'equinox', 'hubble', 'ignition', 'lander', 'observatory', 'pulsar', 'solstice', 'stardust', 'thruster', 'voyager', 'zodiac'],
  },
  sports: {
    name: 'Sports & games', hue: 140,
    words: ['football', 'basketball', 'baseball', 'volleyball', 'badminton', 'swimming', 'gymnastics', 'skateboard', 'snowboard', 'archery', 'bowling', 'cricket',
      'cycling', 'fencing', 'goalkeeper', 'handball', 'hockey', 'jogging', 'karate', 'marathon', 'netball', 'olympics', 'paddle', 'referee',
      'rowing', 'skiing', 'soccer', 'surfing', 'tennis', 'trampoline', 'umpire', 'wrestling', 'chessboard', 'checkers', 'dominoes', 'jigsaw',
      'scoreboard', 'stadium', 'trophy', 'whistle', 'champion', 'defender', 'dribble', 'penalty', 'sprinter', 'tournament', 'workout', 'yachting'],
  },
  places: {
    name: 'Around the world', hue: 200,
    words: ['australia', 'brazil', 'canada', 'denmark', 'ecuador', 'finland', 'germany', 'hungary', 'iceland', 'jamaica', 'kenya', 'lebanon',
      'morocco', 'norway', 'portugal', 'singapore', 'thailand', 'uruguay', 'vietnam', 'zambia', 'amazon', 'sahara', 'himalaya', 'pacific',
      'atlantic', 'volcano', 'glacier', 'savanna', 'tundra', 'canyon', 'archipelago', 'peninsula', 'harbour', 'lighthouse', 'monastery', 'pyramid',
      'rainforest', 'waterfall', 'desert', 'island', 'capital', 'continent', 'equator', 'horizon', 'compass', 'passport', 'suitcase', 'travelling'],
  },
  science: {
    name: 'Science', hue: 180,
    words: ['atom', 'molecule', 'electron', 'neutron', 'proton', 'chemistry', 'biology', 'physics', 'experiment', 'laboratory', 'microscope', 'magnet',
      'battery', 'circuit', 'density', 'friction', 'velocity', 'momentum', 'pressure', 'energy', 'fossil', 'habitat', 'ecosystem', 'organism',
      'bacteria', 'chlorophyll', 'evolution', 'genetics', 'nucleus', 'photosynthesis', 'skeleton', 'vitamin', 'acid', 'carbon', 'oxygen', 'hydrogen',
      'nitrogen', 'mineral', 'crystal', 'thermometer', 'hypothesis', 'variable', 'catalyst', 'reaction', 'solution', 'spectrum', 'telescope', 'vaccine'],
  },
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);
for (const c of Object.values(CATEGORIES)) c.words = [...new Set(c.words)].filter(w => /^[a-z]{4,12}$/.test(w));
