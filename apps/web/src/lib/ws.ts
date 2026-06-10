"use client";

import { useEffect, useRef } from "react";
import type { ClientCommand } from "@virtual-sim/shared";
import { useSim } from "./store";

let socket: WebSocket | null = null;

export function wsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:4000/ws";
  const host = process.env.NEXT_PUBLIC_SERVER_WS ?? `ws://${window.location.hostname}:4000/ws`;
  return host;
}

export function send(cmd: ClientCommand): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(cmd));
  }
}

/** Connect once; auto-reconnect with backoff; feed everything to the store. */
export function useSimSocket(): void {
  const handleEvent = useSim((s) => s.handleEvent);
  const retry = useRef(0);

  useEffect(() => {
    let closed = false;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      socket = ws;

      ws.onopen = () => {
        retry.current = 0;
      };
      ws.onmessage = (msg) => {
        try {
          const env = JSON.parse(String(msg.data)) as { type: string; payload: unknown };
          handleEvent(env.type, env.payload);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        useSim.setState({ connected: false });
        if (!closed) {
          const delay = Math.min(8000, 500 * 2 ** retry.current);
          retry.current += 1;
          setTimeout(connect, delay);
        }
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      socket?.close();
      socket = null;
    };
  }, [handleEvent]);
}
