import Dexie, { type Table } from "dexie";
import {
  DEFAULT_CONFIG,
  configSchema,
  now,
  uid,
  type Config,
  type Session,
  type Trial,
  type Touch,
  type Audit,
  type MediaChunk,
} from "./model";
export class MLPTDatabase extends Dexie {
  sessions!: Table<Session, string>;
  trials!: Table<Trial, string>;
  touches!: Table<Touch, string>;
  events!: Table<Audit, string>;
  media!: Table<MediaChunk, string>;
  settings!: Table<{ id: string; value: Config }, string>;
  constructor(name = "mlpt-local-v1") {
    super(name);
    this.version(1).stores({
      sessions: "id,startedAt,status,participantId",
      trials: "id,sessionId,[sessionId+index],phase",
      touches: "id,trialId",
      events: "id,sessionId,trialId,at",
      media: "id,trialId,[trialId+sequence]",
      settings: "id",
    });
  }
}
export const db = new MLPTDatabase();
export async function getConfig() {
  const saved = await db.settings.get("last-config");
  return saved ? configSchema.parse(saved.value) : DEFAULT_CONFIG;
}
export async function saveConfig(value: Config) {
  await db.settings.put({
    id: "last-config",
    value: configSchema.parse(value),
  });
}
export async function logEvent(
  sessionId: string,
  event: string,
  trialId?: string,
  details?: unknown,
) {
  await db.events.add({
    id: uid(),
    sessionId,
    trialId,
    at: now(),
    event,
    clockMs: performance.timeOrigin + performance.now(),
    details,
  });
}
export async function saveTrial(
  trial: Trial,
  event: string,
  details?: unknown,
) {
  await db.transaction("rw", db.trials, db.events, async () => {
    await db.trials.put(trial);
    await logEvent(trial.sessionId, event, trial.id, details);
  });
}
export async function recoverInterruptedSessions() {
  await db.transaction("rw", db.sessions, db.trials, db.events, async () => {
    const active = await db.sessions.where("status").equals("active").toArray();
    for (const session of active) {
      await db.sessions.update(session.id, {
        status: "interrupted",
        endedAt: now(),
      });
      const trials = await db.trials
        .where("sessionId")
        .equals(session.id)
        .toArray();
      for (const trial of trials.filter((t) => t.phase !== "feedback"))
        await db.trials.put({
          ...trial,
          phase: "interrupted",
          endedAt: now(),
          flags: [...trial.flags, "interrupted_before_confirmation"],
        });
      await logEvent(session.id, "session_recovered_as_interrupted");
    }
  });
}
export async function getSessionData(id: string) {
  const session = await db.sessions.get(id);
  if (!session) throw new Error("Session not found");
  const trials = (await db.trials.where("sessionId").equals(id).toArray()).sort(
    (a, b) => a.index - b.index,
  );
  const ids = trials.map((t) => t.id);
  return {
    schemaVersion: 1,
    exportedAt: now(),
    session,
    trials,
    touches: await db.touches.where("trialId").anyOf(ids).toArray(),
    events: (await db.events.where("sessionId").equals(id).toArray()).sort(
      (a, b) =>
        (a.clockMs ?? Date.parse(a.at)) - (b.clockMs ?? Date.parse(b.at)),
    ),
    media: await db.media.where("trialId").anyOf(ids).toArray(),
  };
}
