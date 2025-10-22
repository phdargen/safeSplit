import { MemorySaver } from "@langchain/langgraph";

export async function dumpMemory(memory: MemorySaver, threadId: string): Promise<void> {
    const cfg = { configurable: { thread_id: threadId } };
  
    // get the freshest checkpoint (list()[0] is usually the latest)
    const history: any[] = [];
    for await (const it of memory.list(cfg)) history.push(it);
    const latest = history[0] ?? (await memory.get(cfg));
  
    if (!latest?.checkpoint?.channel_values) {
      console.log("🧠 No stored messages yet for this thread.");
      return;
    }
  
    // console.log("latest", latest);
  
    // collect messages from every channel (messages, __start__, agent, tools, etc.)
    const chvals = latest.checkpoint.channel_values;
    const allMsgs: any[] = [];
  
    // common spot
    if (Array.isArray(chvals.messages)) allMsgs.push(...chvals.messages);
  
    // other channels (like "__start__")
    for (const v of Object.values(chvals)) {
      if (v && Array.isArray((v as any).messages)) {
        allMsgs.push(...(v as any).messages);
      }
    }
  
    if (allMsgs.length === 0) {
      console.log("🧠 No stored messages yet for this thread.");
      return;
    }
  
    const getKind = (m: any) => {
      const ctor = m?.constructor?.name?.toLowerCase?.() || "";
      if (m?._type) return String(m._type).toLowerCase();
      if (m?.type) return String(m.type).toLowerCase();
      if (ctor.endsWith("message")) return ctor.replace("message", "");
      return ctor || "unknown";
    };
  
    const toText = (content: any): string => {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        // chunked content: [{type:"text", text:"..."}]
        return content.map((c: any) => c?.text ?? "").join("");
      }
      if (content && typeof content === "object" && typeof content.text === "string") {
        return content.text;
      }
      try { return JSON.stringify(content); } catch { return String(content); }
    };
  
    // keep order as stored (usually input-first). If you want strict chronological
    // across multiple checkpoints, iterate all of `history` newest→oldest and reverse.
    console.log("\n🧠 MemorySaver messages (SYSTEM & HUMAN):");
    for (const m of allMsgs) {
      const kind = getKind(m);
      if (kind === "system" || kind === "human") {
        console.log(`• [${kind.toUpperCase()}] ${toText(m.content)}`);
      }
    }
    console.log("-------------------------\n");
  }