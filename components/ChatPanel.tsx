import React, { useState } from "react";
import { Send, Sparkles } from "lucide-react";

interface ChatPanelProps {
  onGenerateDesign?: (prompt: string) => Promise<string | void> | string | void;
  disabled?: boolean;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ onGenerateDesign, disabled = false }) => {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; content: string }[]
  >([
    {
      role: "ai",
      content: "Hey! Describe a pixel art design and I'll generate it for you. Try something like \"a small house\" or \"a heart shape\".",
    },
  ]);

  const handleSend = async () => {
    if (!message.trim()) return;
    const userMsg = message.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setMessage("");
    setMessages((prev) => [
      ...prev,
      { role: "ai", content: "Generating..." },
    ]);

    try {
      const reply = await onGenerateDesign?.(userMsg);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "ai", content: reply || "Done. The design is on the canvas." },
      ]);
    } catch (error) {
      console.error("Design generation failed", error);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "ai",
          content: "Sorry, I couldn't generate that. Try another prompt.",
        },
      ]);
    }
  };

  return (
    <div className={`flex flex-col bg-chat-bg border border-border rounded-lg overflow-hidden ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          AI Design Assistant
        </span>
      </div>

      <div className="flex-1 max-h-[150px] min-h-[100px] overflow-y-auto p-3 space-y-2">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-3 py-1.5 rounded-lg text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 p-2 border-t border-border">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Describe a design..."
          className="flex-1 bg-chat-input text-foreground text-sm px-3 py-2 rounded-md border border-border focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
        />
        <button
          onClick={handleSend}
          className="p-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default ChatPanel;
