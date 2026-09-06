"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, ArrowLeft, History, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db, getSessionData } from "@/lib/db";
import { exportSession } from "@/lib/export";
import { overlaySvg } from "@/lib/stimulus";
import type { Session } from "@/lib/model";
type Detail = Awaited<ReturnType<typeof getSessionData>>;
function TrialReview({ data, trialId }: { data: Detail; trialId: string }) {
  const trial = data.trials.find((t) => t.id === trialId)!;
  const [audioUrl, setAudioUrl] = useState(""),
    [overlayUrl, setOverlayUrl] = useState("");
  useEffect(() => {
    const chunks = data.media
      .filter((m) => m.trialId === trial.id && m.kind === "audio")
      .sort((a, b) => a.sequence - b.sequence);
    const a = chunks.length
      ? URL.createObjectURL(
          new Blob(
            chunks.map((c) => c.blob),
            { type: chunks[0].blob.type },
          ),
        )
      : "";
    const o = trial.geometry
      ? URL.createObjectURL(
          new Blob(
            [
              overlaySvg(
                trial,
                data.touches.filter((t) => t.trialId === trial.id),
              ),
            ],
            { type: "image/svg+xml" },
          ),
        )
      : "";
    setAudioUrl(a);
    setOverlayUrl(o);
    return () => {
      if (a) URL.revokeObjectURL(a);
      if (o) URL.revokeObjectURL(o);
    };
  }, [data, trial]);
  return (
    <details className="review-trial">
      <summary>
        Trial {trial.index} · {trial.target} ·{" "}
        {trial.response
          ? `“${trial.response}” · ${trial.correct ? "Match" : "No match"}`
          : "Unconfirmed"}
      </summary>
      <div className="review-grid">
        <div>
          {overlayUrl ? (
            <img
              src={overlayUrl}
              alt={`Target ${trial.target} with raw touch trajectory in cyan`}
            />
          ) : (
            <p>No target was presented.</p>
          )}
        </div>
        <div>
          <p className="small muted">
            Response time:{" "}
            {trial.responseTimeMs !== undefined
              ? `${(trial.responseTimeMs / 1000).toFixed(2)} seconds`
              : "Not recorded"}
          </p>
          <p className="small muted">
            {data.touches.filter((t) => t.trialId === trial.id).length} raw
            touch samples · {trial.randomization.source}
          </p>
          <p className="small muted">
            {trial.confirmedAt
              ? `Confirmed ${new Date(trial.confirmedAt).toLocaleTimeString()}`
              : "No confirmed response"}
          </p>
          {audioUrl ? (
            <audio
              controls
              preload="none"
              src={audioUrl}
              aria-label={`Trial ${trial.index} recording`}
            />
          ) : (
            <p className="notice">
              No playable audio is available for this trial.
            </p>
          )}
          {trial.flags.length > 0 && (
            <p className="message error">
              Review flags: {trial.flags.join(", ")}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
export default function Sessions() {
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]),
    [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!detail) return;
    reviewHeading.current?.focus({ preventScroll: true });
    reviewHeading.current?.scrollIntoView({ block: "start" });
  }, [detail]);
  useEffect(() => {
    db.sessions
      .orderBy("startedAt")
      .reverse()
      .toArray()
      .then(setSessions)
      .then(() => setLoaded(true))
      .catch(() => setError("Unable to open session history."));
  }, []);
  async function review(id: string) {
    try {
      setError("");
      setDetail(await getSessionData(id));
    } catch {
      setError("Unable to load this session.");
    }
  }
  async function download(id: string) {
    setBusy(true);
    setError("");
    try {
      await exportSession(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your practice over time</p>
          <h1>Session history</h1>
          <p className="muted">
            Review recordings, touch paths and confirmed responses.
          </p>
        </div>
        <Button asChild className="secondary">
          <Link href="/">
            <ArrowLeft size={18} />
            Training
          </Link>
        </Button>
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {!loaded && !error ? (
        <p role="status" className="loading">
          Loading saved sessions…
        </p>
      ) : !sessions.length ? (
        <div className="empty">
          <History className="mx-auto mb-4 muted" size={30} />
          <h2>No sessions yet.</h2>
          <p>
            Your first session will appear here. Everything is stored on this
            device.
          </p>
          <Button asChild className="primary mt-5">
            <Link href="/train/">Begin training</Link>
          </Button>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">Saved training sessions</caption>
            <thead>
              <tr>
                <th>Date and time</th>
                <th>Participant</th>
                <th>Category</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.startedAt).toLocaleString()}</td>
                  <td>{s.participantId}</td>
                  <td className="capitalize">{s.config.category}</td>
                  <td className="capitalize">{s.status}</td>
                  <td>
                    <Button
                      className="secondary"
                      onClick={() => review(s.id)}
                      aria-label={`Review session from ${new Date(s.startedAt).toLocaleString()}`}
                    >
                      Review <ChevronDown size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <section className="card mt-6" aria-labelledby="review-heading">
          <div className="page-heading">
            <div>
              <h2 id="review-heading" ref={reviewHeading} tabIndex={-1}>
                Session review · {detail.session.participantId}
              </h2>
              <p className="small muted">
                {new Date(detail.session.startedAt).toLocaleString()} ·{" "}
                {detail.trials.filter((t) => t.confirmedAt).length} confirmed
                trials
              </p>
            </div>
            <Button
              disabled={busy || detail.session.status === "active"}
              className="primary"
              onClick={() => download(detail.session.id)}
            >
              <Download size={18} />
              {busy ? "Preparing export…" : "Export session"}
            </Button>
          </div>
          <p className="small muted">
            The ZIP includes CSV, JSON, audio and target images with touch
            overlays.
          </p>
          {detail.trials.map((t) => (
            <TrialReview key={t.id} data={detail} trialId={t.id} />
          ))}
          <details className="form-section">
            <summary>Configuration snapshot and event log</summary>
            <pre className="small overflow-auto p-4 bg-slate-50 rounded-lg">
              {JSON.stringify(
                {
                  config: detail.session.config,
                  device: detail.session.device,
                  events: detail.events,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      )}
    </>
  );
}
