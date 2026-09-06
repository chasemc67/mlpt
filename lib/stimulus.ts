import { COLORS, type Trial, type Touch } from "./model";
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function targetMarkup(trial: Trial) {
  const g = trial.geometry;
  if (!g) return "";
  const { x, y, targetWidth: w, targetHeight: h } = g;
  const color =
    trial.category === "colors"
      ? COLORS[trial.target]
      : trial.config.targetColor;
  const attrs = `fill="${color}" stroke="${color}" stroke-width="${trial.config.lineWidth}" opacity="${trial.config.contrast}"`;
  if (trial.category === "colors" || trial.target === "square")
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`;
  if (trial.target === "circle")
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
  if (trial.target === "triangle")
    return `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}" ${attrs}/>`;
  if (trial.target === "diamond")
    return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${attrs}/>`;
  return `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="${trial.category === "words" ? w / 4 : w * 0.85}" ${attrs}>${escape(trial.target)}</text>`;
}
export function overlaySvg(trial: Trial, touches: Touch[]) {
  const g = trial.geometry;
  if (!g) return "";
  const paths: string[] = [];
  const active = new Map<number, string>();
  for (const t of [...touches].sort((a, b) => a.elapsedMs - b.elapsedMs)) {
    if (t.type === "DOWN") active.set(t.pointerId, `M ${t.x} ${t.y}`);
    else {
      const path = active.get(t.pointerId);
      if (path) active.set(t.pointerId, path + ` L ${t.x} ${t.y}`);
    }
    if (t.type === "UP" || t.type === "CANCEL") {
      const p = active.get(t.pointerId);
      if (p) paths.push(p);
      active.delete(t.pointerId);
    }
  }
  paths.push(...active.values());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}"><rect width="100%" height="100%" fill="${trial.config.backgroundColor}"/>${targetMarkup(trial)}${paths.map((d) => `<path d="${d}" fill="none" stroke="#00ffff" stroke-width="1.5" stroke-linecap="round"/>`).join("")}</svg>`;
}
