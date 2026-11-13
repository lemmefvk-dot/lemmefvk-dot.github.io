/* ============================================================
   tips.data.js — the tips behind "Tip of the day" (js/shell/tips.js).

   Every tip is about something StaticOS really does. Shortcuts are never
   typed out here: a tip asks js/core/keymap.js for the row by its label
   (K = the first keys of that row, KS = all of them, KR = first to last),
   so a rebound or renamed row is followed — and a label that no longer
   exists makes the tip drop itself (tips.js) rather than print a wrong key.

     show   what the "Show me" button does:
              ['app', id, opts]       open that app
              ['settings', section]   open Settings on that pane
              ['bus', event, ...args] emit a shell event (Spotlight with a
                                      query typed, the overview, …)
     proof  [file, text]: a line of the code that makes the tip true. The
            tips-tour suite fetches the file and looks for the text, so a
            tip about a feature that is renamed or removed fails the tests.
   ============================================================ */
import { globalRows, keysText } from '../core/keymap.js';

/* globalRows: the keys as this person has them (Settings › Shortcuts) */
const row = label => {
  const r = globalRows().find(x => x.label === label || x.label.startsWith(label));
  if (!r) throw new Error(`no shortcut row "${label}"`);
  return r;
};
/** the first combination of a row: 'Ctrl+K', '⌘K' */
export const K = label => keysText(row(label).keys.split(' / ')[0]);
/** every combination of a row, joined: 'Ctrl+Left / Ctrl+Right' */
export const KS = label => keysText(row(label).keys);
/** first and last combination: 'Ctrl+Alt+1 to Ctrl+Alt+4' */
export const KR = label => {
  const all = keysText(row(label).keys).split(' / ');
  return `${all[0]} to ${all[all.length - 1]}`;
};

const spot = q => ['bus', 'spotlight:open', q];
const app = (id, opts) => ['app', id, opts];
const set = sec => ['settings', sec];

export const TIPS = [
  /* ---- Spotlight ---- */
  { id: 'spotlight', text: () => `Press ${K('Static Search')} to search apps, files, settings and games from anywhere.`, show: spot(''), proof: ['js/shell/spotlight.js', 'spotlight:open'] },
  { id: 'sp-math', text: () => 'Spotlight does maths. Try “15% of 80” or “2^10”, then press Enter to copy the answer.', show: spot('15% of 80'), proof: ['js/core/answers.js', '15% of 80'] },
  { id: 'sp-units', text: () => 'Convert units right in Spotlight: “5 km to mi” or “72 °F in C”.', show: spot('5 km to mi'), proof: ['js/core/answers.js', '5 km to mi'] },
  { id: 'sp-define', text: () => 'Type “define” and a word in Spotlight for a dictionary entry.', show: spot('define '), proof: ['js/core/answers.js', 'define <word>'] },
  { id: 'sp-time', text: () => 'Ask Spotlight “time in Tokyo” to see the local time in another city.', show: spot('time in Tokyo'), proof: ['js/core/answers.js', 'time in <city>'] },
  { id: 'sp-shot', text: () => 'Spotlight can take a screenshot of this tab: search for “Take Screenshot”.', show: spot('Take Screenshot'), proof: ['js/shell/spotlight.js', 'Take Screenshot'] },
  { id: 'launcher', text: () => `${K('Open the launcher')} opens the launcher from the keyboard, with your pinned apps and recent files.`, show: ['bus', 'launcher:toggle'], proof: ['js/shell/launcher.js', 'launcher:toggle'] },

  /* ---- windows and desktops ---- */
  { id: 'snap-layouts', text: () => `Hover the green button on a window for snap layouts, or press ${K('Snap layouts for the front window')}.`, show: set('shortcuts'), proof: ['js/shell/snaplayouts.js', 'snap-picker'] },
  { id: 'snap-halves', text: () => `${KS('Snap left / right half')} snap the front window to the left or right half of the screen.`, show: set('shortcuts'), proof: ['js/core/wm.js', "case 'left'"] },
  { id: 'snap-quarters', text: () => `Snap a window into a corner with ${KR('Snap to a quarter')}.`, show: set('shortcuts'), proof: ['js/core/wm.js', "'tl'"] },
  { id: 'overview', text: () => `${K('Window overview')} shows every window at once, so you can jump to the one you want.`, show: ['bus', 'overview:toggle'], proof: ['js/shell/overview.js', 'overview:toggle'] },
  { id: 'desk-add', text: () => `Open the overview with ${K('Overview with the desktops')} to add desktops and drag windows between them.`, show: ['bus', 'overview:toggle'], proof: ['js/core/desktops.js', 'MAX'] },
  { id: 'desk-switch', text: () => `Switch desktops with ${KS('Previous / next desktop (when not typing)')}.`, show: set('shortcuts'), proof: ['js/shell/desktops.js', 'desktop:switch'] },
  { id: 'desk-move', text: () => `${KS('Take the front window to the desktop beside')} move the front window to the next desktop.`, show: set('shortcuts'), proof: ['js/shell/desktops.js', 'moveToDesktop'] },
  { id: 'cycle', text: () => `${K('Next window')} switches between windows; add Shift to go back.`, show: set('shortcuts'), proof: ['js/main.js', "KM.matches(e, 'win.cycle')"] },
  { id: 'reopen', text: () => `Closed a window by mistake? ${K('Reopen the last closed window')} brings it back where it was.`, show: set('shortcuts'), proof: ['js/core/reopen.js', 'init'] },
  { id: 'winmenu', text: () => `${K('Window menu: move')} opens a window menu so you can move, size, snap and close a window from the keyboard.`, show: set('accessibility'), proof: ['js/shell/a11y.js', 'function windowMenu'] },
  { id: 'lock', text: () => `Lock the screen with ${K('Lock the screen')} when you step away.`, show: set('shortcuts'), proof: ['js/shell/lockscreen.js', 'power:lock'] },

  /* ---- typing and keys ---- */
  { id: 'emoji', text: () => `Press ${K('Emoji and symbols, while typing')} in any text field to pick an emoji or a symbol.`, show: app('notes'), proof: ['js/shell/emoji.js', 'session.emojiRecent'] },
  { id: 'sheet', text: () => `Hold ${K('Hold it on its own')} on its own for a second to see every shortcut for the app in front.`, show: ['bus', 'shortcuts:show'], proof: ['js/shell/cheatsheet.js', 'shortcuts:show'] },
  { id: 'readaloud', text: () => `Select some text and press ${K('Read the selected text aloud')} to hear it read out.`, show: set('accessibility'), proof: ['js/shell/readaloud.js', 'speech'] },

  /* ---- files and tools ---- */
  { id: 'clipboard', text: () => 'Static Clipboard keeps a history of what you copy and cut. Pin the things you reuse.', show: app('clipboard'), proof: ['js/apps/clipboard.js', 'Pin'] },
  { id: 'zip', text: () => 'In Files, right-click some items and choose Compress to make a .zip. Open a .zip to browse it or Extract it.', show: app('files'), proof: ['js/apps/files.js', "label: 'Compress'"] },
  { id: 'markup', text: () => 'In Files, right-click a picture and choose Mark up to add arrows, boxes, text and blur.', show: app('files'), proof: ['js/apps/files.js', "label: 'Mark up'"] },
  { id: 'quicklook', text: () => 'Select a file in Files and press Space for Quick Look.', show: app('files'), proof: ['js/apps/files.js', 'Quick Look the selected item'] },
  { id: 'downloads', text: () => 'Static Downloads lists everything StaticOS has made or saved, in one place.', show: app('downloads'), proof: ['js/apps/downloads.js', 'defineApp'] },
  { id: 'convert', text: () => 'Static Convert turns length, mass, temperature, data and currency into one another.', show: app('convert'), proof: ['js/apps/convert.js', 'defineApp'] },
  { id: 'color', text: () => 'Static Color checks the contrast of two colours against the real WCAG ratio.', show: app('palette'), proof: ['js/apps/palette.js', 'contrast'] },
  { id: 'qr', text: () => 'Static QR makes QR codes for links, text, Wi-Fi and contacts, drawn on this device.', show: app('qr'), proof: ['js/apps/qr.js', 'Wi-Fi'] },
  { id: 'recorder', text: () => 'Static Recorder records your voice or your screen, and can trim a screen recording.', show: app('recorder'), proof: ['js/apps/recorder.js', 'trim'] },
  { id: 'automations', text: () => 'Static Automations runs simple “when this happens, do that” rules you set up yourself.', show: app('automations'), proof: ['js/core/automations.js', 'init'] },
  { id: 'calendar', text: () => 'Calendar events can repeat weekly and carry a reminder.', show: app('calendar'), proof: ['js/apps/calendar.js', 'reminder'] },
  { id: 'tasks', text: () => 'Static Tasks keeps simple checklists on this device.', show: app('tasks'), proof: ['js/apps/tasks.js', 'defineApp'] },
  { id: 'lens', text: () => 'Lens lets you select part of your screen and ask a question about it.', show: app('lens'), proof: ['js/apps/lens.js', 'defineApp'] },
  { id: 'monitor', text: () => 'System Monitor shows real browser performance, and says plainly what a web page cannot measure.', show: app('monitor'), proof: ['js/apps/monitor.js', 'defineApp'] },

  /* ---- time and attention ---- */
  { id: 'screentime', text: () => 'Settings › Screen Time shows how long you spend in each app. It is measured on this device and never leaves it.', show: set('screentime'), proof: ['js/core/screentime.js', 'init'] },
  { id: 'focus', text: () => 'Clock › Focus runs study sessions with breaks, and keeps time even with the Clock window closed.', show: app('clock', { tab: 'focus' }), proof: ['js/core/focus.js', 'init'] },
  { id: 'dnd', text: () => 'Do Not Disturb silences pop-ups, except homework reminders and the focus timer. Everything still lands in the notification centre for later.', show: set('notifications'), proof: ['js/core/automations.js', 'throughDnd: study'] },
  { id: 'noticentre', text: () => 'The bell in the top bar opens the notification centre, and its Achievements tab shows what you have unlocked.', show: ['bus', 'noti:toggle'], proof: ['js/shell/notifications.js', "tabBtn('ach', 'Achievements')"] },
  { id: 'ambient', text: () => 'Music › Ambient sounds plays rain, a fireplace or noise, with a sleep timer.', show: app('music'), proof: ['js/apps/music.js', 'sleep timer'] },

  /* ---- look and feel ---- */
  { id: 'accent', text: () => 'Pick an accent colour or a whole theme pack under Settings › Themes.', show: set('themes'), proof: ['js/core/themes.js', 'THEMES'] },
  { id: 'wallpaper', text: () => 'Your wallpaper can be a built-in scene, or any video, GIF or image you point it at.', show: set('wallpaper'), proof: ['js/apps/settings.js', 'any video, GIF or image'] },
  { id: 'dockmag', text: () => 'Settings › Dock can make icons swell as the pointer sweeps across, and sets which apps live there.', show: set('dock'), proof: ['js/apps/settings.js', 'Dock magnification'] },
  { id: 'dockorder', text: () => `Drag dock icons to reorder them, or focus one and press ${KS('Move the focused app along the dock')}.`, show: set('dock'), proof: ['js/shell/dock.js', 'order'] },
  { id: 'widgets', text: () => 'The widget rail down the right edge shows the clock, weather and system widgets. Turn it on in Settings › Desktop.', show: set('desktop'), proof: ['js/apps/settings.js', 'Widget rail'] },
  { id: 'screensaver', text: () => 'Settings › Desktop can start a screensaver after you have been away a while: bubbles, stars, an aquarium, 3D pipes or a night sky.', show: set('desktop'), proof: ['js/shell/screensaver.js', 'screensaver'] },
  { id: 'lowgfx', text: () => 'On a slow computer, Settings › Performance has a Low graphics mode that turns off everything costing frames.', show: set('performance'), proof: ['js/apps/settings.js', 'Low graphics mode'] },
  { id: 'motion', text: () => 'Prefer calm? Reduce motion, reduce transparency and larger text are all in Settings › Accessibility.', show: set('accessibility'), proof: ['js/apps/settings.js', "label: 'Reduce motion'"] },
  { id: 'backup', text: () => 'Settings › Privacy can back up everything you saved here and restore it on another browser.', show: set('privacy'), proof: ['js/apps/settings.js', 'Back up your data'] },

  /* ---- games and people ---- */
  { id: 'play', text: () => 'Static Play is the home for your games: continue where you left off, discover something new, or pick Quick Play.', show: app('play'), proof: ['js/apps/play.js', 'Quick Play'] },
  { id: 'quickplay', text: () => 'Under the wallpaper clock, Quick Play picks a game for you when you cannot decide.', show: app('play'), proof: ['js/shell/desktop.js', 'canQuick'] },
  { id: 'arcade-clips', text: () => 'Static Arcade can record a clip of your game, and keeps your clips in one place.', show: app('arcade', { view: 'clips' }), proof: ['js/apps/arcade.js', "'clips'"] },
  { id: 'party', text: () => 'Static Party lets you start a party, share a code with friends, pick a game and play together.', show: app('party'), proof: ['js/apps/party.js', 'defineApp'] },
  { id: 'jam', text: () => 'Static Jam runs a weekly game jam with a theme and a countdown.', show: app('jam'), proof: ['js/apps/jam.js', 'defineApp'] },
  { id: 'friends', text: () => 'Static Social › Friends adds people by a private code you pass on yourself. There is no search and no list of people.', show: app('social', { friends: true }), proof: ['js/core/friends.js', 'export async function ensureCode'] },
  { id: 'gamenight', text: () => 'Plan a game night in Static Social › Friends: pick a game and a time, and your friends can say yes, maybe or no.', show: app('social', { friends: true }), proof: ['js/core/friends.js', 'createNight'] },
  { id: 'users', text: () => 'Settings › Users gives each person on this computer their own desktop, files and settings, and a guest session keeps nothing.', show: set('users'), proof: ['js/core/profiles.js', 'export function startGuest'] },
  { id: 'coop-note', text: () => 'In Notes, Write together gives you a code. Pass it on and you both type in the same note, live.', show: app('notes'), proof: ['js/apps/notes.js', 'Write together…'] },
  { id: 'old-games', text: () => 'Scroll to the bottom of Static Arcade for Old Games: free classics such as Beneath a Steel Sky and Sopwith.', show: app('arcade'), proof: ['js/classics/catalog.js', 'Beneath a Steel Sky'] },
  { id: 'jumper-editor', text: () => 'Pixel Jumper in Static Arcade has a level editor. Build a level and share it as a link.', show: app('arcade', { game: 'jumper' }), proof: ['js/arcade/jumper.js', 'Level editor'] },
  { id: 'python', text: () => 'VS Code runs real Python. Open a .py file or a Python template and press Run.', show: app('code'), proof: ['js/core/pyrun.js', 'Pyodide'] },
  { id: 'dev-tools', text: () => 'Dev Tools has a regex tester, a JSON viewer and a password generator, all on this device.', show: app('dev-tools'), proof: ['js/apps/dev-tools.js', 'defineApp'] },
  { id: 'birthday', text: () => 'Tell Settings › Celebrations your birthday, and StaticOS has a card and some confetti for you on the day.', show: set('celebrations'), proof: ['js/apps/celebrate-pane.js', 'prefs.birthday'] },

  /* ---- school ---- */
  { id: 'study-cards', text: () => 'Static Study’s flashcards bring each card back just before you would forget it.', show: app('study', { tab: 'cards' }), proof: ['js/core/flashcards.js', 'SM-2'] },
  { id: 'study-homework', text: () => 'Add homework to Static Study with a reminder. It goes off while StaticOS is open, even with Study closed, and it gets through Do Not Disturb.', show: app('study', { tab: 'homework' }), proof: ['js/core/homework.js', 'AM.syncSourceReminders(SRC'] },
  { id: 'study-final', text: () => 'What do you need on the final? The GPA tab in Static Study works it out.', show: app('study', { tab: 'gpa' }), proof: ['js/core/gpa.js', 'export function neededOnFinal'] },
  { id: 'study-cite', text: () => 'Static Study makes MLA, APA and Chicago citations that keep their italics when you paste them.', show: app('study', { tab: 'cite' }), proof: ['js/study/cite.js', 'Copied, with italics.'] },
  { id: 'study-quiz', text: () => 'Write a quiz in Static Study and host it live: friends join with a code and answer on their own screens.', show: app('study', { tab: 'quiz' }), proof: ['js/study/quiz.js', "btn('Host live'"] },
  { id: 'study-equations', text: () => 'The Equations tab in Static Study solves linear and quadratic equations, step by step.', show: app('study', { tab: 'equations' }), proof: ['js/study/equations.js', "quadratic: 'A quadratic equation'"] },
  { id: 'sheets', text: () => 'Static Sheets has formulas, and bar, line and pie charts that update as you type. It opens and saves CSV files.', show: app('sheets'), proof: ['js/sheets/chart.js', "TYPES = ['bar', 'line', 'pie']"] },
  { id: 'typing', text: () => 'Typing Lessons teaches touch typing, from the home row to whole sentences.', show: app('typing'), proof: ['js/apps/typing-lessons.js', "id: 'typing'"] },
  { id: 'periodic', text: () => 'In the Periodic Table, slide the temperature to see which elements are solid, liquid or gas.', show: app('periodic'), proof: ['js/apps/periodic.js', "'aria-label': 'Temperature in kelvin'"] },
  { id: 'mindmap', text: () => 'Mind Maps lets you drag bubbles and connect ideas, then save the map or export it as a picture.', show: app('mindmap'), proof: ['js/apps/mindmap.js', "id: 'mindmap'"] },
  { id: 'calc-sci', text: () => 'Calculator has a Scientific mode with trig, logs, powers and memory.', show: app('calculator'), proof: ['js/apps/calculator.js', 'Scientific mode'] },

  /* ---- pictures and sound ---- */
  { id: 'picture-tools', text: () => 'Picture Tools makes memes, collages and ASCII art, and converts or resizes pictures to PNG, JPG or WebP.', show: app('picturetools', { tool: 'meme' }), proof: ['js/apps/picturetools.js', "id: 'meme'"] },
  { id: 'picture-files', text: () => 'In Files, right-click a picture you added and choose Picture tools to start from it.', show: app('files'), proof: ['js/apps/files.js', "label: 'Picture tools'"] },
  { id: 'picture-sticker', text: () => 'Cut a sticker out of any picture in Picture Tools, then put it on your desktop.', show: app('picturetools', { tool: 'sticker' }), proof: ['js/photos/pt-sticker.js', "text: 'Put on desktop'"] },
  { id: 'picture-gif', text: () => 'Picture Tools turns pictures or a video clip into a looping GIF.', show: app('picturetools', { tool: 'gif' }), proof: ['js/apps/picturetools.js', "id: 'gif'"] },
  { id: 'palette-picture', text: () => 'The From picture tab in Static Color finds the main colours in any picture.', show: app('palette'), proof: ['js/apps/palette.js', "label: 'From picture'"] },
  { id: 'soundboard', text: () => 'Soundboard plays your own sounds with a click or a key, from files or the microphone.', show: app('soundboard'), proof: ['js/apps/soundboard.js', "KEYS = '123456789QWERTYUIOP'"] },
  { id: 'tuner', text: () => 'Music has a tuner for guitar and ukulele. It records nothing and turns the microphone off when you leave.', show: app('music', { view: 'tuner' }), proof: ['js/apps/music.js', "['tuner', 'gauge', 'Tuner']"] },
  { id: 'voicefx', text: () => 'Static Recorder can turn a voice recording into a robot or a chipmunk, or add echo.', show: app('recorder'), proof: ['js/core/voicefx.js', "label: 'Robot'"] },

  /* ---- with a friend ---- */
  { id: 'drop', text: () => 'Static Drop sends files straight to a friend’s StaticOS with a six-character code, and nothing is saved until they press Accept.', show: app('drop'), proof: ['js/apps/drop.js', 'nothing is saved until you press Accept'] },
  { id: 'drop-move', text: () => 'Moving to another StaticOS link? Move my StaticOS in Static Drop brings what you saved with you.', show: app('drop', { move: true }), proof: ['js/apps/drop.js', "text: 'Move my StaticOS'"] },
  { id: 'online', text: () => 'Play a friend on another device: pick the Online filter in Static Arcade, start a game and share the room code.', show: app('arcade'), proof: ['js/apps/arcade.js', "id: 'online', label: 'Online'"] },
  { id: 'watch-together', text: () => 'Watch Together plays a video in sync with a friend, with chat beside it.', show: app('watch-together'), proof: ['js/apps/watchtogether.js', "id: 'watch-together'"] },
  { id: 'draw-together', text: () => 'The Draw together button in Static Paint shares your canvas with a friend, using a code.', show: app('paint'), proof: ['js/apps/paint.js', "text: 'Draw together'"] },

  /* ---- school, planning and everyday tools (4.7) ---- */
  { id: 'study-exams', text: () => 'Add an exam in the Exams tab of Static Study to see the days left and get a plan of what to revise each day.', show: app('study', { tab: 'exams' }), proof: ['js/apps/study.js', "['exams', 'Exams', 'calendar']"] },
  { id: 'study-vocab', text: () => 'The Vocab tab in Static Study trains words in another language and speaks them aloud.', show: app('study', { tab: 'vocab' }), proof: ['js/apps/study.js', "['vocab', 'Vocab', 'globe']"] },
  { id: 'study-timetable', text: () => 'Put your classes in the Timetable tab of Static Study, then add the Now and Next widget to see which class is on.', show: app('study', { tab: 'timetable' }), proof: ['js/apps/study.js', "['timetable', 'Timetable', 'calendar']"] },
  { id: 'geometry', text: () => 'Geometry lets you construct points, lines and circles, drag them around, and read off lengths, angles and areas.', show: app('geometry'), proof: ['js/apps/geometry.js', "id: 'geometry'"] },
  { id: 'physics', text: () => 'Physics launches projectiles, swings pendulums and bounces springs, with sliders for the real variables.', show: app('physics'), proof: ['js/apps/physics.js', "id: 'physics'"] },
  { id: 'drills', text: () => 'Static Drills runs short rounds of times tables, Morse code, flags and capitals, and spelling.', show: app('drills'), proof: ['js/apps/drills.js', "id: 'drills'"] },
  { id: 'life', text: () => 'Static Life keeps habit streaks, a budget, a recipe box and a workout timer on this device.', show: app('life'), proof: ['js/apps/life.js', "id: 'life'"] },
  { id: 'tasks-undo', text: () => 'Deleted a task by mistake? Press Undo in the notification that appears, and Tasks puts it back where it was.', show: app('tasks'), proof: ['js/apps/tasks.js', "title: 'Task deleted'"] },
  { id: 'calc-prog', text: () => 'Calculator has a Programmer mode for hex, binary and bits.', show: app('calculator'), proof: ['js/apps/calculator.js', "text: 'Programmer'"] },
  { id: 'qr-scan', text: () => 'Static QR can read a QR code from your camera or from a picture, on this device.', show: app('qr'), proof: ['js/apps/qr.js', "text: 'Scan a code'"] },
  { id: 'picture-scan', text: () => 'The Scan tab in Picture Tools turns photos of pages into a PDF.', show: app('picturetools', { tool: 'scan' }), proof: ['js/apps/picturetools.js', "id: 'scan', label: 'Scan'"] },
  { id: 'synth', text: () => 'Static Synth plays from your keys or a MIDI keyboard, with presets to start from.', show: app('synth'), proof: ['js/apps/synth.js', "id: 'synth'"] },
  { id: 'loops', text: () => 'Loop Station records a loop from your microphone and lets you layer more on top.', show: app('loops'), proof: ['js/apps/loops.js', "id: 'loops'"] },

  { id: 'watch-together-cam', text: () => 'In Watch Together, press Camera or Mic to see and hear your friend beside the video. Both stay off until you turn them on.', show: app('watch-together'), proof: ['js/apps/watchtogether.js', "'Stop camera'"] },
  { id: 'watch-films', text: () => 'Static Watch has a Free films section of full-length films from archive.org.', show: app('watch'), proof: ['js/apps/watch.js', "label: 'Free films'"] },
  { id: 'manga-library', text: () => 'Static Manga comes with a library: all of Pepper&Carrot, free to read.', show: app('manga'), proof: ['js/apps/manga.js', "id: 'manga'"] },
  { id: 'flex-battle', text: () => 'Flex Battle: show a friend your coolest item on camera and let an AI guess what it is worth. It only guesses.', show: app('flex-battle'), proof: ['js/apps/flexbattle.js', "id: 'flex-battle'"] },

  /* ---- this tour ---- */
  { id: 'tour', text: () => 'New here, or forgot where things are? Help › Take the Tour walks through the desktop again.', show: ['bus', 'tour:start'], proof: ['js/shell/tour.js', 'tour:start'] },
];
