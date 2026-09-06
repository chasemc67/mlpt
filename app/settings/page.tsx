"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getConfig, saveConfig } from "@/lib/db";
import { DEFAULT_CONFIG, configSchema, type Config } from "@/lib/model";
export default function Settings() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    getConfig()
      .then(setConfig)
      .then(() => setLoaded(true))
      .catch(() => setError("Unable to open the local database."));
  }, []);
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const result = configSchema.safeParse(config);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    try {
      await saveConfig(result.data);
      setMessage(
        "Configuration saved. Your next session will use these settings.",
      );
    } catch {
      setError("Configuration could not be saved. Check available storage.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Before your session</p>
          <h1>Session setup</h1>
          <p className="muted">
            Your saved settings are ready. Change only what you need.
          </p>
        </div>
        <Button asChild className="secondary">
          <Link href="/">
            <ArrowLeft size={18} />
            Training
          </Link>
        </Button>
      </div>
      <form onSubmit={save} className="card compact-setup">
        <fieldset disabled={!loaded}>
          <legend>Training basics</legend>
          <div className="form-grid">
            <label>
              Participant study ID
              <input
                value={config.participantId}
                maxLength={64}
                required
                onChange={(e) => set("participantId", e.target.value)}
                aria-describedby="id-help"
              />
              <small id="id-help" className="muted">
                A local label for your sessions; no account is created.
              </small>
            </label>
            <label>
              Target category
              <select
                value={config.category}
                onChange={(e) =>
                  set("category", e.target.value as Config["category"])
                }
              >
                {["shapes", "colors", "numbers", "letters", "words"].map(
                  (v) => (
                    <option key={v} value={v}>
                      {v[0].toUpperCase() + v.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Number of trials
              <input
                type="number"
                min={0}
                max={100}
                value={config.trials}
                onChange={(e) => set("trials", Number(e.target.value))}
              />
              <small className="muted">Use 0 for an open-ended session.</small>
            </label>

          </div>
          <details className="setup-advanced">
            <summary>More settings</summary>
          <div className="form-section">
            <h2>Target presentation</h2>
            <p className="muted small">
              Targets are selected with a cryptographically secure random
              generator.
            </p>
            <div className="form-grid">
              <label>
                Target position
                <select
                  value={config.position}
                  onChange={(e) =>
                    set("position", e.target.value as Config["position"])
                  }
                >
                  <option value="center">Centered</option>
                  <option value="random">Randomized</option>
                </select>
              </label>
              <label>
                Allowed area
                <select
                  value={config.area}
                  onChange={(e) =>
                    set("area", e.target.value as Config["area"])
                  }
                >
                  <option value="central">Central 60% of the screen</option>
                  <option value="full">Full experimental area</option>
                </select>
              </label>
              <label>
                Target size
                <select
                  value={config.size}
                  onChange={(e) =>
                    set("size", e.target.value as Config["size"])
                  }
                >
                  {["small", "medium", "large", "random"].map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Line thickness (pixels)
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={config.lineWidth}
                  onChange={(e) => set("lineWidth", Number(e.target.value))}
                />
              </label>
              <label>
                Target color
                <input
                  type="color"
                  value={config.targetColor}
                  onChange={(e) => set("targetColor", e.target.value)}
                />
                <small className="muted">
                  Color trials use their selected target color.
                </small>
              </label>
              <label>
                Background color
                <input
                  type="color"
                  value={config.backgroundColor}
                  onChange={(e) => set("backgroundColor", e.target.value)}
                />
              </label>
              <label>
                Target opacity · {Math.round(config.contrast * 100)}%
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={config.contrast}
                  onChange={(e) => set("contrast", Number(e.target.value))}
                />
                <small className="muted">
                  Controls contrast by blending with the background.
                </small>
              </label>
              <label>
                Screen brightness · {Math.round(config.brightness * 100)}%
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={config.brightness}
                  onChange={(e) => set("brightness", Number(e.target.value))}
                />
                <small className="muted">
                  Applied in the iPad app. In a browser, set brightness
                  manually.
                </small>
              </label>
            </div>
          </div>
          <div className="form-section stack">
            <h2>Accessible controls</h2>
            <label>
              Speech recognition
              <select
                value={config.speechProvider}
                onChange={(e) =>
                  set(
                    "speechProvider",
                    e.target.value as Config["speechProvider"],
                  )
                }
              >
                <option value="device">Device speech recognition</option>
                <option value="gateway">Vercel AI Gateway</option>
              </select>
              <small className="muted">
                AI Gateway requires a configured voice server and internet.
              </small>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={config.tripleTap}
                onChange={(e) => set("tripleTap", e.target.checked)}
              />
              <span>
                Triple tap to finish exploring
                <small>
                  Optional for blindfolded use without VoiceOver. A large button
                  and external keyboard are always available.
                </small>
              </span>
            </label>
          </div>
          </details>
          <div className="actions">
            <Button type="submit" className="primary">
              <Save size={18} />
              Save settings
            </Button>
            <Button asChild className="secondary"><Link href="/">Back to session</Link></Button>
          </div>
        </fieldset>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="message error">
            {error}
          </p>
        )}
      </form>
    </>
  );
}
