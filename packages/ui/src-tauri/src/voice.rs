// Voice input, the shell's half: records the microphone while the push-to-talk key is held, turns the recording into text with Whisper
// on this Mac, and downloads the speech model once (ADR 0006). The audio lives in memory only and is dropped as soon as it is text;
// the model file is the only thing written to disk. The window decides when to start and stop, and where the words go.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;
use tauri::State;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::grove_home;

// Whisper "small", multilingual, 5-bit quantised: about 190 MB, so a language chosen in Settings works.
const MODEL_FILE: &str = "ggml-small-q5_1.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin";
const MODEL_BYTES: u64 = 190_085_487;
const MODEL_SHA256: &str = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
// What Whisper takes: mono, 16 kHz.
const WHISPER_RATE: u32 = 16_000;
// A recording whose loudest sample is below this is silence, and is not given to Whisper, which would invent words for it.
const SILENCE_PEAK: f32 = 0.01;

enum Command {
    Stop(Sender<(Vec<f32>, u32)>),
    Cancel,
}

#[derive(Default)]
struct Inner {
    // The recorder thread of the clip being recorded: it owns the microphone stream, which cannot move between threads.
    recorder: Option<Sender<Command>>,
    // The model, loaded on the first recording and kept.
    model: Option<Arc<WhisperContext>>,
}

#[derive(Default)]
pub struct Voice {
    inner: Mutex<Inner>,
    transcribing: AtomicBool,
    downloading: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    model_ready: bool,
    model_bytes: u64,
    // "granted", "denied", "not-determined" or "unknown".
    microphone: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    done: u64,
    total: u64,
}

fn model_path() -> PathBuf {
    grove_home().join("models").join(MODEL_FILE)
}

#[cfg(target_os = "macos")]
fn microphone_status() -> &'static str {
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
    // SAFETY: AVMediaTypeAudio is a constant AVFoundation provides; the status query has no preconditions.
    let status = unsafe {
        let Some(kind) = AVMediaTypeAudio else { return "unknown" };
        AVCaptureDevice::authorizationStatusForMediaType(kind)
    };
    match status {
        AVAuthorizationStatus::Authorized => "granted",
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => "denied",
        AVAuthorizationStatus::NotDetermined => "not-determined",
        _ => "unknown",
    }
}

#[cfg(not(target_os = "macos"))]
fn microphone_status() -> &'static str {
    "unknown"
}

#[tauri::command]
pub fn voice_status() -> VoiceStatus {
    VoiceStatus { model_ready: model_path().is_file(), model_bytes: MODEL_BYTES, microphone: microphone_status() }
}

// Records on its own thread until told to stop. Returns once the microphone is open, or why it could not be.
fn spawn_recorder() -> Result<Sender<Command>, String> {
    let (commands, inbox) = channel::<Command>();
    let (ready, opened) = channel::<Result<(), String>>();
    thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let open = || -> Result<(cpal::Stream, u32), String> {
            let device = cpal::default_host().default_input_device().ok_or("No microphone found")?;
            let config = device.default_input_config().map_err(|error| format!("Could not open the microphone: {error}"))?;
            let rate = config.sample_rate();
            let channels = usize::from(config.channels());
            let sink = Arc::clone(&samples);
            let failed = |error| eprintln!("microphone error: {error}");
            // The clip is kept as mono at the device's own rate; it is brought to Whisper's at the end.
            fn mono<T: cpal::Sample>(data: &[T], channels: usize, to_f32: impl Fn(T) -> f32, sink: &Mutex<Vec<f32>>) {
                let Ok(mut clip) = sink.lock() else { return };
                for frame in data.chunks(channels) {
                    clip.push(frame.iter().map(|sample| to_f32(*sample)).sum::<f32>() / frame.len() as f32);
                }
            }
            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(config.into(), move |data: &[f32], _| mono(data, channels, |s| s, &sink), failed, None),
                cpal::SampleFormat::I16 => device.build_input_stream(config.into(), move |data: &[i16], _| mono(data, channels, |s| f32::from(s) / 32768.0, &sink), failed, None),
                cpal::SampleFormat::U16 => device.build_input_stream(config.into(), move |data: &[u16], _| mono(data, channels, |s| (f32::from(s) - 32768.0) / 32768.0, &sink), failed, None),
                other => return Err(format!("The microphone gives a sample format Grove cannot read: {other:?}")),
            }
            .map_err(|error| format!("Could not open the microphone: {error}"))?;
            stream.play().map_err(|error| format!("Could not start the microphone: {error}"))?;
            Ok((stream, rate))
        };
        let (stream, rate) = match open() {
            Ok(opened) => {
                let _ = ready.send(Ok(()));
                opened
            }
            Err(error) => {
                let _ = ready.send(Err(error));
                return;
            }
        };
        match inbox.recv() {
            Ok(Command::Stop(reply)) => {
                drop(stream);
                let clip = samples.lock().map(|mut clip| std::mem::take(&mut *clip)).unwrap_or_default();
                let _ = reply.send((clip, rate));
            }
            Ok(Command::Cancel) | Err(_) => drop(stream),
        }
    });
    opened.recv().map_err(|_| "The microphone thread ended".to_string())??;
    Ok(commands)
}

// Brings a mono clip to 16 kHz by averaging the input samples under each output sample, which is enough for speech.
fn resample(clip: &[f32], rate: u32) -> Vec<f32> {
    if rate == WHISPER_RATE || clip.is_empty() {
        return clip.to_vec();
    }
    let ratio = f64::from(rate) / f64::from(WHISPER_RATE);
    let length = (clip.len() as f64 / ratio) as usize;
    (0..length)
        .map(|index| {
            let from = (index as f64 * ratio) as usize;
            let to = (((index + 1) as f64 * ratio) as usize).clamp(from + 1, clip.len());
            let window = &clip[from.min(clip.len() - 1)..to];
            window.iter().sum::<f32>() / window.len() as f32
        })
        .collect()
}

// Whisper marks sound that is not speech as [BLANK_AUDIO], (music) and the like; those are not words to paste.
fn without_annotations(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0u32;
    for ch in text.chars() {
        match ch {
            '[' | '(' => depth += 1,
            ']' | ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn load_model(voice: &Voice) -> Result<Arc<WhisperContext>, String> {
    let mut inner = voice.inner.lock().map_err(|_| "Voice is busy".to_string())?;
    if let Some(model) = &inner.model {
        return Ok(Arc::clone(model));
    }
    let path = model_path();
    let model = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
        .map_err(|error| format!("Could not load the speech model: {error}"))?;
    let model = Arc::new(model);
    inner.model = Some(Arc::clone(&model));
    Ok(model)
}

#[tauri::command]
pub fn voice_start(voice: State<'_, Voice>) -> Result<(), String> {
    if voice.transcribing.load(Ordering::SeqCst) {
        return Err("busy".into());
    }
    if !model_path().is_file() {
        return Err("no-model".into());
    }
    if microphone_status() == "denied" {
        return Err("mic-denied".into());
    }
    {
        let inner = voice.inner.lock().map_err(|_| "Voice is busy".to_string())?;
        if inner.recorder.is_some() {
            return Err("busy".into());
        }
    }
    let recorder = spawn_recorder()?;
    let mut inner = voice.inner.lock().map_err(|_| "Voice is busy".to_string())?;
    inner.recorder = Some(recorder);
    Ok(())
}

#[tauri::command]
pub async fn voice_stop(voice: State<'_, Voice>, language: Option<String>) -> Result<String, String> {
    let recorder = voice.inner.lock().map_err(|_| "Voice is busy".to_string())?.recorder.take().ok_or("Voice was not recording")?;
    voice.transcribing.store(true, Ordering::SeqCst);
    let result = (|| {
        let (reply, answer) = channel();
        recorder.send(Command::Stop(reply)).map_err(|_| "The microphone thread ended".to_string())?;
        let (clip, rate) = answer.recv().map_err(|_| "The microphone thread ended".to_string())?;
        let clip = resample(&clip, rate);
        if clip.iter().fold(0.0f32, |peak, sample| peak.max(sample.abs())) < SILENCE_PEAK {
            return Ok(String::new());
        }
        let model = load_model(&voice)?;
        transcribe(&model, &clip, language.as_deref())
    })();
    voice.transcribing.store(false, Ordering::SeqCst);
    result
}

fn transcribe(model: &WhisperContext, clip: &[f32], language: Option<&str>) -> Result<String, String> {
    let mut state = model.create_state().map_err(|error| format!("Could not start the speech model: {error}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(language);
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_no_speech_thold(0.6);
    // A hint of the words an agent session uses, in English only: a prompt in one language pulls the others towards it.
    if language == Some("en") {
        params.set_initial_prompt("Grove, git, branch, worktree, TypeScript, npm, Claude, Copilot, OpenCode, pull request, refactor.");
    }
    state.full(params, clip).map_err(|error| format!("The speech model failed: {error}"))?;
    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_string());
        text.push(' ');
    }
    Ok(without_annotations(&text))
}

// Throws the clip away: the window lost the hold before it was speech.
#[tauri::command]
pub fn voice_cancel(voice: State<'_, Voice>) {
    if let Ok(mut inner) = voice.inner.lock() {
        if let Some(recorder) = inner.recorder.take() {
            let _ = recorder.send(Command::Cancel);
        }
    }
}

// Downloads the speech model once, after the human said yes, reporting progress. It is written beside its place and renamed over it
// only when its checksum is the published one, so a stopped or damaged download never passes for the model.
#[tauri::command]
pub async fn voice_download(voice: State<'_, Voice>, progress: Channel<DownloadProgress>) -> Result<(), String> {
    if voice.downloading.swap(true, Ordering::SeqCst) {
        return Err("The speech model is already downloading".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || download(&progress)).await.map_err(|error| error.to_string());
    voice.downloading.store(false, Ordering::SeqCst);
    result?
}

fn download(progress: &Channel<DownloadProgress>) -> Result<(), String> {
    let target = model_path();
    let dir = target.parent().ok_or("No folder for the speech model")?;
    fs::create_dir_all(dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    let staged = dir.join(format!("{MODEL_FILE}.part"));
    let outcome = (|| {
        let response = ureq::get(MODEL_URL).call().map_err(|error| format!("The download failed: {error}"))?;
        let total = response.body().content_length().unwrap_or(MODEL_BYTES);
        let mut reader = response.into_body().into_reader();
        let mut file = fs::File::create(&staged).map_err(|error| format!("Could not write {}: {error}", staged.display()))?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut done = 0u64;
        let mut reported = 0u64;
        loop {
            let read = reader.read(&mut buffer).map_err(|error| format!("The download failed: {error}"))?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
            file.write_all(&buffer[..read]).map_err(|error| format!("Could not write {}: {error}", staged.display()))?;
            done += read as u64;
            if done - reported >= 1024 * 1024 || done == total {
                reported = done;
                let _ = progress.send(DownloadProgress { done, total });
            }
        }
        file.flush().map_err(|error| format!("Could not write {}: {error}", staged.display()))?;
        let digest: String = hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
        if digest != MODEL_SHA256 {
            return Err("The downloaded speech model did not match its checksum, so it was thrown away".to_string());
        }
        fs::rename(&staged, &target).map_err(|error| format!("Could not place the speech model: {error}"))
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&staged);
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_keeps_a_clip_already_at_whisper_rate() {
        assert_eq!(resample(&[0.1, 0.2], WHISPER_RATE), vec![0.1, 0.2]);
    }

    #[test]
    fn resample_averages_down_to_a_third() {
        let clip = [0.3, 0.6, 0.9, 0.0, 0.0, 0.3];
        let out = resample(&clip, WHISPER_RATE * 3);
        assert_eq!(out.len(), 2);
        assert!((out[0] - 0.6).abs() < 1e-6 && (out[1] - 0.1).abs() < 1e-6);
    }

    #[test]
    fn annotations_are_not_words() {
        assert_eq!(without_annotations(" [BLANK_AUDIO] hello (music)  world "), "hello world");
        assert_eq!(without_annotations("[BLANK_AUDIO]"), "");
    }
}
