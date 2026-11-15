/* ============================================================
   aetherium.kit.js — the little registry Staticum's skills share.

   aetherium.js (the engine and the first skills) and
   aetherium.life.js (reminders, tasks, focus, Do Not Disturb, volume,
   Settings panes, weather, screen time, conversions, flashcards) both
   register skills here, so neither has to import the other.

   A skill is { id, match(q, ctx) -> falsy | { score, params }, run(params, ctx, raw) }.
   ============================================================ */
export const SKILLS = [];
export const skill = def => { SKILLS.push(def); return def; };

export const clean = s => String(s || '').trim();
export const low = s => clean(s).toLowerCase();
export const has = (q, ...words) => words.some(w => q.includes(w));
export const answer = (say, extra = {}) => ({ say, kind: 'answer', chips: [], cards: [], did: null, ...extra });

/** What a verified action (aetherium.actions.js) said, as an answer. It tells the truth either way. */
export const fromAction = (r, success, extra = {}) => (r.ok
  ? answer(success(r), { kind: 'action', did: r.did, ...extra })
  : answer(r.detail || 'That did not work.', { kind: 'answer' }));

export const runAction = async (name, params, ctx) => {
  const A = await import('./aetherium.actions.js');
  return A.run(name, params, ctx);
};
