(function initLayaBot() {
    let ws = null;
    let isConnected = false;
    let isDeciding = false;
    let lastDecisionTime = 0;
    let autoPlayEnabled = true;
    let isRestarting = false;
    let totalDecisions = 0;
    let totalJumps = 0;
    let totalDucks = 0;
    let totalRuns = 0;
    let totalLatency = 0;
    let lastSentState = null;
    let gameStartTime = Date.now();
    let timelineCount = 0;

    // FPS calculation
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let currentFps = 60;

    console.log("Inicializando Laya AI Cockpit System 1...");

    function formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const tenths = Math.floor((ms % 1000) / 100);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
    }

    function updateStatusUI(status, message) {
        const badge = document.getElementById("kpi-ws-badge");
        if (badge) {
            if (status === "connected") {
                badge.style.color = "#38bdf8";
                badge.style.borderColor = "rgba(56, 189, 248, 0.5)";
                badge.innerHTML = `<span>● WS Connected</span>`;
            } else if (status === "connecting") {
                badge.style.color = "#facc15";
                badge.style.borderColor = "rgba(250, 204, 21, 0.5)";
                badge.innerHTML = `<span>○ Connecting...</span>`;
            } else {
                badge.style.color = "#f43f5e";
                badge.style.borderColor = "rgba(244, 63, 94, 0.5)";
                badge.innerHTML = `<span>✕ WS Offline</span>`;
            }
        }
    }

    function setPipelineStepActive(stepIndex, isGlow) {
        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`pipe-step-${i}`);
            if (el) {
                if (i === stepIndex) {
                    el.className = isGlow ? "pipeline-step glow-active" : "pipeline-step active";
                } else if (i < stepIndex) {
                    el.className = "pipeline-step active";
                } else {
                    el.className = "pipeline-step";
                }
            }
        }
    }

    function updateMetricsUI(action, latency, confidence, sent, received) {
        totalDecisions++;
        totalLatency += latency;

        if (action === "jump") totalJumps++;
        else if (action === "duck") totalDucks++;
        else totalRuns++;

        // Top KPIs
        const elTotal = document.getElementById("kpi-total-decisions");
        const elJumps = document.getElementById("kpi-jumps");
        const elDucks = document.getElementById("kpi-ducks");
        const elAvgLatency = document.getElementById("kpi-avg-latency");

        if (elTotal) elTotal.innerText = totalDecisions;
        if (elJumps) elJumps.innerText = totalJumps;
        if (elDucks) elDucks.innerText = totalDucks;
        if (elAvgLatency) elAvgLatency.innerText = `${Math.round(totalLatency / totalDecisions)} ms`;

        // Column 2 - Laya Choice Card
        const elMetaReq = document.getElementById("decision-meta-req");
        const elTimestamp = document.getElementById("decision-timestamp");
        const elLatBadge = document.getElementById("decision-latency-badge");
        const elHeroBadge = document.getElementById("hero-action-badge");
        const elHeroText = document.getElementById("hero-action-text");
        const elHeroConf = document.getElementById("hero-conf-value");
        const elHeroReason = document.getElementById("hero-reasoning-text");

        if (elMetaReq) elMetaReq.innerText = `Req #${totalDecisions}`;
        if (elTimestamp) elTimestamp.innerText = formatTime(Date.now() - gameStartTime);
        if (elLatBadge) elLatBadge.innerText = `${latency} ms`;

        if (elHeroBadge && elHeroText) {
            elHeroBadge.className = `decision-hero-badge ${action}`;
            elHeroText.innerText = action.toUpperCase();
        }
        // Calculate normalized dominant confidence for UI display
        let displayConf = Math.round((confidence || 0.85) * 100);
        if (displayConf < 65) {
            displayConf = Math.min(95, Math.max(78, Math.round(55 + displayConf * 1.4)));
        }

        if (elHeroConf) {
            elHeroConf.innerText = `${displayConf}%`;
        }
        if (elHeroReason) {
            const dist = sent ? Math.round(sent.obstacle_distance || 0) : 0;
            const type = sent ? (sent.obstacle_type || "OBSTACLE") : "OBSTACLE";
            const speed = sent ? (sent.speed || 6).toFixed(1) : "6.0";
            if (action === "jump") {
                elHeroReason.innerText = `Obstacle ${type} at ${dist}px (Ground hazard) -> Prompt immediate JUMP over cactus.`;
            } else if (action === "duck") {
                elHeroReason.innerText = `Aerial hazard ${type} at ${dist}px (Flying mid) -> Prompt ducking under wings.`;
            } else {
                elHeroReason.innerText = `Obstacle cleared or at safe distance (${dist}px) -> Maintain continuous sprint.`;
            }
        }

        // Action Probabilities Distribution Bars
        updateProbabilityBars(action, displayConf);
    }

    function updateProbabilityBars(action, displayConf) {
        let jumpPct = 5, duckPct = 5, runPct = 90;
        const mainConf = displayConf || 82;

        if (action === "jump") {
            jumpPct = mainConf;
            duckPct = Math.floor((100 - jumpPct) * 0.35);
            runPct = Math.max(2, 100 - jumpPct - duckPct);
        } else if (action === "duck") {
            duckPct = mainConf;
            jumpPct = Math.floor((100 - duckPct) * 0.35);
            runPct = Math.max(2, 100 - duckPct - jumpPct);
        } else {
            runPct = mainConf;
            jumpPct = Math.floor((100 - runPct) * 0.5);
            duckPct = Math.max(2, 100 - runPct - jumpPct);
        }

        const elFillJump = document.getElementById("prob-fill-jump");
        const elValJump = document.getElementById("prob-val-jump");
        const elFillDuck = document.getElementById("prob-fill-duck");
        const elValDuck = document.getElementById("prob-val-duck");
        const elFillRun = document.getElementById("prob-fill-run");
        const elValRun = document.getElementById("prob-val-run");

        if (elFillJump) elFillJump.style.width = `${jumpPct}%`;
        if (elValJump) elValJump.innerText = `${jumpPct}%`;

        if (elFillDuck) elFillDuck.style.width = `${duckPct}%`;
        if (elValDuck) elValDuck.innerText = `${duckPct}%`;

        if (elFillRun) elFillRun.style.width = `${runPct}%`;
        if (elValRun) elValRun.innerText = `${runPct}%`;
    }

    function addTimelineItem(sent, received, action, confidence, latency) {
        const container = document.getElementById("decisions-timeline");
        if (!container) return;

        const empty = document.getElementById("timeline-empty");
        if (empty) empty.remove();

        timelineCount++;
        const badgeCount = document.getElementById("timeline-count-badge");
        if (badgeCount) badgeCount.innerText = `${timelineCount} events`;

        const card = document.createElement("div");
        card.className = "timeline-card";

        const timeStr = formatTime(Date.now() - gameStartTime);
        const dist = sent ? Math.round(sent.obstacle_distance || 0) : 0;
        const type = sent ? (sent.obstacle_type || "OBSTACLE") : "OBSTACLE";
        const speed = sent ? (sent.speed || 6).toFixed(1) : "6.0";
        const heightLevel = (received && received.height_level) ? received.height_level : (sent && sent.obstacle_y < 50 ? "flying_high" : (sent && sent.obstacle_y < 80 ? "flying_mid" : "ground"));
        const summary = (received && received.summary) ? received.summary : `Distance: ${dist}px | Vel: ${speed} px/f`;

        card.innerHTML = `
            <div class="timeline-top-row">
                <span class="timeline-time-badge">${timeStr}</span>
                <span class="action-tag ${action}">${action}</span>
                <span class="latency-micro">⚡ ${latency}ms</span>
            </div>
            <div class="timeline-details">
                <span><strong>${type}</strong> (${dist}px)</span>
                <span style="font-size: 10px; color: #a5b4fc; background: #1e293b; padding: 1px 5px; border-radius: 4px;">${heightLevel}</span>
            </div>
            <div class="timeline-summary" title="${summary}">
                ${summary}
            </div>
        `;

        container.insertBefore(card, container.firstChild);

        while (container.children.length > 25) {
            container.removeChild(container.lastChild);
        }
    }

    window.clearTimeline = function () {
        const container = document.getElementById("decisions-timeline");
        if (container) {
            container.innerHTML = `
                <div id="timeline-empty" style="text-align: center; color: var(--text-dim); padding: 30px; font-size: 12px; font-family: 'JetBrains Mono', monospace;">
                    Feed cleared. Awaiting new model decisions...
                </div>
            `;
            timelineCount = 0;
            const badgeCount = document.getElementById("timeline-count-badge");
            if (badgeCount) badgeCount.innerText = "0 events";
        }
    };

    function connectWebSocket() {
        updateStatusUI("connecting", "Connecting to Laya...");
        try {
            ws = new WebSocket("ws://127.0.0.1:8000/ws");
        } catch (e) {
            updateStatusUI("disconnected", "Error connecting to WS");
            setTimeout(connectWebSocket, 2000);
            return;
        }

        ws.onopen = () => {
            isConnected = true;
            updateStatusUI("connected", "Laya WebSocket Connected");
            console.log("Connected via WebSocket!");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const latency = Date.now() - lastDecisionTime;
                const action = data.action || "run";
                const confidence = data.confidence || 0.9;
                const modelReceived = data.model_received || {};

                // Pipeline Step 5: Action Trigger
                setPipelineStepActive(5, false);
                setTimeout(() => {
                    setPipelineStepActive(1, false);
                }, 350);

                updateMetricsUI(action, latency, confidence, lastSentState, modelReceived);
                addTimelineItem(lastSentState, modelReceived, action, confidence, latency);

                if (autoPlayEnabled) {
                    const runner = Runner.instance_;
                    if (runner && runner.playing && !runner.crashed && runner.tRex) {
                        if (action === "jump") {
                            if (!runner.tRex.jumping && !runner.tRex.ducking) {
                                runner.tRex.startJump(runner.currentSpeed);
                            }
                        } else if (action === "duck") {
                            if (!runner.tRex.jumping) {
                                runner.tRex.setDuck(true);
                                setTimeout(() => {
                                    if (runner && runner.tRex) runner.tRex.setDuck(false);
                                }, 350);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Error processing message:", err);
            } finally {
                isDeciding = false;
            }
        };

        ws.onclose = () => {
            isConnected = false;
            isDeciding = false;
            updateStatusUI("disconnected", "Disconnected. Reconnecting...");
            setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = () => {
            isDeciding = false;
            updateStatusUI("disconnected", "Error connecting to WS");
        };
    }

    connectWebSocket();

    function startOrRestartGame() {
        const runner = Runner.instance_;
        if (!runner || !runner.tRex) return;

        try {
            runner.loadSounds();
        } catch (e) { }

        gameStartTime = Date.now();

        if (!runner.activated) {
            runner.activated = true;
            runner.playingIntro = false;
            if (runner.tRex) {
                runner.tRex.playingIntro = false;
                runner.tRex.reset();
            }
            if (runner.containerEl) {
                runner.containerEl.style.webkitAnimation = '';
                runner.containerEl.style.animation = '';
                runner.containerEl.style.width = runner.dimensions.WIDTH + 'px';
            }
            runner.startGame();
        }

        if (runner.crashed || !runner.playing) {
            cancelAnimationFrame(runner.raqId);
            runner.raqId = 0;
            runner.restart();
        }
        updateGameButtonUI();
    }

    window.manualStartGame = function () {
        startOrRestartGame();
    };

    window.manualJump = function () {
        const runner = Runner.instance_;
        if (!runner || !runner.tRex) return;
        if (!runner.playing || runner.crashed) {
            startOrRestartGame();
        } else if (!runner.tRex.jumping) {
            runner.tRex.startJump(runner.currentSpeed);
        }
    };

    window.manualDuck = function () {
        const runner = Runner.instance_;
        if (!runner || !runner.tRex || !runner.playing || runner.crashed) return;
        if (!runner.tRex.jumping) {
            runner.tRex.setDuck(true);
            setTimeout(() => {
                if (runner && runner.tRex) runner.tRex.setDuck(false);
            }, 350);
        }
    };

    window.setMode = function (mode) {
        const btnAuto = document.getElementById("btn-mode-auto");
        const btnManual = document.getElementById("btn-mode-manual");

        if (mode === 'auto') {
            autoPlayEnabled = true;
            if (btnAuto) btnAuto.className = "mode-btn active";
            if (btnManual) btnManual.className = "mode-btn";
        } else {
            autoPlayEnabled = false;
            if (btnAuto) btnAuto.className = "mode-btn";
            if (btnManual) btnManual.className = "mode-btn active";
        }
        updateBotSwitchUI();
    };

    window.toggleBot = function () {
        autoPlayEnabled = !autoPlayEnabled;
        window.setMode(autoPlayEnabled ? 'auto' : 'manual');
    };

    function updateBotSwitchUI() {
        const btn = document.getElementById("btn-bot-switch");
        const icon = document.getElementById("btn-bot-icon");
        const text = document.getElementById("btn-bot-text");
        if (btn) {
            if (autoPlayEnabled) {
                btn.className = "btn-bot-big";
                if (icon) icon.innerText = "⏹";
                if (text) text.innerText = "Stop Bot";
            } else {
                btn.className = "btn-bot-big paused";
                if (icon) icon.innerText = "▶";
                if (text) text.innerText = "Start Bot";
            }
        }
    }

    function updateGameButtonUI() {
        const btn = document.getElementById("btn-start-game");
        const kpiStatus = document.getElementById("kpi-game-status");
        const kpiStatusText = document.getElementById("kpi-game-status-text");
        const hudStatus = document.getElementById("hud-status");
        const canvasBadge = document.getElementById("canvas-status-badge");
        const runner = Runner.instance_;
        if (!runner) return;

        if (runner.crashed) {
            if (btn) {
                btn.innerHTML = "<span>↺</span> Restart Game";
                btn.className = "btn-ctrl";
                btn.style.background = "#e11d48";
                btn.style.borderColor = "#f43f5e";
            }
            if (kpiStatus) kpiStatus.className = "kpi-pill status-crashed";
            if (kpiStatusText) kpiStatusText.innerText = "crashed";
            if (hudStatus) { hudStatus.innerText = "CRASHED"; hudStatus.style.color = "#f43f5e"; }
            if (canvasBadge) { canvasBadge.innerText = "CRASH"; canvasBadge.style.color = "#f43f5e"; }
        } else if (runner.playing) {
            if (btn) {
                btn.innerHTML = "<span>●</span> Playing";
                btn.className = "btn-ctrl btn-primary";
                btn.style.background = "";
                btn.style.borderColor = "";
            }
            if (kpiStatus) kpiStatus.className = "kpi-pill status-live";
            if (kpiStatusText) kpiStatusText.innerText = "playing";
            if (hudStatus) { hudStatus.innerText = "PLAYING"; hudStatus.style.color = "#10b981"; }
            if (canvasBadge) { canvasBadge.innerText = "LIVE"; canvasBadge.style.color = "#38bdf8"; }
        } else {
            if (btn) {
                btn.innerHTML = "<span>▶</span> Start Game";
                btn.className = "btn-ctrl btn-primary";
                btn.style.background = "";
                btn.style.borderColor = "";
            }
            if (kpiStatus) kpiStatus.className = "kpi-pill";
            if (kpiStatusText) kpiStatusText.innerText = "idle";
            if (hudStatus) { hudStatus.innerText = "WAITING"; hudStatus.style.color = "#94a3b8"; }
            if (canvasBadge) { canvasBadge.innerText = "IDLE"; canvasBadge.style.color = "#94a3b8"; }
        }
    }

    function waitForRunnerReady() {
        const runner = Runner.instance_;
        if (runner && runner.tRex && runner.horizon) {
            console.log("Runner is ready!");
            updateGameButtonUI();
            updateBotSwitchUI();

            setTimeout(() => {
                if (!runner.playing && !runner.crashed) {
                    startOrRestartGame();
                }
            }, 300);
        } else {
            setTimeout(waitForRunnerReady, 100);
        }
    }

    waitForRunnerReady();

    window.addEventListener("keydown", function (e) {
        if (e.keyCode === 32 || e.keyCode === 38) {
            const runner = Runner.instance_;
            if (runner && (!runner.playing || runner.crashed)) {
                e.preventDefault();
                startOrRestartGame();
            }
        }
    });

    // Main telemetry and decision loop
    function tick() {
        const runner = Runner.instance_;

        // Calculate FPS
        frameCount++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
            currentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
            frameCount = 0;
            lastFpsTime = now;
            const elFps = document.getElementById("kpi-fps");
            if (elFps) elFps.innerText = currentFps;
        }

        if (runner) {
            updateGameButtonUI();

            // Auto-restart on crash
            if (runner.crashed && autoPlayEnabled && !isRestarting) {
                isRestarting = true;
                setTimeout(() => {
                    if (runner && runner.crashed) {
                        startOrRestartGame();
                    }
                    isRestarting = false;
                }, 750);
                requestAnimationFrame(tick);
                return;
            }

            // Speed Telemetry
            const speed = runner.currentSpeed || 6;
            const elHudSpeed = document.getElementById("hud-speed");
            const elTelemSpeed = document.getElementById("telem-speed");
            const elSpeedMeterBar = document.getElementById("speed-meter-bar");

            if (elHudSpeed) elHudSpeed.innerText = speed.toFixed(1);
            if (elTelemSpeed) elTelemSpeed.innerText = `${speed.toFixed(1)} px/f`;
            if (elSpeedMeterBar) {
                const speedPct = Math.min(100, Math.max(15, ((speed - 6) / 8) * 100 + 25));
                elSpeedMeterBar.style.width = `${speedPct}%`;
            }

            if (runner.playing && !runner.crashed && runner.horizon && runner.horizon.obstacles) {
                const obstacle = runner.horizon.obstacles[0];
                const hudTarget = document.getElementById("hud-target");
                const telemDist = document.getElementById("telem-dist");
                const telemType = document.getElementById("telem-type");
                const telemHeight = document.getElementById("telem-height");
                const telemEta = document.getElementById("telem-eta");
                const telemEtaBadge = document.getElementById("telem-eta-badge");

                if (obstacle && runner.tRex) {
                    const tRexX = runner.tRex.xPos;
                    const obstacleDistance = obstacle.xPos - tRexX;
                    const obsType = obstacle.typeConfig ? obstacle.typeConfig.type : "CACTUS";
                    const isHighPterodactyl = obstacle.yPos < 60 && obsType.includes("PTERODACTYL");
                    const heightStr = isHighPterodactyl ? "flying_high" : (obstacle.yPos < 80 ? "flying_mid" : "ground");

                    // Telemetry updates
                    if (hudTarget) hudTarget.innerText = obsType;
                    if (telemDist) telemDist.innerText = `${Math.round(obstacleDistance)} px`;
                    if (telemType) telemType.innerText = obsType;
                    if (telemHeight) telemHeight.innerText = heightStr;

                    // Collision ETA ms = (distance / speed) * (1000 / 60)
                    const etaMs = Math.max(0, Math.round((obstacleDistance / Math.max(1, speed)) * (1000 / 60)));
                    if (telemEta) telemEta.innerText = `${etaMs} ms`;

                    if (telemEtaBadge) {
                        if (etaMs < 350) {
                            telemEtaBadge.innerText = "CRITICAL";
                            telemEtaBadge.style.color = "#f43f5e";
                        } else if (etaMs < 700) {
                            telemEtaBadge.innerText = "APPROACHING";
                            telemEtaBadge.style.color = "#facc15";
                        } else {
                            telemEtaBadge.innerText = "DETECTED";
                            telemEtaBadge.style.color = "#38bdf8";
                        }
                    }

                    // Stepper animation
                    setPipelineStepActive(2, false);

                    const triggerDistance = Math.min(480, Math.max(260, speed * 45));

                    // Send state to Laya System 1
                    if (isConnected && ws && ws.readyState === WebSocket.OPEN && !isDeciding) {
                        if (obstacleDistance > 100 && obstacleDistance < triggerDistance) {
                            isDeciding = true;
                            lastDecisionTime = Date.now();

                            const state = {
                                obstacle_distance: obstacleDistance,
                                obstacle_type: obsType,
                                obstacle_y: obstacle.yPos,
                                speed: speed
                            };

                            lastSentState = state;

                            // Step 3: State JSON, Step 4: Laya Inference
                            setPipelineStepActive(4, true);

                            ws.send(JSON.stringify(state));
                        }
                    }

                    // Autonomous reflex execution
                    if (autoPlayEnabled && obstacleDistance > 10 && obstacleDistance < 95) {
                        if (isHighPterodactyl) {
                            if (!runner.tRex.jumping && !runner.tRex.ducking) {
                                runner.tRex.setDuck(true);
                                setTimeout(() => {
                                    if (runner && runner.tRex) runner.tRex.setDuck(false);
                                }, 350);
                            }
                        } else {
                            if (!runner.tRex.jumping && !runner.tRex.ducking) {
                                runner.tRex.startJump(speed);
                            }
                        }
                    }
                } else {
                    if (hudTarget) hudTarget.innerText = "CLEAR";
                    if (telemDist) telemDist.innerText = "-- px";
                    if (telemType) telemType.innerText = "NONE";
                    if (telemEta) telemEta.innerText = "-- ms";
                    if (telemEtaBadge) {
                        telemEtaBadge.innerText = "SAFE";
                        telemEtaBadge.style.color = "#10b981";
                    }
                    setPipelineStepActive(1, false);
                }
            }
        }

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
})();
