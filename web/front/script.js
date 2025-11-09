const API_BASE = "http://localhost:8080/api";
const matrixContainer = document.getElementById("matrixContainer");
const statusText = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

async function fetchAll() {
  statusText.textContent = "⏳ Fetching data...";
  matrixContainer.innerHTML = "";
  try {
    const [matrix, connections] = await Promise.all([
      fetchJSON(`${API_BASE}/matrix`),
      fetchJSON(`${API_BASE}/connections`),
    ]);
    renderMatrix(connections);
    statusText.textContent = "✅ Matrix loaded";
  } catch (err) {
    console.error(err);
    statusText.textContent = "❌ Failed to fetch data";
  }
}

function renderMatrix(connections) {
  matrixContainer.innerHTML = "";

  Object.entries(connections).forEach(([key, pairs]) => {
    const card = document.createElement("div");
    card.className = "matrix-card";

    const title = document.createElement("h2");
    title.textContent = key;
    title.className = "text-base font-semibold text-blue-300 mb-1";
    card.appendChild(title);

    const list = document.createElement("div");
    list.className = "matrix-list";

    Object.entries(pairs).forEach(([pair, data]) => {
      const item = document.createElement("div");
      item.className = `matrix-item ${data.connected ? "connected" : "disconnected"}`;

      // --- Label (safe DOM structure) ---
      const label = document.createElement("div");
      const nameDiv = document.createElement("div");
      nameDiv.className = "font-medium";
      nameDiv.textContent = pair;

      const infoDiv = document.createElement("div");
      infoDiv.className = "text-xs text-gray-400";
      infoDiv.textContent = data.connected
        ? `Gain: ${data.gain ?? 0} dB`
        : "Not connected (click to enable)";

      label.appendChild(nameDiv);
      label.appendChild(infoDiv);
      item.appendChild(label);

      // --- Click to activate (gain = -99) ---
      item.addEventListener("click", async (e) => {
        if (!data.connected && !e.target.closest("button,input")) {
          const [source, target] = pair.split(" → ");
          const [srcSlot, dstSlot] = key.split(" → ");
          statusText.textContent = "🎚️ Activating connection...";

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

          const updated = await fetchJSON(
            `${API_BASE}/live/${srcSlot}/${dstSlot}?inName=${encodeURIComponent(source)}&outName=${encodeURIComponent(target)}`
          );

          data.connected = updated.connected;
          data.gain = updated.gain;
          data.mute = updated.mute;

          item.className = `matrix-item connected animate-fadeIn`;
          infoDiv.textContent = `Gain: ${data.gain ?? 0} dB`;
          statusText.textContent = "✅ Connection activated";
        }
      });

      // --- Controls ---
      const controls = document.createElement("div");
      controls.className = "flex gap-2 items-center";

      // Mute Button
      const muteBtn = document.createElement("button");
      muteBtn.className = `p-1.5 rounded transition ${
        data.mute
          ? "bg-red-700 hover:bg-red-800"
          : "bg-gray-700 hover:bg-gray-600"
      }`;
      muteBtn.textContent = data.mute ? "🔇" : "🔊";

      muteBtn.onclick = async () => {
        muteBtn.disabled = true;
        muteBtn.textContent = "⏳";

        const [source, target] = pair.split(" → ");
        const [srcSlot, dstSlot] = key.split(" → ");

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

        const updated = await fetchJSON(
          `${API_BASE}/live/${srcSlot}/${dstSlot}?inName=${encodeURIComponent(source)}&outName=${encodeURIComponent(target)}`
        );

        data.mute = updated.mute;
        data.gain = updated.gain;
        data.connected = updated.connected;

        item.className = `matrix-item ${data.connected ? "connected" : "disconnected"}`;
        muteBtn.textContent = data.mute ? "🔇" : "🔊";
        muteBtn.className = `p-1.5 rounded transition ${
          data.mute
            ? "bg-red-700 hover:bg-red-800"
            : "bg-gray-700 hover:bg-gray-600"
        }`;
        slider.value = data.gain ?? 0;
        valueLabel.textContent = data.gain === -Infinity ? "-∞" : `${data.gain ?? 0}`;
        infoDiv.textContent = `Gain: ${data.gain ?? 0} dB`;
        muteBtn.disabled = false;
      };

      // Gain Slider
      const sliderWrapper = document.createElement("div");
      sliderWrapper.className = "flex items-center gap-1";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = -80;
      slider.max = 6;
      slider.step = 1;
      slider.value = data.gain ?? 0;
      slider.className = "cursor-pointer w-24 accent-blue-500";

      const valueLabel = document.createElement("span");
      valueLabel.className = "w-8 text-xs text-gray-300 text-right";
      valueLabel.textContent =
        data.gain === -Infinity ? "-∞" : `${data.gain ?? 0}`;

      slider.addEventListener("input", (e) => {
        valueLabel.textContent = e.target.value;
      });

      slider.addEventListener("change", async (e) => {
        slider.disabled = true;
        const newGain = parseInt(e.target.value);
        const [source, target] = pair.split(" → ");
        const [srcSlot, dstSlot] = key.split(" → ");

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

        const updated = await fetchJSON(
          `${API_BASE}/live/${srcSlot}/${dstSlot}?inName=${encodeURIComponent(source)}&outName=${encodeURIComponent(target)}`
        );

        data.mute = updated.mute;
        data.gain = updated.gain;
        data.connected = updated.connected;

        item.className = `matrix-item ${data.connected ? "connected" : "disconnected"}`;
        valueLabel.textContent = data.gain === -Infinity ? "-∞" : `${data.gain ?? 0}`;
        slider.value = data.gain ?? 0;
        infoDiv.textContent = `Gain: ${data.gain ?? 0} dB`;
        slider.disabled = false;
      });

      // Reset Button
      const resetBtn = document.createElement("button");
      resetBtn.textContent = "♻️";
      resetBtn.className =
        "p-1.5 bg-gray-700 hover:bg-gray-600 rounded transition";
      resetBtn.title = "Reset connection";

      resetBtn.onclick = async () => {
        resetBtn.disabled = true;
        resetBtn.textContent = "⏳";

        const [source, target] = pair.split(" → ");
        const [srcSlot, dstSlot] = key.split(" → ");

        await fetchJSON(`${API_BASE}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            target,
            action: "reset",
          }),
        });

        const updated = await fetchJSON(
          `${API_BASE}/live/${srcSlot}/${dstSlot}?inName=${encodeURIComponent(source)}&outName=${encodeURIComponent(target)}`
        );

        data.connected = updated.connected;
        data.gain = updated.gain;
        data.mute = updated.mute;

        item.className = `matrix-item ${data.connected ? "connected" : "disconnected"}`;
        infoDiv.textContent = data.connected
          ? `Gain: ${data.gain ?? 0} dB`
          : "Not connected (click to enable)";
        slider.value = data.gain ?? 0;
        valueLabel.textContent = data.gain === -Infinity ? "-∞" : `${data.gain ?? 0}`;
        resetBtn.textContent = "♻️";
        resetBtn.disabled = false;
        statusText.textContent = "✅ Connection reset";
      };

      // Assemble controls
      sliderWrapper.appendChild(slider);
      sliderWrapper.appendChild(valueLabel);
      controls.appendChild(muteBtn);
      controls.appendChild(sliderWrapper);
      controls.appendChild(resetBtn);

      item.appendChild(controls);
      list.appendChild(item);
    });

    card.appendChild(list);
    matrixContainer.appendChild(card);
  });
}

refreshBtn.onclick = async () => {
  statusText.textContent = "🔁 Refreshing...";
  await fetchJSON(`${API_BASE}/refresh`, { method: "POST" });
  fetchAll();
};

fetchAll();
