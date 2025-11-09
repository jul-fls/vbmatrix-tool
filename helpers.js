const { VBANServer, VBANTEXTPacket, ETextEncoding, EFormatBit } = require("vban");

const VBAN_HOST = process.env.VBAN_HOST;
const VBAN_PORT = process.env.VBAN_PORT || 6980;

/**
 * Send a VBAN-TEXT command.
 *
 * Keeps the same behavior as your working POC.
 */
function sendVBANCommand(host, message, streamName) {
  const server = new VBANServer();

  server.on("error", (err) => {
    console.error("❌ VBAN error:", err);
    server.close();
  });

  server.on("listening", () => {
    const pkt = new VBANTEXTPacket(
      {
        streamName,
        formatBit: EFormatBit.VBAN_DATATYPE_BYTE8,
        encoding: ETextEncoding.VBAN_TXT_UTF8,
      },
      message
    );

    server.send(pkt, VBAN_PORT, host);
    console.log(`✅ Sent to ${host}:${VBAN_PORT} → ${message}`);
    setTimeout(() => server.close(), 100);
  });

  server.on("message", (pkt, rinfo) => {
    console.log(`📩 Received response from ${rinfo.address}:${rinfo.port} → ${pkt.answer}`);
  });

  // bind with port 0 → OS picks an unused ephemeral port
  server.bind(0);
}


/**
 * Query function: sends a VBAN-TEXT request (with '= ?' style query)
 * and waits for a single response or until `timeoutMs` expires.
 *
 * @param {string} host - target matrix IP
 * @param {string} message - the request string to send (e.g. 'Point(...).dBGain = ?')
 * @param {string} [streamName='Command1']
 * @param {number} [timeoutMs=1500] - ms to wait for reply before rejecting
 * @returns {Promise<string>} - resolves to text reply from Matrix (string)
 */
function queryVBAN(host, message, streamName = "Command1", timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const server = new VBANServer();
    let done = false;
    let timer = null;

    function cleanup() {
      done = true;
      if (timer) clearTimeout(timer);
      try { server.close(); } catch (e) {}
      server.removeAllListeners();
    }

    server.once("error", (err) => {
      if (done) return;
      cleanup();
      reject(err);
    });

    server.once("message", (pkt, rinfo) => {
      if (done) return;
      const answer = pkt && (pkt.answer ?? pkt.toString());
      cleanup();
      // Some replies include a trailing semicolon or newline — trim it
      resolve(typeof answer === "string" ? answer.trim() : String(answer));
    });

    server.on("listening", () => {
      try {
        const pkt = new VBANTEXTPacket(
          {
            streamName,
            formatBit: EFormatBit.VBAN_DATATYPE_BYTE8,
            encoding: ETextEncoding.VBAN_TXT_UTF8,
          },
          message
        );
        // console.log(`✅ Sent to ${host}:${VBAN_PORT} → ${message}`);
        server.send(pkt, VBAN_PORT, host);
        // start timeout AFTER sending
        timer = setTimeout(() => {
          if (done) return;
          cleanup();
          reject(new Error("VBAN query timeout"));
        }, timeoutMs);
      } catch (e) {
        cleanup();
        reject(e);
      }
    });

    // bind ephemeral port (0)
    try {
      server.bind(0);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

/** Utility to extract clean quoted names like "PC-JUJU-01 (L)" → PC-JUJU-01 (L) */
function cleanName(raw) {
  if (!raw || typeof raw !== "string") return "";
  const match = raw.match(/"([^"]*)"/);
  if (match) {
    const name = match[1].trim();
    return name.length > 0 ? name : "";
  }
  if (/Name\s*=\s*""/.test(raw) || /Err/i.test(raw)) return "";
  const fallback = raw.replace(/Input|Output|\(.*?\)|Name|=|;|"|VBAN1|WIN\d|OUT|IN/gi, "").trim();
  return fallback.length > 0 ? fallback : "";
}

async function discoverMatrix() {
  const suidCandidates = [
    "WIN1", "WIN2", "WIN3", "WIN4",
    "VBAN1", "VBAN2", "VBAN3", "VBAN4",
    "VAIO1", "VAIO2", "VAIO3", "VAIO4"
  ];

  const discovered = {};

  for (const suid of suidCandidates) {
    let info = await queryVBAN(VBAN_HOST, `Slot(${suid}).Info = ?`).catch(() => null);

    // Fallback for separated sub-slots (WINx.IN / WINx.OUT)
    if (!info || /Err/i.test(info)) {
      const inInfo = await queryVBAN(VBAN_HOST, `Slot(${suid}.IN).Info = ?`).catch(() => null);
      const outInfo = await queryVBAN(VBAN_HOST, `Slot(${suid}.OUT).Info = ?`).catch(() => null);

      if (inInfo || outInfo) {
        const inMatch = inInfo ? inInfo.match(/In:(\d+)/i) : null;
        const outMatch = outInfo ? outInfo.match(/Out:(\d+)/i) : null;
        const ins = inMatch ? parseInt(inMatch[1], 10) : 0;
        const outs = outMatch ? parseInt(outMatch[1], 10) : 0;
        info = `In:${ins},Out:${outs}`;
      }
    }

    if (!info || /Err/i.test(info)) continue;
    const match = info.match(/In:(\d+),\s*Out:(\d+)/i);
    if (!match) continue;

    const ins = +match[1], outs = +match[2];
    if (ins + outs === 0) continue;

    const slot = { inputs: [], outputs: [] };

    // Inputs
    for (let i = 1; i <= ins; i++) {
      const raw = await queryVBAN(VBAN_HOST, `Input(${suid}.IN[${i}]).Name = ?`).catch(() => "");
      const name = cleanName(raw);
      if (name && name.length > 0) slot.inputs.push({ ch: i, name });
    }

    // Outputs
    for (let j = 1; j <= outs; j++) {
      const raw = await queryVBAN(VBAN_HOST, `Output(${suid}.OUT[${j}]).Name = ?`).catch(() => "");
      const name = cleanName(raw);
      if (name && name.length > 0) slot.outputs.push({ ch: j, name });
    }

    if (slot.inputs.length || slot.outputs.length) discovered[suid] = slot;
  }

  // Stereo pairing
  const matrix = {};
  for (const [suid, slot] of Object.entries(discovered)) {
    matrix[suid] = { inputs: {}, outputs: {} };

    const pairChannels = (arr) => {
      const pairs = {};
      for (let i = 0; i < arr.length; i++) {
        const curr = arr[i];
        const baseName = curr.name.replace(/\s*\(L\)|\s*\(R\)/gi, "").trim();
        const next = arr[i + 1];
        if (next && next.name.replace(/\s*\(L\)|\s*\(R\)/gi, "").trim() === baseName) {
          pairs[baseName] = {
            chL: curr.ch,
            chR: next.ch,
            type: "stereo",
            gain: 0,
            mute: false,
          };
          i++;
        } else {
          pairs[baseName] = {
            chL: curr.ch,
            chR: null,
            type: "mono",
            gain: 0,
            mute: false,
          };
        }
      }
      return pairs;
    };

    matrix[suid].inputs = pairChannels(slot.inputs);
    matrix[suid].outputs = pairChannels(slot.outputs);
  }

  return matrix;
}

async function fetchMatrixPoints() {
  if (!global.matrixState) throw new Error("Matrix not initialized");

  const matrix = global.matrixState;
  const state = {};

  for (const [srcSuid, src] of Object.entries(matrix)) {
    for (const [dstSuid, dst] of Object.entries(matrix)) {
      const pairKey = `${srcSuid} → ${dstSuid}`;
      state[pairKey] = {};

      for (const [inName, inp] of Object.entries(src.inputs)) {
        for (const [outName, out] of Object.entries(dst.outputs)) {
          const inRange = inp.type === "stereo" ? `${inp.chL}..${inp.chR}` : `${inp.chL}`;
          const outRange = out.type === "stereo" ? `${out.chL}..${out.chR}` : `${out.chL}`;
          const pointBase = `Point(${srcSuid}.IN[${inRange}],${dstSuid}.OUT[${outRange}])`;
          const label = `${inName} → ${outName}`;

          let connected = false;
          let gain = 0;
          let mute = false;

          try {
            const cmd = `${pointBase}.dBGain = ?`;
            const gainReply = await queryVBAN(VBAN_HOST, cmd);
            //   console.log(`↩️ ${cmd} → ${gainReply.trim()}`);

            if (gainReply && !/Err/i.test(gainReply)) {
                const match = gainReply.match(/=\s*([^\;]+)/);
                if (match) {
                    // Parse all returned gains
                    const values = match[1]
                        .split(",")
                        .map(v => v.trim())
                        .filter(v => v.length > 0);

                    // Convert to numbers and keep raw list
                    const numericVals = values.map(v =>
                        /inf/i.test(v) ? -Infinity : parseFloat(v)
                    );

                    const allInf = numericVals.every(v => v === -Infinity);
                    connected = !allInf;

                    // Compute the average gain (ignore -inf)
                    const validGains = numericVals.filter(v => v !== -Infinity);
                    let avgGain = -Infinity;

                    if (validGains.length > 0) {
                        const sum = validGains.reduce((a, b) => a + b, 0);
                        avgGain = parseFloat((sum / validGains.length).toFixed(1));
                    }

                    // Save structured data
                    pointState = {
                        connected,
                        gain: avgGain,
                        gains: numericVals,
                        mute: false // will update below
                    };
                }
            }
            } catch (err) {
            console.log(`⚠️ Error querying ${pointBase}:`, err.message);
            }

          if (pointState.connected) {
            try {
                const muteReply = await queryVBAN(VBAN_HOST, `${pointBase}.Mute = ?`);
                const parts = muteReply.split("=").pop().replace(";", "").trim();
                const vals = parts.split(",").map(v => parseInt(v.trim(), 10));
                pointState.mute = vals.some(v => v === 1);
            } catch {}
        }

          state[pairKey][label] = pointState;
        }
      }
    }
  }

  console.log("🎚️ Full matrix state (Input ➜ Output):");
  console.log(JSON.stringify(state, null, 2));
  return state;
}

async function getLiveConnection(srcSuid, dstSuid, inName, outName) {
  const matrix = global.matrixState;
  if (!matrix) throw new Error("Matrix not initialized");
  
  const src = matrix[srcSuid];
  const dst = matrix[dstSuid];
  if (!src || !dst) throw new Error("Invalid source/destination");

  const inp = src.inputs[inName];
  const out = dst.outputs[outName];
  if (!inp || !out) throw new Error("Unknown input/output");

  const inRange = inp.type === "stereo" ? `${inp.chL}..${inp.chR}` : `${inp.chL}`;
  const outRange = out.type === "stereo" ? `${out.chL}..${out.chR}` : `${out.chL}`;
  const base = `Point(${srcSuid}.IN[${inRange}],${dstSuid}.OUT[${outRange}])`;

  // --- Gain ---
  const gainReply = await queryVBAN(VBAN_HOST, `${base}.dBGain = ?`);
  const gainParts = gainReply.split("=").pop().replace(";", "").trim();
  const gainVals = gainParts.split(",").map(v => (/inf/i.test(v) ? -Infinity : parseFloat(v)));
  const allInf = gainVals.every(v => v === -Infinity);
  const connected = !allInf;
  const valid = gainVals.filter(v => v !== -Infinity);
  const gain = valid.length ? parseFloat((valid.reduce((a,b)=>a+b,0)/valid.length).toFixed(1)) : null;

  // --- Mute ---
  const muteReply = await queryVBAN(VBAN_HOST, `${base}.Mute = ?`);
  const muteParts = muteReply.split("=").pop().replace(";", "").trim();
  const muteVals = muteParts.split(",").map(v => parseInt(v.trim(), 10));
  const mute = muteVals.some(v => v === 1);

  return { connected, gain, gains: gainVals, mute };
}

async function applyAction(sourceName, targetName, action, value = null) {
  const matrix = global.matrixState;
  if (!matrix) throw new Error("Matrix not initialized yet");

  const sourceSlot = Object.entries(matrix).find(([_, s]) => s.inputs[sourceName] || s.outputs[sourceName]);
  const targetSlot = Object.entries(matrix).find(([_, s]) => s.inputs[targetName] || s.outputs[targetName]);
  if (!sourceSlot || !targetSlot) throw new Error("Unknown source or target");

  const [srcSuid, src] = sourceSlot;
  const [dstSuid, dst] = targetSlot;
  const srcCh = src.outputs[sourceName] || src.inputs[sourceName];
  const dstCh = dst.inputs[targetName] || dst.outputs[targetName];
  if (!srcCh || !dstCh) throw new Error("Invalid channel pairing");

  const inRange = srcCh.type === "stereo" ? `${srcCh.chL}..${srcCh.chR}` : `${srcCh.chL}`;
  const outRange = dstCh.type === "stereo" ? `${dstCh.chL}..${dstCh.chR}` : `${dstCh.chL}`;
  const cmdBase = `Point(${srcSuid}.IN[${inRange}],${dstSuid}.OUT[${outRange}])`;

  let cmd = "";
  switch (action) {
    case "gain":
      cmd = `${cmdBase}.dBGain=${value};`;
      break;
    case "mute":
      cmd = `${cmdBase}.Mute=${value ? 1 : 0};`;
      break;
    case "reset":
      cmd = `${cmdBase}.Reset;`;
      break;
    default:
      throw new Error("Unknown action");
  }

  console.log(`🎛️ Executing: ${cmd}`);
  sendVBANCommand(VBAN_HOST, cmd, process.env.VBAN_COMMAND_STREAM_NAME || "Command1");
}

module.exports = {
  discoverMatrix,
  fetchMatrixPoints,
  applyAction,
  getLiveConnection,
};