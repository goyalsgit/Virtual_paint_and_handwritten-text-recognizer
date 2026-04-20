# Gesture Media Player Web App

An interactive browser-based media player that lets you load a local video or a YouTube link, start your webcam, and control playback with hand gestures.

## Tech Stack

- `HTML` for layout
- `CSS` for the interactive UI
- `JavaScript` for media controls, webcam access, drag-drop upload, and gesture logic
- `Python` only as a lightweight local server
- `MediaPipe Hands` in the browser for hand tracking

## Gesture Map

- `Two Fingers Up` -> Toggle `Play / Pause`
- `OK Sign` -> Toggle `Fullscreen / Exit Fullscreen`
- `Thumb Up` -> Forward `10s`
- `Thumb Down` -> Backward `10s`
- `Index Swipe Right` -> Slow Down
- `Index Swipe Left` -> Speed Up
- `Swipe Right` -> Skip forward `20s`
- `Swipe Left` -> Skip backward `20s`

## Project Files

```text
MediaPlayerOpenCV/
|-- app.py
|-- README.md
|-- requirements.txt
`-- web/
    |-- index.html
    |-- script.js
    `-- styles.css
```

## How To Start

1. Open a terminal in `D:\BTP\MediaPlayerOpenCV`
2. Run:

   ```powershell
   python app.py
   ```

3. Open:

   ```text
   http://127.0.0.1:8000
   ```

4. In the app:

   - choose a local video,
   - or paste a YouTube link and click `Load YouTube`,
   - click `Start Camera`,
   - allow webcam access,
   - use gestures to control playback.

## Notes

- No external Python package is required for the local server.
- The frontend loads MediaPipe from a CDN in the browser, so internet access is needed unless you later store those files locally.
- Webcam permissions must be allowed in the browser.
- `localhost` is enough for camera access in modern browsers.
- The website now includes an on-screen gesture guide that explains what each gesture means and how to perform it.
- Gesture triggering has been made less sensitive with stronger stability checks, tighter pinch detection, and cleaner swipe thresholds.
- The minimum gesture command gap is now `220 ms` for more reliable control.
- YouTube playback uses the embedded player, so some videos may refuse embedding depending on the uploader settings.
