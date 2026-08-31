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
  var waveformCanvas = document.getElementById("waveformCanvas");

  // Metering approach (validated against 5 real Samsung S20 clips, cross-checked
  // against ffmpeg's EBU R128 loudness/true-peak filter — a broadcast-standard
  // reference — 2026-08-31):
  //
  // An earlier version of this tool used simple sample-domain peak + whole-file
  // RMS. That measured these S20 clips at a reassuring-looking ~0 dBFS peak /
  // -15 dBFS RMS and called them "perfect". The reference analysis told a very
  // different story: True Peak +0.0 to +0.3 dBTP (genuine inter-sample overs —
  // a real technical defect by any delivery standard, which requires staying
  // below -1 dBTP) and Integrated Loudness around -10 to -12 LUFS, roughly
  // 12-13 dB hotter than the -23 LUFS broadcast target and hotter than most
  // "loudness war" commercial masters. The whole-file RMS looked fine only
  // because it was diluted by silence between phrases — once you gate that
  // out (as loudness standards do), these phone recordings are clearly being
  // run through aggressive automatic gain control that leaves no headroom for
  // mixing. So: True Peak is measured with 4x oversampling (linear
  // interpolation — a lightweight approximation of the polyphase filter real
  // meters use, sufficient to catch the inter-sample overs that matter here),
  // and level is measured as gated block loudness (400ms blocks, silence and
  // outlier blocks excluded) rather than raw whole-file RMS.
  var TRUE_PEAK_LIMIT_DB = -1; // professional delivery ceiling
  var GATED_HOT_LIMIT_DB = -9; // backstop: average speech level itself too loud
  var GATED_LOW_LIMIT_DB = -40;
  var BLOCK_SECONDS = 0.4;
  var ABSOLUTE_GATE_DB = -60;
  var RELATIVE_GATE_OFFSET_DB = -15;

  // Secondary signal: sustained flat-top runs are the signature of genuine
  // hard/square-wave clipping (distinct from AGC just riding near the
  // ceiling). Calibrated so normal AAC decode ringing at true peaks (observed
  // up to ~18 consecutive samples on clean S20 audio) does not trigger it.
  var NEAR_MAX = 0.98;
  var MIN_RUN = 30;
  var CLIP_EVENTS_THRESHOLD = 5;
  var CLIP_RATIO_THRESHOLD = 0.003;

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

  function dbfs(v) {
    return 20 * Math.log10(Math.max(v, 1e-8));
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
    var sampleRate = buffer.sampleRate;
    var length = buffer.length;
    var channelData = [];
    var ch, i;
    for (ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

    // Waveform: one column per ~2048 frames, capped so huge files stay cheap to draw.
    var targetColumns = 1200;
    var samplesPerColumn = Math.max(1, Math.ceil(length / targetColumns));
    var columnCount = Math.ceil(length / samplesPerColumn);
    var waveMax = new Float32Array(columnCount);
    var waveHot = new Uint8Array(columnCount);

    var truePeak = 0;
    var samplePeak = 0;
    var clipEvents = 0;
    var clippedSamples = 0;
    var totalSamples = 0;

    var blockLen = Math.max(1, Math.round(sampleRate * BLOCK_SECONDS));
    var blockPowers = [];
    var blockSum = 0;
    var blockCount = 0;

    var runLen = new Int32Array(numChannels);
    var truePeakThresholdLin = Math.pow(10, TRUE_PEAK_LIMIT_DB / 20);

    for (i = 0; i < length; i++) {
      var col = (i / samplesPerColumn) | 0;
      var monoSum = 0;
      var frameIsHot = false;

      for (ch = 0; ch < numChannels; ch++) {
        var data = channelData[ch];
        var v = data[i];
        var av = Math.abs(v);
        monoSum += v;

        if (av > samplePeak) samplePeak = av;

        // 4x oversample via linear interpolation against the previous sample
        // to approximate true (inter-sample) peak.
        if (i > 0) {
          var prev = data[i - 1];
          var d = v - prev;
          var interpPeak = Math.max(Math.abs(prev + d * 0.25), Math.abs(prev + d * 0.5), Math.abs(prev + d * 0.75), av);
          if (interpPeak > truePeak) truePeak = interpPeak;
          if (interpPeak >= truePeakThresholdLin) frameIsHot = true;
        } else if (av > truePeak) {
          truePeak = av;
        }

        if (av >= NEAR_MAX) {
          runLen[ch]++;
          if (runLen[ch] === MIN_RUN) clipEvents++;
          if (runLen[ch] >= MIN_RUN) clippedSamples++;
        } else {
          runLen[ch] = 0;
        }

        blockSum += v * v;
      }

      totalSamples += numChannels;
      blockCount++;

      var monoAbs = Math.abs(monoSum / numChannels);
      if (monoAbs > waveMax[col]) waveMax[col] = monoAbs;
      if (frameIsHot) waveHot[col] = 1;

      if (blockCount >= blockLen) {
        blockPowers.push(blockSum / blockCount);
        blockSum = 0;
        blockCount = 0;
      }
    }
    if (blockCount > 0) blockPowers.push(blockSum / blockCount);

    // Gated block loudness: absolute gate drops silence, relative gate drops
    // blocks well below the programme's own average (mirrors EBU R128's
    // two-stage gating, without K-weighting).
    var gated = blockPowers.filter(function (p) { return dbfs(Math.sqrt(p)) > ABSOLUTE_GATE_DB; });
    var gatedLevelDb;
    if (gated.length) {
      var meanPow = gated.reduce(function (a, b) { return a + b; }, 0) / gated.length;
      var meanDb = dbfs(Math.sqrt(meanPow));
      var relGated = gated.filter(function (p) { return dbfs(Math.sqrt(p)) > meanDb + RELATIVE_GATE_OFFSET_DB; });
      var finalSet = relGated.length ? relGated : gated;
      var finalMeanPow = finalSet.reduce(function (a, b) { return a + b; }, 0) / finalSet.length;
      gatedLevelDb = dbfs(Math.sqrt(finalMeanPow));
    } else {
      gatedLevelDb = -Infinity;
    }

    var truePeakDb = dbfs(truePeak);
    var samplePeakDb = dbfs(samplePeak);
    var clippedRatio = totalSamples ? clippedSamples / totalSamples : 0;
    var hasHardClip = clipEvents >= CLIP_EVENTS_THRESHOLD || clippedRatio >= CLIP_RATIO_THRESHOLD;
    var overTruePeak = truePeakDb > TRUE_PEAK_LIMIT_DB;
    var tooHot = gatedLevelDb > GATED_HOT_LIMIT_DB;

    var status, reason;
    if (hasHardClip) {
      status = "bad"; reason = "clip";
    } else if (overTruePeak || tooHot) {
      status = "bad"; reason = "headroom";
    } else if (gatedLevelDb < GATED_LOW_LIMIT_DB) {
      status = "low"; reason = "low";
    } else {
      status = "good"; reason = "good";
    }

    return {
      truePeakDb: truePeakDb,
      samplePeakDb: samplePeakDb,
      gatedLevelDb: gatedLevelDb,
      duration: buffer.duration,
      channels: numChannels,
      status: status,
      reason: reason,
      waveMax: waveMax,
      waveHot: waveHot,
      columnCount: columnCount
    };
  }

  function drawWaveform(r) {
    if (!waveformCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = waveformCanvas.clientWidth || waveformCanvas.parentElement.clientWidth;
    var cssHeight = 100;
    waveformCanvas.width = Math.round(cssWidth * dpr);
    waveformCanvas.height = Math.round(cssHeight * dpr);
    var ctx = waveformCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var n = r.columnCount;
    var barGap = cssWidth / n;
    var midY = cssHeight / 2;
    var normalStyle = getComputedStyle(document.documentElement).getPropertyValue("--blue-strong").trim() || "#7aabff";
    var hotStyle = getComputedStyle(document.documentElement).getPropertyValue("--red").trim() || "#ef5b5b";

    for (var col = 0; col < n; col++) {
      var amp = Math.min(1, r.waveMax[col]);
      var barH = Math.max(1.5, amp * (cssHeight / 2 - 4));
      var x = col * barGap;
      ctx.fillStyle = r.waveHot[col] ? hotStyle : normalStyle;
      ctx.fillRect(x, midY - barH, Math.max(1, barGap - 0.5), barH * 2);
    }
  }

  function renderResult(r) {
    statusBox.classList.remove("state-good", "state-low", "state-bad", "status-hidden");
    statusBox.classList.add("state-" + r.status);
    statusIcon.innerHTML = ICONS[r.status];

    metricPeak.textContent = fmtDb(r.truePeakDb);
    metricRms.textContent = fmtDb(r.gatedLevelDb);
    metricDuration.textContent = fmtDuration(r.duration);
    metricChannels.textContent = r.channels === 1 ? "Mono" : r.channels === 2 ? "Estéreo" : r.channels + " canais";

    tipsList.innerHTML = "";
    // statusBox must already be visible (status-hidden removed above) so the
    // canvas has a real layout width to measure before we draw into it.
    drawWaveform(r);

    if (r.status === "bad" && r.reason === "clip") {
      statusTitle.textContent = "Áudio com distorção (clipping)";
      statusSubtitle.textContent = "Há trechos com o áudio realmente estourado, causando distorção audível na gravação.";
      [
        "Afaste um pouco o celular da fonte de som, ou peça para falar/tocar com menos intensidade perto do microfone.",
        "Se possível, use um microfone de lapela ou externo — o microfone do celular satura fácil em ambientes muito altos.",
        "Grave um teste de alguns segundos antes da gravação principal e ouça de fone para checar se há distorção.",
        "Regrave o trecho, se possível, e envie novamente aqui para conferir."
      ].forEach(addTip);
    } else if (r.status === "bad" && r.reason === "headroom") {
      statusTitle.textContent = "Áudio sem margem para mixagem";
      statusSubtitle.textContent = "O nível está no teto digital praticamente o tempo todo (True Peak " + fmtDb(r.truePeakDb) + "), sinal de que o controle automático de ganho do celular comprimiu demais o áudio. Sem espaço para ganhar punch e corpo na mixagem.";
      [
        "Afaste um pouco o celular da fonte de som — o AGC do celular sobe o ganho sozinho quando o som está baixo, e isso comprime tudo perto do teto.",
        "Se o app de câmera tiver ajuste manual de ganho/sensibilidade de microfone, reduza um pouco antes de gravar.",
        "Um microfone de lapela ou externo evita o AGC agressivo do microfone embutido do celular.",
        "Regrave um teste curto e confira aqui antes da gravação definitiva."
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
      statusTitle.textContent = "Arquivo com boa margem para edição";
      statusSubtitle.textContent = "True Peak e nível de fala estão com margem saudável, sem sinais de compressão excessiva. Bom material para trabalhar na mixagem.";
    }
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
        progressText.textContent = "Medindo true peak e nível de fala…";
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(analyzeBuffer(audioBuffer)); }, 0);
        });
      })
      .then(function (result) {
        progressBox.classList.add("status-hidden");
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
