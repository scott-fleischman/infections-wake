// Story content (§15–16). The three staged archive fragments follow the
// spec's First Wake reveal sequence. Cataloging one unlocks a practical system
// and adds a Story Log entry; all three assemble the synthesized "First Wake".

export const ARCHIVES = {
  1: {
    id: 1,
    title: 'Ward Seven — Preservation Notes',
    tag: 'ATMOSPHERIC / TACTICAL',
    meta: 'Project Lazarus · Clinical Annex · fragment recovered',
    body: `Intake log, Ward Seven. Subject received concentrated LZ-9 for crush trauma.
Circulation returned within the hour. Consciousness did not.

STANDING RULE, POSTED AT EVERY BED: Preservation is not revival.

Addendum, handwritten: Do NOT place heated blankets near preserved patients.
The colonies follow warmth. Twice now a body has turned its head toward a warm
lamp with no cortical activity on the monitor. It is not waking. It is a gradient,
nothing more. — M.V.`,
    unlock: 'Heat attraction confirmed. Bestiary updated: infected follow warmth.',
    bestiaryReveal: ['drifter'],
    overlay: 'heat',
  },
  2: {
    id: 2,
    title: 'Ventilation Incident Record',
    tag: 'TACTICAL',
    meta: 'Project Lazarus · Environmental Systems · incident #—',
    body: `Filters clogged on the annex return. Staff overrode pressure controls to
keep air moving. Within days a new strain formed dry cysts — in lungs, in throats,
in the vents themselves.

We now log what the colonies respond to: heat, breath, fresh blood, vibration,
electrical activity. Each colony acts alone. There is no shared mind, no signal
between them. They only appear coordinated because they answer the same stimulus.

Recommendation: seal processing. Filter every vent. Assume anything that emits
is a beacon.`,
    unlock: 'Filtration and spore behavior logged. Signature overlays expanded. Bestiary: cyst transmission.',
    bestiaryReveal: ['runner', 'machine_eater'],
    overlay: 'all',
  },
  3: {
    id: 3,
    title: "Venn's Reservoir Protocol",
    tag: 'PROGRESSION',
    meta: 'Project Lazarus · Dr. Mara Venn · final entry',
    body: `Subject L-01 is Elias Roane. Mining accident, crushed chest, Ward Seven.
His colony grew the most durable cultures we ever recorded. When the annex fell,
they moved him into the reservoir vault. Over years it became the strongest
physical and chemical source in the region.

The infected converge on it. They are NOT commanded by it. It is simply the
loudest thing in the valley — heat, metal, nutrient film, signaling chemicals.

To end the regional pressure: reach the three sterilization galleries and open
each purge valve. Heat regulation. Sterilant. Flood. I have opened the first.
I do not think I will reach the second. — M.V.`,
    unlock: 'Objective updated: purge the regional reservoir. Deep Site marked. (Full expedition arrives in a later chapter.)',
    bestiaryReveal: ['colony_host'],
    overlay: 'all',
  },
};

export const SYNTH = {
  title: 'THE FIRST WAKE',
  tag: 'STORY LOG · SYNTHESIS',
  body: `Project Lazarus tried to keep the dying alive long enough to save them.
Its bacterium, LZ-9, preserved tissue and bridged broken nerves with conductive
biofilm — enough to make a clinically dead body move. Preservation, never revival.

Elias Roane was its clearest evidence: a man whose colony outlived him and seeded
the valley's most durable strains. When containment failed through a clogged vent,
the infection escaped into the valley. It has no mind. Every colony answers only
to what it can sense — warmth, breath, blood, vibration, current.

Beneath the annex, Roane's reservoir still hums louder than anything else in the
region. The infected gather there because it is loud, not because it calls. Silence
it, and the valley can begin to heal. It will not cure the world. It is a beginning.`,
};

// Bestiary base entries; senses are hidden until revealed by an archive.
export const BESTIARY = {
  drifter: { name: 'Drifter', known: 'Standard infected body. Batters accessible barriers to reach warmth and breath.' },
  runner: { name: 'Runner', known: 'Fast, fragile. Erupts toward movement and fresh blood; punishes open doors.' },
  machine_eater: { name: 'Machine eater', known: 'Drawn to running machinery — heat, current, and metal. Chews through power.' },
  colony_host: { name: 'Colony host', known: 'A tissue-fused colony mineralized into stone. A location problem, not a monster with a key.' },
};

export class StoryLog {
  constructor(game) {
    this.game = game;
    this.cataloged = new Set();   // archive ids
    this.beastKnown = new Set();  // strain keys whose senses are revealed
    this.synthUnlocked = false;
    this.entries = [];            // {title, tag, body, synth?}
  }

  isCataloged(id) { return this.cataloged.has(id); }

  catalog(id) {
    if (this.cataloged.has(id)) return false;
    const a = ARCHIVES[id];
    this.cataloged.add(id);
    this.entries.push({ title: a.title, tag: a.tag, body: a.body });
    for (const k of a.bestiaryReveal) this.beastKnown.add(k);
    // practical unlocks
    this.game.onArchiveCataloged(a);
    this.game.toast(`Cataloged: ${a.title}`, 'important');
    this.game.toast(a.unlock, 'important');
    if (this.cataloged.size === 3 && !this.synthUnlocked) {
      this.synthUnlocked = true;
      this.entries.push({ title: SYNTH.title, tag: SYNTH.tag, body: SYNTH.body, synth: true });
      this.game.toast('Story Log assembled: THE FIRST WAKE', 'important');
    }
    return true;
  }

  revealBeast(k) { this.beastKnown.add(k); }

  serialize() {
    return { cataloged: [...this.cataloged], beast: [...this.beastKnown], synth: this.synthUnlocked };
  }
  load(d) {
    if (!d) return;
    this.cataloged = new Set(d.cataloged || []);
    this.beastKnown = new Set(d.beast || []);
    this.synthUnlocked = d.synth || false;
    this.entries = [];
    for (const id of this.cataloged) { const a = ARCHIVES[id]; if (a) this.entries.push({ title: a.title, tag: a.tag, body: a.body }); }
    if (this.synthUnlocked) this.entries.push({ title: SYNTH.title, tag: SYNTH.tag, body: SYNTH.body, synth: true });
  }
}
