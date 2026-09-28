# Guitar Studio

A guitar practice app. No build step: plain HTML/CSS/JS that works in any modern browser and can be installed
on an iPhone/iPad home screen. It works offline after the first visit, and syncs between devices through your
Dropbox (see below).

**Live:** https://tjmitch4.github.io/guitar-studio/

## Run it locally
From this folder:

```
python -m http.server 8782
```

Then open http://localhost:8782 (the port registered as a Dropbox redirect URI). Use a server instead of opening
`index.html` directly, because audio, the microphone tuner, webcam recording, Dropbox sign-in and the offline
service worker all need `http://localhost` or `https://`.

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

### Practice videos
- **Signed in to Dropbox (any device, including iPhone):** recordings and **Import video(s)** upload straight
  to `/TJ/Guitar/Guitar Studio/Practice Videos/` in Dropbox, with no Share sheet or "Save video" step. The list
  shows everything in that folder and plays it from Dropbox. Each video waits in browser storage (IndexedDB)
  until it has uploaded, so if you're offline or close the app, it uploads by itself next time. Large files go up
  in 8 MB chunks.
- **Not signed in, Chrome / Edge / Arc on a computer:** click **Link Dropbox folder** and pick your *Practice
  Videos* folder. Recordings and imports are saved straight into it.
- **Not signed in, iPhone / iPad, Firefox, Android:** new videos stay in the list for the current session.
  Open one and tap **Save video…**, then pick *Save Video* (to Photos) or *Save to Files → Dropbox → Practice
  Videos*. On a computer the recording downloads automatically. The app warns you before you close it with
  unsaved recordings.

## Your data and Dropbox sync
Everything (sessions, songs, trainer stats, video notes, settings) is saved **in the browser first**, in
localStorage under `guitarStudio.v1`. The app works fully offline and never waits for the network.

When Dropbox is connected, every device syncs automatically through one file,
**`/TJ/Guitar/guitar-studio-data.json`**. You never need to export or import. Sync runs:
- when the app opens,
- 2 seconds after any change,
- when you come back to the app, and when the connection comes back,
- every 60 seconds while the app is on screen.

Each sync downloads the Dropbox copy, merges it with this device, saves locally, and uploads the result. The
upload names the exact revision it merged with. If another device wrote in between, Dropbox refuses the upload,
and the app downloads again, re-merges and retries (up to 3 times). Network trouble is retried quietly.

The header shows the sync state: a green dot means synced, blue pulsing means syncing, amber means offline, red
means an error or that you need to sign in again, and a hollow dot means not connected. Tap it to open the sync
panel. It has **Connect Dropbox**, the status, the last sync time, **Sync now**, **Sign out**, and backup tools
(Export/Import JSON still work as extra backups).

**How merging works** (`js/sync-merge.js`, tested by `tests/merge-test.html`):
- **Sessions, songs, video notes:** every record has a stable `id` and an `updatedAt` time. The two copies are
  combined by `id`, and the newer edit of each record wins. Deleting leaves a small "tombstone" so the delete
  syncs too. Old records with no timestamp count as time 0. Old records with no `id` get one made from their
  content, so the same record on two devices never doubles. The built-in *Slow Dancing* song merges cleanly.
- **Trainer answers:** these are only ever added. Both devices' answers are combined, with no duplicates, and
  capped at the newest 4000. **Reset stats** also resets them on every device.
- **Settings** (flat names, sound, tone): each one keeps whichever device changed it last.
- Nothing is uploaded while this device's saved data can't be read. If the Dropbox copy is unreadable, it is
  left alone and an error is shown.

Sign-in uses OAuth with PKCE, so the app has no secret. The long-lived token is kept in its own localStorage
key (`guitarStudio.dropbox`), separate from your practice data. **Sign out** revokes it and keeps your local
data. On a Dropbox Business account the file lives in your member folder. If `/TJ/Guitar` isn't found there, the
app looks it up from the team root, under your home folder (for example `/TJ Mitchell/TJ/Guitar`), and remembers
which one worked.

### iPhone home-screen app: "Use a code instead"
In the home-screen app, Dropbox's sign-in page opens in Safari and can't send you back into the app. There,
**Connect Dropbox** opens Dropbox, you tap **Allow**, and Dropbox shows a code. Copy it, switch back to Guitar
Studio, and paste it in the box. The same option is under **Having trouble? Use a code instead** on every
other device.

### Setting up the Dropbox app (one-time, shared with Lift Studio)
1. Go to https://www.dropbox.com/developers/apps, click **Create app**, choose **Scoped access** and
   **Full Dropbox** (the data lives in your existing `/TJ/...` folders). Name it, e.g. "TJ Studio Apps".
2. **Permissions** tab: tick `files.metadata.read`, `files.content.read`, `files.content.write`, then **Submit**.
3. **Settings** tab:
   - **Allow public clients (Implicit Grant & PKCE)**: set it to *Allow*.
   - **Redirect URIs**: add each of these:
     - `https://tjmitch4.github.io/guitar-studio/`
     - `https://tjmitch4.github.io/lift-studio/`
     - `http://localhost:8782/` (Guitar Studio run locally; add Lift Studio's local URL too)
   - Copy the **App key**. Don't use the app secret: it isn't needed and must not go in the repo.
4. Paste the app key into `js/config.js` as `DROPBOX_APP_KEY: '...'`. The key is public, so it's fine to commit.
   Bump `VERSION` in `sw.js` and push. Put the same key in Lift Studio's config.
5. Open the app, tap the sync dot in the header, then **Connect Dropbox**, and do the same on each device. The
   first sync on each device merges its local data with Dropbox, and nothing is lost on either side.

While `DROPBOX_APP_KEY` is empty, the app works exactly as before. The sync panel says "Sync not configured yet".

### Tests
Serve the folder, then open:
- `tests/merge-test.html`: the merge rules (disjoint devices, edit vs edit, delete vs edit, old data, prefs,
  the seed song, trainer answers).
- `tests/sync-test.html`: the sync engine against a fake Dropbox. It covers sign-in URLs, the first sync, two
  devices, a 409 retry, offline and back online, token refresh, the Business-account fallback, and video
  uploads/listing.
- `tests/app-mock.html`: the whole app wired to the fake Dropbox. It uses its own storage keys, so it never
  touches real data.

## Updating the app
Push to the `main` branch and GitHub Pages redeploys it. The service worker fetches from the network first, so
an open device gets the new version on its next load when it's online. When offline, it falls back to the
cached copy. Bump `VERSION` in `sw.js` on every release (use the date, e.g. `gs-2026-09-28b`) so phones drop the
old cache in one go, and update the `CORE` list if you add or rename files. Open copies show an "updated — Reload"
toast. The service worker never touches Dropbox requests.

## Files
- `index.html`, `css/style.css`
- `manifest.webmanifest`, `icons/`: home-screen install metadata and icons
- `sw.js`: the service worker (network-first with offline fallback)
- `js/config.js`: the Dropbox app key and paths
- `js/music.js`: the theory engine (notes, scales, chord formulas, chord identification, diatonic chords)
- `js/voicings.js`: the voicing generator, chord diagram and fretboard SVG, and CAGED shapes
- `js/tone.js`: the plucked-string synth (Karplus-Strong) used for playback, plus the iOS audio unlock
- `js/*-ui.js`: one file per tab. `js/store.js` handles persistence and file saving. `js/app.js` is the shell,
  and also registers the service worker.
- `js/sync-merge.js`: the pure merge rules. `js/dropbox.js`: sign-in and the Dropbox API. `js/sync.js`: the
  sync engine, the header indicator and the sync panel.
- `tests/`: test pages (not used by the app)
