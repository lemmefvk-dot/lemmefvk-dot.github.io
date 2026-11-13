/* ============================================================
   arcade/wordsearch.data.js — Word Search's themed word lists.

   Every list is written for StaticOS (plain common words, no
   brands, no names). Letters A–Z only. No word is a palindrome, and
   no word hides inside another word of the same list (forwards or
   backwards), so a grid never contains a listed word twice by
   accident. The word-search test checks both.
   ============================================================ */
export const THEMES = [
  { id: 'animals', name: 'Animals', words: 'LION TIGER ZEBRA GIRAFFE ELEPHANT MONKEY PANDA KOALA WOLF FOX BEAR RABBIT HORSE DOLPHIN EAGLE OWL SNAKE TURTLE CAMEL OTTER MOOSE BADGER HAMSTER GORILLA PENGUIN'.split(' ') },
  { id: 'space', name: 'Space', words: 'PLANET STAR MOON COMET ORBIT GALAXY ROCKET SATURN JUPITER MARS VENUS EARTH SOLAR ECLIPSE ASTEROID NEBULA METEOR GRAVITY COSMOS LUNAR SHUTTLE TELESCOPE ALIEN SATELLITE'.split(' ') },
  { id: 'food', name: 'Food', words: 'PIZZA BURGER PASTA SALAD APPLE BANANA CHEESE BREAD COOKIE CARROT NOODLE TACO SUSHI RICE BEANS CEREAL PANCAKE WAFFLE MANGO GRAPE LEMON PEACH POTATO PRETZEL'.split(' ') },
  { id: 'sports', name: 'Sports', words: 'SOCCER TENNIS HOCKEY BASEBALL BASKETBALL GOLF RUGBY SWIMMING CYCLING BOXING ARCHERY SURFING SKIING DIVING JUDO KARATE CRICKET VOLLEYBALL FENCING ROWING SKATING BOWLING RACING CLIMBING'.split(' ') },
  { id: 'halloween', name: 'Halloween', words: 'GHOST WITCH PUMPKIN SKELETON VAMPIRE ZOMBIE SPIDER BAT CANDY COSTUME CAULDRON BROOM MUMMY MONSTER SPOOKY HAUNTED GRAVEYARD COBWEB LANTERN POTION WEREWOLF CREEPY SCARY MASK'.split(' ') },
  { id: 'ocean', name: 'Ocean', words: 'WHALE SHARK CORAL OCTOPUS CRAB SEAL TURTLE JELLYFISH STARFISH LOBSTER SHRIMP REEF TIDE WAVE ANCHOR PEARL SEAWEED DOLPHIN SQUID URCHIN BEACH SAND SHELL KELP'.split(' ') },
  { id: 'school', name: 'School', words: 'PENCIL TEST DESK TEACHER STUDENT ERASER RULER NOTEBOOK BACKPACK LESSON HOMEWORK MARKER CLASSROOM LIBRARY SCIENCE HISTORY MATH PAPER SCISSORS LOCKER RECESS GLUE CHALK BELL'.split(' ') },
  { id: 'weather', name: 'Weather', words: 'RAINY SNOW STORM CLOUD THUNDER LIGHTNING WIND BREEZE FOG HAIL SUNNY FROST TORNADO HURRICANE RAINBOW DRIZZLE SHOWER BLIZZARD HUMID CLIMATE MONSOON FREEZING FLOOD'.split(' ') },
];
export const SIZES = { small: { n: 10, words: 8, name: 'Small' }, medium: { n: 12, words: 12, name: 'Medium' }, large: { n: 14, words: 16, name: 'Large' } };
