"use client";

import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { toSimDateTime, type WorldDefinition } from "@virtual-sim/shared";
import { useSim } from "@/lib/store";

const TILE = 32;

interface AgentVisual {
  root: Container;
  body: Graphics;
  emoji: Text;
  label: Text;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  bubbleUntil: number;
  tx: number;
  ty: number;
}

export function OfficeView() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let destroyed = false;
    const app = new Application();
    const visuals = new Map<string, AgentVisual>();
    let worldDrawn = false;
    let unsubscribe: (() => void) | null = null;

    void app
      .init({ resizeTo: wrap, background: 0x0b0e14, antialias: true })
      .then(() => {
        if (destroyed) {
          app.destroy(true);
          return;
        }
        wrap.appendChild(app.canvas);
        app.canvas.className = "office-canvas";

        const camera = new Container();
        app.stage.addChild(camera);
        const floorLayer = new Container();
        const agentLayer = new Container();
        const tint = new Graphics();
        camera.addChild(floorLayer, agentLayer);
        app.stage.addChild(tint);

        // ----- camera pan/zoom -----
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        app.canvas.addEventListener("pointerdown", (e) => {
          dragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
        });
        window.addEventListener("pointerup", () => (dragging = false));
        app.canvas.addEventListener("pointermove", (e) => {
          if (!dragging) return;
          camera.x += e.clientX - lastX;
          camera.y += e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;
        });
        app.canvas.addEventListener("wheel", (e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.1 : 0.9;
          const next = Math.min(2.5, Math.max(0.4, camera.scale.x * factor));
          camera.scale.set(next);
        });

        const drawWorld = (world: WorldDefinition) => {
          floorLayer.removeChildren();
          const g = new Graphics();
          const { grid } = world.tilemap;
          for (let y = 0; y < grid.length; y++) {
            for (let x = 0; x < grid[y]!.length; x++) {
              const px = x * TILE;
              const py = y * TILE;
              if (grid[y]![x] === 1) {
                g.rect(px, py, TILE, TILE).fill(0x1d2435);
                g.rect(px, py, TILE, 6).fill(0x232c42);
              } else {
                const checker = (x + y) % 2 === 0 ? 0x141a29 : 0x121724;
                g.rect(px, py, TILE, TILE).fill(checker);
              }
            }
          }
          floorLayer.addChild(g);

          // Area labels + object markers.
          const walk = (node: WorldDefinition["tree"]) => {
            for (const area of node.children) {
              const anchor = world.anchors[area.path];
              if (anchor) {
                const label = new Text({
                  text: area.name.replace(/^the /, "").toUpperCase(),
                  style: { fontSize: 10, fill: 0x47506a, letterSpacing: 2, fontWeight: "700" },
                });
                label.x = anchor.x * TILE - label.width / 2 + TILE / 2;
                label.y = anchor.y * TILE - 26;
                floorLayer.addChild(label);
              }
              for (const obj of area.children) {
                const oa = world.anchors[obj.path];
                if (!oa) continue;
                const marker = new Graphics();
                marker.roundRect(oa.x * TILE + 4, oa.y * TILE + 4, TILE - 8, TILE - 8, 6).fill(0x1c2336);
                marker.roundRect(oa.x * TILE + 4, oa.y * TILE + 4, TILE - 8, 6, 3).fill(0x28324c);
                floorLayer.addChild(marker);
                const icon = new Text({ text: objectIcon(obj.name), style: { fontSize: 14 } });
                icon.x = oa.x * TILE + 8;
                icon.y = oa.y * TILE + 8;
                floorLayer.addChild(icon);
              }
            }
          };
          walk(world.tree);

          // Center camera on the map.
          const mapW = world.tilemap.width * TILE;
          const mapH = world.tilemap.height * TILE;
          camera.x = (app.screen.width - mapW) / 2;
          camera.y = (app.screen.height - mapH) / 2;
        };

        const ensureVisual = (id: string, name: string, color: string): AgentVisual => {
          let v = visuals.get(id);
          if (v) return v;
          const root = new Container();
          const body = new Graphics();
          const colorNum = parseInt(color.slice(1), 16);
          body.circle(0, 0, 11).fill(colorNum).stroke({ width: 2, color: 0x0b0e14 });
          const initialsText = new Text({
            text: name.split(" ").map((p) => p[0]).slice(0, 2).join(""),
            style: { fontSize: 9, fill: 0xffffff, fontWeight: "700" },
          });
          initialsText.anchor.set(0.5);
          const emoji = new Text({ text: "", style: { fontSize: 12 } });
          emoji.anchor.set(0.5);
          emoji.y = -20;
          const label = new Text({ text: name.split(" ")[0], style: { fontSize: 9, fill: 0x8b93a7 } });
          label.anchor.set(0.5);
          label.y = 19;

          const bubble = new Container();
          const bubbleBg = new Graphics();
          const bubbleText = new Text({
            text: "",
            style: { fontSize: 10, fill: 0xe6e9f2, wordWrap: true, wordWrapWidth: 150 },
          });
          bubbleText.x = 6;
          bubbleText.y = 4;
          bubble.addChild(bubbleBg, bubbleText);
          bubble.y = -64;
          bubble.visible = false;

          root.addChild(body, initialsText, emoji, label, bubble);
          root.eventMode = "static";
          root.cursor = "pointer";
          root.on("pointertap", () => useSim.getState().select(id));
          agentLayer.addChild(root);
          v = { root, body, emoji, label, bubble, bubbleText, bubbleBg, bubbleUntil: 0, tx: 0, ty: 0 };
          visuals.set(id, v);
          return v;
        };

        const showBubble = (v: AgentVisual, text: string) => {
          v.bubbleText.text = text.length > 90 ? text.slice(0, 87) + "…" : text;
          v.bubbleBg.clear();
          v.bubbleBg
            .roundRect(0, 0, v.bubbleText.width + 12, v.bubbleText.height + 8, 8)
            .fill({ color: 0x1b2233, alpha: 0.95 })
            .stroke({ width: 1, color: 0x2c3650 });
          v.bubble.x = -(v.bubbleText.width + 12) / 2;
          v.bubble.visible = true;
          v.bubbleUntil = Date.now() + 4500;
        };

        // Track utterance counts to detect new ones.
        const seenUtterances = new Set<string>();

        const sync = () => {
          const state = useSim.getState();
          if (state.world && !worldDrawn) {
            drawWorld(state.world);
            worldDrawn = true;
          }
          for (const agent of state.agents.values()) {
            const v = ensureVisual(agent.id, agent.name, agent.color);
            v.tx = agent.state.x * TILE + TILE / 2;
            v.ty = agent.state.y * TILE + TILE / 2;
            if (v.root.x === 0 && v.root.y === 0) {
              v.root.x = v.tx;
              v.root.y = v.ty;
            }
            v.emoji.text = agent.state.statusEmoji;
            v.root.alpha = agent.state.status === "asleep" ? 0.35 : 1;
          }
          // New utterances → bubbles.
          for (const [, list] of state.utterances) {
            const last = list[list.length - 1];
            if (last && !seenUtterances.has(last.id)) {
              seenUtterances.add(last.id);
              const v = visuals.get(last.agentId);
              if (v) showBubble(v, last.content);
            }
          }
          // Day/night tint.
          const { hour } = toSimDateTime(state.sim.simTime);
          tint.clear();
          const alpha = hour < 6 ? 0.4 : hour < 8 ? 0.2 : hour < 17 ? 0 : hour < 20 ? 0.15 : 0.35;
          if (alpha > 0) {
            tint.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0a1030, alpha });
          }
        };

        unsubscribe = useSim.subscribe(sync);
        sync();

        app.ticker.add(() => {
          const now = Date.now();
          for (const v of visuals.values()) {
            v.root.x += (v.tx - v.root.x) * 0.12;
            v.root.y += (v.ty - v.root.y) * 0.12;
            if (v.bubble.visible && now > v.bubbleUntil) v.bubble.visible = false;
          }
        });
      })
      .catch((err) => console.error("[office] pixi init failed", err));

    return () => {
      destroyed = true;
      unsubscribe?.();
      try {
        app.destroy(true, { children: true });
      } catch {
        /* already torn down */
      }
    };
  }, []);

  return (
    <div className="office-wrap" ref={wrapRef}>
      <div className="office-hint">drag to pan · scroll to zoom · click an agent for details</div>
    </div>
  );
}

function objectIcon(name: string): string {
  if (name.includes("desk")) return "🖥️";
  if (name.includes("whiteboard") || name.includes("board")) return "📋";
  if (name.includes("coffee")) return "☕";
  if (name.includes("fridge")) return "🧊";
  if (name.includes("snack")) return "🍪";
  if (name.includes("TV") || name.includes("tv")) return "📺";
  if (name.includes("bookshelf")) return "📚";
  if (name.includes("beanbag")) return "🛋️";
  return "📦";
}
