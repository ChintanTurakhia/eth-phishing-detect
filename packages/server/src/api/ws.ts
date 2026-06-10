import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientCommand } from "@virtual-sim/shared";
import type { SimHost } from "../host.js";

/**
 * WebSocket hub: fans every host event out to all clients in the protocol
 * envelope, and handles client commands.
 */
export function attachWs(server: HttpServer, host: SimHost): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });
  let seq = 0;

  const broadcast = (event: { type: string; payload: unknown }) => {
    seq += 1;
    const msg = JSON.stringify({
      v: 1,
      seq,
      ts: { wall: Date.now(), sim: host.sim.clock.now },
      type: event.type,
      payload: event.payload,
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  host.events.on("event", broadcast);

  wss.on("connection", (socket) => {
    seq += 1;
    socket.send(
      JSON.stringify({
        v: 1,
        seq,
        ts: { wall: Date.now(), sim: host.sim.clock.now },
        type: "state.snapshot",
        payload: host.snapshot(),
      }),
    );

    socket.on("message", (raw) => {
      void (async () => {
        let cmd: ClientCommand;
        try {
          cmd = JSON.parse(String(raw)) as ClientCommand;
        } catch {
          return;
        }
        try {
          await handleCommand(host, cmd);
        } catch (err) {
          socket.send(
            JSON.stringify({
              v: 1,
              seq: ++seq,
              ts: { wall: Date.now(), sim: host.sim.clock.now },
              type: "error",
              payload: { message: (err as Error).message },
            }),
          );
        }
      })();
    });
  });

  return wss;
}

async function handleCommand(host: SimHost, cmd: ClientCommand): Promise<void> {
  switch (cmd.type) {
    case "sim.start":
    case "sim.resume":
      host.start();
      break;
    case "sim.pause":
      await host.pause();
      break;
    case "sim.setSpeed":
      host.setSpeed(cmd.payload.speed);
      break;
    case "settings.update":
      host.updateSettings(cmd.payload.patch);
      break;
    case "artifact.review":
      await host.reviewArtifact(cmd.payload.id, cmd.payload.decision, cmd.payload.reason);
      break;
    case "soul.save":
      host.saveSoul(cmd.payload.fileName, cmd.payload.content);
      break;
    case "agent.remove":
      host.removeAgent(cmd.payload.agentId);
      break;
  }
}
