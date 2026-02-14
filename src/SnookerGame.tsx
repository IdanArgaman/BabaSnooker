import { useEffect, useRef, useCallback, useState } from "react";
import Matter from "matter-js";

const {
  Engine,
  Render,
  Runner,
  Bodies,
  Composite,
  Body,
  Events,
  Vector,
  Mouse,
} = Matter;

// ── Table dimensions ──────────────────────────────────────────────
const TABLE_WIDTH = 1200;
const TABLE_HEIGHT = 600;
const CUSHION = 40; // cushion thickness
const POCKET_R = 22; // pocket radius
const BALL_R = 10; // ball radius
const CANVAS_W = TABLE_WIDTH + CUSHION * 2;
const CANVAS_H = TABLE_HEIGHT + CUSHION * 2;

// ── Colours ──────────────────────────────────────────────────────
const FELT = "#0a6e2e";
const CUSHION_COLOR = "#2d8b4e";
const WOOD_COLOR = "#5c3a1e";
const POCKET_COLOR = "#111";

// Ball colours (snooker)
const BALL_COLORS: Record<string, string> = {
  white: "#fffbe6",
  red: "#cc0000",
  yellow: "#f5d020",
  green: "#0a7e3a",
  brown: "#7b3f00",
  blue: "#1e40af",
  pink: "#e85d8a",
  black: "#111111",
};

// ── Physics constants ─────────────────────────────────────────────
const BALL_OPTS: Matter.IBodyDefinition = {
  restitution: 0.85,
  friction: 0.05,
  frictionAir: 0.012,
  density: 0.005,
  slop: 0,
};

const CUSHION_OPTS: Matter.IBodyDefinition = {
  isStatic: true,
  restitution: 0.7,
  friction: 0.05,
  render: { fillStyle: CUSHION_COLOR },
};

// ── Helpers ───────────────────────────────────────────────────────
function createBall(
  x: number,
  y: number,
  color: string,
  label: string
): Matter.Body {
  return Bodies.circle(x, y, BALL_R, {
    ...BALL_OPTS,
    label,
    render: {
      fillStyle: color,
      strokeStyle: color === BALL_COLORS.white ? "#999" : "#222",
      lineWidth: 1,
    },
  });
}

// Pocket positions (top-left, top-center, top-right, bottom-left, bottom-center, bottom-right)
function pocketPositions(): { x: number; y: number }[] {
  const l = CUSHION;
  const r = CUSHION + TABLE_WIDTH;
  const t = CUSHION;
  const b = CUSHION + TABLE_HEIGHT;
  const cx = CUSHION + TABLE_WIDTH / 2;
  return [
    { x: l - 2, y: t - 2 },
    { x: cx, y: t - 5 },
    { x: r + 2, y: t - 2 },
    { x: l - 2, y: b + 2 },
    { x: cx, y: b + 5 },
    { x: r + 2, y: b + 2 },
  ];
}

// Create pocket sensor bodies (balls that touch these get removed)
function createPockets(): Matter.Body[] {
  return pocketPositions().map((p, i) =>
    Bodies.circle(p.x, p.y, POCKET_R, {
      isStatic: true,
      isSensor: true,
      label: `pocket-${i}`,
      render: { fillStyle: POCKET_COLOR },
    })
  );
}

// Create the four cushions (walls) with gaps for pockets
function createCushions(): Matter.Body[] {
  const l = CUSHION;
  const r = CUSHION + TABLE_WIDTH;
  const t = CUSHION;
  const b = CUSHION + TABLE_HEIGHT;
  const cx = CUSHION + TABLE_WIDTH / 2;
  const pGap = POCKET_R + 12; // gap near pockets
  const cThick = 14;

  // Top cushions (two halves with center pocket gap)
  const topLeft = Bodies.rectangle(
    (l + pGap + cx - pGap) / 2,
    t - cThick / 2,
    cx - pGap - (l + pGap) + 2,
    cThick,
    CUSHION_OPTS
  );
  const topRight = Bodies.rectangle(
    (cx + pGap + r - pGap) / 2,
    t - cThick / 2,
    r - pGap - (cx + pGap) + 2,
    cThick,
    CUSHION_OPTS
  );

  // Bottom cushions (two halves)
  const botLeft = Bodies.rectangle(
    (l + pGap + cx - pGap) / 2,
    b + cThick / 2,
    cx - pGap - (l + pGap) + 2,
    cThick,
    CUSHION_OPTS
  );
  const botRight = Bodies.rectangle(
    (cx + pGap + r - pGap) / 2,
    b + cThick / 2,
    r - pGap - (cx + pGap) + 2,
    cThick,
    CUSHION_OPTS
  );

  // Left cushion
  const left = Bodies.rectangle(
    l - cThick / 2,
    (t + b) / 2,
    cThick,
    b - t - pGap * 2 + 2,
    CUSHION_OPTS
  );

  // Right cushion
  const right = Bodies.rectangle(
    r + cThick / 2,
    (t + b) / 2,
    cThick,
    b - t - pGap * 2 + 2,
    CUSHION_OPTS
  );

  return [topLeft, topRight, botLeft, botRight, left, right];
}

// Create wooden rail border
function createRails(): Matter.Body[] {
  const railThick = CUSHION;
  const w = CANVAS_W;
  const h = CANVAS_H;

  return [
    Bodies.rectangle(w / 2, railThick / 2, w, railThick, {
      isStatic: true,
      render: { fillStyle: WOOD_COLOR },
    }),
    Bodies.rectangle(w / 2, h - railThick / 2, w, railThick, {
      isStatic: true,
      render: { fillStyle: WOOD_COLOR },
    }),
    Bodies.rectangle(railThick / 2, h / 2, railThick, h, {
      isStatic: true,
      render: { fillStyle: WOOD_COLOR },
    }),
    Bodies.rectangle(w - railThick / 2, h / 2, railThick, h, {
      isStatic: true,
      render: { fillStyle: WOOD_COLOR },
    }),
  ];
}

// ── Ball positions (snooker layout) ───────────────────────────────
function createBalls(): { cueBall: Matter.Body; objectBalls: Matter.Body[] } {
  const tableL = CUSHION;
  const tableT = CUSHION;
  const cy = tableT + TABLE_HEIGHT / 2;

  // Cue ball – placed at 1/4 from left
  const cueBall = createBall(
    tableL + TABLE_WIDTH * 0.25,
    cy,
    BALL_COLORS.white,
    "cue"
  );

  const objectBalls: Matter.Body[] = [];

  // Triangle of 15 reds starting 3/4 from left
  const startX = tableL + TABLE_WIDTH * 0.68;
  const startY = cy;
  const spacing = BALL_R * 2.15;
  let ballIndex = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = startX + row * spacing * Math.cos(Math.PI / 6);
      const y =
        startY + (col - row / 2) * spacing;
      objectBalls.push(
        createBall(x, y, BALL_COLORS.red, `red-${ballIndex++}`)
      );
    }
  }

  // Colour balls on their spots
  const spots: [number, number, string, string][] = [
    [tableL + TABLE_WIDTH * 0.2, cy - TABLE_HEIGHT * 0.22, BALL_COLORS.yellow, "yellow"],
    [tableL + TABLE_WIDTH * 0.2, cy + TABLE_HEIGHT * 0.22, BALL_COLORS.green, "green"],
    [tableL + TABLE_WIDTH * 0.2, cy, BALL_COLORS.brown, "brown"],
    [tableL + TABLE_WIDTH * 0.5, cy, BALL_COLORS.blue, "blue"],
    [startX - spacing * 1.5, cy, BALL_COLORS.pink, "pink"],
    [tableL + TABLE_WIDTH * 0.89, cy, BALL_COLORS.black, "black"],
  ];

  spots.forEach(([x, y, color, label]) => {
    objectBalls.push(createBall(x, y, color, label));
  });

  return { cueBall, objectBalls };
}

// ── Component ────────────────────────────────────────────────────
export default function SnookerGame() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const cueBallRef = useRef<Matter.Body | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cueLineRef = useRef<{ from: Matter.Vector; to: Matter.Vector } | null>(
    null
  );
  const [pottedBalls, setPottedBalls] = useState<string[]>([]);
  const [shotPower, setShotPower] = useState(0);
  const [isAiming, setIsAiming] = useState(false);
  const allBallsRef = useRef<Matter.Body[]>([]);
  const [isCueBallPotted, setIsCueBallPotted] = useState(false);

  // Reset cue ball to original position
  const resetCueBall = useCallback(() => {
    const cueBall = cueBallRef.current;
    if (!cueBall || !engineRef.current) return;
    const tableL = CUSHION;
    const cy = CUSHION + TABLE_HEIGHT / 2;
    Body.setPosition(cueBall, { x: tableL + TABLE_WIDTH * 0.25, y: cy });
    Body.setVelocity(cueBall, { x: 0, y: 0 });
    Body.setAngularVelocity(cueBall, 0);

    // Re-add if it was removed
    if (!Composite.get(engineRef.current.world, cueBall.id, "body")) {
      Composite.add(engineRef.current.world, cueBall);
    }
    setIsCueBallPotted(false);
  }, []);

  // Check if all balls are at rest
  const allBallsStopped = useCallback((): boolean => {
    const world = engineRef.current?.world;
    if (!world) return true;
    const bodies = Composite.allBodies(world);
    return bodies
      .filter((b) => !b.isStatic && !b.isSensor)
      .every((b) => {
        const speed = Vector.magnitude(b.velocity);
        return speed < 0.1;
      });
  }, []);

  // Reset entire game
  const resetGame = useCallback(() => {
    if (!engineRef.current) return;
    const world = engineRef.current.world;

    // Remove all non-static, non-sensor bodies
    const bodies = Composite.allBodies(world).filter(
      (b) => !b.isStatic && !b.isSensor
    );
    Composite.remove(world, bodies);

    // Re-create balls
    const { cueBall, objectBalls } = createBalls();
    cueBallRef.current = cueBall;
    allBallsRef.current = [cueBall, ...objectBalls];
    Composite.add(world, [cueBall, ...objectBalls]);
    setPottedBalls([]);
    setIsCueBallPotted(false);
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;

    // ── Engine ──────────────────────────────────────────────────
    const engine = Engine.create({
      gravity: { x: 0, y: 0 }, // top-down view = no gravity
    });
    engineRef.current = engine;

    // ── Renderer ────────────────────────────────────────────────
    const render = Render.create({
      element: sceneRef.current,
      engine,
      options: {
        width: CANVAS_W,
        height: CANVAS_H,
        wireframes: false,
        background: FELT,
        pixelRatio: window.devicePixelRatio || 1,
      },
    });
    renderRef.current = render;

    // ── Runner ──────────────────────────────────────────────────
    const runner = Runner.create();
    runnerRef.current = runner;

    // ── Add table elements ──────────────────────────────────────
    const rails = createRails();
    const cushions = createCushions();
    const pockets = createPockets();
    const { cueBall, objectBalls } = createBalls();
    cueBallRef.current = cueBall;
    allBallsRef.current = [cueBall, ...objectBalls];

    Composite.add(engine.world, [
      ...rails,
      ...cushions,
      ...pockets,
      cueBall,
      ...objectBalls,
    ]);

    // ── Pocket detection ────────────────────────────────────────
    Events.on(engine, "collisionStart", (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;
        let pocket: Matter.Body | null = null;
        let ball: Matter.Body | null = null;

        if (bodyA.label.startsWith("pocket-")) {
          pocket = bodyA;
          ball = bodyB;
        } else if (bodyB.label.startsWith("pocket-")) {
          pocket = bodyB;
          ball = bodyA;
        }

        if (pocket && ball && !ball.isStatic) {
          if (ball.label === "cue") {
            // Cue ball potted – remove it and flag
            Composite.remove(engine.world, ball);
            setIsCueBallPotted(true);
          } else {
            // Object ball potted
            Composite.remove(engine.world, ball);
            setPottedBalls((prev) => [...prev, ball!.label]);
          }
        }
      });
    });

    // ── Mouse / Cue interaction ──────────────────────────────────
    const mouse = Mouse.create(render.canvas);

    const getCanvasPos = (e: MouseEvent) => {
      const rect = render.canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!allBallsStopped()) return;
      const pos = getCanvasPos(e);
      const cue = cueBallRef.current;
      if (!cue) return;

      const dist = Vector.magnitude(Vector.sub(pos, cue.position));
      if (dist < BALL_R * 4) {
        isDraggingRef.current = true;
        dragStartRef.current = { x: cue.position.x, y: cue.position.y };
        setIsAiming(true);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;
      const pos = getCanvasPos(e);
      const cue = cueBallRef.current;
      if (!cue) return;

      const from = cue.position;
      const dx = from.x - pos.x;
      const dy = from.y - pos.y;
      const power = Math.min(Math.sqrt(dx * dx + dy * dy), 300);
      setShotPower(Math.round((power / 300) * 100));

      cueLineRef.current = { from: { ...from }, to: { x: pos.x, y: pos.y } };
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;
      const pos = getCanvasPos(e);
      const cue = cueBallRef.current;
      if (!cue) return;

      const from = cue.position;
      const dx = from.x - pos.x;
      const dy = from.y - pos.y;
      const power = Math.min(Math.sqrt(dx * dx + dy * dy), 300);
      const maxForce = 0.08;
      const force = (power / 300) * maxForce;

      if (power > 5) {
        const angle = Math.atan2(dy, dx);
        Body.applyForce(cue, cue.position, {
          x: Math.cos(angle) * force,
          y: Math.sin(angle) * force,
        });
      }

      isDraggingRef.current = false;
      dragStartRef.current = null;
      cueLineRef.current = null;
      setIsAiming(false);
      setShotPower(0);
    };

    render.canvas.addEventListener("mousedown", onMouseDown);
    render.canvas.addEventListener("mousemove", onMouseMove);
    render.canvas.addEventListener("mouseup", onMouseUp);

    // ── Custom rendering (cue line + aiming guide) ──────────────
    Events.on(render, "afterRender", () => {
      const ctx = render.context;
      const cue = cueBallRef.current;

      // Draw pocket holes prettier
      pocketPositions().forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
      });

      // Draw baulk line (the D)
      const baulkX = CUSHION + TABLE_WIDTH * 0.2;
      ctx.beginPath();
      ctx.moveTo(baulkX, CUSHION);
      ctx.lineTo(baulkX, CUSHION + TABLE_HEIGHT);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw D semicircle
      const dRadius = TABLE_HEIGHT * 0.22;
      ctx.beginPath();
      ctx.arc(
        baulkX,
        CUSHION + TABLE_HEIGHT / 2,
        dRadius,
        -Math.PI / 2,
        Math.PI / 2,
        true
      );
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Cue aiming line
      if (cueLineRef.current && cue) {
        const { from, to } = cueLineRef.current;

        // Draw dotted aim line (direction ball will go)
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const angle = Math.atan2(dy, dx);
        const aimLen = 200;

        ctx.beginPath();
        ctx.setLineDash([6, 6]);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(
          from.x + Math.cos(angle) * aimLen,
          from.y + Math.sin(angle) * aimLen
        );
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw cue stick
        const stickLen = 280;
        const distFromBall = BALL_R + 6;
        const pullBack = Math.min(
          Vector.magnitude(Vector.sub(from, to)),
          150
        );
        const cueAngle = Math.atan2(to.y - from.y, to.x - from.x);
        const startDist = distFromBall + pullBack;

        const sx = from.x + Math.cos(cueAngle) * startDist;
        const sy = from.y + Math.sin(cueAngle) * startDist;
        const ex = from.x + Math.cos(cueAngle) * (startDist + stickLen);
        const ey = from.y + Math.sin(cueAngle) * (startDist + stickLen);

        // Cue stick shadow
        ctx.beginPath();
        ctx.moveTo(sx + 2, sy + 2);
        ctx.lineTo(ex + 2, ey + 2);
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 7;
        ctx.stroke();

        // Cue stick body
        const grad = ctx.createLinearGradient(sx, sy, ex, ey);
        grad.addColorStop(0, "#f5e6c8");
        grad.addColorStop(0.12, "#d4a04a");
        grad.addColorStop(1, "#6b3a1f");
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.stroke();

        // Cue tip
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#5ba3d9";
        ctx.fill();
      }

      // Ball shine effect
      Composite.allBodies(engine.world)
        .filter((b) => !b.isStatic && !b.isSensor)
        .forEach((b) => {
          const r = BALL_R;
          const gradient = ctx.createRadialGradient(
            b.position.x - r * 0.3,
            b.position.y - r * 0.3,
            r * 0.1,
            b.position.x,
            b.position.y,
            r
          );
          gradient.addColorStop(0, "rgba(255,255,255,0.35)");
          gradient.addColorStop(1, "rgba(255,255,255,0)");
          ctx.beginPath();
          ctx.arc(b.position.x, b.position.y, r, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        });
    });

    // ── Apply friction / damping each update ─────────────────────
    Events.on(engine, "beforeUpdate", () => {
      Composite.allBodies(engine.world)
        .filter((b) => !b.isStatic && !b.isSensor)
        .forEach((b) => {
          const speed = Vector.magnitude(b.velocity);
          // Stop very slow balls to avoid endless rolling
          if (speed > 0 && speed < 0.15) {
            Body.setVelocity(b, { x: 0, y: 0 });
            Body.setAngularVelocity(b, 0);
          }
        });
    });

    // ── Start ───────────────────────────────────────────────────
    Render.run(render);
    Runner.run(runner, engine);

    // Keep mouse in sync
    (render as unknown as { mouse: typeof mouse }).mouse = mouse;

    return () => {
      render.canvas.removeEventListener("mousedown", onMouseDown);
      render.canvas.removeEventListener("mousemove", onMouseMove);
      render.canvas.removeEventListener("mouseup", onMouseUp);
      Render.stop(render);
      Runner.stop(runner);
      Engine.clear(engine);
      render.canvas.remove();
      render.textures = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="snooker-container">
      <h1 className="title">Snooker Physics</h1>
      <p className="subtitle">
        Click and drag from the cue ball to aim and shoot. Pull further for more
        power.
      </p>

      <div className="game-area">
        <div ref={sceneRef} className="canvas-wrapper" />

        {/* Power / Aiming HUD */}
        {isAiming && (
          <div className="power-bar-container">
            <div className="power-bar-label">Power</div>
            <div className="power-bar-track">
              <div
                className="power-bar-fill"
                style={{
                  width: `${shotPower}%`,
                  backgroundColor:
                    shotPower < 40
                      ? "#4ade80"
                      : shotPower < 70
                        ? "#facc15"
                        : "#ef4444",
                }}
              />
            </div>
            <div className="power-bar-value">{shotPower}%</div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="controls">
        {isCueBallPotted && (
          <button className="btn btn-warning" onClick={resetCueBall}>
            Replace Cue Ball
          </button>
        )}
        <button className="btn btn-reset" onClick={resetGame}>
          New Game
        </button>
      </div>

      {/* Potted balls display */}
      {pottedBalls.length > 0 && (
        <div className="potted-display">
          <span className="potted-label">Potted:</span>
          {pottedBalls.map((label, i) => {
            const colorName = label.startsWith("red") ? "red" : label;
            return (
              <span
                key={i}
                className="potted-ball"
                style={{ backgroundColor: BALL_COLORS[colorName] || "#cc0000" }}
                title={label}
              />
            );
          })}
        </div>
      )}

      {/* Physics info for class */}
      <div className="physics-info">
        <h3>Physics Concepts in this Simulation</h3>
        <ul>
          <li>
            <strong>Conservation of Momentum:</strong> When the cue ball
            strikes another ball, momentum is transferred between them.
          </li>
          <li>
            <strong>Elastic Collisions:</strong> Balls bounce off each other
            with a coefficient of restitution of ~0.85.
          </li>
          <li>
            <strong>Friction:</strong> Rolling friction and air friction
            gradually slow the balls down.
          </li>
          <li>
            <strong>Force &amp; Impulse:</strong> The cue stick applies a
            force to the cue ball proportional to the drag distance.
          </li>
          <li>
            <strong>Newton&apos;s Third Law:</strong> Every collision produces
            equal and opposite forces on both balls.
          </li>
        </ul>
      </div>
    </div>
  );
}
