// How the business likes to sell, from gentle to direct. It shapes the words on
// new pages, how close together follow-ups go out, how many checkout reminders
// are sent, and the tone of drafted copy. At every level the rule is the same:
// no invented deadlines, no fake scarcity, no made-up proof.
'use strict';

const STYLES = {
  1: { key: 'gentle', label: 'Gentle', waits: 2, reminders: 1,
    ai: 'Sales style: gentle. Inform and invite; never push. Soft calls to action ("have a look", "whenever you’re ready"). No urgency words at all.' },
  2: { key: 'soft', label: 'Soft', waits: 1.5, reminders: 1,
    ai: 'Sales style: soft. Warm and helpful, with a clear but relaxed call to action. Avoid urgency words.' },
  3: { key: 'balanced', label: 'Balanced', waits: 1, reminders: 2,
    ai: 'Sales style: balanced. Friendly and clear, with one confident call to action.' },
  4: { key: 'confident', label: 'Confident', waits: 0.75, reminders: 2,
    ai: 'Sales style: confident. Lead with the result, use strong verbs and a direct call to action. Mention a deadline only if the owner gave a real one.' },
  5: { key: 'direct', label: 'Direct', waits: 0.5, reminders: 2,
    ai: 'Sales style: direct. Short, bold and action-first, with a strong call to action repeated once. Urgency only from real facts (a real deadline, a real limit the owner stated); never invent scarcity, countdowns or claims.' },
};
const level = (v) => Math.min(5, Math.max(1, Math.round(Number(v) || 3)));
const styleOf = (account) => STYLES[level(account?.sales_style)];
const tier = (v) => (level(v) <= 2 ? 'low' : level(v) >= 4 ? 'high' : 'mid');

// Follow-up waits stretched or tightened for the style (never under an hour).
function paceGraph(graph, v) {
  const f = STYLES[level(v)].waits;
  if (f === 1) return graph;
  for (const n of Object.values(graph.nodes || {})) {
    if (n.type !== 'wait') continue;
    const hours = (Number(n.config.days) || 0) * 24 + (Number(n.config.hours) || 0);
    if (!hours) continue;
    const h = Math.max(1, Math.round(hours * f));
    n.config.days = Math.floor(h / 24); n.config.hours = h % 24;
  }
  return graph;
}

module.exports = { STYLES, level, styleOf, tier, paceGraph };
