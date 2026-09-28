# Guitar Studio

A guitar practice app. No build step: plain HTML/CSS/JS that works in any modern browser and can be installed
on an iPhone/iPad home screen. It works offline after the first visit, and can sync between devices through a
private GitHub repo, stored as readable Markdown (see below).

**Live:** https://tjmitch4.github.io/guitar-studio/

## Run it locally
From this folder, serve it with any static file server, for example:

```
python -m http.server 8765
```

Then open http://localhost:8765. Use a server instead of opening `index.html` directly, because audio, the
microphone tuner, webcam recording, sync and the offline service worker all need `http://localhost` or `https://`.

## Add it to your home screen
- **iPhone / iPad (Safari):** open the live URL, tap **Share** (the square with the arrow), then
  **Add to Home Screen**, then **Add**. It opens full-screen like an app.
- **Android (Chrome):** open the live URL, tap the **⋮** menu, then **Add to Home screen** / **Install app**.
- **Mac / PC (Chrome or Edge):** click the install icon in the address bar, or use the menu and choose
  **Install Guitar Studio**.

Allow microphone access the first time you start the tuner, and camera plus microphone the first time you record.

## Tabs
- **Note Trainer**: learn and quiz every note on the neck. "Find the note" (tap the fret), "Name the note"
  (tap, or type A–G; Shift = sharp; letter then `-` = flat), and "Learn" (see every position of a note, or all
  notes on a string). It has a 7-level path from low-E naturals to a timed whole-neck round, and a heat map of
  accuracy for each string × note. Weak spots get asked more often.
- **Fretboard & Chords**: scale and chord-tone overlays with a scale explorer (whole neck, position boxes,
  3 notes per string, single string, compare two scales, highlight a target chord's tones, ▶ play the pattern).
  Tap frets to identify what you're playing. It also has a chord voicing browser (tap to hear it and show it on
  the neck), plus diatonic chords and common progressions for each key (tap to hear; tap the 7th line under a
  chord, or Alt-click, for the 7th chord).
- **Theory**: circle of fifths, CAGED shapes (tap to hear), a modes table, interval and chord-formula tables,
  and quick refresher cards.
- **Practice**: timer, metronome (Space toggles it), a chromatic tuner (uses the mic, and plays string
  reference tones), a session log with focus areas, tempo and notes, an auto-generated 25-minute plan, a weekly
  chart, a streak counter, and **practice videos**.
- **Songs**: a repertoire board (Want → Learning → Polishing → Can play) with tempo progress.

### Practice videos: browser differences
- **Chrome / Edge / Arc on a computer:** click **Link Dropbox folder** and pick your *Practice Videos*
  folder. Recordings and imports are saved straight into it, and the list shows everything in the folder.
- **iPhone / iPad, Firefox, Android:** these browsers can't link a folder. Recording and **Import video(s)**
  still work. New videos stay in the list for the current session. Open one and tap **Save video…**, then pick
  *Save Video* (to Photos) or *Save to Files → Dropbox → Practice Videos*. On a computer the recording
  downloads automatically. The app warns you before you close it with unsaved recordings, and a recording
  that was never saved comes back the next time you open the app.
- The videos themselves never go to GitHub. Their review notes (song, notes, reviewed) do sync.

## Your data and GitHub sync
Everything (sessions, songs, trainer stats, video notes, settings) is saved **in the browser first**, in
localStorage under `guitarStudio.v1`. The app works fully offline and never waits for the network. Without a
GitHub token it works exactly as before: each device keeps its own data, and **Export JSON / Import JSON**
(Practice → Session history) work as backups.

With a token, every device syncs automatically to the private repo **`tjmitch4/studio-data`**, folder
**`guitar/`** (Lift Studio uses `lift/` in the same repo):

| File | What's in it |
|---|---|
| `guitar/sessions/YYYY-MM-DD-<focus>-<id>.md` | one practice session: minutes, focus areas, song, tempo, feel, notes |
| `guitar/songs/<title>-<id>.md` | one song: status, key, tempo progress, sections, notes, links |
| `guitar/trainer/YYYY-MM.md` | note-trainer answers for that month (UTC), with the month's accuracy summary |
| `guitar/video-notes.md` | review notes for practice videos, keyed by file name |
| `guitar/settings.md` | settings (flat names, sound, tone), each with its own change time |
| `guitar/PROGRESS.md` | a generated coaching summary: streak, weekly minutes, recent sessions, song board, trainer level and weak spots. Point Claude at this file. |

Each data file has YAML frontmatter (a few flat fields), a readable body, and a final `## Data` section with a
JSON code block holding the full record. **The app reads only that JSON block.** If you (or Claude) edit a file
by hand, edit the JSON; the app notices the change and treats it as a new edit. A file the app can't parse is
skipped with a warning in the sync panel and is never deleted or overwritten. The app never reads `PROGRESS.md`.
File names never change after a record is created.

### Turning sync on (once per browser)
1. Open https://github.com/settings/personal-access-tokens/new (signed in as tjmitch4).
2. **Token name:** e.g. "Studio apps – iPhone". **Expiration:** your choice.
3. **Repository access:** *Only select repositories* → **studio-data**.
4. **Permissions → Repository permissions → Contents:** *Read and write*. GitHub adds Metadata: read-only
   automatically. Nothing else is needed.
5. **Generate token** and copy it.
6. In Guitar Studio, tap the sync dot in the header, paste the token, and tap **Connect**. The app checks that it
   can see and write to the repo. If not, it tells you why: an invalid or expired token, no access to
   studio-data, or read-only access.

The token is stored only in this browser (localStorage key `studioData.githubToken`) and is only sent to
api.github.com. Lift Studio reads the same key (same site, tjmitch4.github.io), so connecting one app connects
both in that browser. On iPhone, the home-screen app and Safari keep separate storage, so paste it in each.
**Disconnect** removes the token and keeps all data. If the token expires, the header shows a red dot. Paste a
new one under **Replace token**.

### How sync works
Sync runs when the app opens, 5 seconds after a change, when you come back to the app, when the connection comes
back, and every 2 minutes while the app is on screen. Each sync:
1. reads the `main` branch (just one request if nothing changed on GitHub since this device's last sync),
2. downloads only the files whose content changed since the last sync,
3. merges them with this device (rules below) and saves locally,
4. writes only the files whose content actually differs, as **one commit** (`guitar: sync (3 changed) from
   iPhone 7k2f`). If another device pushed in between, GitHub refuses the update and the app starts the round
   again (up to 3 tries). An idle device never commits.

The header dot: green = synced, blue pulsing = syncing, amber = offline or GitHub unreachable (retried quietly
with backoff, respecting GitHub's rate limits), red = a problem to fix (explained in the panel), hollow = not
connected. The panel has the status, last sync time, **Sync now**, a link to the repo, and **Disconnect**.

**Merge rules** (`js/sync-merge.js`, `js/sync-plan.js`, tested by the pages in `tests/`):
- **Sessions, songs, video notes:** each record has a stable `id` and `updatedAt`, and the newer edit wins.
  Old records with no timestamp count as time 0. Old records with no `id` get one made from their content, so
  the same record on two devices never doubles. The built-in *Slow Dancing* song merges cleanly.
- **Deletes:** deleting a session or song removes its file. A device that finds a synced file gone deletes its
  copy too, unless it edited that record since its last sync; then the edit wins and the file comes back.
  Deletes of the built-in song (and of old content-id records) are also remembered in `settings.md`, so a new
  device can't bring them back.
- **Trainer answers:** only ever added. Both devices' answers are combined without duplicates, capped at the
  newest 4000. **Reset stats** resets them on every device.
- **Settings:** each one keeps whichever device changed it last.
- Every in-app delete that removes a file is also listed in `settings.md` (`deleteLog`), so a device that
  connects fresh (or reconnects) still applies deletes made elsewhere.
- **Safety net for a wiped or recreated repo:** if `guitar/settings.md` disappears, or more than 3 records (and
  more than a quarter of the files this device knew about) vanish at once with no delete records, the app
  deletes nothing locally, re-uploads everything, and the sync panel says "GitHub folder looked empty — restored
  it from this device". Connect and Disconnect also forget this device's list of last-synced files, so a new
  connection never reads missing files as deletes.
- Nothing syncs while this device's saved data can't be read.

## Updating the app
Push to the `main` branch and GitHub Pages redeploys it. The service worker fetches from the network first, so
an open device gets the new version on its next load when it's online. When offline, it falls back to the
cached copy. Bump `VERSION` in `sw.js` on every release (use the date, e.g. `gs-2026-09-28c`) so phones drop the
old cache in one go, and update the `CORE` list if you add or rename files. Open copies show an "updated —
Reload" toast. The service worker never touches api.github.com.

## Tests
Serve the folder, then open:
- `tests/merge-test.html`: the merge rules.
- `tests/md-test.html`: the Markdown files (lossless round trip, deterministic output, file names, corrupt
  files, trainer month buckets, PROGRESS.md) and the sync plan.
- `tests/sync-test.html`: the sync engine against a fake GitHub (`tests/github-mock.js`). It covers token checks,
  first sync, idle sync, several devices converging, deletes, edit vs delete, non-fast-forward retries, corrupt
  files, the trainer cap and reset, offline, rate limits and revoked tokens.
- `tests/app-mock.html?dev=A` (and `?dev=B`, …): the whole app wired to the fake GitHub, with its own storage
  keys, so it never touches real data. Test tokens are listed at the top of the file.

## Files
- `index.html`, `css/style.css`
- `manifest.webmanifest`, `icons/`: home-screen install metadata and icons
- `sw.js`: the service worker (network-first with offline fallback)
- `js/config.js`: the data repo and storage keys (no secrets)
- `js/music.js`: the theory engine (notes, scales, chord formulas, chord identification, diatonic chords)
- `js/voicings.js`: the voicing generator, chord diagram and fretboard SVG, and CAGED shapes
- `js/tone.js`: the plucked-string synth (Karplus-Strong) used for playback, plus the iOS audio unlock
- `js/*-ui.js`: one file per tab. `js/store.js` handles persistence and file saving. `js/app.js` is the shell,
  and also registers the service worker.
- `js/sync-merge.js`: the pure merge rules. `js/md-format.js`: the Markdown files and PROGRESS.md.
  `js/sync-plan.js`: what to download, merge and write. `js/github.js`: the GitHub API. `js/sync.js`: the sync
  engine, the header indicator and the sync panel.
- `tests/`: test pages (not used by the app)
