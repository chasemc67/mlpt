import JSZip from "jszip";
import { isNative, NativeRecorder } from "./audio";
import { getSessionData } from "./db";
import { csvCell } from "./model";
import { overlaySvg } from "./stimulus";
export async function createSessionArchive(
  data: Awaited<ReturnType<typeof getSessionData>>,
) {
  const zip = new JSZip();
  const metadata = {
    ...data,
    media: data.media.map(({ blob, ...m }) => ({
      ...m,
      mimeType: blob.type,
      bytes: blob.size,
    })),
  };
  zip.file("session.json", JSON.stringify(metadata, null, 2));
  const columns = [
    "id",
    "sessionId",
    "participantId",
    "index",
    "category",
    "mode",
    "task",
    "projectPhase",
    "stimulusReference",
    "actualBrightness",
    "target",
    "response",
    "correct",
    "phase",
    "presentedAt",
    "responseAt",
    "confirmedAt",
    "responseTimeMs",
    "config",
    "geometry",
    "randomization",
    "flags",
  ] as const;
  zip.file(
    "trials.csv",
    "\uFEFF" +
      [
        columns.join(","),
        ...data.trials.map((t) => columns.map((c) => csvCell(t[c])).join(",")),
      ].join("\r\n"),
  );
  const touchColumns = [
    "trialId",
    "at",
    "elapsedMs",
    "type",
    "x",
    "y",
    "pointerId",
    "pointerType",
    "pressure",
    "contactWidth",
    "contactHeight",
  ] as const;
  zip.file(
    "touches.csv",
    "\uFEFF" +
      [
        touchColumns.join(","),
        ...data.touches.map((t) =>
          touchColumns.map((c) => csvCell(t[c])).join(","),
        ),
      ].join("\r\n"),
  );
  for (const trial of data.trials) {
    if (trial.geometry)
      zip.file(
        `overlays/trial-${trial.index}.svg`,
        overlaySvg(
          trial,
          data.touches.filter((t) => t.trialId === trial.id),
        ),
      );
    const chunks = data.media
      .filter((m) => m.trialId === trial.id && m.kind === "audio")
      .sort((a, b) => a.sequence - b.sequence);
    if (chunks.length) {
      const mime = chunks[0].blob.type;
      const extension = mime.includes("mp4")
        ? "m4a"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("caf")
            ? "caf"
            : "webm";
      zip.file(
        `audio/trial-${trial.index}.${extension}`,
        await new Blob(
          chunks.map((c) => c.blob),
          { type: mime },
        ).arrayBuffer(),
      );
    }
  }
  zip.file(
    "README.txt",
    "MLPT local export, schema version 1.\nSession and trial timestamps are UTC. Coordinates are CSS pixels relative to the experimental area, with origin at top left. Raw touch samples are unsmoothed. Audio chunks are ordered before concatenation. Only confirmed responses are scored. See session.json for full configuration, randomization draws, events and quality flags. CSV files are UTF-8 with BOM and open in Excel. Device-local storage is not a central server backup.",
  );
  return zip;
}
export async function exportSession(id: string) {
  const data = await getSessionData(id);
  if (data.session.status === "active")
    throw new Error("Finish the session before exporting.");
  const zip = await createSessionArchive(data);
  if (isNative()) {
    const payload = await zip.generateAsync({ type: "base64" });
    await NativeRecorder.shareExport({
      base64: payload,
      filename: `mlpt-${data.session.participantId}-${id.slice(0, 8)}.zip`,
    });
    return;
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mlpt-${data.session.participantId}-${id.slice(0, 8)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
