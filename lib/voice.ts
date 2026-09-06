export type VoiceContext = "ready" | "exploring" | "answering" | "confirming" | "feedback" | "ending";
export type VoiceAction = "start" | "finish" | "confirm" | "change" | "next" | "repeat" | "end" | "cancel";

export function voiceAction(context: VoiceContext, transcript: string): VoiceAction | null {
  const text = transcript.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/^mlpt /, "");
  // Whole utterances only: free exploration must never accidentally advance a trial.
  if (["repeat", "repeat that", "help", "repeat instructions"].includes(text)) return "repeat";
  if (context === "ending") {
    if (["yes", "yes please", "end session", "stop session"].includes(text)) return "end";
    if (["no", "cancel", "keep going", "continue"].includes(text)) return "cancel";
    return null;
  }
  if (["end session", "stop session"].includes(text)) return "end";
  if (context === "ready" && ["start", "start session", "begin session", "start training", "begin training"].includes(text)) return "start";
  if (context === "exploring" && ["finish trial", "end trial", "finish exploring", "im done", "done"].includes(text)) return "finish";
  if (context === "confirming") {
    if (["yes", "yes correct", "correct", "thats correct", "confirm", "confirm answer"].includes(text)) return "confirm";
    if (["no", "no change", "change", "change answer", "try again", "thats wrong"].includes(text)) return "change";
  }
  if (context === "feedback" && ["next", "next trial", "continue", "finish session"].includes(text)) return "next";
  return null;
}

export function voicePrompt(context: VoiceContext, index = 0, answer = "", last = false, handsFree = true) {
  if (!handsFree) {
    switch (context) {
      case "ready": return "Welcome to MLPT. Use the Start session button when you are ready.";
      case "exploring": return `Trial ${index}. Explore freely. Use the Finish trial button when you are ready to give your answer.`;
      case "answering": return "Give your final answer, then use the Use this answer button. You can also type your answer.";
      case "confirming": return `You said ${answer}. Is that correct? Use Yes to confirm, or Change to try again.`;
      case "feedback": return last ? "Use Finish session when you are ready." : "Use Next trial when you are ready.";
      case "ending": return "End this session? Use Yes, end session to end, or Keep going to continue.";
    }
  }
  switch (context) {
    case "ready": return "Welcome to MLPT. Say start session when you are ready. You can say repeat for help.";
    case "exploring": return `Trial ${index}. Explore freely. Say finish trial when you are ready to give your answer.`;
    case "answering": return "Please say or spell your final answer. I will read it back to you.";
    case "confirming": return `You said ${answer}. Is that correct? Say yes, or say change.`;
    case "feedback": return last ? "Say finish session when you are ready." : "Say next trial when you are ready.";
    case "ending": return "End this session? Say yes to end, or no to keep going. Your saved answers will be kept.";
  }
}
