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
LZ-9: an engineered bacterium assembled from six harmless strains and one
extremophile recovered from a poisoned mine. It eats damaged tissue, seals
ruptured vessels with fibrous biofilm, and holds failing organs together.
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

Staff report false alarms, phantom footsteps, faces in the vents. The clinical
term is neural instability — toxins, inflammation, no sleep, contaminated air.
It is a wound like any other, and it heals like one.

Recommendation: seal processing. Filter every vent. Assume anything that emits
is a beacon.`,
    unlock: 'Filtration research opened: scrubbers, UV, and cartridges are now fabricable at steel. Bestiary: cyst transmission.',
    bestiaryReveal: ['runner', 'machine_eater', 'cyst_carrier'],
    overlay: 'all',
    unlockFlag: 'filtration',
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
    unlock: 'Objective updated: purge the regional reservoir. Restore the transit relay station on the north plains.',
    bestiaryReveal: ['colony_host'],
    overlay: 'all',
  },
  4: {
    id: 4,
    title: 'Relay Station K-4 — Duty Log',
    tag: 'ATMOSPHERIC / TACTICAL',
    meta: 'Project Lazarus · Containment Transit · final shift',
    body: `The rail still holds pressure. Whatever else failed, the engineers built
this part to outlive us. Checklist for restart is posted by the panel: two
control relays, one filtration cartridge, external power to the intake bus.
The line runs one place only — down, to the Deep Site.

Fair warning, whoever reads this: the startup sequence is LOUD. Turbines,
bulkheads, rail motors — every colony in the valley will hear it. Do not
start the line until you are ready to hold this platform.`,
    unlock: 'Transit restoration checklist logged: 2 relays, 1 filtration cartridge, powered intake — then hold the platform.',
    bestiaryReveal: [],
    overlay: null,
  },
  5: {
    id: 5,
    title: 'M. Venn — Gallery One',
    tag: 'PROGRESSION',
    meta: 'Project Lazarus · Deep Site · recovered beside human remains',
    body: `I reached the first gallery. The valve turned. The heat exchangers
screamed and died, exactly as designed — and everything warm in this complex
became a torch in a dark room. I understand now why the protocol wanted three
hands.

The sequence matters: heat regulation first, then sterilant, then the flood.
The sterilant corrodes unshielded electronics — power down what you carry, or
lose it. The flood will push everything that still moves up and out. Be
somewhere defensible.

Whoever you are: my valve reset itself when the pressure dropped. You will
have to open all three. Finish it. — M.V.`,
    unlock: 'Purge protocol confirmed: open the three valves in sequence, then burn out what remains of the reservoir.',
    bestiaryReveal: [],
    overlay: null,
  },
};

// §15.8 emotional continuity: the recurring shortwave operator. Broadcasts
// arrive at story beats; the shack radio replays the latest with [F].
export const RADIO = {
  day2: '…anyone on this band? Saw smoke over the west valley. If you are real, keep your fires small at night. They follow warmth. — K.',
  ironTier: '…that furnace glow last night — you are smelting. Good. Iron means a beacon. Build the beacon before you build the gun. — K.',
  genRan: '…I can hear your generator from the ridge, which means everything else can too. Bury the cable. Switch it off when you sleep. — K.',
  firstAssault: '…you held. First night anyone has held ground down there in years. The valley notices. So do I. — K.',
  steelTier: '…the old foundry stacks are smoking again. Steel. You know what steel means? It means machines. Mind what machines mean here. — K.',
  transitRestored: '…the whole basin shook when that rail spun up. If you are going down — the labs said three galleries, three valves. Come back up. Someone should. — K.',
  purged: '…the hum is gone. First quiet night in a decade. I do not know what you did down there, but the lights on my ridge — I am not the only one who lit one tonight. — K.',
  reclaim: '…heard the nests going quiet, one by one. Keep going. Leave the valley better than the Project left it. — K.',
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
  brute: { name: 'Brute', known: 'Mineralized mass on two legs. Ignores you to hammer foundations and plate. Walls are a delay, not an answer.' },
  climber: { name: 'Climber', known: 'Hardened fingers, altered joints. Reads lit windows and rooflines as invitations. Overhangs stop it; walls do not.' },
  burrower: { name: 'Burrower', known: 'Follows sustained vibration through soil, surfacing where the shaking is loudest. Watch for a line of disturbed earth.' },
  cyst_carrier: { name: 'Cyst carrier', known: 'A body given over to spore packaging. Cold — warm-body turrets cannot see it. The film it seeds keeps working after it dies.' },
  spitter: { name: 'Spitter', known: 'Expels contaminated fluid in an arc. Punishes exposed platforms and anything silhouetted against a light.' },
  elite: { name: 'Elite strain', known: 'Two strains fused into one competent body. Only appears where the ecology is loud enough to feed it.' },
  colony_host: { name: 'Colony host', known: 'A tissue-fused colony mineralized into stone. A location problem, not a monster with a key.' },
  kiln_host: { name: 'Kiln host', known: 'Tissue fused through an industrial kiln, cooking its own colony air. Purging it restores steel production at scale.' },
  pump_host: { name: 'Pump host', known: 'A colony grown through a flooded pump gallery. Purging it drains the annex and exposes the filtration stores.' },
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
    // the First Wake assembles from the three CORE discoveries (§16.4)
    if ([1, 2, 3].every(i => this.cataloged.has(i)) && !this.synthUnlocked) {
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
