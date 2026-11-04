//! Transcribes a real speech clip with every model. Needs the network (downloads models),
//! so it only runs when FLOWSTAY_SPEECH_TEST=<path to 16 kHz mono 16-bit WAV> is set.
use flowstay_engine::*;

fn read_wav(path: &str) -> Vec<f32> {
    let b = std::fs::read(path).unwrap();
    let mut i = 12;
    while i + 8 <= b.len() {
        let id = &b[i..i + 4];
        let len = u32::from_le_bytes(b[i + 4..i + 8].try_into().unwrap()) as usize;
        if id == b"data" {
            return b[i + 8..(i + 8 + len).min(b.len())].chunks_exact(2).map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0).collect();
        }
        i += 8 + len + (len & 1);
    }
    panic!("no data chunk");
}

#[test]
fn transcribes_real_speech() {
    let Ok(wav) = std::env::var("FLOWSTAY_SPEECH_TEST") else {
        eprintln!("skipped: set FLOWSTAY_SPEECH_TEST");
        return;
    };
    let pcm = read_wav(&wav);
    let dir = std::env::temp_dir().join("flowstay-models");
    init().unwrap();
    let engine = Engine::start();
    let only = std::env::var("FLOWSTAY_MODELS").ok();
    let mut report = String::from("| model | load ms | transcribe ms (11 s audio) | vocabulary bias | text |\n|---|---|---|---|---|\n");
    for m in MODELS.iter().filter(|m| only.as_deref().map_or(true, |o| o.split(',').any(|x| x == m.id))) {
        let path = if is_downloaded(&dir, m) { model_path(&dir, m) } else { download(&dir, m, |_, _| {}).unwrap() };
        let loaded = engine.load(path, m.id).unwrap();
        let trimmed = trim_silence(&pcm).to_vec();
        let out = engine.transcribe(trimmed.clone(), vec![], None).unwrap();
        // second run measures steady-state latency; also exercises vocabulary biasing
        let biased = engine.transcribe(trimmed, vec!["Flowstay".into(), "PyTorch".into()], None).unwrap();
        println!("{}: load {} ms, run {} ms / {} ms, vocab={} → {}", m.id, loaded.load_ms, out.ms, biased.ms, loaded.vocabulary, out.text);
        report += &format!("| {} | {} | {} | {} | {} |\n", m.id, loaded.load_ms, biased.ms, loaded.vocabulary, out.text);
        let t = out.text.to_lowercase();
        assert!(t.contains("ask not what your country"), "{}: unexpected transcript: {}", m.id, out.text);
        assert!(biased.text.to_lowercase().contains("ask not what"), "{}: vocabulary run broke output: {}", m.id, biased.text);
    }
    if let Ok(summary) = std::env::var("GITHUB_STEP_SUMMARY") {
        let _ = std::fs::OpenOptions::new().append(true).open(summary).and_then(|mut f| std::io::Write::write_all(&mut f, report.as_bytes()));
    }
}

#[test]
fn split_and_trim() {
    let mut pcm = vec![0.0f32; 16_000];
    pcm.extend((0..16_000 * 60).map(|i| ((i as f32) * 0.05).sin() * 0.3));
    pcm.extend(vec![0.0f32; 16_000]);
    let t = trim_silence(&pcm);
    assert!(t.len() < pcm.len() && t.len() >= 16_000 * 60);
    let parts = split(t, 25);
    assert_eq!(parts.iter().map(|p| p.len()).sum::<usize>(), t.len());
    assert!(parts.iter().all(|p| p.len() <= 25 * 16_000));
}
