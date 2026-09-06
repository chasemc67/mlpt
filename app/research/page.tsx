"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { db } from "@/lib/db";
import type { Session, Trial } from "@/lib/model";
import { Button } from "@/components/ui/button";

export default function ResearchOverview() {
  const [data, setData] = useState<{ sessions: Session[]; trials: Trial[] }>();
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([db.sessions.orderBy("startedAt").reverse().toArray(), db.trials.toArray()])
      .then(([sessions, trials]) => setData({ sessions, trials }))
      .catch(() => setError("Could not open the local session data."));
  }, []);
  const confirmed = data?.trials.filter(t => t.confirmedAt) || [];
  return <>
    <div className="page-heading"><div><p className="eyebrow">Training workspace</p><h1>Overview</h1><p className="muted">Review local training sessions and prepare the next session.</p></div>
      <Button asChild className="primary"><Link href="/settings/"><SlidersHorizontal aria-hidden="true"/>Session setup</Link></Button></div>
    {error && <p role="alert" className="message error">{error}</p>}
    {!data ? <p role="status">Loading local sessions…</p> : <>
      <div className="research-stats">
        {[['Participant IDs', new Set(data.sessions.map(s => s.participantId)).size], ['Sessions',data.sessions.length], ['Confirmed trials',confirmed.length], ['Exact matches',confirmed.length ? Math.round(100*confirmed.filter(t => t.correct).length/confirmed.length)+'%' : '—']].map(([label,value]) => <div className="card" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <section className="card"><div className="page-heading"><h2>Recent sessions</h2><Link className="summary-review" href="/sessions/">View all sessions <ArrowRight size={16} className="inline"/></Link></div>
        {data.sessions.length ? <div className="table-scroll"><table><thead><tr><th>Participant</th><th>Date</th><th>Status</th><th>Trials</th><th>Match rate</th></tr></thead><tbody>
          {data.sessions.slice(0,8).map(s => { const trials=confirmed.filter(t=>t.sessionId===s.id);return <tr key={s.id}><td>{s.participantId}</td><td>{new Date(s.startedAt).toLocaleString()}</td><td><span className="pill">{s.status}</span></td><td>{trials.length}</td><td>{trials.length ? Math.round(100*trials.filter(t=>t.correct).length/trials.length)+'%' : '—'}</td></tr>; })}
        </tbody></table></div> : <p className="muted">Completed sessions will appear here after training on this device.</p>}
      </section>
      <p className="small muted mt-5">This workspace shows data stored on this device. Cloud accounts and remote researcher access are planned for a later stage.</p>
    </>}
  </>;
}
