//! On-device speech recognition for Flowstay.
//!
//! Models are GGUF builds of NVIDIA Parakeet run by transcribe.cpp (ggml) on the CPU,
//! the same engine and model files Handy uses. The model stays loaded on a dedicated
//! thread, so a dictation only pays for inference, never for loading.

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Instant;
use transcribe_cpp::{BackendMask, Feature, Model, RunOptions, Session};

#[derive(Clone, Debug)]
pub struct ModelInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub blurb: &'static str,
    pub url: &'static str,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub english_wer: f32,
    /// Speed multiple over real time on CPU (Handy's benchmark).
    pub cpu_speed: f32,
    pub multilingual: bool,
}

/// Accuracy and speed figures come from Handy's published model benchmarks.
pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "parakeet-unified-en",
        name: "Parakeet Unified (English)",
        blurb: "Most accurate. Recommended.",
        url: "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/7e948f21b7bdbac698d3318db9d350f1096f3b6c/parakeet-unified-en-0.6b-Q8_0.gguf",
        file: "parakeet-unified-en-0.6b-Q8_0.gguf",
        size: 731_357_568,
        sha256: "4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795",
        english_wer: 3.99,
        cpu_speed: 14.0,
        multilingual: false,
    },
    ModelInfo {
        id: "parakeet-110m",
        name: "Parakeet Fast 110M (English)",
        blurb: "Fastest and smallest, slightly less accurate.",
        url: "https://huggingface.co/handy-computer/parakeet-tdt_ctc-110m-gguf/resolve/9d66d34f9e1594075c5dd72c90c0f4c321b29f21/parakeet-tdt_ctc-110m-Q8_0.gguf",
        file: "parakeet-tdt_ctc-110m-Q8_0.gguf",
        size: 135_373_280,
        sha256: "7dd44c74a331d788a4e5f8b16913b3feb29ced22cf5613aad0e0f6cd30516296",
        english_wer: 6.11,
        cpu_speed: 50.0,
        multilingual: false,
    },
    ModelInfo {
        id: "parakeet-v3",
        name: "Parakeet v3 (25 languages)",
        blurb: "European languages incl. Dutch, German, French, Spanish.",
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/85ac09ea12fc4b1112fa76810059364bc6adc9de/parakeet-tdt-0.6b-v3-Q8_0.gguf",
        file: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        size: 739_508_576,
        sha256: "5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7",
        english_wer: 4.83,
        cpu_speed: 13.7,
        multilingual: true,
    },
];

pub fn find(id: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|m| m.id == id)
}

pub fn model_path(dir: &Path, m: &ModelInfo) -> PathBuf {
    dir.join(m.file)
}

pub fn is_downloaded(dir: &Path, m: &ModelInfo) -> bool {
    std::fs::metadata(model_path(dir, m)).map(|md| md.len() == m.size).unwrap_or(false)
}

/// Downloads a model with progress, verifies its SHA-256, then moves it into place.
pub fn download(dir: &Path, m: &ModelInfo, mut progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = model_path(dir, m);
    let part = dest.with_extension("part");
    let resp = ureq::get(m.url).call().map_err(|e| format!("Download failed: {e}"))?;
    let mut reader = resp.into_body().into_reader();
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    let mut last = Instant::now();
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if last.elapsed().as_millis() > 150 {
            progress(done, m.size);
            last = Instant::now();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let got = format!("{:x}", hasher.finalize());
    if got != m.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("Downloaded file is corrupted (checksum mismatch). Please try again.".into());
    }
    std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
    progress(m.size, m.size);
    Ok(dest)
}

pub struct Loaded {
    pub id: String,
    pub vocabulary: bool,
    pub load_ms: u128,
}

pub struct Output {
    pub text: String,
    pub ms: u128,
}

enum Job {
    Load(PathBuf, String, mpsc::Sender<Result<Loaded, String>>),
    Run { pcm: Vec<f32>, vocabulary: Vec<String>, language: Option<String>, reply: mpsc::Sender<Result<Output, String>> },
    Unload,
}

/// Owns the loaded model on its own thread. Cheap to clone; calls queue in order.
#[derive(Clone)]
pub struct Engine {
    tx: mpsc::Sender<Job>,
}

pub fn init() -> Result<(), String> {
    transcribe_cpp::init_backends_with(None::<&Path>, BackendMask::CPU).map_err(|e| e.to_string())
}

impl Engine {
    pub fn start() -> Engine {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("flowstay-engine".into())
            .spawn(move || worker(rx))
            .expect("engine thread");
        Engine { tx }
    }

    pub fn load(&self, path: PathBuf, id: &str) -> Result<Loaded, String> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(Job::Load(path, id.to_string(), reply)).map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }

    pub fn transcribe(&self, pcm: Vec<f32>, vocabulary: Vec<String>, language: Option<String>) -> Result<Output, String> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(Job::Run { pcm, vocabulary, language, reply }).map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }

    pub fn unload(&self) {
        let _ = self.tx.send(Job::Unload);
    }
}

fn worker(rx: mpsc::Receiver<Job>) {
    let mut current: Option<(String, Model, Session)> = None;
    while let Ok(job) = rx.recv() {
        match job {
            Job::Load(path, id, reply) => {
                if let Some((cur, model, _)) = &current {
                    if *cur == id {
                        let _ = reply.send(Ok(Loaded { id, vocabulary: model.supports(Feature::Vocabulary), load_ms: 0 }));
                        continue;
                    }
                }
                current = None;
                let t = Instant::now();
                let r = Model::load(&path)
                    .and_then(|model| model.session().map(|s| (model, s)))
                    .map_err(|e| format!("Couldn't load the speech model: {e}"));
                match r {
                    Ok((model, session)) => {
                        let vocab = model.supports(Feature::Vocabulary);
                        current = Some((id.clone(), model, session));
                        // warm-up so the first real dictation doesn't pay one-time allocation costs
                        if let Some((_, _, s)) = current.as_mut() {
                            let _ = s.run(&vec![0.0f32; 16_000], &RunOptions::default());
                        }
                        let _ = reply.send(Ok(Loaded { id, vocabulary: vocab, load_ms: t.elapsed().as_millis() }));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(e));
                    }
                }
            }
            Job::Run { pcm, vocabulary, language, reply } => {
                let Some((_, model, session)) = current.as_mut() else {
                    let _ = reply.send(Err("No speech model loaded".into()));
                    continue;
                };
                let t = Instant::now();
                let opts = RunOptions {
                    vocabulary: if model.supports(Feature::Vocabulary) { vocabulary } else { Vec::new() },
                    language,
                    ..Default::default()
                };
                let windows = if model.supports(Feature::LongForm) { vec![&pcm[..]] } else { split(&pcm, 25) };
                let mut parts = Vec::new();
                let mut err = None;
                for w in windows {
                    match session.run(w, &opts) {
                        Ok(tr) => parts.push(tr.text.trim().to_string()),
                        Err(e) => {
                            err = Some(format!("Transcription failed: {e}"));
                            break;
                        }
                    }
                }
                let _ = reply.send(match err {
                    Some(e) => Err(e),
                    None => Ok(Output { text: parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" "), ms: t.elapsed().as_millis() }),
                });
            }
            Job::Unload => current = None,
        }
    }
}

/// Splits long audio into windows of at most `max_sec`, cutting at the quietest 20 ms
/// frame in the last 5 s of each window so words aren't chopped.
pub fn split(pcm: &[f32], max_sec: usize) -> Vec<&[f32]> {
    const SR: usize = 16_000;
    let max = max_sec * SR;
    let frame = SR / 50;
    let mut out = Vec::new();
    let mut start = 0;
    while pcm.len() - start > max {
        let end = start + max;
        let mut best = end;
        let mut best_e = f32::MAX;
        let mut i = end - 5 * SR;
        while i + frame <= end {
            let e: f32 = pcm[i..i + frame].iter().map(|v| v * v).sum();
            if e < best_e {
                best_e = e;
                best = i + frame / 2;
            }
            i += frame;
        }
        out.push(&pcm[start..best]);
        start = best;
    }
    out.push(&pcm[start..]);
    out
}

/// Trims leading/trailing silence (keeps 200 ms of padding). Less audio = faster, and
/// fewer hallucinations on quiet tails.
pub fn trim_silence(pcm: &[f32]) -> &[f32] {
    const FRAME: usize = 320; // 20 ms
    const PAD: usize = 3200; // 200 ms
    let voiced = |f: &[f32]| (f.iter().map(|v| v * v).sum::<f32>() / f.len() as f32).sqrt() > 0.006;
    let frames: Vec<bool> = pcm.chunks(FRAME).map(voiced).collect();
    let (Some(first), Some(last)) = (frames.iter().position(|&v| v), frames.iter().rposition(|&v| v)) else {
        return &pcm[0..0];
    };
    let a = (first * FRAME).saturating_sub(PAD);
    let b = ((last + 1) * FRAME + PAD).min(pcm.len());
    &pcm[a..b]
}
