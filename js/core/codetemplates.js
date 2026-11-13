/* ============================================================
   codetemplates.js — Code's one-click starters.

   Each template is a small, original project: real files that go
   into ~/Projects and run the first time (the preview shows them
   working as soon as they open). Written for this app; nothing is
   copied from elsewhere. The plain website starter lives in
   code.js (STARTER); the entries here are the others.

   TEMPLATES[i] = { id, name, hint, icon, dir, open, files: { name: text } }
     dir    the folder name in ~/Projects (made unique when it exists)
     open   the file to show first
   ============================================================ */

const CANVAS_HTML = name => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Star Catcher</h1>
    <p>Move the mouse (or press the left and right arrow keys) to catch the stars. Click the game to start again.</p>
    <canvas id="game" width="480" height="320" aria-label="Star Catcher game"></canvas>
    <p id="score">Score 0 · Lives 3</p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`;

const CANVAS_CSS = `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #0d0b24;
  color: #e9e6ff;
  text-align: center;
}

main {
  max-width: 520px;
  margin: 0 auto;
  padding: 1rem;
}

h1 {
  margin: 0.4rem 0;
  color: #ffd34d;
}

canvas {
  max-width: 100%;
  border-radius: 12px;
  background: #15123a;
  touch-action: none;
  cursor: none;
}
`;

const CANVAS_JS = `// Star Catcher: a tiny canvas game. Change the numbers at the top and watch it update.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');

const BASKET_W = 70;
const STAR_SPEED = 2;      // pixels per frame at the start
const SPAWN_EVERY = 45;    // frames between new stars

let basketX, stars, score, lives, frame, over, keys = {};

function reset() {
  basketX = canvas.width / 2;
  stars = [];
  score = 0;
  lives = 3;
  frame = 0;
  over = false;
}

function spawn() {
  stars.push({ x: 16 + Math.random() * (canvas.width - 32), y: -10, r: 9 + Math.random() * 4 });
}

function update() {
  if (over) return;
  frame++;
  if (keys.ArrowLeft) basketX -= 6;
  if (keys.ArrowRight) basketX += 6;
  basketX = Math.max(BASKET_W / 2, Math.min(canvas.width - BASKET_W / 2, basketX));
  if (frame % SPAWN_EVERY === 0) spawn();
  const speed = STAR_SPEED + score * 0.08;
  for (const s of stars) s.y += speed;
  const top = canvas.height - 28;
  stars = stars.filter(s => {
    if (s.y + s.r >= top && Math.abs(s.x - basketX) < BASKET_W / 2 + s.r) { score++; return false; }
    if (s.y - s.r > canvas.height) { lives--; return false; }
    return true;
  });
  if (lives <= 0) { over = true; console.log('Game over. Score:', score); }
  scoreEl.textContent = 'Score ' + score + ' · Lives ' + Math.max(lives, 0);
}

function star(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffd34d';
  for (const s of stars) star(s.x, s.y, s.r);
  ctx.fillStyle = '#7c6cff';
  ctx.fillRect(basketX - BASKET_W / 2, canvas.height - 24, BASKET_W, 14);
  if (over) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Game over: ' + score + ' stars', canvas.width / 2, canvas.height / 2);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Click to play again', canvas.width / 2, canvas.height / 2 + 28);
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

canvas.addEventListener('pointermove', e => {
  const box = canvas.getBoundingClientRect();
  basketX = ((e.clientX - box.left) / box.width) * canvas.width;
});
canvas.addEventListener('click', () => { if (over) reset(); });
addEventListener('keydown', e => { keys[e.key] = true; });
addEventListener('keyup', e => { keys[e.key] = false; });

reset();
// a first star right away, so the page is never empty
spawn();
console.log('Star Catcher is running');
loop();
`;

const QUIZ_HTML = name => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Quick Quiz</h1>
    <p id="progress" aria-live="polite"></p>
    <h2 id="question"></h2>
    <div id="answers" role="group" aria-label="Answers"></div>
    <p id="feedback" role="status"></p>
    <button id="next" type="button" hidden>Next</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`;

const QUIZ_CSS = `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #f3f0ff;
  color: #1d1740;
}

main {
  max-width: 520px;
  margin: 2rem auto;
  padding: 1.5rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 6px 24px rgba(60, 40, 160, 0.12);
}

h1 {
  margin-top: 0;
  color: #5b3fd1;
}

#progress {
  color: #6b6590;
  font-size: 0.9rem;
}

#answers {
  display: grid;
  gap: 0.6rem;
}

button {
  font: inherit;
  padding: 0.7rem 1rem;
  text-align: left;
  border-radius: 10px;
  border: 2px solid #d9d2ff;
  background: #fff;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: #5b3fd1;
}

button.right {
  border-color: #1f9d55;
  background: #e5f8ec;
}

button.wrong {
  border-color: #d64545;
  background: #fde8e8;
}

#next {
  margin-top: 1rem;
  background: #5b3fd1;
  color: #fff;
  border-color: #5b3fd1;
  text-align: center;
}
`;

const QUIZ_JS = `// Quick Quiz: add your own questions to this list.
// 'answer' is the position of the right choice (0 is the first).
const QUESTIONS = [
  { q: 'Which planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter', 'Mercury'], answer: 1 },
  { q: 'How many legs does a spider have?', choices: ['6', '8', '10', '12'], answer: 1 },
  { q: 'What is 7 x 8?', choices: ['54', '56', '63', '64'], answer: 1 },
  { q: 'Which gas do plants take in from the air?', choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], answer: 2 },
  { q: 'What is the capital of France?', choices: ['Paris', 'Rome', 'Madrid', 'Berlin'], answer: 0 },
];

const progressEl = document.getElementById('progress');
const questionEl = document.getElementById('question');
const answersEl = document.getElementById('answers');
const feedbackEl = document.getElementById('feedback');
const nextBtn = document.getElementById('next');

let index = 0;
let score = 0;

function show() {
  const item = QUESTIONS[index];
  progressEl.textContent = 'Question ' + (index + 1) + ' of ' + QUESTIONS.length + ' · Score ' + score;
  questionEl.textContent = item.q;
  feedbackEl.textContent = '';
  nextBtn.hidden = true;
  answersEl.replaceChildren(...item.choices.map((text, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => choose(i));
    return b;
  }));
}

function choose(i) {
  const item = QUESTIONS[index];
  const buttons = [...answersEl.children];
  buttons.forEach((b, k) => {
    b.disabled = true;
    if (k === item.answer) b.classList.add('right');
  });
  if (i === item.answer) {
    score++;
    feedbackEl.textContent = 'Correct!';
  } else {
    buttons[i].classList.add('wrong');
    feedbackEl.textContent = 'Not quite: the answer is ' + item.choices[item.answer] + '.';
  }
  progressEl.textContent = 'Question ' + (index + 1) + ' of ' + QUESTIONS.length + ' · Score ' + score;
  nextBtn.textContent = index === QUESTIONS.length - 1 ? 'See my score' : 'Next';
  nextBtn.hidden = false;
  console.log('answered', index + 1, i === item.answer ? 'right' : 'wrong');
}

nextBtn.addEventListener('click', () => {
  index++;
  if (index < QUESTIONS.length) { show(); return; }
  progressEl.textContent = 'Finished';
  questionEl.textContent = 'You got ' + score + ' out of ' + QUESTIONS.length + '.';
  answersEl.replaceChildren();
  feedbackEl.textContent = score === QUESTIONS.length ? 'Perfect score!' : 'Press Play again to try for more.';
  nextBtn.textContent = 'Play again';
  nextBtn.onclick = () => { index = 0; score = 0; nextBtn.onclick = null; show(); };
  console.log('quiz finished', score);
});

show();
console.log('Quick Quiz loaded with', QUESTIONS.length, 'questions');
`;

const PY_MAIN = `# A first Python program. Press Run (top right) to run it.
# Other .py files in this folder can be imported, and text files read.
from greet import hello

name = input("What is your name? ")
print(hello(name))

print()
print("Times table for 7:")
for n in range(1, 6):
    print(f"  7 x {n} = {7 * n}")

with open("notes.txt", encoding="utf-8") as f:
    print()
    print("From notes.txt:", f.read().strip())
`;

const PY_GREET = `def hello(name):
    name = name.strip() or "friend"
    return f"Hello, {name}! Welcome to Python in StaticOS."
`;

const PY_NOTES = `This file sits next to main.py, so the program can read it.
`;

export const TEMPLATES = [
  {
    id: 'canvas-game', name: 'Canvas game', hint: 'A small catch-the-stars game', icon: 'gamepad', dir: 'star-catcher', open: 'script.js', preview: 'web',
    files: name => ({ 'index.html': CANVAS_HTML(name), 'style.css': CANVAS_CSS, 'script.js': CANVAS_JS }),
  },
  {
    id: 'quiz', name: 'Quiz page', hint: 'Multiple-choice questions with a score', icon: 'help-circle', dir: 'quiz-page', open: 'script.js', preview: 'web',
    files: name => ({ 'index.html': QUIZ_HTML(name), 'style.css': QUIZ_CSS, 'script.js': QUIZ_JS }),
  },
  {
    id: 'python', name: 'Python program', hint: 'Asks your name, imports a file, reads a file', icon: 'terminal', dir: 'python-hello', open: 'main.py', preview: 'py',
    files: () => ({ 'main.py': PY_MAIN, 'greet.py': PY_GREET, 'notes.txt': PY_NOTES }),
  },
];

export default { TEMPLATES };
