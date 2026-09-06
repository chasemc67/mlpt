import Link from "next/link";
export default function Guide() {
  return (
    <article className="prose">
      <p className="eyebrow">Getting comfortable</p>
      <h1>How training works</h1>
      <p>
        MLPT presents a target while you explore the tablet by touch and
        describe what you perceive. Each trial is self-paced.
      </p>
      <h2>Before you begin</h2>
      <ol>
        <li>Check your configuration and audio volume.</li>
        <li>
          Allow microphone access. Every trial records audio, including your
          exploration and final response.
        </li>
        <li>
          Position your tablet securely. If you use a blindfold, put it on when
          you are ready to start.
        </li>
      </ol>
      <h2>During a trial</h2>
      <p>
        A short tone marks the start. Explore the target area and speak freely.
        Your exploration speech is recorded, but it is not treated as an answer.
      </p>
      <p>
        Say <strong>“Start session”</strong> from the ready screen. During a trial,
        say <strong>“Finish trial”</strong> when you are ready to answer. After the
        prompt, say or spell your final answer. The app reads it back: say
        <strong> “Yes”</strong> to confirm, or <strong>“Change”</strong> to try again.
        Then hear the actual target and say <strong>“Next trial”</strong> when ready.
      </p>
      <p>
        Say <strong>“Repeat”</strong> for the current instruction. Say
        <strong> “End session”</strong> to stop; the app asks for confirmation.
        Each step also has a large button. If speech recognition is unavailable,
        use those buttons and the answer field. A browser may require an initial
        tap on Enable voice controls. The iPad app listens after its initial
        microphone and speech permissions have been granted.
      </p>
      <p>
        Wait until the spoken prompt finishes before speaking. Short commands
        must be said on their own; ordinary exploration speech does not advance
        the trial. Control + Enter activates the primary trial button on an
        external keyboard.
      </p>
      <p>
        VoiceOver users can navigate standard buttons normally. The visual
        target is hidden from the accessibility tree until feedback, so it is
        not announced as the answer. VoiceOver touch exploration and raw finger
        tracing can conflict; use the external keyboard or a sighted facilitator
        when evaluating the tracing task.
      </p>
      <h2>Your data</h2>
      <p>
        Sessions, raw touch samples, recordings and settings stay in this app’s
        local database. There is no account or server synchronization yet.
        Export a session from <Link href="/sessions/">Session history</Link> to
        keep a separate copy. Clearing browser data or uninstalling the app may
        remove local sessions.
      </p>
      <p>
        On iPad, device recognition uses Apple’s on-device speech when
        available. Browser recognition may use the browser vendor’s online
        service. Selecting AI Gateway sends only the final-answer audio to the
        configured voice service; the rest of the trial audio stays local.
        The Gateway option currently requires the Use this answer button to end
        that audio segment. Device speech is the default for hands-free answers.
      </p>
      <h2>If a session is interrupted</h2>
      <p>
        Return to training to close the interrupted session. Data already saved
        remain available in history. Start a new session to continue; an
        unfinished trial is never scored as a confirmed answer.
      </p>
      <Link className="button primary" href="/">
        Back to training
      </Link>
    </article>
  );
}
