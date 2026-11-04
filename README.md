# Flowstay for Windows

Hold a key, speak, let go. Your words land on the clipboard and in the app you're typing in.
A Windows port of [Flowstay](https://github.com/maketheproduct/flowstay), rebuilt around fast, accurate,
fully on-device speech recognition. Ideas and model files borrowed from [Handy](https://github.com/cjpais/Handy)
and [Murmur](https://github.com/per-simmons/murmur-youtube).

**Download:** `Flowstay_x.y.z_x64-setup.exe` from [Releases](../../releases/latest).
It isn't code-signed yet, so SmartScreen warns on first run: *More info → Run anyway*.

## Use it

| | |
|---|---|
| **Right Ctrl** (default) | Hold to talk, release to finish, or tap to start and tap again to stop |
| **Space** (option) | Hold to talk, like Claude Code's voice mode. A quick tap still types a space; fast typing, shortcuts with Ctrl/Alt/Win, and admin windows are left alone |
| **Ctrl+Space** (configurable) | Hold to talk, or tap to start and tap again to stop |
| **Esc** | Cancel the current recording |

The text is copied to the clipboard the moment you stop, and also pasted into the window you were typing in
(turn that off in Settings → Output if you only want the clipboard). The last 5 dictations are on the Dictate screen.

## Speed and accuracy

Speech recognition is native code ([transcribe.cpp](https://github.com/handy-computer/transcribe.cpp), ggml) running NVIDIA
Parakeet models on the CPU. The model stays loaded, so a dictation only pays for inference.

| Model | Download | English error rate | Speed on CPU |
|---|---|---|---|
| **Parakeet Unified** (default) | 731 MB | 4.0 % | ~14× real time |
| Parakeet Fast 110M | 135 MB | 6.1 % | ~50× real time |
| Parakeet v3, 25 languages | 740 MB | 4.8 % | ~14× real time |

Figures from Handy's benchmarks.

**Live preview:** your words appear as you speak, in the recording bubble and on the Dictate screen. The sentence in
progress is re-transcribed every ~0.6 s with full context, so the preview is as accurate as the final text.

Latency tricks:
- Audio is cut at natural pauses and transcribed **while you keep talking**, so stopping only waits for the last few seconds.
- If the live preview already covers what you said, stopping reuses it: the text is on the clipboard almost instantly.
- Leading/trailing silence is trimmed before inference.
- **Instant start** (Settings → Microphone) keeps the mic open and keeps 500 ms of pre-roll, so your first word is never clipped.
- The Dictate screen shows the stop-to-clipboard time of your last dictation.

Needs a CPU with AVX2 (virtually every laptop since ~2015).

## Vocabulary

Add names, jargon and tools you use. They're applied three ways:
1. Every transcript is **corrected**: casing (`github` → `GitHub`), sound-alikes (`pie torch` → `PyTorch`), and exact
   *heard as* rules (`cloud code` → `Claude Code`, also catching `CloudCode` / `cloud-code`). Whole words only.
2. Persona rewrites keep your spellings.
3. Models that support in-decoder biasing get your first 40 terms too (the current Parakeet models don't, so step 1
   does the work).

## Cleanup and personas

- **Remove filler words** (on by default): drops um / uh / er and stutters like "I I think". Instant, deterministic.
- **Personas** (optional) rewrite text in a style: Cleanup, Professional, Concise or your own. Different personas per app
  (Outlook → Professional) are supported. Engines: an on-device model (Qwen3.5 0.8B on your GPU), OpenRouter, or your
  local Claude Code CLI.

## Develop

```bash
npm install
npm test                 # vocabulary + cleanup tests
npm run dev              # UI preview in a browser (mock engine)
npm run tauri dev        # the real app (Windows, needs Rust + CMake)
cd src-tauri/engine && FLOWSTAY_SPEECH_TEST=jfk.wav cargo test --release -- --nocapture   # engine on real speech
```

CI runs the engine on a real speech clip with every model on Linux and Windows, and builds the installer on every
push to `main` (bump `version` in `package.json` for a new release).

## License

Apache-2.0, as the original. Model weights: CC-BY-4.0 (NVIDIA Parakeet), converted by Handy.
