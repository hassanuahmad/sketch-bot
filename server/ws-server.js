const WebSocket = require("ws");

const PORT = Number(process.env.WS_PORT || 3001);
const wss = new WebSocket.Server({ port: PORT });

let carClient = null;
let carName = "ESP32";
const uiClients = new Set();

function safeSend(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function broadcastToUi(message) {
  for (const client of uiClients) {
    safeSend(client, message);
  }
}

function sendStatus(target) {
  const payload = {
    type: "status",
    carOnline: Boolean(carClient),
    carName,
  };

  if (target) {
    safeSend(target, payload);
    return;
  }

  broadcastToUi(payload);
}

function registerClient(ws, data) {
  const role = data.role;
  if (role === "car") {
    carClient = ws;
    carName = data.carName || carName || "ESP32";
    ws.role = "car";
    sendStatus();
    return;
  }

  if (role === "ui") {
    ws.role = "ui";
    uiClients.add(ws);
    sendStatus(ws);
    return;
  }

  ws.role = "unknown";
  safeSend(ws, { type: "error", message: "Unknown role" });
}

function handleSketchFromUi(ws, data) {
  if (!carClient || carClient.readyState !== WebSocket.OPEN) {
    safeSend(ws, {
      type: "sketch_sent",
      ok: false,
      error: "car_offline",
    });
    return;
  }

  safeSend(carClient, {
    type: "sketch",
    sketch: data.sketch,
  });

  safeSend(ws, { type: "sketch_sent", ok: true });
}

function handleCmdFromUi(ws, data) {
  if (!carClient || carClient.readyState !== WebSocket.OPEN) {
    safeSend(ws, { type: "cmd_sent", ok: false, error: "car_offline" });
    return;
  }

  // Forward only the command payload to the car.
  safeSend(carClient, { cmd: data.cmd, value: data.value });
  safeSend(ws, { type: "cmd_sent", ok: true });
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.role = "unknown";

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (error) {
      safeSend(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (data.type === "register") {
      registerClient(ws, data);
      return;
    }

    if (data.type === "sketch" && ws.role === "ui") {
      handleSketchFromUi(ws, data);
      return;
    }

    if (data.type === "cmd" && ws.role === "ui") {
      handleCmdFromUi(ws, data);
      return;
    }

    if (data.type === "ping") {
      safeSend(ws, { type: "pong" });
      return;
    }

    safeSend(ws, { type: "error", message: "Unknown message type" });
  });

  ws.on("close", () => {
    if (uiClients.has(ws)) uiClients.delete(ws);
    if (carClient === ws) {
      carClient = null;
      sendStatus();
    }
  });

  ws.on("error", () => {
    if (uiClients.has(ws)) uiClients.delete(ws);
    if (carClient === ws) {
      carClient = null;
      sendStatus();
    }
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((client) => {
    if (!client.isAlive) {
      client.terminate();
      return;
    }
    client.isAlive = false;
    client.ping();
  });
}, 15000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

console.log(`WebSocket server listening on ws://localhost:${PORT}`);
