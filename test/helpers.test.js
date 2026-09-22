const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

const sent = [];
let gainReply = "Point(...).dBGain = -12.3;";

class FakeVBANServer extends EventEmitter {
  bind() {
    queueMicrotask(() => this.emit("listening"));
  }

  send(packet) {
    sent.push(packet.message);
    if (packet.message.endsWith("= ?")) {
      const answer = packet.message.includes(".Mute")
        ? "Point(...).Mute = 0;"
        : gainReply;
      queueMicrotask(() => this.emit("message", { answer }, { address: "127.0.0.1", port: 6980 }));
    }
  }

  close() {}
}

class FakeVBANTEXTPacket {
  constructor(options, message) {
    this.message = message;
  }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vban") {
    return {
      VBANServer: FakeVBANServer,
      VBANTEXTPacket: FakeVBANTEXTPacket,
      ETextEncoding: { VBAN_TXT_UTF8: 0 },
      EFormatBit: { VBAN_DATATYPE_BYTE8: 0 },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { fetchMatrixPoints, applyAction } = require("../helpers");
Module._load = originalLoad;

const matrix = {
  WIN1: {
    inputs: { Source: { chL: 1, chR: null, type: "mono" } },
    outputs: { Target: { chL: 1, chR: null, type: "mono" } },
  },
};

test("reads a decimal gain and rejects invalid replies without clearing the state", async () => {
  const state = await fetchMatrixPoints(matrix);
  assert.deepEqual(state["WIN1 → WIN1"]["Source → Target"], {
    connected: true,
    gain: -12.3,
    gains: [-12.3],
    mute: false,
  });
  assert.equal(Object.hasOwn(global, "connected"), false);

  gainReply = "Point(...).dBGain = -inf;";
  const disconnected = await fetchMatrixPoints(matrix);
  assert.equal(disconnected["WIN1 → WIN1"]["Source → Target"].connected, false);

  gainReply = "Err";
  await assert.rejects(fetchMatrixPoints(matrix), /Invalid gain response/);
});

test("sends exact tenth-dB values and rejects invalid gains", async () => {
  global.matrixState = matrix;
  await applyAction("Source", "Target", "gain", -12.3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sent.includes("Point(WIN1.IN[1],WIN1.OUT[1]).dBGain=-12.3;"));

  await assert.rejects(applyAction("Source", "Target", "gain", -12.35), /0.1 dB steps/);
  await assert.rejects(applyAction("Source", "Target", "gain", "-12.3"), /0.1 dB steps/);
});
