# Guitar Studio

A guitar practice app. No accounts, no build step: plain HTML/CSS/JS that works in any modern browser
and can be installed on an iPhone/iPad home screen. It works offline after the first visit.

**Live:** `https://<user>.github.io/guitar-studio/`

## Run it locally
From this folder:

```
python -m http.server 8765
```

Then open http://localhost:8765. Use a server instead of opening `index.html` directly, because audio,
the microphone tuner, webcam recording and the offline service worker all need `http://localhost` or `https://`.

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
  chart, a streak counter, **practice videos**, and JSON export/import.
- **Songs**: a repertoire board (Want → Learning → Polishing → Can play) with tempo progress.

### Practice videos: browser differences
- **Chrome / Edge / Arc on a computer:** click **Link Dropbox folder** and pick your *Practice Videos*
  folder. Recordings and imports are saved straight into it, and the list shows everything in the folder.
- **iPhone / iPad, Firefox, Android:** these browsers can't link a folder. Recording and **Import video(s)**
  still work. New videos stay in the list for the current session. Open one and tap **Save video…**, then pick
  *Save Video* (to Photos) or *Save to Files → Dropbox → Practice Videos*. On a computer the recording
  downloads automatically. The app warns you before you close it with unsaved recordings.

## Your data
Everything (sessions, songs, trainer stats, settings) is stored **in the browser on each device**, in
localStorage under the key `guitarStudio.v1`. That means:
- Your phone, iPad and computer each keep their own separate data.
- On iPhone/iPad, the **home-screen app and Safari keep separate data** too.
- Use **Export JSON** (Practice tab → Session history) for a backup. Use **Import JSON** on another device
  to merge sessions and songs into it.

**Planned next step:** cross-device sync through Dropbox, so every device shares one data file.

## Updating the app
Push to the `main` branch and GitHub Pages redeploys it. The service worker fetches from the network first, so
an open device gets the new version on its next load when it's online. When offline, it falls back to the
cached copy. Bump `VERSION` in `sw.js` on every release (use the date, e.g. `gs-2026-09-28a`) so phones drop the old
cache in one go, and update the `CORE` list if you add or rename files. Open copies show an "updated — Reload" toast.

## Files
- `index.html`, `css/style.css`
- `manifest.webmanifest`, `icons/`: home-screen install metadata and icons
- `sw.js`: the service worker (network-first with offline fallback)
- `js/music.js`: the theory engine (notes, scales, chord formulas, chord identification, diatonic chords)
- `js/voicings.js`: the voicing generator, chord diagram and fretboard SVG, and CAGED shapes
- `js/tone.js`: the plucked-string synth (Karplus-Strong) used for playback, plus the iOS audio unlock
- `js/*-ui.js`: one file per tab. `js/store.js` handles persistence and file saving. `js/app.js` is the shell,
  and also registers the service worker.
