/* ============================================================
   study/print.js — a print sheet for Static Study (an exam's plan,
   a transcript): the browser's own print window with only this sheet
   on the page (css/feat-study.css, html.st-printing), so "Save as PDF"
   there makes a PDF. The sheet goes when printing is over.
   ============================================================ */
let sheet = null;

/** Print `nodes` under a title. -> the sheet element (gone after printing) */
export function printSheet(h, title, sub, nodes) {
  done();
  sheet = h('div.st-print', { 'aria-hidden': 'true' }, h('h1', { text: title }), sub ? h('p.st-print__sub', { text: sub }) : null, ...nodes);
  document.body.appendChild(sheet);
  document.documentElement.classList.add('st-printing');
  window.addEventListener('afterprint', done);
  setTimeout(done, 120000);
  try { window.print(); } catch (e) { done(); }
  return sheet;
}
function done() {
  document.documentElement.classList.remove('st-printing');
  window.removeEventListener('afterprint', done);
  if (sheet) { sheet.remove(); sheet = null; }
}
export const printedOn = () => `Printed ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} from Static Study.`;
