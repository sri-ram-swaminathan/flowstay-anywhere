# Flowstay Anywhere

A port of [Flowstay](https://github.com/maketheproduct/flowstay) (macOS menu-bar dictation) to **Windows** and **iPhone**, with on-device speech recognition and a new **custom vocabulary** feature.

One TypeScript codebase runs as a Windows app, an Android app, an iPhone app, and a web app. All downloads are on the [Releases](../../releases/latest) page.

| | Install | Start dictating | Where the text goes |
|---|---|---|---|
| **Windows** | `Flowstay_x.y.z_x64-setup.exe` | Global hotkey (`Alt+Space` toggle, `Ctrl+Shift+Space` hold), tray, or app | Pasted into the app you're typing in, and kept on the clipboard |
| **Android** | `Flowstay_x.y.z_android.apk`: open it on the phone, allow "install unknown apps" | Mic button | Copied to the clipboard instantly |
| **iPhone** | `Flowstay_x.y.z_ios-unsigned.ipa` via [Sideloadly](https://sideloadly.io) (Windows/Mac) with your Apple ID; free IDs must re-sign every 7 days | Mic button | Copied to the clipboard instantly |
| Web | https://sri-ram-swaminathan.github.io/flowstay-anywhere/ | Mic button | Copied to the clipboard |

In the apps, model files are stored as native files in the app's data folder, so they download once and are never evicted (unlike the browser cache on iOS).

## On-device models

Downloaded once on first use, cached, then fully offline. Pick in **Settings → Speech model**.

| Model | Size | Languages | Notes |
|---|---|---|---|
| **Moonshine v2 Small** (2026) | 158 MB | English | Default on Windows. Streaming-architecture edge model, more accurate than Whisper Small. |
| **Moonshine Base** | 63 MB | English | Default on iPhone. Fast on phone CPUs. |
| Moonshine Tiny | 30 MB | English | Smallest. |
| Whisper Base | 80 MB | 99 languages | Vocabulary is fed in as a decoding prompt (true biasing). |
| Whisper Large v3 Turbo | 560 MB | 99 languages | Best multilingual; laptop with GPU only. |

Personas can also run on-device (replacing Apple Intelligence) with **Qwen3.5 0.8B**. This needs GPU acceleration (WebGPU), which current Windows laptops and iPhones have. Alternatives are **OpenRouter** (cloud, free models available) and **Claude Code** (Windows; uses your local `claude` CLI and your Pro/Max plan).

## Custom vocabulary (new)

**Vocabulary** tab → add terms you use often (names, jargon, tools: `PyTorch`, `Maastricht`, `CBS`…). Each term can optionally list what it *sounds like* (`CBS: c b s`). The vocabulary is applied in three ways:

1. **Whisper models** are prompted with your terms while decoding.
2. **Every transcript is corrected:** exact aliases, casing (`github` → `GitHub`), and fuzzy/phonetic matches across 1–4 words (`pie torch` → `PyTorch`, `cooper netties` → `Kubernetes`). A strictness slider controls how aggressive this is, and a test box shows what would change.
3. **Persona rewrites** are told to keep your exact spellings.

You can import/export the list as plain text (one term per line, `Term: alias, alias`). From History you can add a misheard word in one tap.

## What was ported

Feature parity with Flowstay (macOS), and what differs:

| Flowstay (macOS) | Here |
|---|---|
| Parakeet ASR via FluidAudio/CoreML | Moonshine v2 / Moonshine / Whisper via ONNX (same on both platforms) |
| Menu-bar app | Windows tray app; iPhone home-screen app |
| Toggle / Hold / Both hotkey modes, customizable | ✅ Windows. `Fn` key isn't accessible on Windows, so hold-to-talk uses its own shortcut |
| Auto-paste with clipboard restore | ✅ Windows. iPhone: auto-copy (iOS doesn't let apps type into other apps) |
| Recording overlay bubble | ✅ Windows (click-through, bottom of screen) |
| Personas: built-ins + custom, default persona | ✅ |
| App-specific personas | ✅ Windows (detects the foreground program). Not possible on iPhone |
| Apple Intelligence / OpenRouter (OAuth) / Claude Code (strict-rewrite & assistant modes, model choice) | On-device LLM / OpenRouter (OAuth or pasted key) / Claude Code (Windows) |
| History with retention, copy original vs. rewritten | ✅ plus search, export (.txt/.md/.json) |
| Crash recovery of in-progress recordings | ✅ Audio is saved every second; recover on next launch |
| Silence auto-stop, sound feedback, launch at login | ✅ (launch at login: Windows) |
| Onboarding with permission + shortcut tutorial + first dictation | ✅ |
| Troubleshooting / diagnostics | ✅ Mic status, GPU check, model reload, cache reset, exportable log |
| Sparkle auto-updates | Windows checks GitHub Releases and notifies; the iPhone app updates itself |

## Develop

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm test             # vocabulary unit tests
npm run tauri dev    # Windows app (on Windows, needs Rust + WebView2)
npm run tauri build  # Windows installer
```

CI (`.github/workflows`):
- **CI**: unit tests, build, and an end-to-end test that feeds a real speech clip through each model in Chromium and checks the transcript, the vocabulary, and the on-device persona models.
- **Windows app**: builds the installer on every push to `main` and attaches it to the release for the current version (bump `version` in `package.json` for a new release).
- **iPhone app**: deploys to GitHub Pages. If the first run fails, enable **Settings → Pages → Source: GitHub Actions** once.

## Notes

- The Windows installer isn't code-signed, so SmartScreen will warn on first run (*More info → Run anyway*).
- On iPhone, keep the app open while dictating: iOS pauses web apps in the background.
- The first dictation after install waits for the model download; after that it starts immediately.

## License

Apache-2.0, same as the original. Derived from Flowstay by maketheproduct; see `LICENSE` and `NOTICE`.
