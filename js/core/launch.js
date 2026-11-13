/* ============================================================
   launch.js — open anything playable, from anywhere.

   One place that knows which app plays which kind of thing, so a
   desktop shortcut, a file in Game Projects, a widget tile and
   Staticum all behave the same:
     web       -> Static Games, straight into the play stage
     arcade    -> Static Arcade with that game
     creation  -> Static Forge with that project
   item: { kind, id, url?, title? }
   ============================================================ */
import { open } from './wm.js';

export function launchItem(item) {
  if (!item || !item.id) return null;
  const kind = item.kind || 'web';
  if (kind === 'arcade') return open('arcade', { game: item.id });
  if (kind === 'creation') return open('forge', { project: item.id });
  return open('aether-games', { url: item.url || `static://games/${item.id}` });
}

export default { launchItem };
