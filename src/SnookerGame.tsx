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

// ── Vector display constants ─────────────────────────────────────
const VEC_SCALE_VELOCITY = 18; // scale factor for velocity arrows
const VEC_SCALE_FRICTION = 800; // scale factor for friction arrows
const VEC_SCALE_FORCE = 6000; // scale factor for applied-force arrows
const FORCE_FADE_MS = 2000; // how long the applied-force arrow lingers
const MIN_SPEED_FOR_VECTORS = 0.2; // don't draw vectors on nearly-stopped balls

const VECTOR_COLORS = {
  velocity: "#00e5ff", // cyan
  friction: "#ff9100", // orange
  force: "#ffee58", // yellow
};

// ── Physics defaults (used for sliders + ball creation) ──────────
const DEFAULTS = {
  frictionAir: 0.018, // velocity-proportional drag (applied every frame)
  friction: 0.05, // contact friction (ball-to-ball / ball-to-cushion)
  rollingFriction: 0.0006, // constant deceleration per tick (simulates felt)
  density: 0.005, // controls mass (mass = density × area)
  restitution: 0.85,
};

// ── Physics constants ─────────────────────────────────────────────
const BALL_OPTS: Matter.IBodyDefinition = {
  restitution: DEFAULTS.restitution,
  friction: DEFAULTS.friction,
  frictionAir: DEFAULTS.frictionAir,
  density: DEFAULTS.density,
  slop: 0,
};

const CUSHION_OPTS: Matter.IChamferableBodyDefinition = {
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

// ── Arrow drawing helper ─────────────────────────────────────────
function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
  lineWidth: number = 2,
  alpha: number = 1
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return; // too short to draw

  const headLen = Math.min(8, len * 0.35);
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Shaft
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle - Math.PI / 6),
    toY - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLen * Math.cos(angle + Math.PI / 6),
    toY - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
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

  // Vector display state
  const [showVectors, setShowVectors] = useState(true);
  const showVectorsRef = useRef(true);
  // Track the last applied force { fx, fy, time } so we can draw it fading out
  const lastForceRef = useRef<{
    fx: number;
    fy: number;
    time: number;
  } | null>(null);

  // ── Physics settings state ────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [frictionAir, setFrictionAir] = useState(DEFAULTS.frictionAir);
  const [rollingFriction, setRollingFriction] = useState(DEFAULTS.rollingFriction);
  const [density, setDensity] = useState(DEFAULTS.density);

  // Ref so the beforeUpdate callback always reads the latest value
  const rollingFrictionRef = useRef(DEFAULTS.rollingFriction);

  // Apply current physics settings to every ball on the table
  const applyPhysicsSettings = useCallback(
    (fAir: number, rf: number, dn: number) => {
      const world = engineRef.current?.world;
      if (!world) return;
      rollingFrictionRef.current = rf;
      Composite.allBodies(world)
        .filter((b) => !b.isStatic && !b.isSensor)
        .forEach((b) => {
          b.frictionAir = fAir; // this is the drag that actually slows rolling balls
          Body.setDensity(b, dn);
        });
    },
    []
  );

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
        const fx = Math.cos(angle) * force;
        const fy = Math.sin(angle) * force;
        Body.applyForce(cue, cue.position, { x: fx, y: fy });

        // Store the applied force for vector visualisation
        lastForceRef.current = { fx, fy, time: Date.now() };
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
      const movingBalls = Composite.allBodies(engine.world)
        .filter((b) => !b.isStatic && !b.isSensor);

      movingBalls.forEach((b) => {
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

      // ── Physics vector overlays ─────────────────────────────────
      if (showVectorsRef.current) {
        movingBalls.forEach((b) => {
          const speed = Vector.magnitude(b.velocity);
          if (speed < MIN_SPEED_FOR_VECTORS) return;

          const px = b.position.x;
          const py = b.position.y;

          // 1) Velocity vector (cyan) ─────────────────────────────
          const vx = b.velocity.x * VEC_SCALE_VELOCITY;
          const vy = b.velocity.y * VEC_SCALE_VELOCITY;
          drawArrow(ctx, px, py, px + vx, py + vy, VECTOR_COLORS.velocity, 2.5, 0.9);

          // Label "v"
          ctx.save();
          ctx.font = "bold 10px monospace";
          ctx.fillStyle = VECTOR_COLORS.velocity;
          ctx.globalAlpha = 0.85;
          ctx.fillText("v", px + vx + 4, py + vy - 4);
          ctx.restore();

          // 2) Friction force vector (orange) ─────────────────────
          // F_friction = -frictionAir * v * mass  (approximate damping force)
          const mass = b.mass;
          const frictionAir = b.frictionAir;
          const ffx = -b.velocity.x * frictionAir * mass * VEC_SCALE_FRICTION;
          const ffy = -b.velocity.y * frictionAir * mass * VEC_SCALE_FRICTION;
          drawArrow(ctx, px, py, px + ffx, py + ffy, VECTOR_COLORS.friction, 2, 0.8);

          // Label "f"
          ctx.save();
          ctx.font = "bold 10px monospace";
          ctx.fillStyle = VECTOR_COLORS.friction;
          ctx.globalAlpha = 0.8;
          ctx.fillText("f", px + ffx + 4, py + ffy - 4);
          ctx.restore();
        });

        // 3) Applied force vector on cue ball (yellow, fading) ───
        const lastForce = lastForceRef.current;
        const cueBallBody = cueBallRef.current;
        if (lastForce && cueBallBody) {
          const elapsed = Date.now() - lastForce.time;
          if (elapsed < FORCE_FADE_MS) {
            const alpha = 1 - elapsed / FORCE_FADE_MS;
            const px = cueBallBody.position.x;
            const py = cueBallBody.position.y;
            const afx = lastForce.fx * VEC_SCALE_FORCE;
            const afy = lastForce.fy * VEC_SCALE_FORCE;
            drawArrow(ctx, px, py, px + afx, py + afy, VECTOR_COLORS.force, 3, alpha);

            // Label "F"
            ctx.save();
            ctx.font = "bold 11px monospace";
            ctx.fillStyle = VECTOR_COLORS.force;
            ctx.globalAlpha = alpha;
            ctx.fillText("F", px + afx + 5, py + afy - 5);
            ctx.restore();
          }
        }

        // ── Legend (top-right corner on canvas) ────────────────────
        const legendX = CANVAS_W - 200;
        const legendY = CUSHION + 14;
        const lineH = 18;

        ctx.save();
        // Background
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.roundRect(legendX - 10, legendY - 14, 190, lineH * 3 + 22, 8);
        ctx.fill();

        ctx.font = "bold 11px monospace";

        // Velocity
        ctx.fillStyle = VECTOR_COLORS.velocity;
        ctx.fillText("\u2192 v  = Velocity", legendX + 6, legendY + 4);

        // Friction
        ctx.fillStyle = VECTOR_COLORS.friction;
        ctx.fillText("\u2192 f  = Friction Force", legendX + 6, legendY + 4 + lineH);

        // Applied Force
        ctx.fillStyle = VECTOR_COLORS.force;
        ctx.fillText("\u2192 F  = Applied Force", legendX + 6, legendY + 4 + lineH * 2);

        ctx.restore();
      }
    });

    // ── Apply friction / damping each update ─────────────────────
    // Matter.js `frictionAir` provides velocity-proportional drag (v *= 1-frictionAir).
    // Real rolling friction on felt is roughly constant (independent of speed),
    // so we add a custom constant deceleration on top of the air drag.
    Events.on(engine, "beforeUpdate", () => {
      Composite.allBodies(engine.world)
        .filter((b) => !b.isStatic && !b.isSensor)
        .forEach((b) => {
          const speed = Vector.magnitude(b.velocity);

          // Stop very slow balls to avoid endless rolling
          if (speed > 0 && speed < 0.15) {
            Body.setVelocity(b, { x: 0, y: 0 });
            Body.setAngularVelocity(b, 0);
            return;
          }

          // Apply constant rolling friction (felt resistance)
          // This subtracts a fixed amount from speed each tick,
          // which is more realistic than velocity-proportional drag alone.
          const rf = rollingFrictionRef.current;
          if (rf > 0 && speed > 0.15) {
            const newSpeed = Math.max(0, speed - rf);
            const scale = newSpeed / speed;
            Body.setVelocity(b, {
              x: b.velocity.x * scale,
              y: b.velocity.y * scale,
            });
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
        <button
          className={`btn btn-vectors ${showVectors ? "active" : ""}`}
          onClick={() => {
            setShowVectors((v) => {
              showVectorsRef.current = !v;
              return !v;
            });
          }}
        >
          {showVectors ? "Hide Vectors" : "Show Vectors"}
        </button>
        {isCueBallPotted && (
          <button className="btn btn-warning" onClick={resetCueBall}>
            Replace Cue Ball
          </button>
        )}
        <button className="btn btn-reset" onClick={resetGame}>
          New Game
        </button>
      </div>

      {/* ── Physics Settings Panel ──────────────────────────────── */}
      <div className="settings-panel">
        <button
          className="settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          Physics Settings
          <span className={`settings-chevron ${settingsOpen ? "open" : ""}`}>
            &#9662;
          </span>
        </button>

        {settingsOpen && (
          <div className="settings-body">
            {/* Air Drag (frictionAir) — velocity-proportional */}
            <div className="setting-row">
              <label className="setting-label">
                Air Drag
                <span className="setting-value">{frictionAir.toFixed(3)}</span>
              </label>
              <input
                type="range"
                className="setting-slider"
                min={0}
                max={0.06}
                step={0.002}
                value={frictionAir}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setFrictionAir(v);
                  applyPhysicsSettings(v, rollingFriction, density);
                }}
              />
              <div className="setting-range-labels">
                <span>0 (none)</span>
                <span>0.06 (heavy drag)</span>
              </div>
            </div>

            {/* Rolling Friction — constant deceleration (felt resistance) */}
            <div className="setting-row">
              <label className="setting-label">
                Rolling Friction
                <span className="setting-value">{rollingFriction.toFixed(4)}</span>
              </label>
              <input
                type="range"
                className="setting-slider"
                min={0}
                max={0.003}
                step={0.0001}
                value={rollingFriction}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setRollingFriction(v);
                  applyPhysicsSettings(frictionAir, v, density);
                }}
              />
              <div className="setting-range-labels">
                <span>0 (ice)</span>
                <span>0.003 (rough felt)</span>
              </div>
            </div>

            {/* Ball Mass (density) */}
            <div className="setting-row">
              <label className="setting-label">
                Ball Mass
                <span className="setting-value">
                  {density.toFixed(4)}
                  <span className="setting-unit"> kg/px&sup2;</span>
                </span>
              </label>
              <input
                type="range"
                className="setting-slider"
                min={0.001}
                max={0.02}
                step={0.0005}
                value={density}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setDensity(v);
                  applyPhysicsSettings(frictionAir, rollingFriction, v);
                }}
              />
              <div className="setting-range-labels">
                <span>0.001 (light)</span>
                <span>0.02 (heavy)</span>
              </div>
            </div>

            {/* Reset to defaults */}
            <button
              className="btn btn-defaults"
              onClick={() => {
                setFrictionAir(DEFAULTS.frictionAir);
                setRollingFriction(DEFAULTS.rollingFriction);
                setDensity(DEFAULTS.density);
                applyPhysicsSettings(
                  DEFAULTS.frictionAir,
                  DEFAULTS.rollingFriction,
                  DEFAULTS.density
                );
              }}
            >
              Reset to Defaults
            </button>
          </div>
        )}
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
