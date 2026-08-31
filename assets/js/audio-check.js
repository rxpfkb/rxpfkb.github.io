(function () {
  "use strict";

  var dropZone = document.getElementById("dropZone");
  var fileInput = document.getElementById("fileInput");
  var pickBtn = document.getElementById("pickBtn");
  var fileChip = document.getElementById("fileChip");
  var fileChipName = document.getElementById("fileChipName");
  var progressBox = document.getElementById("progressBox");
  var progressText = document.getElementById("progressText");
  var errorBox = document.getElementById("errorBox");
  var statusBox = document.getElementById("statusBox");
  var statusIcon = document.getElementById("statusIcon");
  var statusTitle = document.getElementById("statusTitle");
  var statusSubtitle = document.getElementById("statusSubtitle");
  var metricPeak = document.getElementById("metricPeak");
  var metricRms = document.getElementById("metricRms");
  var metricDuration = document.getElementById("metricDuration");
  var metricChannels = document.getElementById("metricChannels");
  var tipsList = document.getElementById("tipsList");
  var resetBtn = document.getElementById("resetBtn");

  // Calibrated against real Samsung S20 handheld recordings decoded through
  // the browser's own AAC decoder (not an offline reference decoder): normal,
  // unclipped close-mic speech commonly peaks at 0 to +0.3 dBFS, and the
  // decoder itself briefly pins samples at the float ceiling (~0.98-1.0) for
  // up to ~18 consecutive samples right at those peaks, purely from lossy
  // encode/decode rounding. Real hard clipping from an overdriven mic runs
  // much longer per event (tens to hundreds of samples, roughly half a
  // waveform cycle) and pins a far larger share of the signal, so both
  // MIN_RUN and CLIP_RATIO_THRESHOLD sit well above that natural baseline.
  // Crest factor (peak vs. RMS) is used as a second, duration-independent
  // signal: clipped/over-limited audio loses dynamic range, pulling the RMS
  // up close to the peak.
  var NEAR_MAX = 0.98; // ~ -0.18 dBFS
  var MIN_RUN = 30; // ~0.6ms at 48kHz
  var CLIP_EVENTS_THRESHOLD = 5;
  var CLIP_RATIO_THRESHOLD = 0.003; // 0.3% of all samples
  var LOW_RMS_THRESHOLD_DB = -35;
  var LOW_CREST_FACTOR_DB = 8;

  var ICONS = {
    good: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
    low: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="10"></circle></svg>',
    bad: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-6 6-3-3-6 6"></path><path d="M21 3v6h-6"></path></svg>'
  };

  var audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function fmtDb(v) {
    if (!isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
  }

  function fmtDuration(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.round(sec % 60);
    return m + "min " + (s < 10 ? "0" : "") + s + "s";
  }

  function fmtBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    return (bytes / (1024 * 1024)).toFixed(0) + " MB";
  }

  var MAX_FILE_SIZE = 3 * 1024 * 1024 * 1024; // 3 GB — acima disso o navegador do celular costuma travar
  var WARN_FILE_SIZE = 400 * 1024 * 1024; // 400 MB — ainda funciona, só avisamos que pode demorar
  var ACCEPTED_EXT = /\.(mp4|mov|m4a|m4v|wav|aac|3gp)$/i;

  function analyzeBuffer(buffer) {
    var numChannels = buffer.numberOfChannels;
    var peak = 0;
    var sumSquares = 0;
    var totalSamples = 0;
    var clippedSamples = 0;
    var clipEvents = 0;

    for (var ch = 0; ch < numChannels; ch++) {
      var data = buffer.getChannelData(ch);
      var run = 0;
      for (var i = 0; i < data.length; i++) {
        var v = Math.abs(data[i]);
        if (v > peak) peak = v;
        sumSquares += v * v;
        totalSamples++;
        if (v >= NEAR_MAX) {
          run++;
          if (run === MIN_RUN) clipEvents++;
          if (run >= MIN_RUN) clippedSamples++;
        } else {
          run = 0;
        }
      }
    }

    var peakDb = 20 * Math.log10(Math.max(peak, 1e-8));
    var rms = Math.sqrt(sumSquares / Math.max(totalSamples, 1));
    var rmsDb = 20 * Math.log10(Math.max(rms, 1e-8));
    var clippedRatio = totalSamples ? clippedSamples / totalSamples : 0;
    var crestFactorDb = peakDb - rmsDb;

    var status;
    if (clipEvents >= CLIP_EVENTS_THRESHOLD || clippedRatio >= CLIP_RATIO_THRESHOLD || crestFactorDb < LOW_CREST_FACTOR_DB) {
      status = "bad";
    } else if (rmsDb < LOW_RMS_THRESHOLD_DB) {
      status = "low";
    } else {
      status = "good";
    }

    return {
      peakDb: peakDb,
      rmsDb: rmsDb,
      duration: buffer.duration,
      channels: numChannels,
      status: status
    };
  }

  function renderResult(r) {
    statusBox.classList.remove("state-good", "state-low", "state-bad");
    statusBox.classList.add("state-" + r.status);
    statusIcon.innerHTML = ICONS[r.status];

    metricPeak.textContent = fmtDb(r.peakDb);
    metricRms.textContent = fmtDb(r.rmsDb);
    metricDuration.textContent = fmtDuration(r.duration);
    metricChannels.textContent = r.channels === 1 ? "Mono" : r.channels === 2 ? "Estéreo" : r.channels + " canais";

    tipsList.innerHTML = "";

    if (r.status === "bad") {
      statusTitle.textContent = "Áudio saturado detectado";
      statusSubtitle.textContent = "Há trechos com o áudio estourado (clipping), o que causa distorção e chiado na gravação.";
      [
        "Afaste um pouco o celular da fonte de som, ou peça para falar/tocar com menos intensidade perto do microfone.",
        "Se possível, use um microfone de lapela ou externo — o microfone do celular satura fácil em ambientes muito altos.",
        "Grave um teste de alguns segundos antes da gravação principal e ouça de fone para checar se há distorção.",
        "Evite gravar encostado em caixas de som ou instrumentos muito próximos.",
        "Regrave o trecho, se possível, e envie novamente aqui para conferir."
      ].forEach(addTip);
    } else if (r.status === "low") {
      statusTitle.textContent = "Volume de áudio muito baixo";
      statusSubtitle.textContent = "O áudio está com nível muito baixo, o que pode gerar ruído de fundo ao ser realçado na edição.";
      [
        "Aproxime-se mais da fonte de som ao gravar.",
        "Evite gravar em ambientes muito silenciosos ou com o celular muito distante de quem está falando.",
        "Se o app de câmera permitir, verifique se a sensibilidade do microfone não está reduzida."
      ].forEach(addTip);
    } else {
      statusTitle.textContent = "Arquivo perfeito para edição";
      statusSubtitle.textContent = "O áudio está com um nível equilibrado, sem saturação. Pode enviar esse arquivo para edição sem problemas.";
    }

    statusBox.classList.remove("status-hidden");
  }

  function addTip(text) {
    var li = document.createElement("li");
    li.textContent = text;
    tipsList.appendChild(li);
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove("status-hidden");
  }

  function resetUI() {
    errorBox.classList.add("status-hidden");
    statusBox.classList.add("status-hidden");
    progressBox.classList.add("status-hidden");
    fileChip.classList.add("status-hidden");
  }

  function handleFile(file) {
    if (!file) return;
    resetUI();

    fileChipName.textContent = file.name + " (" + fmtBytes(file.size) + ")";
    fileChip.classList.remove("status-hidden");

    if (!ACCEPTED_EXT.test(file.name) && file.type.indexOf("video") !== 0 && file.type.indexOf("audio") !== 0) {
      showError("Este tipo de arquivo não parece ser um vídeo ou áudio (esperado MP4, MOV, M4A, WAV ou AAC). Selecione o vídeo original gravado pelo celular.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showError("Este arquivo tem " + fmtBytes(file.size) + ", grande demais para analisar no navegador do celular (limite ~" + fmtBytes(MAX_FILE_SIZE) + "). Tente cortar o vídeo em partes menores antes de enviar.");
      return;
    }

    progressText.textContent = file.size > WARN_FILE_SIZE
      ? "Lendo arquivo grande (" + fmtBytes(file.size) + ") — isso pode levar um pouco mais de tempo…"
      : "Lendo arquivo…";
    progressBox.classList.remove("status-hidden");

    file.arrayBuffer()
      .then(function (buf) {
        progressText.textContent = "Decodificando áudio…";
        var ctx = getAudioContext();
        return ctx.decodeAudioData(buf);
      })
      .then(function (audioBuffer) {
        progressBox.classList.add("status-hidden");
        var result = analyzeBuffer(audioBuffer);
        renderResult(result);
      })
      .catch(function (err) {
        progressBox.classList.add("status-hidden");
        showError("Não foi possível analisar este arquivo. Verifique se é um vídeo ou áudio válido (MP4, MOV, M4A, WAV) e tente novamente. Detalhe técnico: " + (err && err.message ? err.message : err));
      });
  }

  pickBtn.addEventListener("click", function () { fileInput.click(); });
  dropZone.addEventListener("click", function (e) {
    if (e.target === pickBtn) return;
    fileInput.click();
  });

  fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  resetBtn.addEventListener("click", function () {
    fileInput.value = "";
    resetUI();
  });
})();
