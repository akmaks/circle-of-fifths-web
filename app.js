'use strict'
// app.js — the screen: draws what core.js computes and turns taps into state changes. No music logic here
// (rule: anything that can be computed without the DOM lives in core.js and is unit-tested; see docs/SPEC.md).
// Angles: degrees, 0 = top, clockwise. Sector i sits at i * 30° on the wheel; the wheel is turned by `rot`.
// The app's language: the phone's (Russian or English); every text comes from T. [E-1] [E-2]
const T = Core.setLang(Core.langOf(navigator.languages[0]))
const {
  mod, norm, NOTE, FLAT, pcOf, minorOf, MODES, scale, degreeRing, sectorStates, pickSector, keyLabels, tiles, aboutContent,
  selectedIndex, keyAngle, turnTo, snap, turnDuration, easeOut, angleOf, flingTarget, shiftedKey, swipeStep,
  chordNotes, freq, TUNINGS, FRETS, tuningOf, ALL_TUNINGS, anyTuning, neckDots, toggleChord, tileMidi, tilesFrom, twinName, voicings, voicingMidi, diagram,
  parseInput, marksFrom,
  chordCode, progCode, decode, analyze: analyzeFinder, METERS, BPM_MIN, BPM_MAX, clampBpm, CLICK_HZ, tapTempo, ticks,
  detectPitch, centsOff, noteOf, nearestString, tuneStatus, median,
  ANALYTICS_URL, analyticsEvent, analyticsBatch, platformOf, analyticsKey, pcmWav,
  nextPart, partLabel, newSong, readFolders, readFolderLocations, addFolder, folderChildren, folderParent, songName, readSongs, cleanSong, offerExample, seenExamples, EXAMPLES, songChords, transposeSong, enterChord, deleteBar, fitBars, timeline, songAt, scrubBeat, lineAt, hasLyrics, readImport, songToJson, lyricsAfterDelete, setLyric, songCopy, chordsBefore, nextHint, CHORD_TYPES, typeOf,
} = Core

const VB = 524 // viewBox width: the wheel reaches r = 256 (the scale arc)
const R = { deg: 79, minIn: 95, minOut: 165, majOut: 245, min: 130, maj: 206, enh: 233 }
const $ = (id) => document.getElementById(id)
const svg = $('circle'), wheel = $('wheel'), neck = $('neck')
const NS = 'http://www.w3.org/2000/svg'
const pt = (r, deg) => { const a = (deg * Math.PI) / 180; return [r * Math.sin(a), -r * Math.cos(a)] }

function node(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  parent.append(e)
  return e
}
/** Ring band between radii r1 < r2 from angle a to b (clockwise). */
function band(r1, r2, a, b) {
  const p = (r, d) => pt(r, d).map((v) => v.toFixed(2)).join(' '), big = b - a > 180 ? 1 : 0
  return `M${p(r1, a)} L${p(r2, a)} A${r2} ${r2} 0 ${big} 1 ${p(r2, b)} L${p(r1, b)} A${r1} ${r1} 0 ${big} 0 ${p(r1, a)}Z`
}
const sector = (r1, r2, deg) => band(r1, r2, deg - 15, deg + 15)
const el = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text, className: cls || '' })
const list = (items) => { const ul = el('ul'); ul.append(...items.map((t) => el('li', t))); return ul }
/** − / + that repeat while held: a step at once, then again after 0.4 s, each time faster (×0.8, down to 40 ms), until
 *  the finger lifts. A click without a finger (keyboard) is one step. [T-1] */
function holdRepeat(el, step) {
  let timer = 0, fromFinger = false
  const stop = () => clearTimeout(timer)
  el.addEventListener('pointerdown', () => {
    fromFinger = true
    step()
    let wait = 400
    const again = () => { timer = setTimeout(() => { step(); wait = Math.max(40, wait * 0.8); again() }, wait) }
    again()
  })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, stop)
  el.addEventListener('click', () => { if (!fromFinger) step(); fromFinger = false })
}
function button(text, cls, onclick, testid) {
  const b = el('button', text, cls)
  b.onclick = onclick
  if (testid) b.dataset.testid = testid
  return b
}

// ---------- build the wheel ----------
const labels = [] // { g, deg, r } — counter-rotated so text stays upright
const sectors = { maj: [], min: [] }
for (let i = 0; i < 12; i++) {
  const deg = i * 30, pc = pcOf(i), maj = NOTE[pc], min = NOTE[minorOf(pc)]
  for (const ring of ['maj', 'min']) {
    sectors[ring].push(node('path', { class: 'sector', d: ring === 'maj' ? sector(R.minOut, R.majOut, deg) : sector(R.minIn, R.minOut, deg),
      'data-i': i, 'data-testid': `${ring}-${i}`, 'aria-label': ring === 'maj' ? T.major(maj) : T.minor(min) }, wheel))
  }
  const label = (text, r, cls, shift = 0) => {
    const g = node('g', {}, wheel)
    node('text', { class: cls }, g).textContent = text
    labels.push({ g, deg: deg + shift, r })
  }
  label(maj, R.maj, 'maj')
  label(min + 'm', R.min, 'min')
  if (FLAT[pc]) label(FLAT[pc], R.enh, 'enh', 10) // small flat twin near the rim, clockwise of the big letter
}
// Marks: outlines over the sectors of the user's chords / notes from «Подбор» (on top of everything, no fill).
const marks = { maj: [], min: [] }
const markLayer = node('g', { id: 'marks' }, wheel)
for (let i = 0; i < 12; i++) {
  marks.maj.push(node('path', { class: 'mark', d: sector(R.minOut + 3, R.majOut - 3, i * 30), 'data-testid': `mark-maj-${i}` }, markLayer))
  marks.min.push(node('path', { class: 'mark', d: sector(R.minIn + 3, R.minOut - 3, i * 30), 'data-testid': `mark-min-${i}` }, markLayer))
}
// The chord tapped below the circle, highlighted in it (turns with the wheel). [C-6]
const pickMark = node('path', { id: 'pickMark', class: 'pick', 'data-testid': 'pickMark' }, wheel)
let circlePick = null // the chord name picked on the circle
function showPick() {
  pickMark.classList.toggle('on', !!circlePick)
  if (!circlePick) return
  const p = pickSector(circlePick)
  pickMark.setAttribute('d', p.ring === 'maj' ? sector(R.minOut + 2, R.majOut - 2, p.j * 30) : sector(R.minIn + 2, R.minOut - 2, p.j * 30))
  pickMark.classList.toggle('dashed', p.dashed)
  pickMark.dataset.at = `${p.ring}-${p.j}` // for tests
}

for (const { g } of labels) wheel.append(g) // the letters on top of the highlight and the marks: always crisp

// The notes of the scale: seven neighbours on the outer ring — a fixed arc over the rim; the wheel turns under it.
node('path', { id: 'scaleArc', class: 'scale', d: band(R.majOut + 4, R.majOut + 11, -45, 165) }, svg)
const degrees = [...Array(12)].map((_, j) => {
  const [x, y] = pt(R.deg, j * 30)
  return node('text', { class: 'deg', x: x.toFixed(1), y: y.toFixed(1), 'data-testid': `deg-${j}` }, $('degrees'))
})

// ---------- state ----------
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } }

// ---------- analytics: PostHog, EU [Y-1…Y-4] ----------
// The project key is public (it can only send events); only the real site sends — tests and local runs never count.
const ANALYTICS_KEY = analyticsKey(location.hostname, self.KVINTY_ANALYTICS_KEY)
const analyticsCommon = { $lib: 'kvinty-web', platform: platformOf(matchMedia('(display-mode: standalone)').matches, navigator.standalone),
  screen: `${screen.width}x${screen.height}`, lang: navigator.language }
let analyticsQueue = []
/** Queues an event (no key or switched off — nothing); the anonymous device id is made at the first one. */
function track(event, props = {}) {
  if (!ANALYTICS_KEY || store.get('analytics') === '0') return
  let id = store.get('aid')
  if (!id) { id = crypto.randomUUID(); store.set('aid', id) }
  analyticsQueue.push(analyticsEvent(event, id, props, Date.now(), analyticsCommon))
}
/** Sends the queue as one batch; offline — the events go back to the queue (the last 500 at most). */
function flush() {
  if (!analyticsQueue.length) return
  const sent = analyticsQueue
  analyticsQueue = []
  fetch(ANALYTICS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analyticsBatch(ANALYTICS_KEY, sent)), keepalive: true })
    .catch(() => { analyticsQueue = [...sent, ...analyticsQueue].slice(-500) })
}
setInterval(flush, 10000)
document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })
addEventListener('error', (e) => track('js_error', { message: e.message, where: `${e.filename}:${e.lineno}` }))
addEventListener('unhandledrejection', (e) => track('js_error', { message: String(e.reason), where: 'promise' }))
let rot = keyAngle(mod(+store.get('circleKey', 0) || 0, 12))
let mode = mod(+store.get('circleMode', 0) || 0, 7)
let view = 'guitar' // the app always opens on «Гитара» (user's wish) [U-…]
let fromSongs = false // «Гитара» was entered from «Песни»: the song's chords are lit [L-6]
let chordType = CHORD_TYPES.some((t) => t.s === store.get('chordType')) ? store.get('chordType') : '' // «Аккорды»: the type shown
let guitarMode = store.get('guitarMode', 'chord') === 'neck' ? 'neck' : 'chord' // «Гитара»: «Аккорды» (a fingering) or «Лады» (modes + neck)
let chordSel = null // { name, pcs } — on a neck, the chord tile whose notes are lit
let shown = ''
const selected = () => selectedIndex(rot)
// Songs: the only place chords are entered (taps only). The open song's chords feed «Разбор» (the former «Подбор»),
// the guitar tiles and the marks on the circle. [R-1…R-4]
// old «Подбор» input → the draft; a new example is offered once [R-9]
const songs = offerExample(readSongs(store.get('songs'), store.get('finText', '').split(' ').filter(Boolean)), seenExamples(store.get('exampleSeen')))
const AUTHOR_FOLDER = '@author'
let folderPaths = readFolders(store.get('songFolders', '[]'))
const folderLocations = readFolderLocations(store.get('songLocations', '{}'))
let activeFolder = store.get('songFolder', '')
store.set('exampleSeen', JSON.stringify([...new Set([...seenExamples(store.get('exampleSeen')), ...EXAMPLES.map((e) => e.name)])])) // both languages' examples stay seen
let cur = Math.min(Math.max(0, Math.round(+store.get('songCur', 0)) || 0), songs.length - 1)
let sub = 'list' // inside the tab: 'list' | 'edit' | 'finder' («Разбор») | 'play'
let cursor = { part: 0, bar: 0 }
const song = () => songs[cur]
const folderOf = (s) => s.readonly ? AUTHOR_FOLDER : (folderLocations[s.name] || '')
const saveSongs = () => {
  store.set('songs', JSON.stringify(songs.filter((s) => !s.readonly)))
  store.set('songCur', songs[cur]?.readonly ? 0 : songs.slice(0, cur).filter((s) => !s.readonly).length)
  store.set('songFolders', JSON.stringify(folderPaths))
  store.set('songLocations', JSON.stringify(folderLocations))
  store.set('songFolder', activeFolder)
}
saveSongs() // the example offered just now stays put
const tokens = () => songChords(song())
let finPick = 0
// «Разбор» of part k, or -1 = of the whole song. While a part's «Разбор» is open, the guitar tiles, the circle marks
// and the mode set on leaving take only that part's chords. [L-3]
let anPart = -1
const anTokens = () => (anPart < 0 ? tokens() : [...new Set(song().parts[anPart].bars.flat())])
let SONGS = null // the famous-songs index (songs.json), not the user's songs

// ---------- render the circle screen ----------
const finderMarks = () => marksFrom(parseInput(anTokens().join(' '), false).items, false)
function applyMarks() {
  const f = finderMarks()
  for (let j = 0; j < 12; j++) {
    marks.maj[j].classList.toggle('on', f.maj.has(pcOf(j)))
    marks.min[j].classList.toggle('on', f.min.has(minorOf(pcOf(j))))
  }
  const grid = view === 'guitar' && guitarMode === 'chord' // there the song's chords are lit only when coming from it
  for (const b of $('chords').children) b.classList.toggle('mine', (!grid || fromSongs) && f.names.has(b.firstChild.textContent))
}
function render() {
  wheel.setAttribute('transform', `rotate(${rot})`)
  for (const { g, deg, r } of labels) g.setAttribute('transform', `rotate(${deg}) translate(0 ${-r}) rotate(${-deg - rot})`)
  const i = selected()
  if (`${i}/${mode}` === shown) return
  shown = `${i}/${mode}`
  chordSel = null
  circlePick = null
  showPick()
  store.set('circleKey', i)
  store.set('circleMode', mode)
  const st = sectorStates(i, mode)
  for (const ring of ['maj', 'min']) sectors[ring].forEach((s, j) => {
    s.classList.toggle('hi', st[ring][j].hi)
    s.classList.toggle('tonic', st[ring][j].tonic)
  })
  degreeRing(mode).forEach((d, j) => {
    degrees[j].textContent = d.text
    degrees[j].classList.toggle('in', d.in)
    degrees[j].classList.toggle('home', d.home)
  })
  const lab = keyLabels(i, mode)
  $('cMaj').textContent = lab.big
  $('cMin').textContent = lab.small
  $('cMin').classList.toggle('long', lab.small.length > 10) // «миксолидийский» must clear the degree ring
  $('title').textContent = lab.title
  buildTiles()
  for (const b of $('modes').children) b.classList.toggle('on', +b.dataset.m === mode)
  $('aboutBtn').textContent = T.aboutBtn(MODES[mode].name)
  applyMarks()
  syncSel()
  renderNeck()
}
/** The chord tiles: the key's seven chords — on «Гитара» → «Аккорды» the 12 chords of the chosen type (chips above),
 *  the open song's chords lit when coming from «Песни» (a dot on the types it uses). [L-3, L-6] */
function buildTiles() {
  const grid = view === 'guitar' && guitarMode === 'chord', song7 = anTokens(), used = new Set(song7.map(typeOf))
  const list = grid ? NOTE.map((n) => ({ name: n + chordType, degree: '', tonic: false })) : tiles(selected(), mode)
  const tonic = list[0].name
  $('tilesFrom').hidden = !(grid && fromSongs && song7.length)
  $('tilesFrom').textContent = anPart < 0 ? T.litSong(song().name) : T.litPart(partLabel(song().parts[anPart].name))
  $('ctypes').replaceChildren(...CHORD_TYPES.map((t) => button(t.label, (t.s === chordType ? 'on' : '') + (fromSongs && used.has(t.s) ? ' has' : ''), () => {
    chordType = t.s
    track('chord_type', { type: t.s || 'maj' })
    store.set('chordType', t.s)
    guitarChord.set(guitarChord.c.name.replace(/^([A-G]♯?).*$/, `$1${t.s}`)) // the same root, the new type
    buildTiles()
    syncSel()
  }, `ctype-${t.s || 'maj'}`)))
  $('ctypes').querySelector('.on').scrollIntoView({ inline: 'center', block: 'nearest' }) // the chosen type in sight
  typeArrows()
  $('chords').replaceChildren(...list.map((t) => {
    const d = document.createElement('button')
    if (t.tonic) d.className = 't'
    if (t.name.length > 4) d.classList.add('long') // C♯m7b5: a smaller font, still in the tile
    d.innerHTML = '<b></b><span></span>'
    d.firstChild.textContent = t.name
    d.lastChild.textContent = t.degree
    d.setAttribute('aria-label', T.playChord(t.name))
    d.dataset.testid = `tile-${t.name}`
    d.onclick = () => tapChord(t.name, grid ? t.name : tonic) // in the grid each chord from its own root
    return d
  }))
  guitarChord.set(grid ? guitarChord.c?.name ?? tonic : tonic) // the grid keeps the chord you looked at
  applyMarks()
}

// ---------- "what is this mode?" ----------
function about() {
  const a = aboutContent(selected(), mode)
  // Focus goes to the heading, not the Close button: otherwise the sheet opens scrolled to the bottom.
  const h2 = Object.assign(el('h2', a.title), { tabIndex: -1, autofocus: true })
  $('about').replaceChildren(h2, el('h3', T.styles), el('p', a.styles), el('h3', T.examples), list(a.examples),
    el('h3', T.progs), Object.assign(list(a.progs), { className: 'progs' }),
    button(T.close, 'close', () => $('about').close()))
  $('about').showModal()
  $('about').scrollTop = 0
}
$('aboutBtn').onclick = () => { track('about_open'); about() }
$('about').onclick = (e) => { if (e.target === $('about')) $('about').close() }

// ---------- sound ----------
// One audio graph for the whole app: every note → master gain → compressor (no clipping when notes pile up).
// iOS can leave the context "interrupted" (calls, backgrounding) or closed: then it's rebuilt on the next tap.
// The audio session is set once — re-setting it on every tap can make iOS cut the sound.
let ctx, master
const voices = new Set() // sounding / scheduled oscillators, so they can be cut (new sequence, other tab)
/** iOS audio session: 'playback' plays with the mute switch on, but no microphone; 'play-and-record' for the tuner. */
function session(type) {
  try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type } catch {} // a setter that throws: keep what is there
}
/** A new audio context (old Safari has only the prefixed one). */
const newContext = () => new (window.AudioContext || window.webkitAudioContext)()
let clock = null // the last look at the audio clock { t, at }: to catch a context that says 'running' but stands still
/** Makes sure there is a working audio context (called on every tap that sounds). iOS can leave it closed,
 *  «interrupted», suspended — or 'running' with its clock stopped, which silences the whole app: then a new one. [S-6] */
function audio() {
  const now = performance.now()
  const stalled = !!clock && ctx.state === 'running' && now - clock.at > 400 && ctx.currentTime - clock.t < (now - clock.at) / 4000
  if (!ctx || ctx.state === 'closed' || ctx.state === 'interrupted' || stalled) {
    if (ctx) ctx.close().catch(() => {}) // closing an already closed context rejects: nothing to do
    if (!tuner && !recorder) session('playback') // play with the mute switch on
    ctx = newContext()
    master = ctx.createGain()
    master.gain.value = 0.22
    master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination)
    voices.clear()
  }
  if (ctx.state !== 'running') ctx.resume()
  clock = { t: ctx.currentTime, at: now }
}
/** A schedule (metronome, song) left behind by a new context or a sleeping tab picks up from now: the next click is in
 *  the past, or further ahead than a beat (spb s) and a half second — a slow beat is not a lost clock. [S-6] */
function resync(s, spb) { if (s.next < ctx.currentTime || s.next > ctx.currentTime + spb + 0.5) s.next = ctx.currentTime + 0.05 }
/** Silences everything playing or scheduled (a short fade, no click). */
function stopAll() {
  if (!ctx) return
  const now = ctx.currentTime
  for (const { o, g } of voices) { // stop() may be called again: the last call wins, no error
    g.gain.cancelScheduledValues(now)
    g.gain.setValueAtTime(g.gain.value, now)
    g.gain.linearRampToValueAtTime(0, now + 0.03)
    o.stop(now + 0.05)
  }
  voices.clear()
}
/** A soft plucked synth: triangle + sine an octave up, 1.8 s decay; notes `gap` s apart, starting `at` s from now. */
function pluck(notes, gap, at = 0) {
  audio()
  const t0 = ctx.currentTime + 0.02 + at
  notes.forEach((m, n) => {
    const t = t0 + n * gap
    for (const [type, mul, vol] of [['triangle', 1, 1], ['sine', 2, 0.35]]) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = type
      o.frequency.value = freq(m) * mul
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(vol, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8)
      o.connect(g).connect(master)
      o.start(t)
      o.stop(t + 1.9)
      const v = { o, g }
      voices.add(v)
      o.onended = () => { voices.delete(v); g.disconnect() }
    }
  })
}
function playChord(name, tonic = name, at = 0) {
  const notes = tileMidi(name, tonic)
  $('chords').dataset.played = notes.join(' ') // for tests
  pluck(notes, 0.025, at)
}
/** Chord tile: plays it. On «Гитара» → «Аккорды» its fingering replaces the one shown; on a neck («Лады», bass) its
 *  notes light up; on the circle the chord is highlighted in the circle. On a neck and the circle the same tile
 *  again clears. */
function tapChord(name, tonic) {
  track('chord_tap', { chord: name, tuning: tuning().id, view })
  playChord(name, tonic)
  if (view === 'guitar' && guitarMode === 'chord') guitarChord.set(name)
  else if (TUNINGS[view]) { chordSel = toggleChord(chordSel, name); renderNeck() }
  else { circlePick = circlePick === name ? null : name; showPick() }
  syncSel()
}
/** The marked tile: the fingering shown («Аккорды»), the chord lit on the neck or picked on the circle. */
function syncSel() {
  const name = view === 'guitar' && guitarMode === 'chord' ? guitarChord.c.name : TUNINGS[view] ? chordSel?.name : circlePick
  for (const b of $('chords').children) b.classList.toggle('sel', b.firstChild.textContent === name)
}

// ---------- chord fingering on «Гитара» → «Аккорды» ----------
/** Elements `<p>Name`, `<p>Diagram`, `<p>Prev`, `<p>Next`, `<p>Count`. On the diagram a swipe changes the variant
 *  (left = next) and a tap strums this variant. Fingerings follow the guitar tuning. */
// The chosen variant is remembered per chord and tuning ("std|C" → 1), also across restarts. [A-10]
let picks
try { picks = JSON.parse(store.get('voicingPicks', '{}')) } catch { picks = {} } // a damaged value: start afresh
/** A chord in the guitar's tuning: its fingerings and the one picked for it. */
function fingering(name) {
  const t = tuning(), key = `${t.id}|${name}`, list = voicings(t.open, name)
  return { name, key, root: parseInput(name, false).items[0].root, open: t.open, list, k: Math.min(picks[key] ?? 0, list.length - 1) }
}
/** Draws a fingering into an <svg class="diagram"> (viewBox 316 × 330). */
function drawDiagram(svg2, c) {
  const d = diagram(c.open, c.list[c.k], c.root)
  const n = c.open.length, L = 56, G = 220 / (n - 1), H = 46, F = 60, x = (s) => L + s * G, y = (row) => H + (row - 0.5) * F // 4–6 strings, one width
  svg2.replaceChildren()
  for (let s = 0; s < n; s++) node('line', { x1: x(s), y1: H, x2: x(s), y2: H + 4 * F, class: 'str' }, svg2)
  for (let r = 0; r <= 4; r++) node('line', { x1: x(0), y1: H + r * F, x2: x(n - 1), y2: H + r * F, class: r === 0 && d.first === 1 ? 'nut' : 'fr' }, svg2)
  if (d.first > 1) node('text', { x: L - 30, y: y(1), class: 'cs-first' }, svg2).textContent = d.first
  for (const m of d.marks) node('text', { x: x(m.s), y: H - 20, class: `cs-${m.kind}` }, svg2).textContent = m.kind === 'open' ? '○' : '×'
  if (d.barre) node('rect', { x: x(d.barre.from) - 17, y: y(d.barre.row) - 17, width: (d.barre.to - d.barre.from) * G + 34, height: 34, rx: 17,
    class: 'cs-barre' + (d.barre.root ? ' root' : '') }, svg2)
  for (const dot of d.dots) node('circle', { cx: x(dot.s), cy: y(dot.row), r: 17, class: 'cs-dot' + (dot.root ? ' root' : '') }, svg2)
  d.names.forEach((n, s) => { node('text', { x: x(s), y: H + 4 * F + 26, class: 'cs-name' }, svg2).textContent = n })
  svg2.dataset.frets = c.list[c.k].frets.join(' ') // for tests
}
function chordPanel(p) {
  const panel = { c: null }, $p = (id) => $(p + id)
  panel.set = (name) => {
    panel.c = fingering(name)
    $p('Name').textContent = twinName(name)
    panel.draw()
  }
  panel.draw = () => {
    const c = panel.c
    drawDiagram($p('Diagram'), c)
    $p('Count').textContent = `${c.k + 1} / ${c.list.length}`
    $p('Prev').disabled = c.k === 0
    $p('Next').disabled = c.k === c.list.length - 1
  }
  panel.step = (n) => {
    track('voicing_step')
    panel.c.k = Math.min(panel.c.list.length - 1, Math.max(0, panel.c.k + n))
    picks[panel.c.key] = panel.c.k
    store.set('voicingPicks', JSON.stringify(picks))
    panel.draw()
  }
  $p('Prev').onclick = () => panel.step(-1)
  $p('Next').onclick = () => panel.step(1)
  let down = null
  $p('Diagram').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY } })
  $p('Diagram').addEventListener('pointerup', (e) => {
    const step = swipeStep(e.clientX - down.x, e.clientY - down.y)
    if (step) panel.step(step)
    else pluck(voicingMidi(panel.c.open, panel.c.list[panel.c.k].frets), 0.03)
  })
  return panel
}
const guitarChord = chordPanel('gc')

// ---------- neck (guitar / bass) ----------
/** The «Аккорды» tuning — the guitar's or the bass's (before: the guitar tab's own). [G-1] */
const tuning = () => anyTuning(store.get('tuning', store.get('tuning-guitar')))
/** Sets it; the tuner's tuning of that instrument follows. */
function setTuning(id) { store.set('tuning', id); store.set(`tuning-${anyTuning(id).inst}`, id) }
/** Draws the neck lying down, like tabs: nut on the left, high string on top; dots from core.neckDots. */
function renderNeck() {
  if (!TUNINGS[view]) return
  const open = tuning().open, n = open.length
  // The neck is as wide as a 6-string guitar's whatever the string count (bass: wider gaps, same size).
  const S = (5 * 48) / (n - 1), F = 44, HEAD = 26, OPEN = 40, PAD = 24 // string gap, fret length, names row, open zone, margin
  const along = HEAD + OPEN + FRETS * F + 10, across = PAD + (n - 1) * S + PAD * 2 + 14
  neck.setAttribute('viewBox', `0 0 ${along} ${across}`)
  neck.dataset.orient = 'h'
  neck.replaceChildren()
  const at = (a, s) => [a, PAD * 2 + (n - 1 - s) * S] // a = along the neck, s = string (0 = lowest)
  const line = (a1, s1, a2, s2, cls) => { const [x1, y1] = at(a1, s1), [x2, y2] = at(a2, s2); return node('line', { x1, y1, x2, y2, class: cls }, neck) }
  const fretA = (f) => HEAD + OPEN + f * F // fret wire f (0 = nut)
  for (let f = 0; f <= FRETS; f++) line(fretA(f), 0, fretA(f), n - 1, f === 0 ? 'nut' : 'fret')
  for (const f of [3, 5, 7, 9, 12]) { // inlays between the middle strings; fret numbers below
    const a = fretA(f) - F / 2, mid = (n - 1) / 2
    for (const s of f === 12 ? [mid - 1, mid + 1] : [mid]) { const [x, y] = at(a, s); node('circle', { cx: x, cy: y, r: 6, class: 'inlay' }, neck) }
    node('text', { x: a, y: across - 10, class: 'fretno' }, neck).textContent = f
  }
  open.forEach((m, s) => {
    line(fretA(0), s, fretA(FRETS), s, 'string').style.strokeWidth = (1 + (n - 1 - s) * 0.35).toFixed(2) // low strings thicker
    const [x, y] = at(HEAD / 2, s)
    node('text', { x, y, class: 'sname' }, neck).textContent = NOTE[m % 12]
  })
  const dots = neckDots(open, selected(), mode, { chordPcs: chordSel?.pcs ?? null, minePcs: finderMarks().notes })
  for (const d of dots) {
    const [x, y] = at(d.f === 0 ? HEAD + OPEN / 2 : fretA(d.f) - F / 2, d.s)
    const g = node('g', { class: ['dot', ...d.classes].join(' '), 'data-testid': `dot-${d.s}-${d.f}`, 'data-midi': d.midi, 'data-deg': d.deg }, neck)
    node('circle', { cx: x, cy: y, r: 19 }, g)
    node('text', { x, y }, g).textContent = d.label
    g.addEventListener('click', () => { neck.dataset.played = d.midi; pluck([d.midi], 0) })
  }
}

function setView(v) {
  const entering = v !== view // not a «Лады» ↔ «Аккорды» switch inside «Гитара»
  if (entering) track('tab_view', { tab: v })
  if (entering) fromSongs = view === 'songs' && v === 'guitar'
  stopAll() // nothing keeps ringing from the tab we leave
  if (v !== 'tuner') tunerStop() // the microphone is on only while the tuner is on screen
  if (v !== 'songs') playerStop()
  if (v !== 'records' && recordingSource === 'records') stopRecording()
  // Leaving «Песни» with chords in the song: the other tabs open on the mode its «Разбор» finds (like «На круге»). [L-1]
  const found = view === 'songs' && v !== 'songs' && analyzeFinder(anTokens(), false, finPick, null).result
  if (found) { rot = keyAngle(found.i); mode = found.m; render() }
  view = v
  chordSel = null
  if (entering && fromSongs && anTokens().length) { guitarChord.set(anTokens()[0]); chordType = typeOf(anTokens()[0]) } // from the song: its first chord
  document.body.dataset.gmode = guitarMode
  for (const b of $('views').querySelectorAll('[data-v]')) b.classList.toggle('on', b.dataset.v === v)
  document.body.dataset.view = v
  // SVG elements have no .hidden property in WebKit: toggle the attribute.
  const chordMode = v === 'guitar' && guitarMode === 'chord'
  svg.toggleAttribute('hidden', v !== 'circle')
  neck.toggleAttribute('hidden', !TUNINGS[v] || chordMode)
  $('gchord').hidden = !chordMode
  $('gmode').hidden = v !== 'guitar'
  $('gmode').textContent = guitarMode === 'chord' ? T.gModes : T.gChords
  buildTiles() // «Гитара» may show the chords from «Подбор»
  $('songs').hidden = v !== 'songs'
  $('records').hidden = v !== 'records'
  $('metro').hidden = v !== 'metro'
  $('tuner').hidden = v !== 'tuner'
  $('info').hidden = v === 'songs' || v === 'records' || v === 'metro' || v === 'tuner'
  if (v === 'tuner') renderTuner()
  $('neckbar').hidden = !TUNINGS[v]
  if (v === 'songs') renderSongs()
  if (v === 'records') loadRecords()
  if (TUNINGS[v]) {
    $('tuning').replaceChildren(...ALL_TUNINGS.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })))
    $('tuning').value = tuning().id
  }
  syncSel()
  renderNeck()
}
/** The type carousel: ‹ › scroll it; each arrow hides when there is nothing more that way. [L-6] */
function typeArrows() {
  const c = $('ctypes')
  $('ctPrev').classList.toggle('off', c.scrollLeft < 4)
  $('ctNext').classList.toggle('off', c.scrollLeft + c.clientWidth > c.scrollWidth - 4)
}
$('ctypes').addEventListener('scroll', typeArrows)
$('ctPrev').onclick = () => $('ctypes').scrollBy({ left: -$('ctypes').clientWidth * 0.7, behavior: 'smooth' })
$('ctNext').onclick = () => $('ctypes').scrollBy({ left: $('ctypes').clientWidth * 0.7, behavior: 'smooth' })
$('gmode').onclick = () => {
  track('mode', { mode: guitarMode === 'chord' ? 'Лады' : 'Аккорды' }) // the same values in any language
  guitarMode = guitarMode === 'chord' ? 'neck' : 'chord'
  store.set('guitarMode', guitarMode)
  setView('guitar')
}
function shiftKey(semis) {
  rot = keyAngle(shiftedKey(selected(), semis))
  render()
}
// Swipe across the neck: left = a semitone up, right = down. A tap still plays the dot (a swipe ends off the dot it
// started on, so the browser fires no click on a dot).
let swipe = null
neck.addEventListener('pointerdown', (e) => { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY } })
neck.addEventListener('pointercancel', () => { swipe = null })
neck.addEventListener('pointerup', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return
  const step = swipeStep(e.clientX - swipe.x, e.clientY - swipe.y)
  swipe = null
  if (step) shiftKey(step)
})
for (const b of $('views').querySelectorAll('[data-v]')) b.onclick = () => setView(b.dataset.v)
$('tuning').onchange = () => { setTuning($('tuning').value); track('tuning', { tuning: $('tuning').value }); renderNeck(); guitarChord.set(guitarChord.c.name) } // guitar or bass
$('keyDown').onclick = () => shiftKey(-1)
$('keyUp').onclick = () => shiftKey(1)

// ---------- «Песни» ----------
// Famous-songs index: songs.json, built offline by scripts/build-songs.py (see docs/SPEC.md, section I). Loaded on first use.
function loadSongs() { // called only while SONGS is null
  return fetch('songs.json').then((r) => r.json()).then((d) => (SONGS = d.songs)).catch(() => (SONGS = []))
}
function playSequence(names) {
  stopAll() // a new progression replaces the one still playing instead of piling on top of it
  names.forEach((c, k) => playChord(c, c, k * 0.75))
  $('finder').dataset.played = names.join(' ') // for tests
}
function showSub(s) {
  sub = s
  for (const id of ['songList', 'songEdit', 'finder', 'player']) $(id).hidden = id !== { list: 'songList', edit: 'songEdit', finder: 'finder', play: 'player' }[s]
}
function renderSongs() {
  if (sub === 'list') renderList()
  else if (sub === 'edit') renderEdit()
  else if (sub === 'finder') analyze()
  showSub(sub)
}
/** The list: the draft first, then the user's songs and the examples. A swipe left on a song shows «Удалить». [R-2] */
let openRow = -1 // the row swiped open, -1 = none
const folderLabel = (path) => path === AUTHOR_FOLDER ? T.folderAuthor : path ? path.replaceAll('/', ' › ') : T.folderRoot
function renderFolderBar() {
  $('songFolderBack').hidden = !activeFolder
  $('songFolderBack').setAttribute('aria-label', T.html.back)
  $('songFolderTitle').textContent = folderLabel(activeFolder)
  $('songFolderCreate').textContent = T.folderCreate
  $('songFolderCreate').hidden = activeFolder === AUTHOR_FOLDER
  $('songAdd').hidden = activeFolder === AUTHOR_FOLDER
  $('songImport').hidden = activeFolder === AUTHOR_FOLDER
  $('songURL').hidden = activeFolder === AUTHOR_FOLDER || !ugEndpoint
  $('songPaste').hidden = activeFolder === AUTHOR_FOLDER
}
function renderList() {
  renderFolderBar()
  const visible = songs.map((s, k) => ({ s, k })).filter(({ s }) => folderOf(s) === activeFolder)
  const rows = visible.map(({ s, k }) => {
    const li = el('li', '', k === openRow ? 'open' : ''), b = button('', 'item', () => {
      if (openRow >= 0) { openRow = -1; renderList(); return } // a tap while a row is open only closes it
      cur = k; cursor = { part: 0, bar: 0 }; anPart = -1; saveSongs(); sub = 'edit'; renderSongs(); track('song_open')
    }, `song-${k}`)
    b.append(el('b', s.name), el('small', `${s.meter} · ${s.bpm} ${T.bpm} · ${songChords(s).join(' ') || T.empty}`))
    if (k > 0 && !s.readonly) { // the draft and author originals stay
      li.append(button(T.del, 'del', () => { songs.splice(k, 1); cur = 0; openRow = -1; saveSongs(); renderList(); track('song_delete') }, `songDel-${k}`))
      let down = null
      li.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY } })
      li.addEventListener('pointercancel', () => { down = null })
      li.addEventListener('pointerup', (e) => {
        if (!down) return // the browser took the gesture over (scrolling)
        const step = swipeStep(e.clientX - down.x, e.clientY - down.y)
        down = null
        if (step) { openRow = step > 0 ? k : -1; renderList() } // left opens, right closes
      })
    }
    li.append(b)
    return li
  })
  const paths = [...folderChildren(folderPaths, activeFolder), ...(activeFolder ? [] : [AUTHOR_FOLDER])]
  const folderRows = []
  for (const path of paths) { const row = el('li'); row.className = 'folder-row'; row.dataset.folder = path; folderRows.push(row) }
  paths.forEach((path, i) => {
    const row = folderRows[i], name = path === AUTHOR_FOLDER ? T.folderAuthor : path.split('/').at(-1)
    const open = () => { activeFolder = path; openRow = -1; store.set('songFolder', path); renderList() }
    const item = button('', 'folder-item', open, `songFolder-${path === AUTHOR_FOLDER ? 'author' : encodeURIComponent(path)}`)
    item.append(el('span', path === AUTHOR_FOLDER ? '🔒' : '📁', 'folder-mark'), el('span', name, 'folder-name'), el('span', '›', 'folder-mark'))
    row.append(item)
  })
  const authorIndex = paths.indexOf(AUTHOR_FOLDER)
  if (authorIndex >= 0) rows.splice(Math.min(1, rows.length), 0, folderRows[authorIndex])
  rows.push(...folderRows.filter((_, i) => i !== authorIndex))
  $('songItems').replaceChildren(...rows)
}
function createSongFolder() {
  const name = prompt(T.folderName)
  if (name === null) return
  if (!name.trim()) return
  const result = addFolder(folderPaths, activeFolder, name)
  if (!result.path) { toast(T.folderExists); return }
  folderPaths = result.paths
  activeFolder = result.path
  track('song_folder_create')
  saveSongs()
  renderList()
}
function goToParentFolder() { activeFolder = folderParent(activeFolder); store.set('songFolder', activeFolder); renderList() }
$('songFolderCreate').onclick = createSongFolder
$('songFolderBack').onclick = goToParentFolder
function loadAuthorSongs() {
  fetch('author-songs.json').then((r) => r.json()).then((data) => {
    const originals = data.songs.map((entry) => cleanSong(entry.song)).filter(Boolean).map((s) => ({ ...s, readonly: true }))
    songs.push(...originals)
    renderList()
  }).catch(() => renderList())
}
loadAuthorSongs()
function renderMoveTargets() {
  $('songMoveTitle').textContent = T.folderMove
  $('songMoveCancel').textContent = T.html.cancel
  const targets = ['', ...folderPaths]
  $('songMoveTargets').replaceChildren(...targets.map((path) => button(folderLabel(path), '', moveSongTo.bind(null, path), `move-${path ? encodeURIComponent(path) : 'root'}`)))
}
function moveSongTo(path) {
  folderLocations[song().name] = path
  track('song_move', { destination: path ? 'folder' : 'root' })
  saveSongs()
  $('songMoveDialog').close()
  toast(T.folderMoved)
  renderEdit()
}
$('songMove').onclick = () => { renderMoveTargets(); $('songMoveDialog').showModal() }
function cancelSongMove() { $('songMoveDialog').close() }
$('songMoveCancel').onclick = cancelSongMove
$('songAdd').onclick = () => {
  track('song_create')
  const created = newSong(songName(songs))
  songs.push(created)
  folderLocations[created.name] = activeFolder
  cur = songs.length - 1
  cursor = { part: 0, bar: 0 }
  saveSongs()
  sub = 'edit'
  renderSongs()
}
// «Вставить текст»: a chord sheet from a chords site or a song file → a new song [R-13, R-14]
let pastePer = 1
function renderPer() { for (const b of $('pastePer').children) b.classList.toggle('on', +b.dataset.per === pastePer) }
$('songPaste').onclick = () => { $('pasteText').value = ''; $('pasteMsg').textContent = ''; renderPer(); $('paste').showModal() }
$('pastePer').onclick = (e) => { if (e.target.dataset.per) { pastePer = +e.target.dataset.per; renderPer() } }
$('pasteCancel').onclick = () => $('paste').close()
$('pasteGo').onclick = () => {
  const r = readImport($('pasteText').value, songs, pastePer)
  if (r.error) { $('pasteMsg').textContent = r.error; return }
  songs.push(r.song)
  folderLocations[r.song.name] = activeFolder
  cur = songs.length - 1
  cursor = { part: 0, bar: 0 }
  saveSongs()
  $('paste').close()
  sub = 'edit'
  renderSongs()
}
function addImportedSong(song) {
  songs.push(song)
  folderLocations[song.name] = activeFolder
  cur = songs.length - 1
  cursor = { part: 0, bar: 0 }
  saveSongs()
  sub = 'edit'
  renderSongs()
  track('song_import')
}
function importSongFile(file) {
  file.text().then((text) => {
    const r = readImport(text, songs)
    if (r.error) { toast(r.error); return }
    addImportedSong(r.song)
  }).catch(() => toast(T.importFail))
}
const ugEndpoint = document.querySelector('meta[name="ug-import"]').content
$('songURL').hidden = !ugEndpoint
$('songURL').onclick = () => { $('urlForm').reset(); $('urlMsg').textContent = ''; $('urlImport').showModal() }
$('urlCancel').onclick = () => $('urlImport').close()
$('urlImport').oncancel = (e) => { e.preventDefault(); $('urlCancel').click() }
$('urlForm').onsubmit = async (e) => {
  e.preventDefault()
  $('urlGo').disabled = $('urlCancel').disabled = true
  $('urlMsg').textContent = T.urlLoading
  try {
    const body = new URLSearchParams({ url: $('urlValue').value })
    const res = await fetch(ugEndpoint, { method: 'POST', body })
    if (!res.ok) throw new Error('request failed')
    const r = readImport(JSON.stringify(await res.json()), songs)
    if (r.error) { $('urlMsg').textContent = r.error; return }
    $('urlImport').close()
    addImportedSong(r.song)
  } catch {
    $('urlMsg').textContent = T.urlFail
  } finally {
    $('urlGo').disabled = $('urlCancel').disabled = false
  }
}
$('songImport').onclick = () => $('songFile').click()
$('songFile').onchange = () => {
  const file = $('songFile').files[0]
  $('songFile').value = ''
  if (file) importSongFile(file)
}
/** A short note at the bottom for two seconds (e.g. «Копия создана»). */
let toastTimer = 0
function toast(text) {
  $('toast').textContent = text
  $('toast').classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2000)
}
// ⧉ — a copy of the song, opened at once, with a note [R-1]
$('songCopy').onclick = () => {
  track('song_copy')
  const cloned = songCopy(song(), songs)
  delete cloned.readonly
  songs.push(cloned)
  folderLocations[cloned.name] = activeFolder === AUTHOR_FOLDER ? '' : activeFolder
  cur = songs.length - 1
  cursor = { part: 0, bar: 0 }
  saveSongs()
  renderSongs()
  toast(T.copied(song().name))
}
// «Экспорт JSON»: the song file through the system share sheet [R-14]
$('songShare').onclick = () => {
  const json = songToJson(song()), file = new File([json], `${song().name}.json`, { type: 'application/json' })
  track('song_export')
  if (navigator.share && navigator.canShare?.({ files: [file] })) navigator.share({ files: [file] }).catch((error) => {
    if (error.name !== 'AbortError') toast(T.shareFail)
  }) // closing the system sheet rejects with AbortError
  else navigator.clipboard.writeText(json).then(() => alert(T.shared)).catch(() => toast(T.shareFail))
}
/** The song: name, tempo, meter, play / «Разбор» / guitar, the parts with their bars, the chord pad. [R-1, R-3] */
function renderEdit() {
  const s = song(), has = tokens().length > 0
  const locked = s.readonly === true
  $('songEdit').classList.toggle('readonly', locked)
  $('songMove').hidden = locked
  $('songMove').setAttribute('aria-label', T.folderMove)
  $('songReadonly').textContent = T.readOnly
  const chords = songChords(s), key = chords.length ? analyzeFinder(chords, false, 0, null).result?.title : ''
  $('songTransposeKey').textContent = key ? key.split(' ')[0] : '—'
  $('songTranspose').setAttribute('aria-label', `${T.transposeLabel}: ${key || '—'}`)
  $('songTransposeDown').setAttribute('aria-label', T.transposeDown)
  $('songTransposeUp').setAttribute('aria-label', T.transposeUp)
  $('songReadonly').hidden = !locked
  $('songName').textContent = s.name
  $('songDel').hidden = cur === 0 || locked // the draft and author originals stay
  $('songBpm').textContent = s.bpm
  $('songMeter').value = s.meter
  $('songPlay').disabled = !has
  $('songGuitar').disabled = !has
  $('songInf').disabled = !has
  $('songInf').classList.toggle('on', s.loop)
  $('songParts').replaceChildren(...s.parts.map((p, pi) => {
    const box = el('div', '', 'part'), head = el('div', '', 'srow')
    const times = el('div', '', 'stepper')
    times.append(button('−', '', () => { p.times = Math.max(1, p.times - 1); changed() }, `part-${pi}-less`),
      el('span', `×${p.times}`, 'times'),
      button('+', '', () => { p.times = Math.min(16, p.times + 1); changed() }, `part-${pi}-more`))
    head.append(button(partLabel(p.name), 'pname', () => { p.name = nextPart(p.name); changed() }, `part-${pi}-name`), times,
      Object.assign(button('🔍', '', () => { // «Разбор» of this part; «Дальше хорошо пойдёт» adds at its end
        anPart = pi; cursor = { part: pi, bar: p.bars.length }; finPick = 0; sub = 'finder'; renderSongs()
      }, `part-${pi}-an`), { disabled: !p.bars.length, hidden: true, ariaLabel: T.partAn }), // hidden for now, kept and tested
      Object.assign(button('⧉', '', () => { s.parts.splice(pi + 1, 0, JSON.parse(JSON.stringify(p))); changed() }, `part-${pi}-copy`), { ariaLabel: T.partCopy }))
    if (s.parts.length > 1) head.append(Object.assign(button('✕', '', () => {
      s.parts.splice(pi, 1)
      cursor = { part: Math.min(cursor.part, s.parts.length - 1), bar: 0 }
      changed()
    }, `part-${pi}-del`), { ariaLabel: T.partDel }))
    const bars = el('div', '', 'bars')
    const at = (k) => cursor.part === pi && cursor.bar === k
    const starts = new Set(p.lyrics.slice(0, p.times).flat().map((l) => l.bar)) // bars where a line of words starts: ♪
    p.bars.forEach((b, k) => bars.append(button(b.join(' '), (at(k) ? 'cur' : '') + (starts.has(k) ? ' lyr' : ''), () => {
      cursor = { part: pi, bar: k, slot: 0 }
      b.forEach((c, n) => playChord(c, c, n * 0.5))
      renderEdit()
    }, `bar-${pi}-${k}`)))
    bars.append(button('+', 'end' + (at(p.bars.length) ? ' cur' : ''), () => { cursor = { part: pi, bar: p.bars.length, slot: 0 }; renderEdit() }, `bar-${pi}-end`))
    box.append(head, bars)
    if (p.lyrics.length) { // the words, per pass, each with its bar: a tap puts the frame on that bar, a second tap fixes the text [R-12]
      const words = el('div', '', 'lyrics')
      // only the passes that play (×N lowered: their words are kept, just hidden)
      p.lyrics.slice(0, p.times).forEach((pass, t) => pass.forEach((l, i) => words.append(button((p.times > 1 ? T.pass(t + 1) : '') + `${T.barNo(l.bar + 1)} · ${l.text}`, at(l.bar) ? 'on' : '', () => {
        if (!at(l.bar)) { cursor = { part: pi, bar: l.bar }; renderEdit(); return } // first: show its bar
        const text = prompt(T.lyricLine, l.text)
        if (text === null) return
        if (text.trim()) l.text = text.trim()
        else pass.splice(i, 1)
        changed()
      }, `lyr-${pi}-${t}-${i}`))))
      box.append(words)
    }
    if (p.bars.length) { // «+ слова»: a line from the bar under the frame (in another part — from the first bar) [R-12]
      const adds = el('div', '', 'srow addlyr')
      for (let t = 0; t < p.times; t++) adds.append(button(`${T.addWords}${p.times > 1 ? ` ${t + 1}` : ''}`, '', () => {
        const bar = cursor.part === pi ? Math.min(cursor.bar, p.bars.length - 1) : 0
        const text = prompt(T.wordsFrom(bar + 1), p.lyrics[t]?.find((l) => l.bar === bar)?.text ?? '')
        if (text === null) return
        p.lyrics = setLyric(p.lyrics, t, bar, text)
        track('lyric_add')
        changed()
      }, `lyr-add-${pi}-${t}`))
      box.append(adds)
    }
    return box
  }), button(T.addPart, 'wide', () => {
    s.parts.push({ name: nextPart(s.parts[s.parts.length - 1].name), times: 1, bars: [], lyrics: [] })
    cursor = { part: s.parts.length - 1, bar: 0 }
    changed()
  }, 'partAdd'))
  if (locked) {
    const allowed = new Set(['songBack', 'songCopy', 'songShare', 'songPlay'])
    $('songEdit').querySelectorAll('button, select').forEach((b) => { if (!allowed.has(b.id)) b.disabled = true })
  } else {
    for (const id of ['songName', 'songCopy', 'songShare', 'songDel', 'songMove', 'songSlower', 'songFaster', 'songMeter', 'songInf', 'songPlay', 'songGuitar', 'songAnalyze', 'songTransposeDown', 'songTransposeUp', 'padDel']) $(id).disabled = false
    $('finPads').querySelectorAll('button').forEach((b) => { b.disabled = false })
    $('songPlay').disabled = $('songGuitar').disabled = $('songInf').disabled = !has
  }
  lightPads()
}
function changed() { saveSongs(); renderEdit() }
/** The pad lights the chords that fit next after the cursor. [R-11] */
function lightPads() {
  const h = nextHint(chordsBefore(song(), cursor))
  for (const b of $('finPads').querySelectorAll('button')) {
    b.classList.toggle('next', h.next.includes(b.textContent)) // the commonest next: bright
    b.classList.toggle('fit', h.fit.includes(b.textContent)) // the rest of the key: pale
    b.classList.toggle('borrow', h.borrow.includes(b.textContent)) // from outside the key, but common: dashed
  }
}
$('songInf').onclick = () => { song().loop = !song().loop; changed() } // ∞: the song round and round [R-8]
/** All four chord groups stay available in the scroll area. A tap enters and plays the chord. [R-3, R-25] */
function renderPads() {
  const pad = (suffix, cls) => {
    const grid = el('div', '', 'padgrid ' + cls)
    grid.append(...NOTE.map((n) => button(n + suffix, '', () => enter(n + suffix), `fin-${n + suffix}`)))
    return grid
  }
  $('finPads').replaceChildren(pad('', 'major'), pad('m', 'minor'), pad('7', 'minor'), pad('°', 'minor'))
}
function enter(name) {
  const p = song().parts[cursor.part], r = enterChord(p.bars, cursor.bar, name, song().meter, cursor.slot)
  p.bars = r.bars
  cursor.bar = r.bar; cursor.slot = r.slot
  playChord(name, name)
  changed()
}
$('padDel').onclick = () => {
  const p = song().parts[cursor.part], r = deleteBar(p.bars, cursor.bar)
  p.bars = r.bars
  if (r.gone !== null) p.lyrics = lyricsAfterDelete(p.lyrics, r.gone, p.bars.length) // the words follow their bars
  cursor.bar = r.bar; cursor.slot = r.slot
  changed()
}
$('songBack').onclick = () => { sub = 'list'; renderSongs() }
$('songName').onclick = () => {
  const s = song(), previous = s.name, name = (prompt(T.songTitle, s.name) ?? '').trim()
  if (name) {
    s.name = name
    if (Object.hasOwn(folderLocations, previous)) { folderLocations[name] = folderLocations[previous]; delete folderLocations[previous] }
    changed()
  }
}
$('songDel').onclick = () => {
  if (!confirm(T.delSong(song().name))) return
  track('song_delete')
  delete folderLocations[song().name]
  songs.splice(cur, 1)
  cur = 0
  saveSongs()
  sub = 'list'
  renderSongs()
}
holdRepeat($('songSlower'), () => { song().bpm = clampBpm(song().bpm - 1); changed() })
holdRepeat($('songFaster'), () => { song().bpm = clampBpm(song().bpm + 1); changed() })
const transpose = (step) => {
  songs[cur] = transposeSong(song(), step)
  track('song_transpose', { semitones: step })
  changed()
}
const transposeDown = () => transpose(-1)
const transposeUp = () => transpose(1)
holdRepeat($('songTransposeDown'), transposeDown)
holdRepeat($('songTransposeUp'), transposeUp)
$('songMeter').replaceChildren(...Object.keys(METERS).map((m) => Object.assign(document.createElement('option'), { value: m, textContent: m })))
$('songMeter').onchange = () => {
  const s = song(), meter = $('songMeter').value
  s.parts.forEach((p, pi) => {
    const old = p.bars, fitted = fitBars(old, meter)
    p.bars = fitted.bars
    p.lyrics = p.lyrics.map((pass) => pass.map((line) => ({ ...line, bar: fitted.starts[line.bar] })))
    if (cursor.part === pi) {
      const atEnd = cursor.bar === old.length, selected = old[cursor.bar], currentSlot = cursor.slot ?? 0
      cursor.bar = atEnd ? p.bars.length : fitted.starts[cursor.bar]
      cursor.slot = atEnd || selected.length > METERS[meter].length ? 0 : Math.min(currentSlot, selected.length)
    }
  })
  s.meter = meter
  changed()
}
$('songAnalyze').onclick = () => { anPart = -1; finPick = 0; sub = 'finder'; renderSongs() }
$('anBack').onclick = () => { anPart = -1; sub = 'edit'; renderSongs() } // back at the song: the whole song again
/** «На гитаре»: the guitar tab, chords mode, the song's chords as tiles, in the key its «Разбор» finds. [L-4] */
function toGuitar() {
  guitarMode = 'chord'
  store.set('guitarMode', 'chord')
  setView('guitar')
}
$('songGuitar').onclick = () => { anPart = -1; toGuitar() }
$('songPlay').onclick = () => playerStart(timeline(song()), song().loop)
renderPads()

// «Разбор» (the former «Подбор»): core.analyze() on the song's chords.
function analyze() {
  const input = anTokens(), a = analyzeFinder(input, false, finPick, SONGS), out = $('finOut')
  if (!SONGS) loadSongs().then(() => { if (view === 'songs' && sub === 'finder') analyze() })
  out.replaceChildren()
  applyMarks()
  $('anTitle').textContent = anPart < 0 ? T.anSong : T.anPart(partLabel(song().parts[anPart].name))
  $('anInput').replaceChildren(...input.map((c) => button(c, 'chord', () => playChord(c, input[0]))))
  if (!a.result) { out.append(el('p', T.anEmpty, 'hint')); return }
  const r = a.result, card = el('div', '', 'card')
  card.dataset.testid = 'finResult'
  card.append(el('h2', r.title))
  if (r.sub) card.append(el('p', r.sub, 'sub'))
  // the mode's chords and notes; what the song (part) uses is lit [F-H1]
  const modeChords = el('div', '', 'modechords'), scaleRow = el('p', T.notesLabel, 'scale')
  modeChords.dataset.testid = 'finModeChords'
  scaleRow.dataset.testid = 'finScale'
  for (const c of r.chords) { const s = el('span', '', c.used ? 'used' : ''); s.append(el('b', c.name), el('small', c.degree)); modeChords.append(s) }
  for (const n of r.scale) scaleRow.append(el('span', n.name, n.used ? 'used' : ''), ' ')
  card.append(modeChords, scaleRow, ...a.messages.map((x) => el('p', x.text, x.kind)))
  const open = (v) => {
    rot = keyAngle(r.i); mode = r.m
    render()
    if (v === 'guitar') toGuitar()
    else setView(v)
  }
  const row = el('div', '', 'row')
  row.append(button(T.onCircle, 'act', () => open('circle'), 'finCircle'), button(T.onGuitar, 'act', () => open('guitar'), 'finNeck'))
  card.append(row)
  out.append(card)
  const chips = el('div', '', 'chips')
  a.alternatives.forEach((x, k) => chips.append(button(x.label, x.on ? 'on' : '', () => { finPick = k; analyze() })))
  out.append(el('h3', T.alsoFits), chips)
  if (a.songs) {
    out.append(el('h3', a.songs.title))
    if (a.songs.list.length) {
      const ul = el('ul', '', 'songs')
      ul.dataset.testid = 'finSongs'
      for (const s of a.songs.list) { const li = el('li', s.line); li.append(el('div', s.played, 'played')); ul.append(li) }
      out.append(ul)
      if (a.songs.more) out.append(el('p', T.andMore(a.songs.more), 'hint'))
    } else out.append(el('p', T.noHits, 'hint'))
  }
  if (a.next.length) {
    const chips = el('div', '', 'chips')
    chips.dataset.testid = 'finNext'
    a.next.forEach((c) => chips.append(button(c, 'chord', () => { // a tap adds it to the song, at the cursor
      const p = song().parts[cursor.part], e = enterChord(p.bars, cursor.bar, c, song().meter, cursor.slot)
      p.bars = e.bars
      cursor.bar = e.bar; cursor.slot = e.slot
      saveSongs()
      playChord(c, a.tonicChord)
      analyze()
    })))
    out.append(el('h3', T.nextGood), chips)
  }
  const ol = el('ol', '', 'progs')
  ol.dataset.testid = 'finProgs'
  for (const p of a.progs) {
    const li = el('li'), b = el('button', '', 'prog')
    p.chords.forEach((c, n) => { b.append(el('span', c, p.have[n] ? 'have' : '')); if (n < p.chords.length - 1) b.append(' – ') })
    b.append(el('small', ' ' + p.degrees))
    b.onclick = () => playSequence(p.chords)
    li.append(b)
    if (p.songs) li.append(el('div', p.songs, 'progsongs'))
    ol.append(li)
  }
  out.append(el('h3', a.progsTitle), ol, el('p', a.credit, 'credit'))
}

// ---------- player (practice loop) ----------
// Beats are scheduled on the audio clock like the metronome's; each beat updates the chords when it sounds, and the
// strip of bars slides every frame from the last beat's time. [R-7, R-8]
const PX = 26 // strip: pixels per beat
let speed = [50, 75, 100].includes(+store.get('songSpeed')) ? +store.get('songSpeed') : 100
let player = null // { tl, loop, beat, next, timer, raf, anchor: { b, time }, end }
let recorder = null, recordingStream = null, recordingParts = [], recordingSource = null, recordingStarted = 0
let recordingDbPromise = null, recordings = [], recordingUrls = [], openRecord = null, recordingTimer = 0
let songClick = store.get('songClick') !== '0' // click and visual swing stay together [R-8]
let songChordSound = store.get('songChordSound') === '1' // chord playback is optional
let swingTimer = 0
function renderClick() {
  $('plClick').setAttribute('aria-pressed', String(songClick))
  if (!songClick) { clearTimeout(swingTimer); $('plClick').dataset.swing = 'still' }
}
$('plClick').onclick = () => { songClick = !songClick; store.set('songClick', songClick ? '1' : '0'); renderClick() }
function renderChordSound() { $('plChords').setAttribute('aria-pressed', String(songChordSound)); $('plChords').classList.toggle('on', songChordSound) }
$('plChords').onclick = () => {
  songChordSound = !songChordSound
  store.set('songChordSound', songChordSound ? '1' : '0')
  track('song_chord_sound', { enabled: songChordSound })
  renderChordSound()
  if (songChordSound && player && player.beat >= 0) {
    const chord = songAt(player.tl, player.beat, player.loop).cur
    if (chord) { playChord(chord); player.lastChord = chord }
  } else if (!songChordSound) { stopAll(); if (player) player.lastChord = null }
}
renderClick()
renderChordSound()
$('plSpeed').replaceChildren(...[50, 75, 100].map((p) => button(`${p}%`, '', () => { speed = p; store.set('songSpeed', p); renderSpeed() }, `speed-${p}`)))
function renderSpeed() { [...$('plSpeed').children].forEach((b) => b.classList.toggle('on', b.textContent === `${speed}%`)) }
const spb = () => 60 / ((song().bpm * speed) / 100)
/** Plays a timeline: once (then back to the song) or round and round. */
function playerStart(tl, loop) {
  track('song_play', { bars: tl.bars.length, loop, speed, words: hasLyrics(song()) })
  metroStop() // one click at a time
  audio()
  player = { tl, loop, scrub: null, gen: 0, beat: -tl.n, next: ctx.currentTime + 0.15, end: null, anchor: { b: -tl.n, time: ctx.currentTime + 0.15 } }
  $('laneTrack').replaceChildren(...tl.bars.map((b) => {
    const d = el('div', '', 'lbar' + (b.no === 1 ? ' first' : ''))
    d.dataset.part = partLabel(b.part)
    d.append(...b.chords.map((c) => Object.assign(el('span', c.name), { style: `width:${c.len * PX}px` })))
    return d
  }))
  $('player').classList.toggle('book', hasLyrics(song())) // words → the songbook view [R-12]
  player.line = null
  renderSpeed()
  showSub('play')
  showBeatOf(-tl.n)
  player.timer = setInterval(playerTick, 25)
  playerTick()
  const frame = () => { // ■ cancels the next frame, so the player is always there
    const pos = player.scrub ?? player.anchor.b + (ctx.currentTime - player.anchor.time) / spb() // under the finger while scrubbing
    $('laneTrack').style.transform = `translateX(${$('lane').clientWidth / 4 - pos * PX}px)`
    player.raf = requestAnimationFrame(frame)
  }
  player.raf = requestAnimationFrame(frame)
}
function playerTick() {
  const p = player, accents = METERS[song().meter]
  if (p.end !== null && ctx.currentTime >= p.end) { track('song_end'); playerStop(); return } // the song is over: back to it
  if (p.end !== null || p.scrub !== null) return // over, or a finger is scrubbing: nothing to schedule
  resync(p, spb())
  const r = ticks(p.next, p.beat, (song().bpm * speed) / 100, Infinity, ctx.currentTime + 0.12)
  for (const { time, beat } of r.out) {
    if (beat >= p.tl.beats && !p.loop) { p.end = time; break }
    const b = beat < 0 ? beat : beat % p.tl.beats, accent = accents[mod(b, accents.length)]
    if (songClick) click(time, accent)
    const gen = p.gen // a scrub since then makes this beat stale
    setTimeout(() => {
      if (player === p && p.gen === gen) {
        p.anchor = { b, time }; showBeatOf(b); blink(b)
        if (songChordSound && b >= 0) {
          const chord = songAt(p.tl, b, p.loop).cur
          if (chord && chord !== p.lastChord) { playChord(chord); p.lastChord = chord }
        }
      }
    }, Math.max(0, (time - ctx.currentTime) * 1000))
  }
  p.next = r.next
  p.beat = r.beat
}
/** Draws what is played at beat b: the current chord (or the count-in), the next one, the countdown, part and bar. */
function showBeatOf(b) {
  const at = songAt(player.tl, b, player.loop)
  $('player').dataset.beat = b // for tests
  $('plCurName').classList.toggle('count', b < 0)
  $('plCurName').textContent = b < 0 ? `${-b}` : at.cur
  $('plWhere').textContent = b < 0 ? T.getReady(song().name) : `${player.loop ? '∞ ' : ''}${partLabel(at.part)} · ${at.bar}`
  if (b < 0) $('plCurDiagram').replaceChildren()
  else if ($('plCurDiagram').dataset.chord !== at.cur) drawDiagram($('plCurDiagram'), fingering(at.cur))
  $('plCurDiagram').dataset.chord = b < 0 ? '' : at.cur
  $('plNext').classList.toggle('soon', at.soon || b < 0)
  $('plNextName').textContent = at.next ?? '—'
  $('plLeft').textContent = at.next ? T.inBeats(at.left) : T.end
  if (at.next && $('plNextDiagram').dataset.chord !== at.next) drawDiagram($('plNextDiagram'), fingering(at.next))
  else if (!at.next) $('plNextDiagram').replaceChildren()
  $('plNextDiagram').dataset.chord = at.next ?? ''
  showLines(b)
}
/** The songbook: the line playing (its bars' chords over its words, the bar now lit) and the next one, paler. [R-12] */
function showLines(b) {
  const tl = player.tl, k = Math.max(0, lineAt(tl, b)) // the count-in shows the first line coming
  if (k !== player.line) {
    player.line = k
    const block = (l, cls) => {
      const d = el('div', '', 'line ' + cls), row = el('div', '', 'lchords')
      for (let i = l.from; i < l.to; i++) { // a chord is named where it changes; its next bars stay empty (still lit)
        const name = tl.bars[i].chords.map((c) => c.name).join(' ')
        row.append(el('span', i > l.from && name === tl.bars[i - 1].chords.map((c) => c.name).join(' ') ? '' : name))
      }
      d.append(row, el('div', l.text, 'ltext'))
      return d
    }
    const nx = tl.lines[k + 1] ?? (player.loop ? tl.lines[0] : null)
    $('plLines').replaceChildren(block(tl.lines[k], 'cur'), ...(nx ? [block(nx, 'nxt')] : []))
  }
  const now = b < 0 ? -1 : Math.floor(b / tl.n) - tl.lines[k].from, spans = $('plLines').querySelectorAll('.cur .lchords span')
  spans.forEach((s, i) => s.classList.toggle('now', i === now))
}
/** The beat dot: lit for a moment on each beat, bigger on the bar's first. */
function blink(beat) {
  if (!songClick) return
  const button = $('plClick')
  button.dataset.swing = mod(beat, 2) ? 'left' : 'right'
  clearTimeout(swingTimer)
  swingTimer = setTimeout(() => { button.dataset.swing = 'rest' }, 120)
}
// Scrubbing: a finger dragged sideways over the player moves the song under it; let go — it plays from there. [R-15]
let grab = null // { x, b } where the finger touched
$('player').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return // ■, the sound, the speed: buttons, not a scrub
  grab = { x: e.clientX, b: Math.max(0, player.anchor.b + (ctx.currentTime - player.anchor.time) / spb()) }
})
$('player').addEventListener('pointermove', (e) => {
  if (!grab || !player || (player.scrub === null && Math.abs(e.clientX - grab.x) < 8)) return // a tap is not a scrub; the song may be over
  player.gen++ // the beats already on their way are stale now
  player.scrub = scrubBeat(grab.b, e.clientX - grab.x, player.tl.beats, player.loop)
  showBeatOf(Math.floor(player.scrub))
})
function letGo() {
  if (grab && player && player.scrub !== null) { // play on from the beat under the finger, at once
    const b = Math.floor(player.scrub)
    track('song_scrub')
    Object.assign(player, { beat: b, next: ctx.currentTime + 0.1, end: null, scrub: null, gen: player.gen + 1, anchor: { b, time: ctx.currentTime + 0.1 } })
  }
  grab = null
}
$('player').addEventListener('pointerup', letGo)
$('player').addEventListener('pointercancel', letGo)
function playerStop() {
  if (!player) return
  if (recordingSource === 'player') stopRecording()
  clearInterval(player.timer)
  cancelAnimationFrame(player.raf)
  player = null
  sub = 'edit'
  renderSongs()
}
$('plStop').onclick = () => { track('song_stop', { beat: +$('player').dataset.beat }); playerStop() }

// ---------- voice recordings ----------
function recordingsStore() {
  if (!recordingDbPromise) recordingDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('kvinty-recordings', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { recordingDbPromise = null; reject(request.error) }
  })
  return recordingDbPromise
}
async function loadRecords() {
  try {
    const db = await recordingsStore(), request = db.transaction('recordings', 'readonly').objectStore('recordings').getAll()
    recordings = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    renderRecords()
  } catch { $('recordStatus').textContent = T.recordFail }
}
function renderRecords() {
  recordingUrls.forEach((url) => URL.revokeObjectURL(url))
  recordingUrls = []
  $('recordsEmpty').hidden = recordings.length > 0
  const items = []
  for (const record of recordings.sort((a, b) => b.createdAt - a.createdAt)) {
    const li = el('li', '', record.id === openRecord ? 'open' : ''), card = el('div', '', 'record-card')
    li.dataset.testid = `record-row-${record.id}`
    const date = new Date(record.createdAt).toLocaleString(T.lang === 'ru' ? 'ru-RU' : 'en-US')
    const blob = new Blob([record.bytes], { type: record.mimeType })
    const title = el('b', record.name || `${date} · ${Math.round(record.duration / 1000)} ${T.lang === 'ru' ? 'с' : 's'}`), audio = document.createElement('audio'), url = URL.createObjectURL(blob)
    title.dataset.testid = `record-name-${record.id}`
    title.title = T.recordRename
    let renameTimer = 0, renameHeld = false
    title.addEventListener('pointerdown', (event) => {
      renameHeld = false
      renameTimer = setTimeout(() => {
        renameTimer = 0
        renameHeld = true
        const name = prompt(T.recordRename, record.name || '')
        if (name !== null && name.trim() && name.trim() !== record.name) renameRecording(record, name.trim())
      }, 550)
    })
    title.addEventListener('pointerup', () => { clearTimeout(renameTimer); renameTimer = 0 })
    title.addEventListener('pointercancel', () => { clearTimeout(renameTimer); renameTimer = 0 })
    title.addEventListener('contextmenu', (event) => event.preventDefault())
    title.addEventListener('click', (event) => { if (renameHeld) { event.preventDefault(); renameHeld = false } })
    recordingUrls.push(url)
    audio.controls = true; audio.preload = 'auto'; audio.src = url; audio.dataset.testid = `record-audio-${record.id}`
    const exportButton = button('', 'icon record-export', null, `record-export-${record.id}`)
    exportButton.disabled = true
    exportButton.setAttribute('aria-label', T.recordPreparing)
    exportButton.title = T.recordPreparing
    const shareIcon = node('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true' }, exportButton)
    node('path', { d: 'M12 14V3M8 7l4-4 4 4M5 12v8h14v-8', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, shareIcon)
    prepareWav(record).then((wav) => {
      exportButton.wavFile = new File([wav], `kvinty-recording-${record.createdAt}.wav`, { type: 'audio/wav' })
      exportButton.disabled = false
      exportButton.setAttribute('aria-label', T.recordShare)
      exportButton.title = T.recordShare
      exportButton.onclick = () => shareRecording(exportButton.wavFile)
    }, () => {
      exportButton.setAttribute('aria-label', T.recordWavFail)
      exportButton.title = T.recordWavFail
      showRecordStatus(T.recordWavFail)
    })
    card.append(title, audio, exportButton)
    li.append(button(T.recordDelete, 'del', () => deleteRecording(record.id), `recordDelete-${record.id}`), card)
    let down = null
    li.addEventListener('pointerdown', (event) => {
      down = event.target.closest('audio, a, button') ? null : { x: event.clientX, y: event.clientY }
    })
    li.addEventListener('pointercancel', () => { down = null })
    li.addEventListener('pointerup', (event) => {
      if (!down) return
      const step = swipeStep(event.clientX - down.x, event.clientY - down.y)
      down = null
      if (step) { openRecord = step > 0 ? record.id : null; renderRecords() }
    })
    items.push(li)
  }
  $('recordItems').replaceChildren(...items)
  $('recordItems').dataset.loaded = 'true'
}
function shareRecording(file) {
  track('record_export', { format: 'wav' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) navigator.share({ files: [file] }).catch((error) => {
    if (error.name !== 'AbortError') toast(T.shareFail)
  })
  else {
    const url = URL.createObjectURL(file), link = document.createElement('a')
    link.href = url; link.download = file.name; link.click()
    recordingUrls.push(url)
  }
}
async function prepareWav(record) {
  const Audio = window.AudioContext || window.webkitAudioContext, context = new Audio()
  try {
    const decoded = await context.decodeAudioData(record.bytes.slice(0)), mono = new Float32Array(decoded.length)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel)
      for (let i = 0; i < samples.length; i++) mono[i] += samples[i] / decoded.numberOfChannels
    }
    return new Blob([pcmWav(mono, decoded.sampleRate)], { type: 'audio/wav' })
  } finally { await context.close() }
}
function showRecordStatus(text) {
  $('recordStatus').textContent = text
  $('playerRecordStatus').textContent = text
}
function updateRecordingIndicators(active) {
  clearInterval(recordingTimer)
  recordingTimer = 0
  const update = () => {
    const elapsed = Math.floor((Date.now() - recordingStarted) / 1000)
    const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
    for (const id of ['recordingIndicator', 'playerRecordingIndicator']) {
      const indicator = $(id)
      indicator.textContent = `${T.recordingActive} ${clock}`
      indicator.hidden = !active || (id === 'recordingIndicator' ? recordingSource !== 'records' : recordingSource !== 'player')
    }
  }
  update()
  if (active) recordingTimer = setInterval(update, 1000)
}
async function deleteRecording(id) {
  try {
    const db = await recordingsStore(), request = db.transaction('recordings', 'readwrite').objectStore('recordings').delete(id)
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = () => reject(request.error) })
    recordings = recordings.filter((record) => record.id !== id)
    openRecord = null
    renderRecords()
    track('record_delete')
  } catch { showRecordStatus(T.recordFail) }
}
async function renameRecording(record, name) {
  try {
    const updated = { ...record, name }, db = await recordingsStore(), request = db.transaction('recordings', 'readwrite').objectStore('recordings').put(updated)
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = () => reject(request.error) })
    recordings = recordings.map((item) => item.id === record.id ? updated : item)
    renderRecords()
    track('record_rename')
  } catch { showRecordStatus(T.recordFail) }
}
async function saveRecording(blob, duration, mimeType) {
  try {
    const bytes = await blob.arrayBuffer(), db = await recordingsStore(), tx = db.transaction('recordings', 'readwrite')
    const request = tx.objectStore('recordings').put({ id: crypto.randomUUID(), createdAt: Date.now(), duration, mimeType, bytes })
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = () => reject(request.error); tx.onabort = () => reject(tx.error) })
    track('record_saved', { format: mimeType.split(';')[0] })
    await loadRecords()
  } catch { showRecordStatus(T.recordFail) }
}
function updateRecordButtons(active) {
  for (const id of ['recordStart', 'plRecord']) {
    const b = $(id)
    b.textContent = id === 'plRecord' ? '●' : active ? T.recordStop : T.record
    b.classList.toggle('on', active)
    b.setAttribute('aria-pressed', String(active))
    b.setAttribute('aria-label', active ? T.html.recordStopAria : T.html.recordAria)
  }
}
async function startRecording(source) {
  if (recorder) { stopRecording(); return }
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    showRecordStatus(T.recordUnsupported)
    return
  }
  showRecordStatus('')
  session('play-and-record')
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    const formats = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
    const mimeType = formats.find((type) => MediaRecorder.isTypeSupported?.(type)) || ''
    recorder = new MediaRecorder(recordingStream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 })
    recordingParts = []; recordingSource = source; recordingStarted = Date.now()
    recorder.ondataavailable = (event) => { if (event.data.size) recordingParts.push(event.data) }
    recorder.onstop = () => {
      const mime = recorder.mimeType || mimeType || 'audio/mp4', blob = new Blob(recordingParts, { type: mime })
      const duration = Date.now() - recordingStarted
      recordingStream.getTracks().forEach((trackItem) => trackItem.stop())
      recordingStream = null; recorder = null; recordingParts = []; recordingSource = null
      updateRecordingIndicators(false)
      session('playback'); updateRecordButtons(false)
      if (blob.size) saveRecording(blob, duration, mime)
    }
    recorder.start()
    recordingStarted = Date.now()
    updateRecordButtons(true)
    updateRecordingIndicators(true)
    track('record_start', { source, format: recorder.mimeType || mimeType || 'browser-default' })
  } catch (error) {
    recordingStream?.getTracks().forEach((trackItem) => trackItem.stop())
    recordingStream = null; recorder = null; recordingSource = null
    updateRecordingIndicators(false)
    session('playback'); updateRecordButtons(false)
    showRecordStatus(T.recordMicFail(error.name || 'Error'))
  }
}
function stopRecording() {
  if (recorder.state === 'inactive') { recorder.onstop(); return }
  recorder.stop()
}
$('recordStart').onclick = () => startRecording('records')
$('plRecord').onclick = () => startRecording('player')

// ---------- metronome ----------
// Clicks are scheduled on the audio clock a little ahead (a 25 ms timer looks 120 ms forward), so the beat doesn't
// drift with the page; it keeps going on other tabs (play chords along with it). [T-1…T-5]
let bpm = clampBpm(store.get('bpm', 120)), meter = METERS[store.get('meter')] ? store.get('meter') : '4/4'
let metro = null // { timer, next, beat } while running
let taps = []
function renderMetro() {
  $('bpm').textContent = bpm
  $('bpmSlider').value = bpm
  for (const b of $('meters').children) b.classList.toggle('on', b.dataset.meter === meter)
  $('beats').replaceChildren(...METERS[meter].map((a) => el('span', '', 'beat' + (a === 2 ? ' strong' : a === 1 ? ' medium' : ''))))
  $('metroGo').textContent = metro ? T.stop : T.start
  $('metroGo').classList.toggle('on', !!metro)
  document.querySelector('[data-v=metro]').classList.toggle('ticking', !!metro)
}
function setBpm(n) { bpm = clampBpm(n); store.set('bpm', bpm); renderMetro() }
function click(time, level) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.frequency.value = CLICK_HZ[level]
  g.gain.setValueAtTime(0, time)
  g.gain.linearRampToValueAtTime(level === 2 ? 1 : 0.6, time + 0.002)
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.05)
  o.connect(g).connect(master)
  o.start(time)
  o.stop(time + 0.06)
  $('metro').dataset.clicks = +($('metro').dataset.clicks || 0) + 1 // for tests
}
function showBeat(beat) {
  if (!metro) return // stopped meanwhile
  const dots = $('beats').children
  for (let k = 0; k < dots.length; k++) dots[k].classList.toggle('now', k === beat)
}
function metroTick() {
  resync(metro, 60 / bpm)
  const accents = METERS[meter], r = ticks(metro.next, metro.beat, bpm, accents.length, ctx.currentTime + 0.12)
  for (const { time, beat } of r.out) {
    click(time, accents[beat])
    setTimeout(() => showBeat(beat), Math.max(0, (time - ctx.currentTime) * 1000))
  }
  metro.next = r.next
  metro.beat = r.beat
}
function metroStop() {
  if (!metro) return
  clearInterval(metro.timer)
  metro = null
  renderMetro()
}
$('metroGo').onclick = () => {
  if (metro) return metroStop()
  audio()
  metro = { next: ctx.currentTime + 0.1, beat: 0, timer: setInterval(metroTick, 25) }
  metroTick()
  renderMetro()
  track('metro_start', { bpm, meter })
}
holdRepeat($('bpmDown'), () => setBpm(bpm - 1))
holdRepeat($('bpmUp'), () => setBpm(bpm + 1))
$('bpmSlider').oninput = () => setBpm($('bpmSlider').value)
$('tap').onclick = () => {
  const r = tapTempo(taps, performance.now() / 1000)
  taps = r.taps
  if (r.bpm) setBpm(r.bpm)
}
$('meters').replaceChildren(...Object.keys(METERS).map((m) => button(m, '', () => {
  meter = m
  store.set('meter', m)
  if (metro) metro.beat = 0 // a new bar starts
  renderMetro()
}, `meter-${m}`)))
for (const b of $('meters').children) b.dataset.meter = b.textContent
$('bpmSlider').min = BPM_MIN
$('bpmSlider').max = BPM_MAX
renderMetro()

// ---------- tuner ----------
// Microphone → analyser → core.detectPitch ten times a second; the needle shows cents off the chosen (or nearest,
// «Авто») open string of the instrument and tuning. The tuning is shared with the necks. [K-1…K-7]
let tunerInst = store.get('tunerInst', 'guitar') === 'bass' ? 'bass' : 'guitar'
let tunerString = -1 // -1 = «Авто»
let tuner = null // { stream, analyser, buf, timer, history } while listening
const tunerOpen = () => tuningOf(tunerInst, store.get(`tuning-${tunerInst}`)).open
function renderTuner() {
  for (const b of $('tunerInst').children) b.classList.toggle('on', b.dataset.inst === tunerInst)
  $('tunerTuning').replaceChildren(...TUNINGS[tunerInst].map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })))
  $('tunerTuning').value = tuningOf(tunerInst, store.get(`tuning-${tunerInst}`)).id
  const open = tunerOpen()
  if (tunerString >= open.length) tunerString = -1 // guitar string 6 → a 4-string bass
  $('tunerStrings').replaceChildren(button(T.auto, tunerString < 0 ? 'on' : '', () => { tunerString = -1; renderTuner() }, 'tstr-auto'),
    ...open.map((m, s) => button(NOTE[m % 12], s === tunerString ? 'on' : '', () => { tunerString = s; renderTuner() }, `tstr-${s}`)))
  $('tunerGo').textContent = tuner ? T.micOff : T.micOn
  $('tunerGo').classList.toggle('on', !!tuner)
  $('tunerRef').disabled = tunerString < 0
  if (!tuner) showReading(null)
}
/** Draws a reading: hz = what is heard (null = nothing yet / silence). */
function showReading(hz) {
  const open = tunerOpen(), s = hz === null ? tunerString : tunerString < 0 ? nearestString(hz, open) : tunerString
  const target = open[Math.max(0, s)]
  $('tunerNote').textContent = s < 0 ? '—' : NOTE[target % 12]
  for (const b of $('tunerStrings').children) b.classList.toggle('now', b.dataset.testid === `tstr-${s}` && tunerString < 0)
  if (hz === null) {
    $('tunerNeedle').style.left = '50%'
    $('tunerStatus').textContent = tuner ? T.pluck : T.micAndPluck
    $('tunerStatus').className = ''
    $('tunerHeard').textContent = ''
    $('tunerNote').dataset.cents = ''
    return
  }
  const cents = centsOff(hz, target), st = tuneStatus(cents), heard = noteOf(hz)
  $('tunerNeedle').style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`
  $('tunerStatus').textContent = T.tune[st]
  $('tunerStatus').className = st
  $('tunerHeard').textContent = T.heard(heard.name + heard.octave, hz.toFixed(1), `${cents > 0 ? '+' : ''}${Math.round(cents)}`)
  $('tunerNote').dataset.cents = Math.round(cents) // for tests
}
function readPitch() {
  tuner.analyser.getFloatTimeDomainData(tuner.buf)
  const open = tunerOpen() // listen only around the instrument's strings: less hiss, the thin string heard longer
  const hz = detectPitch(tuner.buf, tuner.ac.sampleRate, freq(Math.min(...open)) * 0.8, freq(Math.max(...open)) * 1.5)
  if (hz === null) {
    if (performance.now() - tuner.heardAt < 2000) return // the string still rings, too quietly to read: keep the last reading
    tuner.history = []
    showReading(null)
    return
  }
  tuner.heardAt = performance.now()
  tuner.history = [...tuner.history, hz].slice(-5)
  showReading(median(tuner.history))
}
function tunerStop() {
  if (!tuner) return
  clearInterval(tuner.timer)
  for (const t of tuner.stream.getTracks()) t.stop()
  tuner.ac.close()
  tuner = null
  session('playback')
  renderTuner()
}
$('tunerGo').onclick = () => {
  if (tuner) return tunerStop()
  if (!navigator.mediaDevices?.getUserMedia) { $('tunerMsg').textContent = T.noMicApi; return }
  $('tunerMsg').textContent = ''
  session('play-and-record') // WebKit gives no microphone to a playback-only session
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    .then((stream) => {
      // its own audio context, made after the session switched to recording: on iOS the playback one, made before the
      // switch, may hear the microphone as silence (found on a real iPhone: the same stream was fine in a fresh one)
      const ac = newContext()
      ac.resume()
      const analyser = ac.createAnalyser()
      analyser.fftSize = 4096
      ac.createMediaStreamSource(stream).connect(analyser) // not to the speakers
      track('tuner_on', { inst: tunerInst })
      tuner = { stream, ac, analyser, buf: new Float32Array(analyser.fftSize), timer: setInterval(readPitch, 30), history: [], heardAt: -Infinity }
      renderTuner()
    })
    .catch((e) => {
      track('tuner_fail', { error: e.name })
      session('playback')
      $('tunerMsg').textContent = e.name === 'NotAllowedError' ? T.micDenied
        : T.micFail(e.name)
    })
}
$('tunerInst').onclick = (e) => {
  const inst = e.target.dataset.inst
  if (!inst) return
  tunerInst = inst
  store.set('tunerInst', inst)
  renderTuner()
}
$('tunerTuning').onchange = () => { setTuning($('tunerTuning').value); renderTuner() } // «Аккорды» follow the tuner
$('tunerRef').onclick = () => pluck([tunerOpen()[tunerString]], 0)

// ---------- wheel animation ----------
let raf = 0
function animateTo(to) {
  cancelAnimationFrame(raf)
  svg.dataset.still = '0' // '1' once the wheel rests on a key (tests wait for it)
  const from = rot, t0 = performance.now(), dur = turnDuration(from, to)
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur)
    rot = from + (to - from) * easeOut(p)
    render()
    if (p < 1) raf = requestAnimationFrame(step)
    else { rot = norm(to); render(); svg.dataset.still = '1' }
  }
  raf = requestAnimationFrame(step)
}

// ---------- wheel gesture ----------
let drag = null // { id, last, x0, y0, moved, target, samples: [{t, rot}] }
function wheelAngle(e) {
  const b = svg.getBoundingClientRect(), a = angleOf(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2))
  return { deg: a.deg, dist: a.dist / (b.width / VB) }
}
svg.addEventListener('pointerdown', (e) => {
  if (drag) return
  cancelAnimationFrame(raf)
  svg.dataset.still = '0'
  try { svg.setPointerCapture(e.pointerId) } catch {}
  drag = { id: e.pointerId, last: wheelAngle(e).deg, x0: e.clientX, y0: e.clientY, moved: false,
    target: e.target.dataset.i, samples: [{ t: performance.now(), rot }] }
})
svg.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return
  const a = wheelAngle(e)
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.moved = true
  if (a.dist > 30) rot += norm(a.deg - drag.last) // near the center the angle jumps around
  drag.last = a.deg
  const t = performance.now()
  drag.samples.push({ t, rot })
  while (drag.samples.length > 2 && t - drag.samples[0].t > 100) drag.samples.shift()
  render()
})
function release(e) {
  if (!drag || e.pointerId !== drag.id) return
  const d = drag
  drag = null
  if (d.moved) animateTo(flingTarget(rot, d.samples, performance.now()))
  else if (d.target !== undefined) animateTo(turnTo(rot, +d.target))
  else animateTo(snap(rot))
}
svg.addEventListener('pointerup', release)
svg.addEventListener('pointercancel', release)

// ---------- boot ----------
// The texts of the page in the app's language: data-t → the text, data-ta → the aria-label. [E-2]
document.documentElement.lang = T.lang
document.title = T.title
document.querySelector('meta[name="apple-mobile-web-app-title"]').content = T.app
for (const e of document.querySelectorAll('[data-t]')) e.textContent = T.html[e.dataset.t]
for (const e of document.querySelectorAll('[data-ta]')) e.setAttribute('aria-label', T.html[e.dataset.ta])
$('songBpm').dataset.unit = T.bpm
$('modes').replaceChildren(...MODES.map((m, n) => {
  const b = button(m.short, '', () => { mode = n; render() }, `mode-${n}`)
  b.dataset.m = n
  b.setAttribute('aria-label', m.name)
  return b
}))
render()
setView(view)
track('app_open', { view })
svg.dataset.still = '1'
// iOS ignores user-scalable=no: block pinch zoom ourselves (double-tap zoom is off via touch-action in CSS).
// Don't preventDefault on touchend to stop double taps: it also swallows the click of a quick second tap.
document.addEventListener('gesturestart', (e) => e.preventDefault())
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
