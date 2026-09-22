const API_BASE = "/api";
const matrixContainer = document.getElementById("matrixContainer");
const statusText = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const restartBtn = document.getElementById("restartBtn");

const GAIN_MIN = -80;
const GAIN_MAX = 6;
const AUTO_REFRESH_MIN_INTERVAL = 15000;

let appState = {
  matrix: null,
  connections: null,
  connectionsSnapshot: "",
  lastRefreshAt: 0,
};
let refreshPromise = null;

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { cache: "no-store", ...options });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function readGainAfterWrite(url, expectedGain) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const updated = await fetchJSON(url);
      if (Number.isFinite(updated.gain) && Math.abs(updated.gain - expectedGain) < 0.05) {
        return updated;
      }
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error(`VBMatrix did not confirm ${expectedGain} dB`);
}

function stableSnapshot(value) {
  return JSON.stringify(value ?? {});
}

function formatGain(value) {
  if (value === -Infinity || value === null || value === undefined) return "-∞";
  return Number.isInteger(value) ? `${value}` : `${value.toFixed(1)}`;
}

function gainForControl(value) {
  if (!Number.isFinite(value)) return GAIN_MIN;
  return Math.min(GAIN_MAX, Math.max(GAIN_MIN, value));
}

function setStatus(message) {
  statusText.textContent = message;
}

function updateConnectionData(data, updated) {
  data.connected = updated.connected;
  data.gain = updated.gain;
  data.gains = updated.gains;
  data.mute = updated.mute;
}

function itemClasses(data) {
  return [
    "flex flex-col gap-1 p-2 rounded-md text-sm transition-all duration-200 cursor-pointer",
    data.connected
      ? "bg-emerald-900/20 border border-emerald-500/40"
      : "bg-gray-700/30 border border-gray-600/40 border-dashed hover:bg-blue-600/20",
  ].join(" ");
}

function muteButtonClasses(muted) {
  return [
    "min-w-[2.25rem] min-h-[2.25rem] rounded transition-colors",
    muted ? "bg-red-700 hover:bg-red-800" : "bg-gray-700 hover:bg-gray-600",
  ].join(" ");
}

function renderMatrix(connections) {
  matrixContainer.innerHTML = "";

  Object.entries(connections).forEach(([key, pairs]) => {
    const card = document.createElement("div");
    card.className = "bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-md flex flex-col gap-2 transition-transform duration-200 hover:scale-[1.01]";

    const title = document.createElement("h2");
    title.textContent = key;
    title.className = "text-base font-semibold text-blue-300 mb-1";
    card.appendChild(title);

    const list = document.createElement("div");
    list.className = "matrix-list";

    Object.entries(pairs).forEach(([pair, data]) => {
      const item = document.createElement("div");
      item.className = itemClasses(data);

      const label = document.createElement("div");
      const nameDiv = document.createElement("div");
      nameDiv.className = "font-medium";
      nameDiv.textContent = pair;

      const infoDiv = document.createElement("div");
      infoDiv.className = "text-xs text-gray-400";
      infoDiv.textContent = data.connected
        ? `Gain: ${formatGain(data.gain)} dB`
        : "Not connected (click to enable)";

      label.appendChild(nameDiv);
      label.appendChild(infoDiv);
      item.appendChild(label);

      const [source, target] = pair.split(" → ");
      const [srcSlot, dstSlot] = key.split(" → ");
      const liveUrl = `${API_BASE}/live/${srcSlot}/${dstSlot}?inName=${encodeURIComponent(source)}&outName=${encodeURIComponent(target)}`;

      const controls = document.createElement("div");
      controls.className = "flex flex-wrap items-center gap-2";

      const muteBtn = document.createElement("button");
      muteBtn.className = muteButtonClasses(data.mute);
      muteBtn.textContent = data.mute ? "🔇" : "🔊";
      muteBtn.title = data.mute ? "Unmute" : "Mute";

      const sliderWrapper = document.createElement("div");
      sliderWrapper.className = "flex items-center gap-2";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = GAIN_MIN;
      slider.max = GAIN_MAX;
      slider.step = 1;
      slider.value = gainForControl(data.gain);
      slider.className = "w-28 sm:w-36 accent-blue-500 cursor-pointer touch-none";
      slider.title = "Gain";

      const gainInput = document.createElement("input");
      gainInput.type = "number";
      gainInput.min = GAIN_MIN;
      gainInput.max = GAIN_MAX;
      gainInput.step = 0.1;
      gainInput.inputMode = "decimal";
      gainInput.value = Number.isFinite(data.gain) ? formatGain(data.gain) : "";
      gainInput.placeholder = "-∞";
      gainInput.className = "w-16 rounded bg-gray-950 border border-gray-700 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none";
      gainInput.title = "Gain in dB";

      const dbLabel = document.createElement("span");
      dbLabel.className = "text-xs text-gray-400";
      dbLabel.textContent = "dB";

      function syncControls() {
        item.className = itemClasses(data);
        infoDiv.textContent = data.connected
          ? `Gain: ${formatGain(data.gain)} dB`
          : "Not connected (click to enable)";
        muteBtn.textContent = data.mute ? "🔇" : "🔊";
        muteBtn.title = data.mute ? "Unmute" : "Mute";
        muteBtn.className = muteButtonClasses(data.mute);
        slider.value = gainForControl(data.gain);
        gainInput.value = Number.isFinite(data.gain) ? formatGain(data.gain) : "";
        appState.connectionsSnapshot = stableSnapshot(appState.connections);
      }

      async function applyGain(newGain) {
        slider.disabled = true;
        gainInput.disabled = true;

        try {
          await fetchJSON(`${API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source,
              target,
              action: "gain",
              value: newGain,
            }),
          });

          const updated = await readGainAfterWrite(liveUrl, newGain);
          updateConnectionData(data, updated);
          syncControls();
          setStatus(`✅ Gain set to ${formatGain(data.gain)} dB`);
        } catch (err) {
          console.error(err);
          setStatus("❌ Failed to set gain");
          syncControls();
        } finally {
          slider.disabled = false;
          gainInput.disabled = false;
        }
      }

      item.addEventListener("click", async (e) => {
        if (data.connected || e.target.closest("button,input")) return;

        setStatus("🎚️ Activating connection...");

        try {
          await fetchJSON(`${API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source,
              target,
              action: "gain",
              value: -99,
            }),
          });

          const updated = await fetchJSON(liveUrl);
          updateConnectionData(data, updated);
          syncControls();
          setStatus("✅ Connection activated");
        } catch (err) {
          console.error(err);
          setStatus("❌ Failed to activate connection");
        }
      });

      muteBtn.onclick = async () => {
        muteBtn.disabled = true;
        muteBtn.textContent = "⏳";

        try {
          await fetchJSON(`${API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source,
              target,
              action: "mute",
              value: !data.mute,
            }),
          });

          const updated = await fetchJSON(liveUrl);
          updateConnectionData(data, updated);
          syncControls();
          setStatus(data.mute ? "✅ Muted" : "✅ Unmuted");
        } catch (err) {
          console.error(err);
          setStatus("❌ Failed to toggle mute");
          syncControls();
        } finally {
          muteBtn.disabled = false;
        }
      };

      slider.addEventListener("input", (e) => {
        gainInput.value = e.target.value;
      });

      slider.addEventListener("change", (e) => {
        applyGain(parseFloat(e.target.value));
      });

      gainInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          gainInput.blur();
        }
      });

      gainInput.addEventListener("change", (e) => {
        const value = Number(e.target.value);
        if (!e.target.value.trim() || !Number.isFinite(value) || e.target.validity.badInput) {
          syncControls();
          return;
        }

        const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, value));
        if (Math.abs(clamped * 10 - Math.round(clamped * 10)) > 1e-8) {
          setStatus("❌ Use 0.1 dB steps");
          syncControls();
          return;
        }
        applyGain(Number(clamped.toFixed(1)));
      });

      const resetBtn = document.createElement("button");
      resetBtn.textContent = "♻️";
      resetBtn.className = "min-w-[2.25rem] min-h-[2.25rem] bg-gray-700 hover:bg-gray-600 rounded transition";
      resetBtn.title = "Reset connection";

      resetBtn.onclick = async () => {
        resetBtn.disabled = true;
        resetBtn.textContent = "⏳";

        try {
          await fetchJSON(`${API_BASE}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source,
              target,
              action: "reset",
            }),
          });

          const updated = await fetchJSON(liveUrl);
          updateConnectionData(data, updated);
          syncControls();
          setStatus("✅ Connection reset");
        } catch (err) {
          console.error(err);
          setStatus("❌ Failed to reset connection");
          syncControls();
        } finally {
          resetBtn.textContent = "♻️";
          resetBtn.disabled = false;
        }
      };

      sliderWrapper.appendChild(slider);
      sliderWrapper.appendChild(gainInput);
      sliderWrapper.appendChild(dbLabel);
      controls.appendChild(muteBtn);
      controls.appendChild(sliderWrapper);
      controls.appendChild(resetBtn);

      item.appendChild(controls);
      list.appendChild(item);
    });

    if (list.children.length !== 0) {
      card.appendChild(list);
      matrixContainer.appendChild(card);
    }
  });
}

function applyState(matrix, connections, { silent = false } = {}) {
  const nextSnapshot = stableSnapshot(connections);
  const changed = nextSnapshot !== appState.connectionsSnapshot;

  appState.matrix = matrix;
  if (changed) {
    appState.connections = connections;
    appState.connectionsSnapshot = nextSnapshot;
  }
  appState.lastRefreshAt = Date.now();

  if (changed) {
    renderMatrix(connections);
    if (!silent) setStatus("✅ Matrix loaded");
  } else if (!silent) {
    setStatus("✅ Already up to date");
  }

  return changed;
}

async function fetchCachedState({ silent = false } = {}) {
  if (!silent) setStatus("⏳ Loading cached data...");

  const [matrix, connections] = await Promise.all([
    fetchJSON(`${API_BASE}/matrix`),
    fetchJSON(`${API_BASE}/connections`),
  ]);

  applyState(matrix, connections, { silent });
}

async function refreshData({ userInitiated = false, silent = false } = {}) {
  if (refreshPromise) {
    await refreshPromise;
    if (userInitiated) return refreshData({ userInitiated, silent });
    return;
  }

  refreshPromise = (async () => {
    if (userInitiated) {
      refreshBtn.disabled = true;
      setStatus("🔁 Refreshing...");
    } else if (!silent && !appState.connections) {
      setStatus("⏳ Fetching latest data...");
    }

    try {
      const result = await fetchJSON(`${API_BASE}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full: userInitiated }),
      });
      applyState(result.matrix, result.connections, { silent: silent && !userInitiated });
    } catch (err) {
      console.error(err);
      if (!appState.connections) {
        try {
          await fetchCachedState({ silent: true });
          setStatus("⚠️ Latest refresh failed, cached data loaded");
        } catch (cacheErr) {
          console.error(cacheErr);
          setStatus("❌ Failed to fetch data");
        }
      } else {
        setStatus("⚠️ Refresh failed; showing last data");
      }
    } finally {
      refreshBtn.disabled = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function refreshWhenUseful() {
  const recentlyRefreshed = Date.now() - appState.lastRefreshAt < AUTO_REFRESH_MIN_INTERVAL;
  if (document.hidden || recentlyRefreshed || document.activeElement?.type === "number") return;
  refreshData({ silent: true });
}

refreshBtn.onclick = () => refreshData({ userInitiated: true });

restartBtn.onclick = async () => {
  if (!confirm("⚠️ Restart the vb matrix audio engine?")) return;

  restartBtn.disabled = true;
  refreshBtn.disabled = true;
  setStatus("🔄 Restarting audio engine...");

  try {
    await fetchJSON(`${API_BASE}/restart`, { method: "POST" });
    setStatus("✅ Audio engine restarted — refreshing matrix...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await refreshData({ userInitiated: true });
  } catch (err) {
    console.error(err);
    setStatus("❌ Restart failed");
  } finally {
    restartBtn.disabled = false;
    refreshBtn.disabled = false;
  }
};

document.addEventListener("visibilitychange", refreshWhenUseful);
window.addEventListener("focus", refreshWhenUseful);
window.addEventListener("online", () => refreshData({ silent: true }));

refreshData();
