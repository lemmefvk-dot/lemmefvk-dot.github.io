/* ============================================================
   life.js — Static Life: four small everyday tools in one window.

     Habits    daily or chosen-weekday habits, ticks, streaks
     Budget    income and spending, monthly view, budgets, CSV export
     Recipes   your recipes, scaling, cook mode
     Workout   interval timer with saved routines

   Why one app with tabs rather than four: none of the four is big
   enough to earn its own dock icon, they share one saved record
   (store('portal.life')) and one set of widgets, and nothing existing
   fits them: Tasks is a checklist (no schedule, no streak), Sheets has
   no exact-money or budget model, Clock › Focus is a fixed pomodoro
   cycle. Where an existing piece does the job it is used, not copied:
   reminders go through Automations, files through Files, the picture
   picker through the media layer, cues through sfx.js and speech.js.

   The logic lives in js/core (habits, money, recipes, workout,
   wakelock: no DOM, unit-tested) and each tab's screen in js/life/.
   Every tab's teardown stops its timers, speech and wake lock; this
   window returns the one that tears down the open tab.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { mountHabits } from '../life/habits.js';
import { mountBudget } from '../life/budget.js';
import { mountRecipes } from '../life/recipes.js';
import { mountWorkout } from '../life/workout.js';
import { read, write } from '../life/data.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-life-css')) {
  const link = document.createElement('link');
  link.id = 'feat-life-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-life.css';
  document.head.appendChild(link);
}

const TABS = [
  ['habits', 'Habits', 'repeat', mountHabits],
  ['budget', 'Budget', 'pie-chart', mountBudget],
  ['recipes', 'Recipes', 'file-text', mountRecipes],
  ['workout', 'Workout', 'activity', mountWorkout],
];
const isTab = t => TABS.some(x => x[0] === t);

defineApp({
  id: 'life',
  name: 'Static Life',
  icon: 'heart',
  g1: '#ff9ec0', g2: '#c43d7a',
  category: 'Productivity',
  keywords: ['habit', 'habits', 'streak', 'budget', 'allowance', 'money', 'spending', 'expenses', 'recipe', 'recipes', 'cooking', 'cook', 'workout', 'interval', 'timer', 'exercise', 'hiit', 'life', 'routine'],
  desc: 'Habit streaks, a budget, a recipe box and a workout timer, kept on this device',
  singleton: true,
  win: { w: 860, h: 640, minW: 460, minH: 420 },

  mount(ctx) {
    const { root, opts, api } = ctx;
    const { h, icon } = api;
    let tab = isTab(opts && opts.tab) ? opts.tab : isTab(read().tab) ? read().tab : 'habits';
    let off = null;
    let dead = false;

    const body = h('div.life__body');
    const bar = h('div.app__bar.life__bar',
      h('div.tabs', { role: 'tablist', 'aria-label': 'Static Life' },
        TABS.map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', id: `life-tab-${id}`, 'data-tab': id, 'aria-controls': 'life-panel',
          onclick: () => show(id), onkeydown: e => arrow(e, id) }, icon(ic), h('span', { text: label })))));
    const main = h('div.life', bar, body);
    root.append(h('div.app.app--col', main));

    function arrow(e, id) {
      const i = TABS.findIndex(t => t[0] === id);
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
      if (to === null) return;
      e.preventDefault();
      const next = TABS[(to + TABS.length) % TABS.length][0];
      show(next);
      bar.querySelector(`[data-tab="${next}"]`).focus();
    }

    function show(id) {
      if (dead) return;
      if (off) { try { off(); } catch (e) { console.error(e); } off = null; }
      tab = id;
      write('tab', id);
      for (const b of bar.querySelectorAll('[data-tab]')) {
        const on = b.dataset.tab === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      const panel = h('div.life__panel', { id: 'life-panel', role: 'tabpanel', 'aria-labelledby': `life-tab-${id}`, 'data-panel': id });
      body.replaceChildren(panel);
      const mountTab = TABS.find(t => t[0] === id)[3];
      off = mountTab(panel, ctx);
    }
    show(tab);

    return () => {
      dead = true;
      if (off) { try { off(); } catch (e) { console.error(e); } off = null; }
    };
  },
});
