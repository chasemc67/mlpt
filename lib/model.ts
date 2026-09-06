import { z } from "zod";

export const configSchema = z.object({
  participantId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, hyphens or underscores."),
  category: z.enum(["shapes", "colors", "numbers", "letters", "words"]),
  trials: z.number().int().min(0).max(100),
  position: z.enum(["center", "random"]),
  size: z.enum(["small", "medium", "large", "random"]),
  area: z.enum(["full", "central"]),
  targetColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  contrast: z.number().min(0.1).max(1),
  lineWidth: z.number().min(1).max(24),
  brightness: z.number().min(0.1).max(1),
  guidance: z.boolean(),
  tripleTap: z.boolean(),
  speechProvider: z.enum(["device", "gateway"]),
});
export type Config = z.infer<typeof configSchema>;
export const DEFAULT_CONFIG: Config = {
  participantId: "P-001",
  category: "shapes",
  trials: 10,
  position: "center",
  size: "medium",
  area: "central",
  targetColor: "#ffffff",
  backgroundColor: "#000000",
  contrast: 1,
  lineWidth: 6,
  brightness: 0.8,
  guidance: true,
  tripleTap: false,
  speechProvider: "device",
};
export const TARGETS: Record<Config["category"], string[]> = {
  shapes: ["circle", "square", "triangle", "diamond"],
  colors: ["red", "orange", "yellow", "green", "blue", "purple"],
  numbers: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  letters: ["A", "B", "C", "D", "E", "F"],
  words: ["sun", "moon", "tree", "water", "house", "bird"],
};
export const COLORS: Record<string, string> = {
  red: "#EF4444",
  orange: "#F97316",
  yellow: "#EAB308",
  green: "#22C55E",
  blue: "#3B82F6",
  purple: "#A855F7",
};
export interface Session {
  id: string;
  participantId: string;
  startedAt: string;
  endedAt?: string;
  status: "active" | "completed" | "interrupted";
  mode: "training";
  task: "standard";
  config: Config;
  device: Record<string, unknown>;
}
export type TrialPhase =
  | "preparing"
  | "exploring"
  | "answering"
  | "confirming"
  | "feedback"
  | "interrupted";
export interface Geometry {
  width: number;
  height: number;
  x: number;
  y: number;
  targetWidth: number;
  targetHeight: number;
  rotation: number;
  dpr: number;
  orientation: string;
  renderedBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
    source: string;
  };
}
export interface Trial {
  mode: "training";
  task: "standard";
  projectPhase: "training";
  stimulusReference: string;
  actualBrightness?: number | null;
  id: string;
  sessionId: string;
  participantId: string;
  index: number;
  phase: TrialPhase;
  target: string;
  category: Config["category"];
  config: Config;
  randomization: {
    source: "web-crypto";
    at: string;
    draws: number[];
    index: number;
  };
  geometry?: Geometry;
  startedAt: string;
  presentedAt?: string;
  responseAt?: string;
  confirmedAt?: string;
  endedAt?: string;
  responseTimeMs?: number;
  draft?: string;
  response?: string;
  correct?: boolean;
  flags: string[];
  nativeAudioPath?: string;
}
export interface Touch {
  id: string;
  trialId: string;
  at: string;
  elapsedMs: number;
  type: "DOWN" | "MOVE" | "UP" | "CANCEL";
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
  pressure: number | null;
  contactWidth: number | null;
  contactHeight: number | null;
}
export interface Audit {
  clockMs: number;
  id: string;
  sessionId: string;
  trialId?: string;
  at: string;
  event: string;
  details?: unknown;
}
export interface MediaChunk {
  id: string;
  trialId: string;
  sequence: number;
  at: string;
  blob: Blob;
  kind: "audio" | "overlay";
  nativeFinalized?: boolean;
}
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function sampleIndex(
  count: number,
  draws: number[],
  random = () => crypto.getRandomValues(new Uint32Array(1))[0],
) {
  if (!Number.isInteger(count) || count < 1 || count > 2 ** 32)
    throw new Error("Invalid target count");
  const limit = Math.floor(2 ** 32 / count) * count;
  let value: number;
  do {
    value = random();
    draws.push(value);
  } while (value >= limit);
  return value % count;
}
export function createTrial(session: Session, index: number): Trial {
  const draws: number[] = [];
  const selected = sampleIndex(TARGETS[session.config.category].length, draws);
  return {
    id: uid(),
    sessionId: session.id,
    mode: "training",
    task: "standard",
    projectPhase: "training",
    stimulusReference: `builtin-v1/${session.config.category}/${TARGETS[session.config.category][selected]}`,
    participantId: session.participantId,
    index,
    phase: "preparing",
    target: TARGETS[session.config.category][selected],
    category: session.config.category,
    config: structuredClone(session.config),
    randomization: { source: "web-crypto", at: now(), draws, index: selected },
    startedAt: now(),
    flags: [],
  };
}
export function geometryFor(
  trial: Trial,
  width: number,
  height: number,
  dpr: number,
  orientation: string,
): Geometry {
  const c = trial.config;
  const draws = trial.randomization.draws;
  const ratio =
    c.size === "random"
      ? [0.2, 0.35, 0.5][sampleIndex(3, draws)]
      : { small: 0.2, medium: 0.35, large: 0.5 }[c.size];
  const targetWidth = Math.max(1, Math.min(width, height) * ratio);
  const marginX = c.area === "central" ? width * 0.2 : 12;
  const marginY = c.area === "central" ? height * 0.2 : 12;
  const roomX = Math.max(0, width - targetWidth - marginX * 2);
  const roomY = Math.max(0, height - targetWidth - marginY * 2);
  const x =
    c.position === "center"
      ? (width - targetWidth) / 2
      : marginX + (sampleIndex(10001, draws) / 10000) * roomX;
  const y =
    c.position === "center"
      ? (height - targetWidth) / 2
      : marginY + (sampleIndex(10001, draws) / 10000) * roomY;
  return {
    width,
    height,
    x,
    y,
    targetWidth,
    targetHeight: targetWidth,
    rotation: 0,
    dpr,
    orientation,
  };
}
export function canonicalResponse(text: string) {
  const value = text
    .toLowerCase()
    .trim()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ");
  const numbers: Record<string, string> = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
  };
  return (
    numbers[value] ??
    (/^(?:[a-z][ -]){1,}[a-z]$/.test(value)
      ? value.replace(/[ -]/g, "")
      : value)
  );
}
export function confirmTrial(trial: Trial, response: string): Trial {
  if (trial.phase !== "confirming")
    throw new Error("A response must be reviewed before confirmation.");
  if (!response.trim()) throw new Error("A response is required.");
  const confirmedAt = now();
  return {
    ...trial,
    phase: "feedback",
    response: response.trim(),
    confirmedAt,
    endedAt: confirmedAt,
    responseTimeMs:
      trial.presentedAt && trial.responseAt
        ? Date.parse(trial.responseAt) - Date.parse(trial.presentedAt)
        : undefined,
    correct: canonicalResponse(response) === canonicalResponse(trial.target),
  };
}
export function csvCell(value: unknown) {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return (
    '"' +
    (typeof value === "string" && /^[=+@\-\t\r]/.test(text)
      ? "'" + text
      : text
    ).replaceAll('"', '""') +
    '"'
  );
}
