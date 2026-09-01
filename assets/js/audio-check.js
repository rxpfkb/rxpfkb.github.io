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
  var metricsCaption = document.getElementById("metricsCaption");
  var tipsList = document.getElementById("tipsList");
  var resetBtn = document.getElementById("resetBtn");
  var waveformCanvas = document.getElementById("waveformCanvas");
  var waveformHolder = document.getElementById("waveformHolder");
  var waveformPlayhead = document.getElementById("waveformPlayhead");
  var playBtn = document.getElementById("playBtn");
  var playIcon = document.getElementById("playIcon");
  var pauseIcon = document.getElementById("pauseIcon");
  var playerTime = document.getElementById("playerTime");

  var tabBtnCheck = document.getElementById("tabBtnCheck");
  var tabBtnCalibrate = document.getElementById("tabBtnCalibrate");
  var panelCheck = document.getElementById("panelCheck");
  var panelCalibrate = document.getElementById("panelCalibrate");

  var meterFill = document.getElementById("meterFill");
  var meterPeakHold = document.getElementById("meterPeakHold");
  var meterStatus = document.getElementById("meterStatus");
  var meterDb = document.getElementById("meterDb");
  var micStartBtn = document.getElementById("micStartBtn");
  var micStopBtn = document.getElementById("micStopBtn");
  var micErrorBox = document.getElementById("micErrorBox");
  var micWaveformCanvas = document.getElementById("micWaveformCanvas");
  var micResultBox = document.getElementById("micResultBox");
  var micResultWaveformCanvas = document.getElementById("micResultWaveformCanvas");
  var micResultWaveformHolder = document.getElementById("micResultWaveformHolder");
  var micResultPlayhead = document.getElementById("micResultPlayhead");
  var micResultPlayBtn = document.getElementById("micResultPlayBtn");
  var micResultPlayIcon = document.getElementById("micResultPlayIcon");
  var micResultPauseIcon = document.getElementById("micResultPauseIcon");
  var micResultPlayerTime = document.getElementById("micResultPlayerTime");
  var micResultPeak = document.getElementById("micResultPeak");
  var micResultRms = document.getElementById("micResultRms");
  var micResultStatusIcon = document.getElementById("micResultStatusIcon");
  var micResultStatusTitle = document.getElementById("micResultStatusTitle");
  var micResultStatusSubtitle = document.getElementById("micResultStatusSubtitle");
  var micResultTipsList = document.getElementById("micResultTipsList");

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
      columnCount: columnCount,
      audioBuffer: buffer
    };
  }

  function drawWaveformTo(canvas, waveMax, waveHot, columnCount) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
    var cssHeight = 100;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var n = columnCount;
    var barGap = cssWidth / n;
    var midY = cssHeight / 2;
    var normalStyle = getComputedStyle(document.documentElement).getPropertyValue("--blue-strong").trim() || "#7aabff";
    var hotStyle = getComputedStyle(document.documentElement).getPropertyValue("--red").trim() || "#ef5b5b";

    for (var col = 0; col < n; col++) {
      var amp = Math.min(1, waveMax[col]);
      var barH = Math.max(1.5, amp * (cssHeight / 2 - 4));
      var x = col * barGap;
      ctx.fillStyle = waveHot[col] ? hotStyle : normalStyle;
      ctx.fillRect(x, midY - barH, Math.max(1, barGap - 0.5), barH * 2);
    }
  }

  function drawWaveform(r) {
    drawWaveformTo(waveformCanvas, r.waveMax, r.waveHot, r.columnCount);
  }

  // ===== Playback (play/pause/seek over an already-decoded buffer) =====
  // Factory so the file-check result and the live-calibration test recording
  // can each have their own independent transport over the same waveform UI.
  function fmtClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function createPlayer(els) {
    var state = {
      buffer: null,
      sourceNode: null,
      isPlaying: false,
      startedAt: 0, // ctx.currentTime when playback began, minus offset already played
      pausedAt: 0, // seconds into the buffer to resume from
      rafId: null,
      manualStop: false
    };

    function setIcons(playing) {
      els.playIcon.style.display = playing ? "none" : "";
      els.pauseIcon.style.display = playing ? "" : "none";
    }

    function setup(buffer) {
      stop();
      state.buffer = buffer;
      state.pausedAt = 0;
      els.timeText.textContent = "0:00 / " + fmtClock(buffer.duration);
      els.playhead.style.opacity = "0";
    }

    function currentTime() {
      if (!state.buffer) return 0;
      if (state.isPlaying) {
        var ctx = getAudioContext();
        return Math.min(ctx.currentTime - state.startedAt, state.buffer.duration);
      }
      return state.pausedAt;
    }

    function updatePlayhead() {
      var t = currentTime();
      var ratio = state.buffer ? t / state.buffer.duration : 0;
      els.playhead.style.left = (ratio * 100) + "%";
      els.playhead.style.opacity = "1";
      els.timeText.textContent = fmtClock(t) + " / " + fmtClock(state.buffer ? state.buffer.duration : 0);
      if (state.isPlaying) {
        if (t >= state.buffer.duration - 0.02) {
          stop();
          state.pausedAt = 0;
          updatePlayhead();
          return;
        }
        state.rafId = requestAnimationFrame(updatePlayhead);
      }
    }

    function start(fromTime) {
      if (!state.buffer) return;
      var ctx = getAudioContext();
      var node = ctx.createBufferSource();
      node.buffer = state.buffer;
      node.connect(ctx.destination);
      state.manualStop = false;
      node.onended = function () {
        if (state.manualStop) return;
        state.isPlaying = false;
        setIcons(false);
      };
      node.start(0, fromTime);
      state.sourceNode = node;
      state.startedAt = ctx.currentTime - fromTime;
      state.isPlaying = true;
      setIcons(true);
      updatePlayhead();
    }

    function stop() {
      if (state.sourceNode) {
        state.manualStop = true;
        try { state.sourceNode.stop(); } catch (e) { /* already stopped */ }
        state.sourceNode = null;
      }
      if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
      state.isPlaying = false;
      setIcons(false);
    }

    function toggle() {
      if (!state.buffer) return;
      if (state.isPlaying) {
        state.pausedAt = currentTime();
        stop();
      } else {
        var from = state.pausedAt >= state.buffer.duration ? 0 : state.pausedAt;
        start(from);
      }
    }

    function seek(ratio) {
      if (!state.buffer) return;
      var time = Math.max(0, Math.min(1, ratio)) * state.buffer.duration;
      if (state.isPlaying) {
        stop();
        start(time);
      } else {
        state.pausedAt = time;
        updatePlayhead();
      }
    }

    function seekFromEvent(e) {
      var rect = els.holder.getBoundingClientRect();
      var clientX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
      seek((clientX - rect.left) / rect.width);
    }

    els.playBtn.addEventListener("click", toggle);
    els.holder.addEventListener("click", seekFromEvent);

    return { setup: setup, stop: stop };
  }

  var filePlayer = createPlayer({
    holder: waveformHolder,
    playhead: waveformPlayhead,
    playBtn: playBtn,
    playIcon: playIcon,
    pauseIcon: pauseIcon,
    timeText: playerTime
  });

  var micResultPlayer = createPlayer({
    holder: micResultWaveformHolder,
    playhead: micResultPlayhead,
    playBtn: micResultPlayBtn,
    playIcon: micResultPlayIcon,
    pauseIcon: micResultPauseIcon,
    timeText: micResultPlayerTime
  });

  // Shared verdict/tips builder — used for both an uploaded file and a live
  // calibration test recording, so both get the same "smart" evaluation
  // instead of the test recording only showing raw numbers.
  function describeResult(r) {
    if (r.status === "bad" && r.reason === "clip") {
      return {
        title: "Áudio com distorção (clipping)",
        subtitle: "Há trechos com o áudio realmente estourado, causando distorção audível na gravação.",
        tips: [
          "Afaste um pouco o celular da fonte de som, ou peça para falar/tocar com menos intensidade perto do microfone.",
          "Se possível, use um microfone de lapela ou externo — o microfone do celular satura fácil em ambientes muito altos.",
          "Grave um teste de alguns segundos antes da gravação principal e ouça de fone para checar se há distorção.",
          "Regrave o trecho, se possível, e envie novamente aqui para conferir."
        ]
      };
    }
    if (r.status === "bad" && r.reason === "headroom") {
      return {
        title: "Áudio sem margem para mixagem",
        subtitle: "O nível está no teto digital praticamente o tempo todo (True Peak " + fmtDb(r.truePeakDb) + "), sinal de que o controle automático de ganho do celular comprimiu demais o áudio. Sem espaço para ganhar punch e corpo na mixagem.",
        tips: [
          "Afaste um pouco o celular da fonte de som — o AGC do celular sobe o ganho sozinho quando o som está baixo, e isso comprime tudo perto do teto.",
          "Se o app de câmera tiver ajuste manual de ganho/sensibilidade de microfone, reduza um pouco antes de gravar.",
          "Um microfone de lapela ou externo evita o AGC agressivo do microfone embutido do celular.",
          "Regrave um teste curto e confira aqui antes da gravação definitiva."
        ]
      };
    }
    if (r.status === "low") {
      return {
        title: "Volume de áudio muito baixo",
        subtitle: "O áudio está com nível muito baixo, o que pode gerar ruído de fundo ao ser realçado na edição.",
        tips: [
          "Aproxime-se mais da fonte de som ao gravar.",
          "Evite gravar em ambientes muito silenciosos ou com o celular muito distante de quem está falando.",
          "Se o app de câmera permitir, verifique se a sensibilidade do microfone não está reduzida."
        ]
      };
    }
    return {
      title: "Áudio com boa margem para edição",
      subtitle: "True Peak e nível de fala estão com margem saudável, sem sinais de compressão excessiva. Bom material para trabalhar na mixagem.",
      tips: []
    };
  }

  function fillTips(list, tips) {
    list.innerHTML = "";
    tips.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function renderResult(r) {
    statusBox.classList.remove("state-good", "state-low", "state-bad", "status-hidden");
    statusBox.classList.add("state-" + r.status);
    statusIcon.innerHTML = ICONS[r.status];

    metricPeak.textContent = fmtDb(r.truePeakDb);
    metricRms.textContent = fmtDb(r.gatedLevelDb);
    var channelsLabel = r.channels === 1 ? "Mono" : r.channels === 2 ? "Estéreo" : r.channels + " canais";
    metricsCaption.textContent = fmtDuration(r.duration) + " · " + channelsLabel;

    // statusBox must already be visible (status-hidden removed above) so the
    // canvas has a real layout width to measure before we draw into it.
    drawWaveform(r);
    filePlayer.setup(r.audioBuffer);

    var msg = describeResult(r);
    statusTitle.textContent = msg.title;
    statusSubtitle.textContent = msg.subtitle;
    fillTips(tipsList, msg.tips);
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
    filePlayer.stop();
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
    requestAnimationFrame(function () {
      progressBox.scrollIntoView({ behavior: "smooth", block: "center" });
    });

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
        requestAnimationFrame(function () {
          statusBox.scrollIntoView({ behavior: "smooth", block: "start" });
        });
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
    filePlayer.stop();
    fileInput.value = "";
    resetUI();
  });

  // ===== Tabs =====
  function setActiveTab(which) {
    var checking = which === "check";
    tabBtnCheck.classList.toggle("active", checking);
    tabBtnCalibrate.classList.toggle("active", !checking);
    tabBtnCheck.setAttribute("aria-selected", String(checking));
    tabBtnCalibrate.setAttribute("aria-selected", String(!checking));
    panelCheck.classList.toggle("status-hidden", !checking);
    panelCalibrate.classList.toggle("status-hidden", checking);
    if (checking) stopMicCalibration();
  }
  tabBtnCheck.addEventListener("click", function () { setActiveTab("check"); });
  tabBtnCalibrate.addEventListener("click", function () { setActiveTab("calibrate"); });

  // ===== Live microphone calibrator =====
  // Real-time feedback only (no recording, nothing stored/sent) — a fast peak
  // meter with a slow-decaying peak-hold marker, in the same spirit as a
  // hardware PPM meter, so the user can see transient peaks they'd otherwise
  // miss and adjust mic distance/gain before hitting record for real.
  var MIC_LOW_MAX_DB = -12; // top of the green zone
  var MIC_HOT_MAX_DB = -3; // top of the yellow zone, red above this
  var MIC_METER_FLOOR_DB = -50;
  var mic = {
    stream: null,
    ctx: null,
    analyser: null,
    data: null,
    rafId: null,
    peakHoldDb: MIC_METER_FLOOR_DB,
    peakHoldTime: 0,
    running: false,
    processor: null,
    silentGain: null,
    recChunks: [],
    recSamples: 0,
    recSampleRate: 48000
  };
  var micDeviceSelect = document.getElementById("micDeviceSelect");

  // Test-recording capture: the live meter alone doesn't let the user hear
  // back what was just captured. A ScriptProcessorNode taps the raw PCM into
  // an in-memory buffer (never written to disk, never sent anywhere, gone on
  // "Parar" or a new session) so the same waveform+player+analysis used for
  // uploaded files can play back this test too. Routed through a silent gain
  // node rather than straight to destination to avoid feeding the mic back
  // out the speakers (howling feedback), while keeping the graph "live" so
  // onaudioprocess actually fires.
  var MIC_REC_MAX_SECONDS = 60;
  var MIC_REC_MIN_SECONDS = 0.5;

  // Live reference waveform: a scrolling strip (like a hardware input monitor)
  // rather than an instantaneous oscilloscope trace, so the user can see the
  // actual shape of a few recent seconds — including brief peaks the eye
  // would miss in a single 40ms snapshot — while they adjust mic position.
  var MIC_WAVE_COLUMNS = 150;
  var MIC_WAVE_PUSH_MS = 80; // ~12s of visible history at 150 columns
  var micWaveAmps = new Float32Array(MIC_WAVE_COLUMNS);
  var micWaveHot = new Uint8Array(MIC_WAVE_COLUMNS);
  var micWaveLastPush = 0;
  var micWaveThresholdLin = Math.pow(10, MIC_HOT_MAX_DB / 20);

  function resetMicWaveform() {
    micWaveAmps.fill(0);
    micWaveHot.fill(0);
    micWaveLastPush = 0;
    drawMicWaveform();
  }

  function pushMicWaveColumn(peakLinear) {
    micWaveAmps.copyWithin(0, 1);
    micWaveHot.copyWithin(0, 1);
    micWaveAmps[MIC_WAVE_COLUMNS - 1] = peakLinear;
    micWaveHot[MIC_WAVE_COLUMNS - 1] = peakLinear >= micWaveThresholdLin ? 1 : 0;
  }

  function drawMicWaveform() {
    if (!micWaveformCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = micWaveformCanvas.clientWidth || micWaveformCanvas.parentElement.clientWidth;
    var cssHeight = 90;
    micWaveformCanvas.width = Math.round(cssWidth * dpr);
    micWaveformCanvas.height = Math.round(cssHeight * dpr);
    var ctx = micWaveformCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var normalStyle = getComputedStyle(document.documentElement).getPropertyValue("--blue-strong").trim() || "#7aabff";
    var hotStyle = getComputedStyle(document.documentElement).getPropertyValue("--red").trim() || "#ef5b5b";
    var midY = cssHeight / 2;
    var colWidth = cssWidth / MIC_WAVE_COLUMNS;

    for (var col = 0; col < MIC_WAVE_COLUMNS; col++) {
      var amp = Math.min(1, micWaveAmps[col]);
      var barH = Math.max(1, amp * (cssHeight / 2 - 4));
      ctx.fillStyle = micWaveHot[col] ? hotStyle : normalStyle;
      ctx.fillRect(col * colWidth, midY - barH, Math.max(1, colWidth - 0.5), barH * 2);
    }
  }

  function refreshMicDeviceList(selectDeviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var inputs = devices.filter(function (d) { return d.kind === "audioinput"; });
      if (!inputs.length) return;
      micDeviceSelect.innerHTML = "";
      inputs.forEach(function (d, i) {
        var opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || ("Microfone " + (i + 1));
        micDeviceSelect.appendChild(opt);
      });
      if (selectDeviceId) micDeviceSelect.value = selectDeviceId;
    }).catch(function () { /* enumeration is best-effort */ });
  }

  function dbToMeterPct(db) {
    var clamped = Math.max(MIC_METER_FLOOR_DB, Math.min(0, db));
    return ((clamped - MIC_METER_FLOOR_DB) / (0 - MIC_METER_FLOOR_DB)) * 100;
  }

  function micMeterLoop() {
    mic.analyser.getFloatTimeDomainData(mic.data);
    var peak = 0;
    for (var i = 0; i < mic.data.length; i++) {
      var av = Math.abs(mic.data[i]);
      if (av > peak) peak = av;
    }
    var db = dbfs(peak);
    var now = performance.now();
    if (db >= mic.peakHoldDb) {
      mic.peakHoldDb = db;
      mic.peakHoldTime = now;
    } else if (now - mic.peakHoldTime > 800) {
      mic.peakHoldDb = Math.max(MIC_METER_FLOOR_DB, mic.peakHoldDb - 0.6);
    }

    meterFill.style.width = dbToMeterPct(db) + "%";
    meterPeakHold.style.left = dbToMeterPct(mic.peakHoldDb) + "%";
    meterPeakHold.style.opacity = "1";
    meterDb.textContent = db <= MIC_METER_FLOOR_DB ? "—" : fmtDb(db);

    if (mic.peakHoldDb > MIC_HOT_MAX_DB) {
      meterStatus.textContent = "Estourando — afaste o microfone";
      meterStatus.style.color = "var(--red)";
    } else if (mic.peakHoldDb > MIC_LOW_MAX_DB) {
      meterStatus.textContent = "No limite — cuidado";
      meterStatus.style.color = "var(--amber)";
    } else if (db > MIC_METER_FLOOR_DB + 5) {
      meterStatus.textContent = "Bom nível";
      meterStatus.style.color = "var(--green)";
    } else {
      meterStatus.textContent = "Ouvindo…";
      meterStatus.style.color = "";
    }

    if (now - micWaveLastPush >= MIC_WAVE_PUSH_MS) {
      pushMicWaveColumn(peak);
      micWaveLastPush = now;
    }
    drawMicWaveform();

    mic.rafId = requestAnimationFrame(micMeterLoop);
  }

  function openMicStream(deviceId) {
    micErrorBox.classList.add("status-hidden");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micErrorBox.textContent = "Seu navegador não suporta acesso ao microfone.";
      micErrorBox.classList.remove("status-hidden");
      return;
    }
    var audioConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };

    // Close the previous stream/track before opening a new one so switching
    // devices doesn't leave the old microphone's LED/indicator stuck on.
    if (mic.stream) mic.stream.getTracks().forEach(function (t) { t.stop(); });
    if (mic.rafId) { cancelAnimationFrame(mic.rafId); mic.rafId = null; }
    if (mic.processor) { mic.processor.disconnect(); mic.processor.onaudioprocess = null; mic.processor = null; }
    if (mic.silentGain) { mic.silentGain.disconnect(); mic.silentGain = null; }

    navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      .then(function (stream) {
        mic.stream = stream;
        mic.ctx = getAudioContext();
        var source = mic.ctx.createMediaStreamSource(stream);
        mic.analyser = mic.ctx.createAnalyser();
        mic.analyser.fftSize = 2048;
        mic.data = new Float32Array(mic.analyser.fftSize);
        source.connect(mic.analyser);
        mic.peakHoldDb = MIC_METER_FLOOR_DB;
        mic.running = true;
        window.__appBusy = true; // defer any pending SW-update reload until monitoring stops
        resetMicWaveform();
        micResultBox.classList.add("status-hidden");
        micResultPlayer.stop();
        micStartBtn.classList.add("status-hidden");
        micStopBtn.classList.remove("status-hidden");
        micMeterLoop();

        mic.recChunks = [];
        mic.recSamples = 0;
        mic.recSampleRate = mic.ctx.sampleRate;
        var processor = mic.ctx.createScriptProcessor(4096, 1, 1);
        var silentGain = mic.ctx.createGain();
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(mic.ctx.destination);
        var recCap = MIC_REC_MAX_SECONDS * mic.recSampleRate;
        processor.onaudioprocess = function (e) {
          if (mic.recSamples >= recCap) return;
          mic.recChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
          mic.recSamples += e.inputBuffer.getChannelData(0).length;
        };
        mic.processor = processor;
        mic.silentGain = silentGain;

        var actualId = stream.getAudioTracks()[0] && stream.getAudioTracks()[0].getSettings().deviceId;
        refreshMicDeviceList(actualId || deviceId);
      })
      .catch(function (err) {
        mic.running = false;
        window.__appBusy = false;
        micErrorBox.textContent = "Não foi possível acessar o microfone. Verifique se você deu permissão ao navegador. Detalhe: " + (err && err.message ? err.message : err);
        micErrorBox.classList.remove("status-hidden");
      });
  }

  function startMicCalibration() {
    openMicStream(micDeviceSelect.value || undefined);
  }

  function buildRecordedBuffer() {
    if (mic.recSamples < mic.recSampleRate * MIC_REC_MIN_SECONDS) return null;
    var ctx = getAudioContext();
    var buffer = ctx.createBuffer(1, mic.recSamples, mic.recSampleRate);
    var channelData = buffer.getChannelData(0);
    var offset = 0;
    mic.recChunks.forEach(function (chunk) {
      channelData.set(chunk, offset);
      offset += chunk.length;
    });
    return buffer;
  }

  function renderMicResult(r) {
    micResultBox.classList.remove("state-good", "state-low", "state-bad", "status-hidden");
    micResultBox.classList.add("state-" + r.status);
    micResultStatusIcon.innerHTML = ICONS[r.status];
    micResultPeak.textContent = fmtDb(r.truePeakDb);
    micResultRms.textContent = fmtDb(r.gatedLevelDb);
    // micResultBox must already be visible (status-hidden removed above) so
    // the canvas has a real layout width to measure before we draw into it.
    drawWaveformTo(micResultWaveformCanvas, r.waveMax, r.waveHot, r.columnCount);
    micResultPlayer.setup(r.audioBuffer);

    var msg = describeResult(r);
    micResultStatusTitle.textContent = msg.title;
    micResultStatusSubtitle.textContent = msg.subtitle;
    fillTips(micResultTipsList, msg.tips);
  }

  function stopMicCalibration() {
    mic.running = false;
    window.__appBusy = false;
    if (mic.rafId) { cancelAnimationFrame(mic.rafId); mic.rafId = null; }
    if (mic.processor) { mic.processor.disconnect(); mic.processor.onaudioprocess = null; mic.processor = null; }
    if (mic.silentGain) { mic.silentGain.disconnect(); mic.silentGain = null; }
    if (mic.stream) {
      mic.stream.getTracks().forEach(function (t) { t.stop(); });
      mic.stream = null;
    }
    meterFill.style.width = "0%";
    meterPeakHold.style.opacity = "0";
    meterDb.textContent = "—";
    meterStatus.textContent = "Parado";
    meterStatus.style.color = "";
    resetMicWaveform();
    micStartBtn.classList.remove("status-hidden");
    micStopBtn.classList.add("status-hidden");

    var recordedBuffer = buildRecordedBuffer();
    mic.recChunks = [];
    mic.recSamples = 0;
    if (recordedBuffer) renderMicResult(analyzeBuffer(recordedBuffer));
  }

  micStartBtn.addEventListener("click", startMicCalibration);
  micStopBtn.addEventListener("click", stopMicCalibration);
  micDeviceSelect.addEventListener("change", function () {
    if (mic.running) openMicStream(micDeviceSelect.value || undefined);
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", function () {
      refreshMicDeviceList(micDeviceSelect.value);
    });
  }
  window.addEventListener("pagehide", stopMicCalibration);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopMicCalibration();
  });

  // Browsers only reveal real device names/count via enumerateDevices()
  // after mic permission has been granted at least once — before that they
  // report a single anonymous entry, no matter when it's called. So to show
  // the full device list right away instead of only after "Iniciar", prime
  // permission on load: request the mic just long enough to read the
  // device list, then release it immediately without starting the meter.
  function primeMicDeviceList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        refreshMicDeviceList();
      })
      .catch(function () {
        // Denied or dismissed — leave the generic option; "Iniciar
        // monitoramento" will prompt again if the user wants to retry.
      });
  }
  primeMicDeviceList();
})();
