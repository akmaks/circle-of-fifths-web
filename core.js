// core.js — all the music logic of the app, with no DOM: names, keys and modes, degrees, chords and their notes,
// the neck, wheel math, the «Подбор» analysis and the song index. app.js only draws what these functions return.
// The rules are specified case by case in docs/SPEC.md (ids like [F-R3]); tests/unit/core.test.js checks every case.
// Loads as a plain <script> (window.Core) and as a CommonJS module (Node tests) — no build step.
;(function (factory) {
  const core = factory()
  // The browser branch (window.Core) can't run under Node; e2e tests cover it (the app boots from it).
  /* node:coverage ignore next 2 */
  if (typeof module === 'object' && module.exports) module.exports = core
  else self.Core = core
})(function () {
  'use strict'

  // ---------- numbers ----------
  /** Always-positive remainder: mod(-1, 12) = 11. [N-0] */
  const mod = (n, m) => ((n % m) + m) % m
  /** Angle to [-180, 180). [W-1] */
  const norm = (d) => mod(d + 180, 360) - 180

  // ---------- names ----------
  // Only the twelve sharp names, as on a guitar tuner (user's choice): no flats, no E♯/B♯, no double sharps. [N-1]
  const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  // Small flat twins shown on the circle for the black keys. [N-2]
  const FLAT = { 1: 'D♭', 3: 'E♭', 6: 'G♭', 8: 'A♭', 10: 'B♭' }
  const MAJOR = [0, 2, 4, 5, 7, 9, 11] // semitones of the major scale [M-1]
  const QUALITY = ['', 'm', 'm', '', '', 'm', '°'] // triads on its steps [M-1]
  /** Sector i of the circle (clockwise from the top) → pitch class of its major key: C G D A E B F♯ … F. [C-1] */
  const pcOf = (i) => (i * 7) % 12
  /** Relative minor of a major key: 3 semitones down (= 9 up). [C-2] */
  const minorOf = (pc) => (pc + 9) % 12

  // ---------- modes ----------
  // root: where the mode's home NOTE sits on the outer ring, in sectors from the top (D dorian with C on top: +2).
  // home: which highlighted chord sector is home — [ring, offset from the top]; none for locrian (diminished home).
  // spice: the degree that gives the mode its colour. progs: ten common progressions as indexes into the mode's
  // chords (0 = home) — the sheet shows the first five, «Подбор» all ten. [M-2] [M-3] [M-4]
  const MODES = [
    { home: ['maj', 0], root: 0, deg: 'I ii iii IV V vi vii°', spice: null,
      progs: [[0, 4, 5, 3], [0, 3, 4], [5, 3, 0, 4], [0, 5, 3, 4], [1, 4, 0], [0, 3, 5, 4], [0, 4, 3], [0, 2, 3, 4], [3, 0, 4, 5], [0, 5, 1, 4]] },
    { home: ['min', -1], root: 2, deg: 'i ii ♭III IV v vi° ♭VII', spice: '6',
      progs: [[0, 3], [0, 1], [0, 6, 3], [0, 2, 3], [0, 4, 6, 3], [0, 3, 6, 0], [0, 6, 0], [2, 3, 0], [0, 3, 4], [0, 1, 2, 1]] },
    { home: ['min', 1], root: 4, deg: 'i ♭II ♭III iv v° ♭VI ♭vii', spice: '♭2',
      progs: [[0, 1], [0, 1, 2, 1], [0, 5, 6, 0], [0, 3, 1], [0, 1, 6, 0], [0, 2, 1], [3, 2, 1, 0], [0, 5, 1], [0, 6, 5, 1], [1, 0]] },
    { home: ['maj', -1], root: -1, deg: 'I II iii ♯iv° V vi vii', spice: '♯4',
      progs: [[0, 1], [0, 1, 2], [0, 4, 1], [0, 5, 1, 0], [0, 1, 6, 0], [0, 1, 4], [0, 2, 1], [5, 1, 0], [0, 6, 1], [1, 0]] },
    { home: ['maj', 1], root: 1, deg: 'I ii iii° IV v vi ♭VII', spice: '♭7',
      progs: [[0, 6, 3, 0], [0, 6], [0, 4, 3], [6, 3, 0], [0, 3, 0, 6], [0, 3, 6, 3], [0, 4, 6, 3], [0, 1, 3], [0, 5, 6], [3, 6, 0]] },
    { home: ['min', 0], root: 3, deg: 'i ii° ♭III iv v ♭VI ♭VII', spice: '♭6',
      progs: [[0, 5, 6], [0, 6, 5, 6], [0, 5, 2, 6], [0, 3, 4], [0, 3, 6, 2], [0, 6, 5, 4], [0, 2, 6, 3], [0, 3, 5, 6], [5, 6, 0], [0, 5, 3, 4]] },
    { home: null, root: 5, deg: 'i° ♭II ♭iii iv ♭V ♭VI ♭vii', spice: '♭5',
      progs: [[0, 1], [0, 4], [0, 3, 1], [1, 0], [0, 5, 4], [0, 2, 1], [0, 6, 5], [0, 1, 2], [3, 1, 0], [0, 4, 5, 1]] },
  ]

  /** Key on top (sector i) in mode m: home note, the mode's notes and chords (pitch classes and names). [M-1] */
  function scale(i, m) {
    const p = pcOf(i), pcs = MAJOR.map((s) => (p + s) % 12)
    const rot = (a) => [...a.slice(m), ...a.slice(0, m)]
    const notePcs = rot(pcs), quals = rot(QUALITY)
    return { home: notePcs[0], root: NOTE[notePcs[0]], pcs: notePcs, notes: notePcs.map((x) => NOTE[x]),
      chords: notePcs.map((x, n) => NOTE[x] + quals[n]), parent: NOTE[p] }
  }

  // ---------- degrees ----------
  const SEMI = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7']
  /** Degree of pitch class pc relative to home: 1, ♭2, 2 …; the tritone is ♯4 in lydian, ♭5 elsewhere. [D-1] */
  const degreeOf = (pc, home, m) => { const s = mod(pc - home, 12); return s === 6 && m === 3 ? '♯4' : SEMI[s] }
  /** Degree written on the ring at offset pos (sectors from the top, −5…6) in mode m. [D-2] */
  const degreeAt = (pos, m) => degreeOf(mod(pos * 7, 12), mod(MODES[m].root * 7, 12), m)
  /** The 12 numbers of the degree ring, clockwise from the top: text, under the scale arc?, home? [D-2] [D-3] */
  function degreeRing(m) {
    return [...Array(12)].map((_, j) => {
      const pos = j > 6 ? j - 12 : j
      return { text: degreeAt(pos, m), in: pos >= -1 && pos <= 5, home: pos === MODES[m].root }
    })
  }

  // ---------- the circle screen ----------
  /** Highlight of every sector for key i on top in mode m: hi = one of the six chords, tonic = home. [C-3] [M-2] */
  function sectorStates(i, m) {
    const home = MODES[m].home, out = { maj: [], min: [] }
    for (const ring of ['maj', 'min']) for (let j = 0; j < 12; j++) {
      const d = mod(j - i + 6, 12) - 6
      out[ring].push({ hi: Math.abs(d) <= 1, tonic: !!home && home[0] === ring && home[1] === d })
    }
    return out
  }
  /** Where a tapped chord sits on the circle: major → outer ring, minor → inner ring, anything else (B°, no sector of
   *  its own) → its root on the outer ring, drawn dashed. j = sector index (7 is its own inverse mod 12). [C-6] */
  function pickSector(name) {
    const x = parseInput(name, false).items[0], minor = /^m(?!aj)/.test(name.replace(/^[A-G]♯?/, ''))
    if (minor) return { ring: 'min', j: ((x.root + 3) * 7) % 12, dashed: false }
    return { ring: 'maj', j: (x.root * 7) % 12, dashed: x.name.includes('°') }
  }
  /** Title under the circle and the two lines in its centre. [C-4] */
  function keyLabels(i, m) {
    const sc = scale(i, m), pc = pcOf(i), min = NOTE[minorOf(pc)]
    return { title: m === 0 ? S.majMin(NOTE[pc], min) : `${sc.root} ${MODES[m].name}`,
      big: sc.root, small: m === 0 ? min + 'm' : MODES[m].name }
  }
  /** Chord tiles: the mode's seven chords from home, with degree numerals. [C-5] */
  const tiles = (i, m) => { const deg = MODES[m].deg.split(' '); return scale(i, m).chords.map((name, n) => ({ name, degree: deg[n], tonic: n === 0 })) }
  /** «Что за лад?»: styles, examples, the first five progressions in this key. [M-4] */
  function aboutContent(i, m) {
    const sc = scale(i, m), M = MODES[m], deg = M.deg.split(' ')
    return { title: `${sc.root} ${M.name}`, styles: M.styles, examples: M.examples,
      progs: M.progs.slice(0, 5).map((p) => `${p.map((n) => sc.chords[n]).join(' – ')}   (${p.map((n) => deg[n]).join('–')})`) }
  }

  // ---------- wheel math ----------
  /** Wheel angle → key on top (nearest sector). [W-2] */
  const selectedIndex = (rot) => mod(Math.round(-rot / 30), 12)
  /** Angle that puts key i on top. [W-2] */
  const keyAngle = (i) => norm(-30 * i)
  /** Target angle to bring key i to the top by the shorter way round. [W-3] */
  const turnTo = (rot, i) => rot + norm(-i * 30 - rot)
  /** Nearest resting angle (a multiple of 30°). [W-4] */
  const snap = (rot) => Math.round(rot / 30) * 30
  /** Animation length for a turn: 4 ms per degree, 220…700 ms. [W-5] */
  const turnDuration = (from, to) => Math.min(700, Math.max(220, Math.abs(to - from) * 4))
  /** Ease-out cubic, 0…1 → 0…1. [W-5] */
  const easeOut = (p) => 1 - Math.pow(1 - p, 3)
  /** Point relative to the wheel centre (screen y down) → angle from the top, clockwise, and distance. [W-6] */
  const angleOf = (x, y) => ({ deg: (Math.atan2(x, -y) * 180) / Math.PI, dist: Math.hypot(x, y) })
  /** Where a released wheel comes to rest: the speed of the last 100 ms carried on for 300 ms (max one turn),
   *  then snapped to a key. samples: [{ t, rot }] in time order. [W-7] */
  function flingTarget(rot, samples, now) {
    const recent = samples.filter((s) => now - s.t <= 100)
    let v = 0
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1]
      if (b.t > a.t) v = (b.rot - a.rot) / (b.t - a.t)
    }
    return snap(rot + Math.max(-360, Math.min(360, v * 300)))
  }
  /** Key moved by semitones, mode kept: one semitone = 7 sectors. [G-6] */
  const shiftedKey = (i, semis) => mod(i + semis * 7, 12)
  /** Swipe across the neck: ≥ 40 px and mostly sideways; left = +1 semitone, right = −1, else 0. [G-7] */
  const swipeStep = (dx, dy) => (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5 ? 0 : dx < 0 ? 1 : -1)

  // ---------- chords and sound ----------
  const SHAPE = { '': [0, 4, 7], m: [0, 3, 7], '°': [0, 3, 6] }
  const parseTriad = (name) => { const [, n, q] = /^([A-G]♯?)(m|°)?$/.exec(name); return { pc: NOTE.indexOf(n), shape: SHAPE[q || ''] } }
  /** Chord tile → MIDI notes: triad + root an octave up. The tonic sits in the octave from C3 (48) and every other
   *  chord is placed above it, so tiles always go up from left to right. [S-1] [S-2] */
  function chordNotes(name, tonic = name) {
    const t = 48 + parseTriad(tonic).pc, { pc, shape } = parseTriad(name)
    const root = t + mod(pc - (t % 12), 12)
    return [...shape.map((x) => root + x), root + 12]
  }
  /** Frequency of a MIDI note (A4 = 69 = 440 Hz). [S-3] */
  const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12)
  /** Notes of a parsed «Подбор» item: a note → one MIDI note from C4; a chord → its notes upward from its root in
   *  the octave from C3. [S-4] */
  const itemMidi = (x, asNotes) => (asNotes ? [60 + x.root] : x.pcs.map((p) => 48 + x.root + mod(p - x.root, 12)))

  // ---------- neck ----------
  // Open strings as MIDI notes, lowest string first. [G-1]
  const TUNINGS = {
    guitar: [
      { id: 'std', open: [40, 45, 50, 55, 59, 64] },
      { id: 'dropd', open: [38, 45, 50, 55, 59, 64] },
      { id: 'dstd', open: [38, 43, 48, 53, 57, 62] },
      { id: 'dropc', open: [36, 43, 48, 53, 57, 62] },
    ],
    bass: [
      { id: 'b4', open: [28, 33, 38, 43] },
      { id: 'b5', open: [23, 28, 33, 38, 43] },
    ],
    ukulele: [{ id: 'uke', open: [67, 60, 64, 69] }], // G C E A, the G high (re-entrant)
  }
  const FRETS = 12
  /** Tuning of an instrument by id, the first one if unknown. [G-1] */
  const tuningOf = (inst, id) => TUNINGS[inst].find((t) => t.id === id) || TUNINGS[inst][0]
  /** «Аккорды»: one list of the guitar's, the bass's and the ukulele's tunings (the instrument is chosen by its tuning);
   *  names are filled in by setLang. [G-1] */
  const ALL_TUNINGS = [...TUNINGS.guitar.map((t) => ({ id: t.id, open: t.open, inst: 'guitar' })),
    ...TUNINGS.bass.map((t) => ({ id: t.id, open: t.open, inst: 'bass' })), ...TUNINGS.ukulele.map((t) => ({ id: t.id, open: t.open, inst: 'ukulele' }))]
  /** A tuning by its id, the guitar's or the bass's; unknown → guitar standard. */
  const anyTuning = (id) => ALL_TUNINGS.find((t) => t.id === id) || ALL_TUNINGS[0]
  /** Dots on the neck for key i in mode m: every scale note on frets 0…12 of every string, with its degree,
   *  label and classes (home, spice, mine = in «Подбор» notes, chord / dim when a chord tile is selected). [G-2…G-5] */
  function neckDots(open, i, m, { chordPcs = null, minePcs = new Set() } = {}) {
    const sc = scale(i, m), inScale = new Set(sc.pcs), spice = MODES[m].spice, dots = []
    open.forEach((o, s) => {
      for (let f = 0; f <= FRETS; f++) {
        const midi = o + f, pc = midi % 12
        if (!inScale.has(pc)) continue
        const deg = degreeOf(pc, sc.home, m)
        const classes = [deg === '1' && 'home', deg === spice && 'spice', minePcs.has(pc) && 'mine',
          chordPcs && (chordPcs.includes(pc) ? 'chord' : 'dim')].filter(Boolean)
        dots.push({ s, f, midi, pc, deg, label: NOTE[pc], classes })
      }
    })
    return dots
  }
  /** Tapping a chord tile on a neck (guitar «Лады», bass): selects it (all its notes), the same tile again clears. [G-4] */
  const toggleChord = (current, name) => (current?.name === name ? null : { name, pcs: [...new Set(parseInput(name, false).items[0].pcs)] })
  /** Notes a tile plays: key triads go up from the row's tonic [S-2]; other chords (G7, Csus4 from «Подбор») from
   *  their root in the octave from C3 [S-4]. */
  const tileMidi = (name, tonic) => (/^[A-G]♯?(m|°)?$/.test(name) && /^[A-G]♯?(m|°)?$/.test(tonic)
    ? chordNotes(name, tonic) : itemMidi(parseInput(name, false).items[0], false))
  /** «Гитара» shows the chords entered in «Подбор» instead of the key's: name and degree of the root from home. [L-3] */
  const tilesFrom = (items, i, m) => items.map((x) => ({ name: x.name, degree: degreeOf(x.root, scale(i, m).home, m), tonic: false }))

  // ---------- chord diagrams (guitar) ----------
  /** Chord name with its flat twin for black-key roots: "A♯m" → "A♯m (B♭m)", "C" → "C". [A-1] */
  function twinName(name) {
    const [, root, rest] = /^([A-G]♯?)(.*)$/.exec(name), flat = FLAT[NOTE.indexOf(root)]
    return flat ? `${name} (${flat}${rest})` : name
  }
  // Familiar shapes (written for standard tuning), by chord type (semitones above the root). [A-7]
  //  move: [root string, frets relative to the root's fret r] — the E- and A-shapes guitarists move up the neck
  //        (r = 0 gives the open chord: E, A, Am, Em…; r = 1 on the E-shape is the F barre).
  //  open: absolute frets of open-position chords that don't move.
  const SHAPE_SIG = (pcs, root) => [...new Set(pcs.map((p) => mod(p - root, 12)))].sort((a, b) => a - b).join(',')
  const TEMPLATES = {
    '0,4,7': { move: [[0, [0, 2, 2, 1, 0, 0]], [1, [-1, 0, 2, 2, 2, 0]]], open: [[-1, 3, 2, 0, 1, 0], [3, 2, 0, 0, 0, 3], [-1, -1, 0, 2, 3, 2]] },
    '0,3,7': { move: [[0, [0, 2, 2, 0, 0, 0]], [1, [-1, 0, 2, 2, 1, 0]]], open: [[-1, -1, 0, 2, 3, 1]] },
    '0,4,7,10': { move: [[0, [0, 2, 0, 1, 0, 0]], [1, [-1, 0, 2, 0, 2, 0]]], open: [[-1, 3, 2, 3, 1, 0], [3, 2, 0, 0, 0, 1], [-1, -1, 0, 2, 1, 2], [-1, 2, 1, 2, 0, 2]] },
    '0,3,7,10': { move: [[0, [0, 2, 0, 0, 0, 0]], [1, [-1, 0, 2, 0, 1, 0]]], open: [[-1, -1, 0, 2, 1, 1]] },
    '0,4,7,11': { move: [[0, [0, 2, 1, 1, 0, 0]], [1, [-1, 0, 2, 1, 2, 0]]], open: [[-1, 3, 2, 0, 0, 0], [-1, -1, 3, 2, 1, 0], [-1, -1, 0, 2, 2, 2]] },
    '0,3,6': { move: [[1, [-1, 0, 1, 2, 1, -1]]], open: [] },
    '0,5,7': { move: [[0, [0, 2, 2, 2, 0, 0]], [1, [-1, 0, 2, 2, 3, 0]]], open: [[-1, -1, 0, 2, 3, 3]] },
    '0,2,7': { move: [[1, [-1, 0, 2, 2, 0, 0]]], open: [[-1, -1, 0, 2, 3, 0]] },
    '0,7': { move: [[0, [0, 2, 2, -1, -1, -1]], [1, [-1, 0, 2, 2, -1, -1]]], open: [] },
  }

  /** Playable fingerings of a chord on a guitar with open strings `open` (MIDI, lowest first), best first.
   *  A voicing: frets per string (−1 muted, 0 open), barre { fret, from, to } or null, fingers, first shown fret.
   *  Rules [A-2…A-6]: the lowest sounding note is the root; every chord note sounds (the fifth may go in chords of
   *  4+ notes); only edge strings may be muted, at least 3 strings sound; fretted notes fit in 4 frets; at most 4
   *  fingers, a barre (more than 4 fretted notes) counting as one; open strings only in the first positions.
   *  A re-entrant tuning (strings not low to high, like the ukulele's high G) plays inversions on all strings: no
   *  root-in-the-bass rule, no muted strings. */
  function voicings(open, name, limit = 6) {
    const x = parseInput(name, false).items[0], pcs = new Set(x.pcs), root = x.root, n = open.length
    const reentrant = open.some((m, s) => s > 0 && m < open[s - 1])
    const need = [...pcs].filter((p) => !(pcs.size >= 4 && p === (root + 7) % 12))
    const found = new Map(), cur = []
    function consider(frets, bonus = 0) {
      const sounding = frets.map((f, s) => (f >= 0 ? s : -1)).filter((s) => s >= 0)
      if (sounding.length < 3 || sounding.at(-1) - sounding[0] + 1 !== sounding.length) return // no muted string in the middle
      if (reentrant && sounding.length < n) return // a ukulele chord rings on all its strings
      if (!reentrant && (open[sounding[0]] + frets[sounding[0]]) % 12 !== root) return // root in the bass
      const heard = new Set(sounding.map((s) => (open[s] + frets[s]) % 12))
      if (!need.every((p) => heard.has(p)) || [...heard].some((p) => !pcs.has(p))) return // all chord notes, nothing else
      const fretted = frets.filter((f) => f > 0), min = Math.min(...fretted)
      let barre = null, fingers = fretted.length
      if (fingers > 4) { // one finger lies across the lowest fret: no open string may sit under it
        const at = frets.map((f, s) => (f === min ? s : -1)).filter((s) => s >= 0), from = at[0], to = at.at(-1)
        if (frets.slice(from, to + 1).some((f) => f === 0)) return
        fingers = 1 + fretted.filter((f) => f > min).length
        if (fingers > 4) return
        barre = { fret: min, from, to }
      }
      const key = frets.join(' ')
      if (found.has(key)) return
      // Lower is better: low on the neck, short stretch, few fingers, no barre, muted top strings worst.
      const top = Math.max(0, ...fretted), low = fretted.length ? min : 0
      const bassMuted = sounding[0], trebleMuted = n - 1 - sounding.at(-1), opens = frets.filter((f) => f === 0).length
      const score = top * 0.8 + low * 0.4 + fingers + bassMuted * 1.5 + trebleMuted * 3 + (barre ? 1.5 : 0) - opens * 0.3 - bonus
      found.set(key, { frets, barre, fingers, first: top <= 4 ? 1 : min, score })
    }
    // Familiar shapes first, then everything else the search finds. The shapes are written for standard tuning; in
    // other tunings the same finger shapes sound other chords and only those that fit this chord pass the checks
    // (D standard keeps all of them, a tone lower; drop tunings lose those that use the low string).
    const tpl = n === 6 && TEMPLATES[SHAPE_SIG(x.pcs, root)] // guitar shapes: six strings only (not a bass)
    if (tpl) {
      for (const f of tpl.open) consider(f, 6)
      for (const [rs, pat] of tpl.move) { const r = mod(root - open[rs], 12); consider(pat.map((p) => (p < 0 ? -1 : p + r)), 5) }
    }
    for (let base = 0; base <= 12; base++) {
      const cand = open.map((o) => {
        const c = [-1]
        if (base <= 3 && pcs.has(o % 12)) c.push(0)
        for (let f = Math.max(1, base); f <= base + 3; f++) if (pcs.has((o + f) % 12)) c.push(f)
        return c
      })
      const rec = (s) => { if (s === n) return consider([...cur]); for (const f of cand[s]) { cur.push(f); rec(s + 1); cur.pop() } }
      rec(0)
    }
    return [...found.values()].sort((a, b) => a.score - b.score).slice(0, limit)
  }

  /** Sounding notes of a voicing, low string to high (for strumming it). [A-8] */
  const voicingMidi = (open, frets) => frets.map((f, s) => (f < 0 ? -1 : open[s] + f)).filter((m) => m >= 0)
  /** Layout of a chord diagram: strings left = low, frets top-down from `first`; always 4 rows (fretted notes fit 4 frets).
   *  marks above the nut: 'open' / 'mute'; dots: { s, row (1-based), root }; barre: { row, from, to, root } or null —
   *  the strings under the barre get no separate dot at that fret; names: the note under each string ('' if muted). [A-9] */
  function diagram(open, v, root) {
    const pcOfString = (s) => (open[s] + v.frets[s]) % 12
    const marks = v.frets.map((f, s) => (f === 0 ? { s, kind: 'open' } : f < 0 ? { s, kind: 'mute' } : null)).filter(Boolean)
    const under = (s) => v.barre && s >= v.barre.from && s <= v.barre.to && v.frets[s] === v.barre.fret
    const barre = v.barre && { row: v.barre.fret - v.first + 1, from: v.barre.from, to: v.barre.to,
      root: v.frets.some((f, s) => under(s) && pcOfString(s) === root) }
    const dots = v.frets.map((f, s) => ({ s, f })).filter(({ s, f }) => f > 0 && !under(s))
      .map(({ s, f }) => ({ s, row: f - v.first + 1, root: pcOfString(s) === root }))
    return { first: v.first, rows: 4, marks, dots, barre, names: v.frets.map((f, s) => (f < 0 ? '' : NOTE[pcOfString(s)])) }
  }

  // ---------- metronome ----------
  // Accent per click of a bar: 2 strong, 1 medium, 0 weak. In 6/8 every click is an eighth note. [T-2]
  const METERS = { '2/4': [2, 1], '3/4': [2, 1, 1], '4/4': [2, 1, 1, 1], '6/8': [2, 0, 0, 1, 0, 0],
    '9/8': [2, 0, 0, 1, 0, 0, 0, 0, 0], '12/8': [2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] }
  const BPM_MIN = 40, BPM_MAX = 240
  /** Tempo kept to whole beats per minute in 40…240; anything unreadable → 120. [T-1] */
  const clampBpm = (n) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(+n || 120)))
  const CLICK_HZ = [800, 1100, 1600] // click pitch: weak, medium, strong [T-4]
  /** Tap tempo: taps (seconds) more than 2 s after the previous one start over; the tempo is the average of the last
   *  four intervals (needs two taps). Returns the taps to keep and the tempo or null. [T-3] */
  function tapTempo(taps, now) {
    const kept = [...(taps.length && now - taps.at(-1) > 2 ? [] : taps), now].slice(-5)
    const bpm = kept.length < 2 ? null : clampBpm(60 / ((kept.at(-1) - kept[0]) / (kept.length - 1)))
    return { taps: kept, bpm }
  }
  /** Clicks to schedule: from time `next` (s) on beat `beat` of a bar of `beats`, every 60 / bpm s, while before
   *  `until`. Returns them with where to continue from. [T-5] */
  function ticks(next, beat, bpm, beats, until) {
    const out = []
    while (next < until) { out.push({ time: next, beat }); next += 60 / bpm; beat = (beat + 1) % beats }
    return { out, next, beat }
  }

  // ---------- tuner ----------
  /** Pitch of a sound (Hz) by YIN: the lag where the signal best repeats itself. null for silence (RMS < 0.01) or no
   *  clear pitch. buf — samples, rate — sample rate, minHz / maxHz — the range to look in. [K-1] */
  function detectPitch(input, rate, minHz, maxHz = 1400) {
    // two passes of a one-pole low-pass at maxHz: the room's hiss is broadband, a string's fundamental is below it
    const k = 1 - Math.exp((-2 * Math.PI * maxHz) / rate), lp = Float32Array.from(input)
    for (let pass = 0; pass < 2; pass++) for (let i = 0, y = lp[0]; i < lp.length; i++) lp[i] = y += k * (lp[i] - y)
    const buf = lp.subarray(Math.ceil(12 / k)) // the filter's start-up would bend the first periods
    let rms = 0
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
    if (Math.sqrt(rms / buf.length) < 0.0002) return null // quieter than this is the room, not a string
    const maxTau = Math.min(Math.floor(rate / minHz), Math.floor(buf.length / 2)), minTau = Math.max(2, Math.floor(rate / maxHz))
    const W = buf.length - maxTau, d = new Float64Array(maxTau + 1), cmnd = new Float64Array(maxTau + 1)
    let run = 0
    cmnd[0] = 1
    for (let tau = 1; tau <= maxTau; tau++) { // difference function, cumulative-mean normalised
      let s = 0
      for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x }
      run += s
      d[tau] = s
      cmnd[tau] = (s * tau) / run
    }
    let tau = -1
    for (let t = minTau; t < maxTau && tau < 0; t++) if (cmnd[t] < 0.2) { // first dip under the threshold, then its bottom
      while (t + 1 < maxTau && cmnd[t + 1] < cmnd[t]) t++
      tau = t
    }
    if (tau < 0) return null
    // a lower string ringing along (an open string whose harmonic is this note) leaves the deeper dip at a multiple of
    // the period: a clear dip at 1/4, 1/3 or 1/2 of it is the note actually played
    for (let k = 4; k >= 2; k--) {
      const c = Math.round(tau / k)
      if (c - 4 < minTau) continue
      let t = c - 3 // the bottom near tau / k; it counts only as a real dip, not a slope
      for (let i = c - 2; i <= c + 3; i++) if (cmnd[i] < cmnd[t]) t = i
      if (t > c - 3 && t < c + 3 && cmnd[t] < 0.4) { tau = t; break }
    }
    const a = d[tau - 1], b = d[tau], c = d[tau + 1] // parabola through the raw dip (the normalised one leans): a sub-sample lag
    return rate / (tau + (a - c) / (2 * (a + c - 2 * b) + 1e-12))
  }
  /** How far a frequency is from a target note, in cents (100 = a semitone; − = too low). [K-2] */
  const centsOff = (hz, midi) => 1200 * Math.log2(hz / freq(midi))
  /** The nearest note to a frequency: name, octave (C4 = middle C) and cents off it. [K-3] */
  function noteOf(hz) {
    const m = 69 + 12 * Math.log2(hz / 440), midi = Math.round(m)
    return { midi, name: NOTE[mod(midi, 12)], octave: Math.floor(midi / 12) - 1, cents: Math.round((m - midi) * 100) }
  }
  /** «Авто»: the open string closest in pitch to what is heard. [K-4] */
  const nearestString = (hz, open) => open.reduce((best, m, s) => (Math.abs(centsOff(hz, m)) < Math.abs(centsOff(hz, open[best])) ? s : best), 0)
  /** In tune within ±5 cents; otherwise too low (tighten) or too high (loosen). [K-5] */
  const tuneStatus = (cents) => (Math.abs(cents) <= 5 ? 'ok' : cents < 0 ? 'low' : 'high')
  /** Median of the last readings: one stray reading doesn't jerk the needle. [K-6] */
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }

  // ---------- «Подбор»: parsing ----------
  const SHAPES = { '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], '-': [0, 3, 7], dim: [0, 3, 6], '°': [0, 3, 6],
    o: [0, 3, 6], aug: [0, 4, 8], '+': [0, 4, 8], 5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10],
    m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], sus: [0, 5, 7], sus2: [0, 2, 7],
    sus4: [0, 5, 7], add9: [0, 4, 7, 2], 9: [0, 4, 7, 10, 2] }
  const SUFFIX = { maj: '', min: 'm', '-': 'm', o: '°', dim: '°', sus: 'sus4' } // how a suffix is shown back
  const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  /** "Am F#m Bb7" → { items: [{ root, pcs, name }], bad: [unknown tokens] }; notes mode: single notes only. [F-P1…F-P5] */
  function parseInput(text, asNotes) {
    const items = [], bad = []
    for (const tok of text.split(/[\s,;|–—→>]+|-(?=[A-Ga-g])/).filter(Boolean)) {
      const m = /^([A-Ga-g])([#♯b♭]?)(.*)$/.exec(tok)
      const rest = m ? m[3].replace('♯', '#').replace('♭', 'b') : null
      const shape = m && (asNotes ? (rest === '' ? [0] : null) : SHAPES[rest] ?? SHAPES[rest.toLowerCase()])
      if (!shape) { bad.push(tok); continue }
      const root = mod(LETTER[m[1].toUpperCase()] + (/[#♯]/.test(m[2]) ? 1 : 0) - (/[b♭]/.test(m[2]) ? 1 : 0), 12)
      const suf = asNotes ? '' : (SUFFIX[rest] ?? SUFFIX[rest.toLowerCase()] ?? rest)
      items.push({ root, pcs: shape.map((s) => (root + s) % 12), name: NOTE[root] + suf })
    }
    return { items, bad }
  }

  // ---------- «Подбор»: which mode ----------
  const PRIOR = [1, 0.5, 0.2, 0.2, 0.5, 0.9, 0] // how common each mode is: breaks ties towards major / minor
  /** All 84 (key, mode) pairs ranked: fewest notes outside the mode, then home = first / last / any input root,
   *  a chord on home agreeing with the mode's home chord, then how common the mode is. [F-R1…F-R6] */
  function rankModes(items) {
    const need = [...new Set(items.flatMap((x) => x.pcs))], first = items[0]?.root, last = items.at(-1)?.root
    const roots = new Set(items.map((x) => x.root)), out = []
    for (let i = 0; i < 12; i++) for (let m = 0; m < 7; m++) {
      const sc = scale(i, m), S = new Set(sc.pcs), missing = need.filter((p) => !S.has(p))
      const third = sc.pcs[2], onHome = items.filter((x) => x.root === sc.home && x.pcs.length > 1)
      const agree = onHome.length ? (onHome.every((x) => x.pcs.includes(third)) ? 2 : -3) : 0
      const score = -100 * missing.length + (sc.home === first ? 3 : 0) + (sc.home === last ? 2 : 0) +
        (roots.has(sc.home) ? 2 : 0) + agree + PRIOR[m]
      out.push({ i, m, sc, missing, score })
    }
    return out.sort((a, b) => b.score - a.score)
  }
  /** What usually comes after the last chord: degree → next degree counted over the mode's ten progressions
   *  (around each loop), top three, ties by degree. [F-N1] */
  function nextChords(r, items) {
    const lastDeg = r.sc.pcs.indexOf(items.at(-1)?.root)
    if (lastDeg < 0) return []
    const count = new Map()
    for (const p of MODES[r.m].progs) p.forEach((d, k) => {
      if (d !== lastDeg) return
      const nx = p[(k + 1) % p.length]
      if (nx !== d) count.set(nx, (count.get(nx) || 0) + 1)
    })
    return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([d]) => r.sc.chords[d])
  }
  /** What «Подбор» marks on the other tabs: major / minor chord roots for the circle, names for tiles, notes. [L-2] */
  function marksFrom(items, asNotes) {
    const maj = new Set(), min = new Set(), names = new Set(items.map((x) => x.name)), notes = new Set()
    for (const x of items) {
      if (asNotes) { maj.add(x.root); notes.add(x.root) } // outer ring letters double as note names
      else if (/m$|m7$/.test(x.name)) min.add(x.root)
      else if (!/°/.test(x.name)) maj.add(x.root)
    }
    return { maj, min, names, notes }
  }

  // ---------- song index ----------
  // Song = [title, artist, fame, chart note, chords, tonics]: chords coded relative to each section's tonic
  // ('a'+k major-ish, 'A'+k minor, 'n'+k diminished; '|' between sections; one hex tonic per section). [I-1]
  /** Chord name → its code letter relative to home. [I-2] */
  function chordCode(name, home) {
    const m = /^([A-G]♯?)(.*)$/.exec(name), off = mod(NOTE.indexOf(m[1]) - home, 12), q = m[2]
    const base = q.includes('°') ? 'n' : /^m(?!aj)/.test(q) ? 'A' : 'a'
    return String.fromCharCode(base.charCodeAt(0) + off)
  }
  /** Progression → code string, repeated neighbours merged. [I-3] */
  const progCode = (names, home) => names.map((n) => chordCode(n, home)).filter((c, k, a) => k === 0 || c !== a[k - 1]).join('')
  /** Songs containing a code string (the index is sorted most famous first). [I-4] */
  const songsWith = (songs, code) => (songs || []).filter((s) => s[4].includes(code))
  /** "Artist — Title · chart note". [I-5] */
  const songLine = (s) => `${s[1]} — ${s[0]}` + (s[3] ? ` · ${s[3]}` : '')
  /** Code letters → chord names in a key: decode('Aki', 4) → Em D C. [I-6] */
  const decode = (codes, tonic) => [...codes].map((c) => {
    const k = c.charCodeAt(0), [base, suf] = c >= 'n' ? [110, '°'] : c >= 'a' ? [97, ''] : [65, 'm']
    return NOTE[(tonic + k - base) % 12] + suf
  })
  const sectionsOf = (s) => s[4].split('|').map((codes, k) => ({ codes, tonic: parseInt(s[5][k], 16) }))
  /** Where a progression sits in a song → its chords as played there ("Em – C – G – D"). [I-7] */
  function asPlayed(s, code) {
    const sec = sectionsOf(s).find((x) => x.codes.includes(code))
    return sec ? decode(code, sec.tonic).join(' – ') : ''
  }
  /** Loose match: the user's chord codes in the song's key, from the section that has most of them. [I-8] */
  function chordsThere(s, codes) {
    const best = sectionsOf(s).map((x) => ({ x, n: codes.filter((c) => x.codes.includes(c)).length })).sort((a, b) => b.n - a.n)[0]
    return codes.map((c) => decode(c, best.x.tonic)[0]).join(', ')
  }

  // ---------- «Подбор»: the whole answer ----------
  /** Everything «Подбор» shows for the tapped tokens, as data. pick: which of the equally fitting modes is shown;
   *  songs: the song index or null while it loads. [F-A1…F-A9] */
  function analyze(tokens, asNotes, pick, songs) {
    const { items, bad } = parseInput(tokens.join(' '), asNotes)
    const out = { items, bad, result: null }
    if (!items.length) {
      out.prompt = asNotes ? S.anNotes : S.anChords
      return out
    }
    const ranked = rankModes(items), best = ranked[0].missing.length
    const fits = ranked.filter((x) => x.missing.length === best)
    const idx = Math.min(pick, fits.length - 1), r = fits[idx], M = MODES[r.m]
    const usedNames = new Set(items.map((x) => x.name)), usedPcs = new Set(items.flatMap((x) => x.pcs)) // what the input uses [F-H1]
    out.result = { i: r.i, m: r.m, title: `${r.sc.root} ${M.name}`, sub: S.modeHint[r.m], notes: S.notes(r.sc.notes.join(' ')),
      chords: tiles(r.i, r.m).map((t) => ({ name: t.name, degree: t.degree, used: usedNames.has(t.name) })),
      scale: r.sc.notes.map((name, k) => ({ name, used: usedPcs.has(r.sc.pcs[k]) })) }
    out.messages = [] // [{ kind: 'warn' | 'note' | 'ok', text }]
    out.offerNotes = false
    if (r.missing.length) {
      const miss = r.missing.map((p) => NOTE[p]).join(', ')
      if (r.m === 5 && r.missing.length === 1 && r.missing[0] === (r.sc.home + 11) % 12) {
        out.messages.push({ kind: 'warn', text: S.harmonic(miss, r.sc.root) })
      } else {
        const offItems = items.filter((x) => x.pcs.some((p) => r.missing.includes(p)))
        const one = r.missing.length === 1, notesOf = (x) => x.pcs.map((p) => NOTE[p]).join(', ')
        out.messages.push({ kind: 'warn', text: S.allBut(one, miss) + (asNotes ? '' : ' ' +
          offItems.map((x) => S.inside(one, x.name, notesOf(x))).filter((t, k, a) => a.indexOf(t) === k).join(' ')) })
        const offPcs = offItems.flatMap((x) => x.pcs)
        const alt = !asNotes && ranked.find((x) => x.sc.home === r.sc.home && x.m !== r.m && offPcs.every((p) => x.sc.pcs.includes(p)))
        if (alt) out.messages.push({ kind: 'note', text: S.borrowed(offItems.map((x) => x.name).join(', '), alt.sc.root, alt.m) })
        out.offerNotes = !asNotes && tokens.every((t) => /^[A-G]♯?$/.test(t))
      }
    } else if (asNotes) {
      const set = new Set(items.map((x) => x.root)), h = r.sc.home
      const pent = (steps) => steps.length === set.size && steps.every((s) => set.has((h + s) % 12))
      if (pent([0, 3, 5, 7, 10])) out.messages.push({ kind: 'ok', text: S.pentMinor(r.sc.root) })
      else if (pent([0, 2, 4, 7, 9])) out.messages.push({ kind: 'ok', text: S.pentMajor(r.sc.root) })
    }
    // Never fewer than 7 equally fitting modes: the 7 modes of one parent major share its notes. [F-A2]
    out.alternatives = fits.slice(0, 5).map((f, k) => ({ label: `${f.sc.root} ${MODES[f.m].name}`, on: k === idx }))
    out.songs = null
    if (!asNotes && songs && items.length > 1) {
      const names = items.map((x) => x.name), code = progCode(names, r.sc.home)
      const codes = [...new Set(names.map((n) => chordCode(n, r.sc.home)))]
      const exact = songsWith(songs, code)
      const found = exact.length ? exact : songs.filter((s) => codes.every((c) => s[4].includes(c)))
      out.songs = { title: exact.length ? S.hitsExact : S.hitsSame,
        list: found.slice(0, 5).map((s) => ({ line: songLine(s), played: exact.length ? S.inSong(asPlayed(s, code)) : S.there(chordsThere(s, codes)) })),
        more: Math.max(0, found.length - 5) }
    }
    out.next = asNotes ? [] : nextChords(r, items)
    out.tonicChord = r.sc.chords[0]
    // Ten progressions: first those containing the user's chords in a row (in order, around the loop), then by how
    // many different user chords they use, then the usual top order. [F-A7]
    const names = items.map((x) => x.name), have = new Set(names), deg = M.deg.split(' ')
    const inRow = (cs) => names.length > 1 && (' ' + [...cs, ...cs].join(' ') + ' ').includes(' ' + names.join(' ') + ' ')
    out.progsTitle = S.top10(`${r.sc.root} ${M.name}`)
    out.progs = M.progs.map((p, k) => ({ k, chords: p.map((d) => r.sc.chords[d]), degrees: p.map((d) => deg[d]).join('–') }))
      .map((x) => ({ ...x, row: inRow(x.chords) ? 1 : 0, hits: new Set(x.chords.filter((c) => have.has(c))).size }))
      .sort((a, b) => b.row - a.row || b.hits - a.hits || a.k - b.k)
      .map(({ chords, degrees }) => {
        const hits = songs ? songsWith(songs, progCode(chords, r.sc.home)) : []
        return { chords, degrees, have: chords.map((c) => have.has(c)),
          songs: hits.length ? hits.slice(0, 2).map((s) => `${s[1]} — ${s[0]}`).join(' · ') + (hits.length > 2 ? ` · ${S.more(hits.length - 2)}` : '') : '' }
      })
    out.credit = S.credit
    return out
  }

  // ---------- songs (practice loop) ----------
  // Parts are stored by code and shown in the app's language; old names (Russian, English) are read as codes. [R-1] [E-3]
  const PARTS = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'solo', 'outro']
  /** The next part, round the list; an unknown one → the first. [R-1] */
  const nextPart = (name) => PARTS[(PARTS.indexOf(name) + 1) % PARTS.length]
  /** A part's name to show: a code → its name in the app's language; anything else as is. [E-3] */
  const partLabel = (code) => S.parts[PARTS.indexOf(code)] ?? code
  /** A stored part name → its code: a code stays, a Russian or English name of a part → its code, else as is. [E-3] */
  const partCode = (name) => { const k = Math.max(STR.ru.parts.indexOf(name), STR.en.parts.indexOf(name)); return k < 0 ? name : PARTS[k] }
  /** Any language's draft name is the draft (renamed to the app's language on reading). [R-2] [E-4] */
  const isDraft = (name) => name === STR.ru.draft || name === STR.en.draft
  const newSong = (name) => ({ name, bpm: 100, meter: '4/4', loop: false, parts: [{ name: 'verse', times: 1, bars: [], lyrics: [] }] })
  /** Folder paths are stored as slash-separated names; invalid storage behaves as an empty tree. [R-23] */
  function readFolders(json) {
    try { return JSON.parse(json).filter((p) => typeof p === 'string' && p && !p.startsWith('/') && !p.endsWith('/') && !p.includes('//')) }
    catch { return [] }
  }
  /** Song locations are keyed by unique song title, with '' meaning the root. [R-23] */
  function readFolderLocations(json) {
    try { const locations = JSON.parse(json); return locations && typeof locations === 'object' && !Array.isArray(locations) ? locations : {} }
    catch { return {} }
  }
  /** Add a nested folder under `parent`, keeping sibling names unique. [R-23] */
  function addFolder(paths, parent, name) {
    const label = name.trim().replace(/[\\/]/g, '').slice(0, 40), path = [parent, label].filter(Boolean).join('/')
    return !label || paths.includes(path) ? { paths, path: null } : { paths: [...paths, path], path }
  }
  const folderChildren = (paths, parent) => {
    const prefix = parent ? `${parent}/` : ''
    return paths.filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
  }
  const folderParent = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  /** «Песня N» («Song N») with the first N not taken. [R-1] */
  function songName(songs) {
    let n = 1
    while (songs.some((s) => s.name === S.song(n))) n++
    return S.song(n)
  }
  const loop4 = (name, times, chords) => ({ name, times, bars: chords.map((c) => [c]), lyrics: [] })
  // Earlier examples, as stored (part names as codes: cleanSong reads them so): untouched on a phone → gone. [R-9]
  const OLD_VIVA = { name: 'Coldplay — Viva La Vida', bpm: 138, meter: '4/4', loop: false,
    parts: ['intro', 'verse', 'chorus'].map((p) => loop4(p, 2, ['C♯', 'D♯', 'G♯', 'Fm'])) }
  const OLD_DEMONS = { name: 'Imagine Dragons — Demons', bpm: 90, meter: '4/4', loop: false,
    parts: [['intro', 1], ['verse', 2], ['chorus', 2]].map(([p, n]) => loop4(p, n, ['D♯', 'A♯', 'Cm', 'G♯'])) }
  const OLD_DEMONS2 = { ...OLD_DEMONS, name: 'Пример: Imagine Dragons — Demons' }
  const OLD_KINO = { name: 'Пример: Кино — Звезда по имени Солнце', bpm: 128, meter: '4/4', loop: false,
    parts: [['intro', 1], ['verse', 2], ['chorus', 2]].map(([p, n]) => loop4(p, n, ['Am', 'C', 'Dm', 'G'])) }
  // each chord rings two bars, as in the record: the same chord in bars next to each other plays as one long chord [R-6]
  const two = (chords) => chords.flatMap((c) => [[c], [c]]) // each chord two bars
  const paired = (chords) => [chords.slice(0, 2), chords.slice(0, 2), chords.slice(2, 4), chords.slice(2, 4),
    chords.slice(0, 2), chords.slice(0, 2), chords.slice(2, 4), chords.slice(2, 4)]
  const words = (...passes) => passes.map((lines) => lines.map((text, i) => ({ bar: i * 2, text })))
  const KINO2 = { ...OLD_KINO, parts: [['intro', 1], ['verse', 2], ['chorus', 2]].map(([p, n]) => loop4(p, n, ['Am', 'Am', 'C', 'C', 'Dm', 'Dm', 'G', 'G'])) }
  const OLD_EXAMPLES = [OLD_VIVA, OLD_DEMONS, OLD_DEMONS2, OLD_KINO, KINO2] // untouched on a phone → gone (user's wish)
  /** The example in the app's language: our own words (no song's lyrics in the app), to see the songbook. [R-12] [E-4] */
  const example = (x) => ({ name: x.name, bpm: 90, meter: '4/4', loop: false, parts: [
    { name: 'verse', times: 2, bars: paired(['Am', 'C', 'Dm', 'G']), lyrics: words(...x.verse) },
    { name: 'chorus', times: 1, bars: paired(['F', 'G', 'C', 'Am']), lyrics: words(x.chorus) }] })
  const EXAMPLES = [] // filled by setLang
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const copy = (s) => JSON.parse(JSON.stringify(s))
  const oldSample = (name, verse, chorus) => ({ name, bpm: 90, meter: '4/4', loop: false, parts: [
    { name: 'verse', times: 2, bars: two(['Am', 'C', 'Dm', 'G']), lyrics: words(...verse) },
    { name: 'chorus', times: 1, bars: two(['F', 'G', 'C', 'Am']), lyrics: words(chorus) }] })
  const OLD_SAMPLES = [
    oldSample('Пример со словами: Утро у струн', [
      ['Утро тихое, струны ждут,', 'Пальцы сами к ладам идут.', 'Раз-два-три-четыре — счёт,', 'Аккорд за аккордом — вперёд.'],
      ['Медленно — значит, верно,', 'Быстро будет потом, наверно.', 'Слушай клик и держи темп,', 'Песня сложится сама совсем.']],
    ['Играй, играй, не спеши,', 'Пусть звучит от души,', 'Каждый день понемногу —', 'Так и найдёшь дорогу.']),
    oldSample('Example with lyrics: Morning strings', [
      ['Quiet morning, strings awake,', 'Fingers find the frets they take.', 'One-two-three-four, count it through,', 'Chord by chord, the song comes true.'],
      ['Slow is steady, slow is right,', 'Speed will come another night.', 'Hear the click and hold the time,', 'Let the song fall into line.']],
    ['Play it, play it, take it slow,', 'Let it sound and let it grow,', 'Every day a little more —', 'That’s the way to find the door.']),
  ]
  const chordName = (t) => { const r = parseInput(String(t), false); return r.items.length === 1 && !r.bad.length ? r.items[0].name : null }
  /** A song read from storage, made safe: [R-2]. null if it is not a song at all. */
  function cleanSong(s) {
    if (!s || typeof s.name !== 'string' || !Array.isArray(s.parts)) return null
    const meter = METERS[s.meter] ? s.meter : '4/4'
    return { name: s.name, bpm: clampBpm(s.bpm), meter, loop: s.loop === true,
      parts: s.parts.filter((p) => p && Array.isArray(p.bars)).map((p) => {
        const times = Math.min(16, Math.max(1, Math.round(+p.times) || 1))
        const bars = p.bars.map((b) => (Array.isArray(b) ? b.slice(0, METERS[meter].length).map(chordName).filter(Boolean) : [])).filter((b) => b.length)
        // the words, per pass: a line starts at a bar of the part and has text [R-12]
        const lyrics = (Array.isArray(p.lyrics) ? p.lyrics.slice(0, times) : []).map((pass) => (Array.isArray(pass) ? pass : [])
          .filter((l) => l && typeof l.text === 'string' && l.text.trim() && Number.isInteger(+l.bar) && +l.bar >= 0 && +l.bar < bars.length)
          .map((l) => ({ bar: +l.bar, text: l.text.trim() })))
        return { name: typeof p.name === 'string' ? partCode(p.name) : PARTS[1], times, bars, lyrics }
      }) }
  }
  /** The song list from storage: the draft first; damaged or missing → draft (+ the old «Подбор» input) and examples. [R-2] */
  function readSongs(json, legacy = []) {
    let list = null
    try { list = JSON.parse(json) } catch { list = null }
    list = Array.isArray(list) ? list.map(cleanSong).filter(Boolean) : []
    if (!list.length) {
      const draft = newSong(S.draft)
      draft.parts[0].bars = legacy.map(chordName).filter(Boolean).map((c) => [c])
      return [draft, ...EXAMPLES.map(copy)]
    }
    list = list.filter((s) => !OLD_EXAMPLES.some((o) => same(s, o)))
      .map((s) => OLD_SAMPLES.some((o) => same(s, o)) ? copy(EXAMPLES[0]) : s)
    if (isDraft(list[0]?.name)) list[0].name = S.draft
    else list.unshift(newSong(S.draft))
    return list
  }
  /** The examples offered before (stored: a JSON list of names; once it was one name). [R-9] */
  function seenExamples(raw) {
    let v = null
    try { v = JSON.parse(raw) } catch { v = raw }
    return Array.isArray(v) ? v : v ? [String(v)] : []
  }
  /** New examples are offered once: added at the end if the list lacks them and they were not offered before. [R-9] */
  const offerExample = (list, seen) => [...list, ...EXAMPLES.filter((e) => !seen.includes(e.name) && !list.some((s) => s.name === e.name)).map(copy)]
  /** The chords played before the cursor { part, bar }: earlier parts, then this part's bars before it. [R-11] */
  const chordsBefore = (song, cur) => [...song.parts.slice(0, cur.part).flatMap((p) => p.bars.flat()), ...song.parts[cur.part].bars.slice(0, cur.bar).flat(), ...(cur.slot ? song.parts[cur.part].bars[cur.bar]?.slice(0, cur.slot) ?? [] : [])]
  /** Split bars that exceed the new meter, keeping their chord order and mapping old bar indices. [R-1] */
  function fitBars(bars, meter) {
    const cap = METERS[meter].length, starts = [], fitted = []
    bars.forEach((bar, i) => {
      starts[i] = fitted.length
      for (let j = 0; j < bar.length; j += cap) fitted.push(bar.slice(j, j + cap))
    })
    return { bars: fitted, starts }
  }
  /** What fits next after these chords (the pad lights them): the mode of all of them; next — the most common steps from
   *  the last one (up to 3), fit — the other chords of that mode. [R-11] */
  function nextHint(chords) {
    if (!chords.length) return { next: [], fit: [], borrow: [] }
    const r = rankModes(parseInput([...new Set(chords)].join(' '), false).items)[0]
    const next = nextChords(r, parseInput(chords.at(-1), false).items)
    // common chords from outside the mode (semitones from home, then the kinds): with a major third — V/vi, V/V, V/ii
    // (and their 7s), iv, ♭VII; with a minor third — the major V (and V7), the major IV. Those the mode has stay pale.
    const B = [0, 3, 4].includes(r.m) ? [[4, '', '7'], [2, '', '7'], [9, '', '7'], [5, 'm'], [10, '']] : [[7, '', '7'], [5, '']]
    const borrow = B.flatMap(([s, ...kinds]) => kinds.map((k) => NOTE[(r.sc.home + s) % 12] + k)).filter((c) => !r.sc.chords.includes(c))
    return { next, fit: r.sc.chords.filter((c) => !next.includes(c)), borrow }
  }
  /** «Гитара» → «Аккорды»: chord types (the most played first); a type shows its chord on each of the 12 notes. [L-6] */
  // labels: the symbol, the first two named (setLang)
  const CHORD_TYPES = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2', '°', '+', '6', 'm6', '9', 'add9', '5', 'dim7', 'm7b5'].map((s) => ({ s, label: s }))
  /** The type of a chord name: what follows its root ("C♯m7" → "m7", "G" → ""). [L-6] */
  const typeOf = (name) => name.replace(/^[A-G]♯?/, '')
  /** Each chord of the song once, in order of appearance (repeats not unrolled). [R-4] */
  const songChords = (song) => [...new Set(song.parts.flatMap((p) => p.bars.flat()))]
  /** Move every chord of a song by semitones; repeats, words, and section structure stay intact. [R-24] */
  function transposeSong(song, semitones) {
    const out = copy(song), shift = mod(Math.round(semitones), 12)
    for (const p of out.parts) for (const bar of p.bars) for (let i = 0; i < bar.length; i++) {
      const chord = parseInput(bar[i], false).items[0]
      bar[i] = NOTE[mod(chord.root + shift, 12)] + chord.name.replace(/^[A-G]♯?/, '')
    }
    return out
  }
  /** Add a chord to bar k, up to one per beat; a full bar starts over. [R-3] */
  function enterChord(bars, k, chord, meter = '4/4', slot = 0) {
    const out = bars.map((b) => [...b])
    const cap = METERS[meter].length
    if (k === out.length) { out.push([chord]); slot = 1 }
    else {
      if (slot >= out[k].length) out[k].push(chord)
      else out[k][slot] = chord
      slot++
    }
    return slot >= cap ? { bars: out, bar: k + 1, slot: 0 } : { bars: out, bar: k, slot }
  }
  /** Delete one chord from bar k; when its last chord is removed, drop the bar. At the empty cell past the end,
   *  act on the bar to its left, like Backspace. `gone` is null when the bar stays. [R-3] */
  function deleteBar(bars, k) {
    const out = bars.map((b) => [...b]), at = k < out.length ? k : k - 1
    if (at < 0) return { bars: out, bar: 0, slot: 0, gone: -1 }
    if (out[at].length > 1) {
      out[at].pop()
      return { bars: out, bar: at, slot: out[at].length, gone: null }
    }
    out.splice(at, 1)
    return { bars: out, bar: Math.min(k, out.length), slot: 0, gone: at }
  }
  /** Words by hand: the line of pass `pass` starting at `bar` set to text (empty — dropped); lines kept in bar order. [R-12] */
  function setLyric(lyrics, pass, bar, text) {
    const out = lyrics.map((p) => [...p])
    while (out.length <= pass) out.push([])
    out[pass] = out[pass].filter((l) => l.bar !== bar)
    if (text.trim()) out[pass] = [...out[pass], { bar, text: text.trim() }].sort((a, b) => a.bar - b.bar)
    return out
  }
  /** The words after bar `gone` is dropped (len bars left): later lines move one bar back; a line that started on the
   *  dropped bar gives way to one starting right after it; none past the end. [R-12] */
  const lyricsAfterDelete = (lyrics, gone, len) => lyrics.map((pass) => pass
    .filter((l) => !(l.bar === gone && pass.some((o) => o.bar === gone + 1)))
    .map((l) => ({ bar: l.bar > gone ? l.bar - 1 : l.bar, text: l.text }))
    .filter((l) => l.bar < len))
  /** Beats in a bar and the even lengths for its chords. [R-5] */
  const barSplit = (meter, count = 2) => {
    const n = METERS[meter].length, k = Math.min(n, count)
    return [n, ...Array.from({ length: k }, (_, i) => Math.ceil(n * (i + 1) / k) - Math.ceil(n * i / k))]
  }
  /** The song laid out in beats: bars (for the strip) and chord changes (same chords in a row merge). [R-6] */
  function timeline(song) {
    const n = METERS[song.meter].length, bars = [], changes = [], lines = []
    let at = 0
    for (const p of song.parts) for (let t = 0; t < p.times; t++) {
      const first = bars.length
      p.bars.forEach((b, j) => {
        const inBar = b.slice(0, n), lengths = barSplit(song.meter, inBar.length).slice(1)
        const chords = inBar.map((name, i) => ({ name, len: lengths[i] }))
        bars.push({ part: p.name, no: t * p.bars.length + j + 1, of: p.times * p.bars.length, at, chords })
        for (const c of chords) {
          const last = changes[changes.length - 1]
          if (last && last.name === c.name) last.len += c.len
          else changes.push({ name: c.name, at, len: c.len })
          at += c.len
        }
      })
      // the songbook lines of this pass: its own words, else the first pass's, else 4-bar lines without words [R-12]
      const lyr = p.lyrics ?? [], own = lyr[t]?.length ? lyr[t] : lyr[0] ?? []
      let starts = own.length ? [...own].sort((a, b) => a.bar - b.bar) : [...Array(Math.ceil(p.bars.length / 4))].map((_, r) => ({ bar: r * 4, text: '' }))
      if (starts.length && starts[0].bar > 0) starts = [{ bar: 0, text: '' }, ...starts]
      starts.forEach((l, i) => {
        const from = first + l.bar, to = first + (starts[i + 1]?.bar ?? p.bars.length)
        lines.push({ text: l.text, at: bars[from].at, len: (to < bars.length ? bars[to].at : at) - bars[from].at, from, to })
      })
    }
    return { n, beats: at, bars, changes, lines }
  }
  /** Scrubbing: the beat under the finger moved dx px from where it touched at beat b0 (12 px a beat, left = on). [R-15] */
  const scrubBeat = (b0, dx, beats, loop) => { const b = b0 - dx / 12; return loop ? mod(b, beats) : Math.min(beats - 1, Math.max(0, b)) }
  /** The songbook line playing at beat b (−1 in the count-in). [R-12] */
  const lineAt = (tl, b) => (b < 0 ? -1 : tl.lines.findLastIndex((l) => l.at <= b))
  /** Does the song have any words? Then the player shows the songbook. [R-12] */
  const hasLyrics = (song) => song.parts.some((p) => p.lyrics.some((pass) => pass.length > 0))
  // ---------- sharing songs: a JSON file [R-14] ----------
  const SONG_FORMAT = 'kvinty-song', SONG_VERSION = 1
  /** The song as a file to share. */
  const songToJson = (song) => JSON.stringify({ format: SONG_FORMAT, version: SONG_VERSION, song }, null, 1)
  /** What «Вставить текст» got: a song file (or a bare song), else a chord sheet. { song } or { error }. A taken name
   *  gets « 2», « 3»… */
  function readImport(text, songs, per = 1) {
    let data = null
    try { data = JSON.parse(text) } catch { data = null }
    let song
    if (data && typeof data === 'object') {
      if (data.format === SONG_FORMAT && data.version > SONG_VERSION) return { error: S.errNewer }
      song = cleanSong(data.format === SONG_FORMAT ? data.song : data)
      if (!song) return { error: S.errNotSong }
    } else {
      song = parseSheet(text, songs, per)
      if (!song) return { error: S.errNoChords }
    }
    return { song: { ...song, name: freeName(song.name, songs) } }
  }
  /** A name not taken yet: as is, else with « 2», « 3»… [R-14] */
  function freeName(base, songs) {
    let name = base
    for (let n = 2; songs.some((s) => s.name === name); n++) name = `${base} ${n}`
    return name
  }
  /** A copy of a song to play with: everything the same, the name «… (копия)» («… (copy)»). [R-1] */
  const songCopy = (song, songs) => ({ ...copy(song), name: freeName(S.copyOf(song.name), songs) })
  // ---------- «Вставить текст»: a chord sheet from a chords site → a song [R-13] ----------
  const LABELS = [[/^(вступление|интро|intro)/i, 'intro'], [/^(предприпев|pre-?chorus)/i, 'prechorus'], [/^(куплет|verse)/i, 'verse'],
    [/^(припев|chorus)/i, 'chorus'], [/^(бридж|bridge)/i, 'bridge'], [/^(проигрыш|соло|solo|interlude)/i, 'solo'], [/^(кода|outro|аутро|coda)/i, 'outro']]
  const SEP = /^(\||-|–|:|[x×х]\d+|\([x×х]?\d+\))$/i
  /** A chord as written on chords sites ("H7/D#" → "B7"), or null. */
  function sheetChord(tok) {
    const m = /^([A-H])([#♯b♭]?)([^/]*)(\/.*)?$/.exec(tok)
    return m && chordName((m[1] === 'H' ? 'B' : m[1]) + m[2] + m[3])
  }
  /** The chords of a line made only of chords (separators allowed), else null. */
  function chordLine(line) {
    const toks = line.split(/\s+/).map((t) => t.replace(/^\|+|\|+$/g, '')).filter((t) => t && !SEP.test(t)), chords = toks.map(sheetChord)
    return toks.length && chords.every(Boolean) ? chords : null
  }
  function parseSheet(text, songs, per = 1) { // per — bars a chord lasts (the sheet does not say)
    const parts = []
    let name = null, cur = null, seen = false, start = null, last = null, firstLine = true
    const begin = (nm, times) => { cur = { name: nm, times, bars: [], lyrics: [[]] }; parts.push(cur); start = null; last = null }
    const add = (chords) => { start = cur.bars.length; cur.bars.push(...chords.flatMap((c) => Array(per).fill([c]))); seen = true }
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim()
      if (!t) continue
      const label = LABELS.find(([re]) => re.test(t)), chords = chordLine(t)
      if (label) {
        begin(label[1], +(/[x×х]\s*(\d+)/i.exec(t)?.[1] ?? 1))
        const rest = chordLine(t.split(':').slice(1).join(':'))
        if (rest) add(rest)
      } else if (chords) {
        if (!cur) begin('verse', 1)
        add(chords)
      } else if (!seen) {
        if (firstLine) name = t // the title, if it comes first; anything else before the chords is not a lyric
      } else if (start !== null) {
        last = { bar: start, text: t }
        cur.lyrics[0].push(last)
        start = null
      } else if (last) last.text += ' ' + t // words with no chords above: the same line
      firstLine = false
    }
    if (!seen) return null
    // «Припев:» with nothing under it repeats the last chorus; the same part again with the same bars adds a pass
    const filled = parts.map((p, i) => (p.bars.length ? p : JSON.parse(JSON.stringify(parts.slice(0, i).findLast((q) => q.name === p.name && q.bars.length) ?? p))))
      .filter((p) => p.bars.length)
    const merged = []
    for (const p of filled) {
      const prev = merged[merged.length - 1]
      if (prev && prev.name === p.name && same(prev.bars, p.bars) && p !== filled[filled.indexOf(prev)]) { prev.times += p.times; prev.lyrics.push(...p.lyrics) }
      else merged.push(p)
    }
    return { name: name ?? songName(songs), bpm: 100, meter: '4/4', loop: false,
      parts: merged.map((p) => ({ name: p.name, times: p.times, bars: p.bars, lyrics: p.lyrics.some((x) => x.length) ? p.lyrics : [] })) }
  }
  /** Where the song is at beat b (b < 0 — the count-in bar). [R-7] */
  function songAt(tl, b, loop = false) {
    if (b < 0) return { k: -1, cur: null, next: tl.changes[0].name, left: -b, soon: false, part: '', bar: '' }
    let k = 0
    while (k + 1 < tl.changes.length && tl.changes[k + 1].at <= b) k++
    const c = tl.changes[k], nx = tl.changes[k + 1] ?? (loop ? tl.changes[0] : null), left = c.at + c.len - b
    const bar = tl.bars[Math.floor(b / tl.n)]
    return { k, cur: c.name, next: nx && nx.name, left, soon: !!nx && left <= 2, part: bar.part, bar: `${bar.no} / ${bar.of}` }
  }

  // ---------- analytics: PostHog, EU [Y-1…Y-4] ----------
  const ANALYTICS_URL = 'https://eu.i.posthog.com/batch/'
  /** One event of a batch: name, time, the device's anonymous id, the common details and its own. [Y-2] */
  const analyticsEvent = (event, id, props, now, common) => ({ event, timestamp: new Date(now).toISOString(), properties: { distinct_id: id, ...common, ...props } })
  /** The PostHog project key (public: it can only send events) — only on the real site, so tests and local runs never
   *  count; a test may pass its own. [Y-1] */
  const analyticsKey = (host, override) => override ?? (host === 'akmaks.github.io' ? 'phc_B79ar29nFn6Mpx9ki2VpRNLy9PoBSJAsZhsQgkUjsV43' : '')
  /** How the app was opened: from the home screen (standalone) or in the browser. [Y-2] */
  const platformOf = (standalone, iosStandalone) => (standalone || iosStandalone === true ? 'home-screen' : 'browser')
  /** What is sent: PostHog's batch. [Y-3] */
  const analyticsBatch = (key, events) => ({ api_key: key, batch: events })


  // ---------- language: Russian or English, by the phone's language [E-1…E-4] ----------
  /** The phone's language → the app's: Russian for ru…, English for anything else. [E-1] */
  const langOf = (tag) => (/^ru\b/i.test(String(tag ?? '')) ? 'ru' : 'en')
  // Every text of the app, in both languages (the same keys: a unit test checks). Functions fill in the details. [E-2]
  const STR = {
    ru: {
      lang: 'ru', app: 'Квинты', title: 'Квинтовый круг',
      modes: [
        { short: 'Ион', name: 'ионийский', styles: 'Поп, кантри, рок-баллады, детские песни, гимны.',
          examples: ['The Beatles — Let It Be', 'Bob Marley — Three Little Birds'] },
        { short: 'Дор', name: 'дорийский', styles: 'Фанк, соул, модальный джаз, латина, кельтский фолк, психоделический рок.',
          examples: ['Santana — Oye Como Va', 'Daft Punk — Get Lucky'] },
        { short: 'Фриг', name: 'фригийский', styles: 'Фламенко, трэш и хэви-метал, восточные мотивы.',
          examples: ['Metallica — Wherever I May Roam', 'Megadeth — Symphony of Destruction'] },
        { short: 'Лид', name: 'лидийский', styles: 'Киномузыка (полёт, волшебство), прог-рок, фьюжн, гитарная инструменталка.',
          examples: ['Заставка «Симпсонов»', 'Joe Satriani — Flying in a Blue Dream'] },
        { short: 'Микс', name: 'миксолидийский', styles: 'Классический и блюз-рок, кантри, джем-бэнды, кельтская музыка.',
          examples: ['Lynyrd Skynyrd — Sweet Home Alabama', "Guns N' Roses — Sweet Child O' Mine"] },
        { short: 'Эол', name: 'эолийский', styles: 'Рок-баллады, поп в миноре, хард-рок и метал, эпическая музыка.',
          examples: ['R.E.M. — Losing My Religion', 'The Cranberries — Zombie'] },
        { short: 'Локр', name: 'локрийский', styles: 'Краска в экстремальном метале и джазе; целых песен почти нет.',
          examples: ['Björk — Army of Me'] },
      ],
      modeHint: ['мажор', '', '', '', '', 'натуральный минор', ''],
      majMin: (maj, min) => `${maj} мажор · ${min} минор`,
      major: (n) => `${n} мажор`, minor: (n) => `${n} минор`,
      typeMajor: 'Мажор', typeMinor: 'Минор',
      tunings: { std: 'Стандарт', dropd: 'Drop D', dstd: 'D standard', dropc: 'Drop C', b4: '4 струны', b5: '5 струн', uke: 'Укулеле' },
      bass: 'Бас',
      anNotes: 'Выбери 3–5 нот — скажу, что это за лад или гамма.',
      anChords: 'Выбери 2–4 аккорда — скажу, что это за лад, и подскажу, что играть дальше. Тап по аккорду в строке сверху убирает его.',
      notes: (list) => `Ноты: ${list}`,
      harmonic: (miss, root) => `Не хватает ${miss} — это ${root} гармонический минор: натуральный минор с повышенной 7-й ступенью.`,
      allBut: (one, miss) => `Подходит ко всему, кроме ${one ? 'ноты' : 'нот'} ${miss}.`,
      inside: (one, chord, notes) => `${one ? 'Она' : 'Они'} внутри аккорда ${chord} (${notes}).`,
      borrowed (list, root, m) { return `Так бывает: песня берёт аккорд из соседнего лада. ${list} — из ${root} ${this.modes[m].name.replace(/ий$/, 'ого')}.` },
      pentMinor: (root) => `Это ${root} минорная пентатоника.`, pentMajor: (root) => `Это ${root} мажорная пентатоника.`,
      hitsExact: 'Так играют в хитах', hitsSame: 'Хиты с теми же аккордами',
      inSong: (x) => `в песне: ${x}`, there: (x) => `там: ${x}`,
      top10: (key) => `Топ-10 последовательностей · ${key}`, more: (n) => `ещё ${n}`,
      credit: 'Песни и аккорды: McGill Billboard Project (CC0) и Hooktheory TheoryTab через набор Sheet Sage (CC BY-NC-SA 3.0).',
      parts: ['Вступление', 'Куплет', 'Предприпев', 'Припев', 'Бридж', 'Соло', 'Кода'],
      draft: 'Черновик', song: (n) => `Песня ${n}`, copyOf: (name) => `${name} (копия)`,
      example: { name: 'Пример со словами: Утро у струн',
        verse: [['Утро тихое, струны ждут,', 'Пальцы сами к ладам идут.', 'Раз-два-три-четыре — счёт,', 'Аккорд за аккордом — вперёд.'],
          ['Медленно — значит, верно,', 'Быстро будет потом, наверно.', 'Слушай клик и держи темп,', 'Песня сложится сама совсем.']],
        chorus: ['Играй, играй, не спеши,', 'Пусть звучит от души,', 'Каждый день понемногу —', 'Так и найдёшь дорогу.'] },
      errNewer: 'Файл из более новой версии приложения — обнови его.',
      errNotSong: 'Не похоже на песню.',
      errNoChords: 'Не нашёл аккордов. Нужны строки аккордов над словами (как на сайтах аккордов) или файл песни.',
      // app.js
      aboutBtn: (mode) => `Что за лад: ${mode}? ›`,
      litSong: (name) => `подсвечены аккорды песни «${name}»`, litPart: (name) => `подсвечены аккорды части «${name}»`,
      playChord: (name) => `Сыграть ${name}`,
      styles: 'Стиль музыки', examples: 'Примеры', progs: 'Частые последовательности', close: 'Закрыть',
      gModes: 'Лады', gChords: 'Аккорды',
      bpm: 'уд/мин', empty: 'пусто', del: 'Удалить',
      copied: (name) => `Копия создана — «${name}»`,
      folderRoot: 'Песни', folderAuthor: 'Лучшее от автора', folderCreate: '+ Папка', folderName: 'Название папки',
      folderMove: 'Переместить', folderMoved: 'Песня перемещена', folderExists: 'Такая папка уже есть', readOnly: 'Оригинал',
      transposeLabel: 'Тональность', transposeDown: 'На полутон ниже', transposeUp: 'На полутон выше',
      shared: 'Файл песни недоступен для шаринга — JSON скопирован в буфер обмена.',
      importFail: 'Не удалось прочитать файл песни.',
      urlFail: 'Не удалось загрузить песню. Проверь ссылку Ultimate Guitar и попробуй ещё раз.', urlLoading: 'Загружаю песню…',
      shareFail: 'Не удалось открыть шаринг или скопировать JSON.',
      partAn: 'Разбор части', partCopy: 'Копия части', partDel: 'Удалить часть',
      pass: (n) => `${n}-й: `, barNo: (n) => `т.${n}`,
      lyricLine: 'Строка слов', addWords: '+ слова', wordsFrom: (n) => `Слова с такта ${n}`, addPart: '+ Часть',
      more7: 'Ещё: G7 и B°', songTitle: 'Название песни', delSong: (name) => `Удалить «${name}»?`,
      anSong: 'Разбор песни', anPart: (name) => `Разбор части «${name}»`,
      anEmpty: 'Набери в песне 2–4 аккорда — скажу, что это за лад, и подскажу, что играть дальше.',
      notesLabel: 'Ноты: ', onCircle: 'На круге', onGuitar: 'На гитаре', alsoFits: 'Ещё подходит',
      andMore: (n) => `и ещё ${n}`, noHits: 'В базе песен такого не нашлось.', nextGood: 'Дальше хорошо пойдёт · тап — в песню',
      getReady: (name) => `${name} · приготовься`, inBeats: (n) => `через ${n}`, end: 'конец',
      stop: '■ Стоп', start: '▶ Старт',
      auto: 'Авто', micOff: '■ Выключить микрофон', micOn: '🎙 Включить микрофон',
      pluck: 'Дёрни струну', micAndPluck: 'Включи микрофон и дёрни струну',
      tune: { ok: 'Строит ✓', low: 'Низко — подтяни ↑', high: 'Высоко — ослабь ↓' },
      heard: (note, hz, cents) => `слышу ${note} · ${hz} Гц · ${cents} ¢`,
      noMicApi: 'Этот браузер не даёт доступ к микрофону.',
      micDenied: 'Нет доступа к микрофону — разреши его: Settings → Apps → Safari → Microphone.',
      micFail: (err) => `Микрофон не включился (${err}). Попробуй ещё раз или перезапусти приложение.`,
      record: '● Записать', recordStop: '● Стоп', recordingActive: 'Идёт запись', recordDelete: 'Удалить', recordRename: 'Название записи', recordsEmpty: 'Записей пока нет',
      recordFail: 'Не удалось сохранить запись.', recordUnsupported: 'Запись звука не поддерживается этим браузером.',
      recordShare: 'Поделиться WAV', recordPreparing: 'Готовлю WAV…', recordWavFail: 'Не удалось подготовить WAV.', recordMicFail: (err) => `Не удалось включить микрофон (${err}).`,
      // index.html: data-t (text) and data-ta (aria-label)
      html: { vCircle: 'Круг', vChords: 'Аккорды', vSongs: 'Песни', vRecords: 'Записи', vClick: 'Клик', vTuner: 'Тюнер',
        down: 'На полтона ниже', up: 'На полтона выше', tuning: 'Строй', gmode: 'Аккорды или лады', circle: 'Квинтовый круг',
        neck: 'Гриф', diagram: 'Схема аккорда', prev: 'Предыдущий вариант', next: 'Следующий вариант', bpm: 'уд/мин',
        slower: 'Медленнее', faster: 'Быстрее', tempo: 'Темп', tap: 'Тап', guitar: 'Гитара', bass: 'Бас', ref: '▶ Эталон',
        record: '● Записать', recordAria: 'Записать', recordStopAria: 'Остановить запись', chordSound: 'Звучание аккордов', recordsEmpty: 'Записей пока нет', newSong: '+ Новая песня', paste: 'Вставить текст', back: 'К списку песен', rename: 'Переименовать', copy: 'Копия песни',
        share: 'Поделиться песней', importJson: 'Импорт JSON', importURL: 'По ссылке', urlGo: 'Добавить', urlTitle: 'Ссылка Ultimate Guitar', exportJson: 'Экспорт JSON', delSong: 'Удалить песню', meter: 'Размер', loop: 'Играть по кругу', play: '▶ Играть',
        analyze: 'Разбор', onGuitar: 'На гитаре', delBar: '⌫ Удалить такт', toSong: '‹ К песне', stop: 'Стоп',
        clicks: 'Щелчки метронома', ctype: 'Тип аккорда', ctPrev: 'Другие типы аккордов', ctNext: 'Ещё типы аккордов', mode: 'Лад',
        pasteTitle: 'Вставить песню', pasteHint: 'Аккорды над словами — как на сайтах аккордов, или файл песни.',
        per1: 'Аккорд — 1 такт', per2: '2 такта', cancel: 'Отмена', layOut: 'Разложить' },
    },
    en: {
      lang: 'en', app: 'Fifths', title: 'Circle of fifths',
      modes: [
        { short: 'Ion', name: 'Ionian', styles: 'Pop, country, rock ballads, children’s songs, anthems.',
          examples: ['The Beatles — Let It Be', 'Bob Marley — Three Little Birds'] },
        { short: 'Dor', name: 'Dorian', styles: 'Funk, soul, modal jazz, Latin, Celtic folk, psychedelic rock.',
          examples: ['Santana — Oye Como Va', 'Daft Punk — Get Lucky'] },
        { short: 'Phr', name: 'Phrygian', styles: 'Flamenco, thrash and heavy metal, Eastern flavour.',
          examples: ['Metallica — Wherever I May Roam', 'Megadeth — Symphony of Destruction'] },
        { short: 'Lyd', name: 'Lydian', styles: 'Film music (flight, magic), prog rock, fusion, guitar instrumentals.',
          examples: ['The Simpsons theme', 'Joe Satriani — Flying in a Blue Dream'] },
        { short: 'Mix', name: 'Mixolydian', styles: 'Classic and blues rock, country, jam bands, Celtic music.',
          examples: ['Lynyrd Skynyrd — Sweet Home Alabama', "Guns N' Roses — Sweet Child O' Mine"] },
        { short: 'Aeo', name: 'Aeolian', styles: 'Rock ballads, minor-key pop, hard rock and metal, epic music.',
          examples: ['R.E.M. — Losing My Religion', 'The Cranberries — Zombie'] },
        { short: 'Loc', name: 'Locrian', styles: 'A colour in extreme metal and jazz; whole songs are rare.',
          examples: ['Björk — Army of Me'] },
      ],
      modeHint: ['major', '', '', '', '', 'natural minor', ''],
      majMin: (maj, min) => `${maj} major · ${min} minor`,
      major: (n) => `${n} major`, minor: (n) => `${n} minor`,
      typeMajor: 'Major', typeMinor: 'Minor',
      tunings: { std: 'Standard', dropd: 'Drop D', dstd: 'D standard', dropc: 'Drop C', b4: '4 strings', b5: '5 strings', uke: 'Ukulele' },
      bass: 'Bass',
      anNotes: 'Pick 3–5 notes — I’ll tell you the mode or scale.',
      anChords: 'Pick 2–4 chords — I’ll tell you the mode and suggest what to play next. Tap a chord in the row above to remove it.',
      notes: (list) => `Notes: ${list}`,
      harmonic: (miss, root) => `${miss} is missing — this is ${root} harmonic minor: natural minor with a raised 7th.`,
      allBut: (one, miss) => `Fits everything but the ${one ? 'note' : 'notes'} ${miss}.`,
      inside: (one, chord, notes) => `${one ? 'It is' : 'They are'} in the chord ${chord} (${notes}).`,
      borrowed (list, root, m) { return `It happens: a song borrows a chord from a neighbouring mode. ${list} — from ${root} ${this.modes[m].name}.` },
      pentMinor: (root) => `This is ${root} minor pentatonic.`, pentMajor: (root) => `This is ${root} major pentatonic.`,
      hitsExact: 'Played like this in hits', hitsSame: 'Hits with the same chords',
      inSong: (x) => `in the song: ${x}`, there: (x) => `there: ${x}`,
      top10: (key) => `Top 10 progressions · ${key}`, more: (n) => `${n} more`,
      credit: 'Songs and chords: McGill Billboard Project (CC0) and Hooktheory TheoryTab via the Sheet Sage set (CC BY-NC-SA 3.0).',
      parts: ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Solo', 'Outro'],
      draft: 'Draft', song: (n) => `Song ${n}`, copyOf: (name) => `${name} (copy)`,
      example: { name: 'Example with lyrics: Morning strings',
        verse: [['Quiet morning, strings awake,', 'Fingers find the frets they take.', 'One-two-three-four, count it through,', 'Chord by chord, the song comes true.'],
          ['Slow is steady, slow is right,', 'Speed will come another night.', 'Hear the click and hold the time,', 'Let the song fall into line.']],
        chorus: ['Play it, play it, take it slow,', 'Let it sound and let it grow,', 'Every day a little more —', 'That’s the way to find the door.'] },
      errNewer: 'The file is from a newer version of the app — update it.',
      errNotSong: 'This doesn’t look like a song.',
      errNoChords: 'No chords found. It needs lines of chords over the words (as on chord sites) or a song file.',
      aboutBtn: (mode) => `What is ${mode}? ›`,
      litSong: (name) => `chords of the song “${name}” lit`, litPart: (name) => `chords of the part “${name}” lit`,
      playChord: (name) => `Play ${name}`,
      styles: 'Styles', examples: 'Examples', progs: 'Common progressions', close: 'Close',
      gModes: 'Modes', gChords: 'Chords',
      bpm: 'bpm', empty: 'empty', del: 'Delete',
      copied: (name) => `Copy made — “${name}”`,
      folderRoot: 'Songs', folderAuthor: 'Author’s best', folderCreate: '+ Folder', folderName: 'Folder name',
      folderMove: 'Move', folderMoved: 'Song moved', folderExists: 'This folder already exists', readOnly: 'Original',
      transposeLabel: 'Key', transposeDown: 'Down one semitone', transposeUp: 'Up one semitone',
      shared: 'Song file sharing is unavailable — JSON copied to the clipboard.',
      importFail: 'Could not read the song file.',
      urlFail: 'Could not load the song. Check the Ultimate Guitar link and try again.', urlLoading: 'Loading song…',
      shareFail: 'Could not open sharing or copy the JSON.',
      partAn: 'Analyse the part', partCopy: 'Copy the part', partDel: 'Delete the part',
      pass: (n) => `${n}: `, barNo: (n) => `b.${n}`,
      lyricLine: 'Line of words', addWords: '+ words', wordsFrom: (n) => `Words from bar ${n}`, addPart: '+ Part',
      more7: 'More: G7 and B°', songTitle: 'Song name', delSong: (name) => `Delete “${name}”?`,
      anSong: 'Song analysis', anPart: (name) => `Analysis of the part “${name}”`,
      anEmpty: 'Enter 2–4 chords in the song — I’ll tell you the mode and suggest what to play next.',
      notesLabel: 'Notes: ', onCircle: 'On the circle', onGuitar: 'On the guitar', alsoFits: 'Also fits',
      andMore: (n) => `and ${n} more`, noHits: 'No such songs in the song base.', nextGood: 'Goes well next · tap to add',
      getReady: (name) => `${name} · get ready`, inBeats: (n) => `in ${n}`, end: 'end',
      stop: '■ Stop', start: '▶ Start',
      auto: 'Auto', micOff: '■ Mic off', micOn: '🎙 Mic on',
      pluck: 'Pluck a string', micAndPluck: 'Turn the mic on and pluck a string',
      tune: { ok: 'In tune ✓', low: 'Low — tighten ↑', high: 'High — loosen ↓' },
      heard: (note, hz, cents) => `hearing ${note} · ${hz} Hz · ${cents} ¢`,
      noMicApi: 'This browser gives no access to the microphone.',
      micDenied: 'No access to the microphone — allow it: Settings → Apps → Safari → Microphone.',
      micFail: (err) => `The microphone didn’t start (${err}). Try again or restart the app.`,
      record: '● Record', recordStop: '● Stop', recordingActive: 'Recording', recordDelete: 'Delete', recordRename: 'Recording name', recordsEmpty: 'No recordings yet',
      recordFail: 'Could not save the recording.', recordUnsupported: 'Audio recording is not supported by this browser.',
      recordShare: 'Share WAV', recordPreparing: 'Preparing WAV…', recordWavFail: 'Could not prepare the WAV file.', recordMicFail: (err) => `Could not turn on the microphone (${err}).`,
      html: { vCircle: 'Circle', vChords: 'Chords', vSongs: 'Songs', vRecords: 'Records', vClick: 'Click', vTuner: 'Tuner',
        down: 'Half a step down', up: 'Half a step up', tuning: 'Tuning', gmode: 'Chords or modes', circle: 'Circle of fifths',
        neck: 'Neck', diagram: 'Chord diagram', prev: 'Previous shape', next: 'Next shape', bpm: 'bpm',
        slower: 'Slower', faster: 'Faster', tempo: 'Tempo', tap: 'Tap', guitar: 'Guitar', bass: 'Bass', ref: '▶ Reference',
        record: '● Record', recordAria: 'Start recording', recordStopAria: 'Stop recording', chordSound: 'Play chords', recordsEmpty: 'No recordings yet', newSong: '+ New song', paste: 'Paste text', back: 'Back to songs', rename: 'Rename', copy: 'Copy the song',
        share: 'Share the song', importJson: 'Import JSON', importURL: 'From link', urlGo: 'Add', urlTitle: 'Ultimate Guitar link', exportJson: 'Export JSON', delSong: 'Delete the song', meter: 'Meter', loop: 'Play in a loop', play: '▶ Play',
        analyze: 'Analysis', onGuitar: 'On the guitar', delBar: '⌫ Delete bar', toSong: '‹ To the song', stop: 'Stop',
        clicks: 'Metronome clicks', ctype: 'Chord type', ctPrev: 'Previous chord types', ctNext: 'More chord types', mode: 'Mode',
        pasteTitle: 'Paste a song', pasteHint: 'Chords over words — as on chord sites, or a song file.',
        per1: 'Chord — 1 bar', per2: '2 bars', cancel: 'Cancel', layOut: 'Lay out' },
    },
  }
  let S = STR.ru // the texts in the app's language
  /** Switches the app's language: the texts, the modes' names, tunings, chord types and the example. Returns the texts. [E-2] */
  function setLang(lang) {
    S = STR[lang]
    MODES.forEach((m, k) => Object.assign(m, S.modes[k]))
    for (const t of [...TUNINGS.guitar, ...TUNINGS.bass, ...TUNINGS.ukulele]) t.name = S.tunings[t.id]
    for (const t of ALL_TUNINGS) t.name = (t.inst === 'bass' ? `${S.bass}, ` : '') + S.tunings[t.id]
    CHORD_TYPES[0].label = S.typeMajor
    CHORD_TYPES[1].label = S.typeMinor
    EXAMPLES.splice(0, EXAMPLES.length, example(S.example))
    return S
  }
  /** Encodes mono floating-point samples as little-endian 16-bit PCM WAV. */
  function pcmWav(samples, sampleRate) {
    const dataSize = samples.length * 2, bytes = new Uint8Array(44 + dataSize), view = new DataView(bytes.buffer)
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i) }
    text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    text(36, 'data'); view.setUint32(40, dataSize, true)
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true)
    }
    return bytes
  }
  setLang('ru')
  return {
    mod, norm, NOTE, FLAT, MAJOR, QUALITY, pcOf, minorOf, MODES, scale, SEMI, degreeOf, degreeAt, degreeRing,
    sectorStates, pickSector, keyLabels, tiles, aboutContent,
    selectedIndex, keyAngle, turnTo, snap, turnDuration, easeOut, angleOf, flingTarget, shiftedKey, swipeStep,
    chordNotes, freq, itemMidi, TUNINGS, FRETS, tuningOf, ALL_TUNINGS, anyTuning, neckDots, toggleChord, tileMidi, tilesFrom, twinName, voicings, voicingMidi, diagram,
    SHAPES, parseInput, PRIOR, rankModes, nextChords, marksFrom,
    chordCode, progCode, songsWith, songLine, decode, asPlayed, chordsThere, analyze,
    METERS, BPM_MIN, BPM_MAX, clampBpm, CLICK_HZ, tapTempo, ticks, detectPitch, centsOff, noteOf, nearestString, tuneStatus, median,
    langOf, STR, setLang, pcmWav, PARTS, nextPart, partLabel, partCode, isDraft, newSong, readFolders, readFolderLocations, addFolder, folderChildren, folderParent, songName, EXAMPLES, cleanSong, readSongs, songChords, transposeSong, enterChord, deleteBar, fitBars, barSplit, timeline, songAt, scrubBeat, lineAt, hasLyrics, parseSheet, lyricsAfterDelete, setLyric, songToJson, readImport, songCopy, ANALYTICS_URL, analyticsEvent, analyticsBatch, platformOf, analyticsKey, chordsBefore, nextHint, CHORD_TYPES, typeOf, offerExample, seenExamples,
  }
})
