// What the shared summary page shows, worked out from a run: its stats and
// its history as plain lines of text. Pure functions (tests/summary.test.js).

import { graveyard, isUsable, party, tally } from "./rules.js?v=19436aea";

const DAY = 24 * 60 * 60 * 1000;

/** Headline numbers for a run. */
export function stats(run, now = Date.now()) {
  const { logged, caught, lost } = tally(run);
  const failed = run.encounters.filter((e) => e.catches.some((c) => c.status !== "caught")).length;
  const alive = caught - lost;
  const start = run.createdAt || Math.min(now, ...run.encounters.map((e) => e.createdAt || now));
  return {
    logged, caught, lost, failed, alive,
    party: party(run).length,
    survival: caught ? Math.round((alive / caught) * 100) : null,
    days: Math.max(1, Math.floor((now - start) / DAY) + 1),
  };
}

function names(list) {
  return (list || []).join(" & ") || "—";
}

/** One history entry as {icon, text}; `milestones` maps key -> {name}. */
export function describe(event, run, milestones = {}) {
  const soul = run.mode === "soul";
  switch (event.type) {
    case "encounter": {
      const who = event.catches.filter((c) => c.species)
        .map((c) => (c.nickname ? `${c.nickname} (${c.species})` : c.species));
      if (event.status === "caught") return { icon: "🟢", text: `Caught ${names(who)} at ${event.location}` };
      if (event.status === "failed") {
        return { icon: "❌", text: `${event.location}: ${who.length ? `${names(who)} got away` : "the encounter failed"}` };
      }
      return { icon: "⛔", text: `${event.location}: invalid encounter${who.length ? ` (${names(who)})` : ""}` };
    }
    case "party": return { icon: "➕", text: `${names(event.names)} joined the party` };
    case "box": return { icon: "📦", text: `${names(event.names)} went to the box` };
    case "faint": {
      const where = event.where ? ` at ${event.where}` : "";
      return { icon: "🪦", text: `${names(event.names)} ${soul ? "fell together" : "fainted"}${where}` };
    }
    case "evolve": {
      const who = event.nickname ? `${event.nickname} (${event.from})` : event.from;
      return { icon: "✨", text: `${who} evolved into ${event.to}` };
    }
    case "milestone": {
      const m = milestones[event.key];
      const label = m?.name || event.key;
      if (m?.kind === "champion") return { icon: "🏆", text: `Became the Champion!` };
      if (m?.kind === "elite4") return { icon: "⭐", text: `Beat the Elite Four` };
      return { icon: "🏅", text: `Earned the ${label}${m?.leader ? ` from ${m.leader}` : ""}` };
    }
    default: return null;
  }
}

/** The run's history, newest first, grouped by day:
 *  [{day: "Today" | "Yesterday" | "Mon 12 Oct", entries: [{t, icon, text}]}]. */
export function timeline(run, milestones = {}, { now = Date.now(), locale } = {}) {
  let events = run.events || [];
  if (!events.length) {
    // runs from before the history was kept: rebuild what we can from encounters
    events = run.encounters.map((e) => ({
      t: e.createdAt, type: "encounter", id: e.id, location: e.location,
      status: e.catches.every((c) => c.status === "caught") ? "caught"
        : e.catches.some((c) => c.status === "failed") ? "failed" : "invalid",
      catches: e.catches,
    }));
  }
  const dayName = (t) => {
    const d = new Date(t), today = new Date(now);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, new Date(now - DAY))) return "Yesterday";
    return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  };
  // joining the party right after being caught is part of the catch, not news
  const caughtAt = new Map(events.filter((e) => e.type === "encounter").map((e) => [e.id, e.t]));
  events = events.filter((e) => !(e.type === "party" && caughtAt.has(e.id)
    && Math.abs(e.t - caughtAt.get(e.id)) < 10 * 60 * 1000));
  const groups = [];
  // newest first; things that happened at the same moment stay in reverse order
  const ordered = events.map((e, i) => [e, i]).sort(([a, i], [b, j]) => (b.t - a.t) || (j - i));
  for (const [ev] of ordered) {
    const line = describe(ev, run, milestones);
    if (!line) continue;
    const day = dayName(ev.t);
    if (groups.at(-1)?.day !== day) groups.push({ day, entries: [] });
    groups.at(-1).entries.push({ t: ev.t, ...line });
  }
  return groups;
}

/** Where each Pokémon in the party came from: "Caught at Route 1 · was Charmander". */
export function origin(enc, c) {
  const bits = [`Caught at ${enc.location}`];
  if (c.caughtAs) bits.push(`was ${c.caughtAs}`);
  return bits.join(" · ");
}

/** The fallen, newest first, with where they were caught and lost. */
export function memorial(run) {
  return graveyard(run).slice().sort((a, b) => (b.diedTime || 0) - (a.diedTime || 0));
}

/** Encounters in the order they were logged, with a one-word result. */
export function route(run) {
  return run.encounters
    .map((e, i) => [e, i])
    .sort(([a, i], [b, j]) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || i - j)
    .map(([e]) => ({
      enc: e,
      result: e.place === "grave" ? "lost"
        : isUsable(run, e) ? (e.place === "party" ? "party" : e.place === "box" ? "box" : "caught")
          : e.catches.some((c) => c.status === "failed") ? "failed" : "invalid",
    }));
}
