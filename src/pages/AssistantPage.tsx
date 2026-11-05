import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Clipboard, FlaskConical, Loader2, Mic, MicOff, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type ChatMessage = { role: "user" | "assistant"; content: string };
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

const STARTERS = [
  "What was my best week?",
  "What is my average weekly income?",
  "Which week had the strongest performance?",
  "What achievements have I unlocked recently?",
  "What pattern do you see in my recent weeks?",
  "Which pickup zones have the strongest confirmed earnings?",
  "Today Thursday I only want to work 4 hours. What broad zone and time window should I test from my data?",
];

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-my-data`;
const VOICE_UNSUPPORTED = "Voice input is not available on this device/browser yet.";

function extractStreamDelta(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    return parsed?.choices?.[0]?.delta?.content ??
      parsed?.choices?.[0]?.message?.content ??
      parsed?.text ??
      "";
  } catch {
    return "";
  }
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function formatConversation(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Streex AI"}:\n${message.content.trim()}`)
    .join("\n\n");
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseInputRef = useRef("");
  const { toast } = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }, [input]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("You're signed out. Please sign in again.");
        return;
      }
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: next, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (res.status === 429) setError("Rate limit reached. Wait a moment and try again.");
        else if (res.status === 402) setError("AI billing needs attention. Please try again later.");
        else if (res.status === 401) setError("Authentication issue. Please sign in again.");
        else setError(json?.error || "The assistant is unavailable right now.");
        return;
      }

      if (res.body && res.headers.get("Content-Type")?.includes("text/event-stream")) {
        const assistantIndex = next.length;
        setMessages([...next, { role: "assistant", content: "" }]);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullReply = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              const delta = extractStreamDelta(payload);
              if (!delta) continue;
              fullReply += delta;
              setMessages((current) =>
                current.map((message, index) =>
                  index === assistantIndex
                    ? { ...message, content: fullReply }
                    : message,
                ),
              );
            }
          }
        }

        if (!fullReply) {
          setMessages((current) => current.filter((_, index) => index !== assistantIndex));
          setError("The assistant returned an empty response. Please try again.");
        }
        return;
      }

      const json = await res.json().catch(() => ({}));
      const reply: string = json?.text ?? "(empty response)";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyConversation() {
    const text = formatConversation(messages);
    if (!text) {
      toast({ title: "Nothing to copy yet." });
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Conversation copied." });
    } catch {
      toast({ title: "Copy failed.", variant: "destructive" });
    }
  }

  function toggleVoiceInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      toast({ title: VOICE_UNSUPPORTED });
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognitionRef.current = recognition;
      voiceBaseInputRef.current = input.trim();
      let finalTranscript = "";

      recognition.onresult = (event) => {
        let interimTranscript = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) finalTranscript += result[0].transcript;
          else interimTranscript += result[0].transcript;
        }
        const spokenText = `${finalTranscript}${interimTranscript}`.trim();
        setInput([voiceBaseInputRef.current, spokenText].filter(Boolean).join(" "));
      };

      recognition.onerror = (event) => {
        setListening(false);
        const title = event.error === "not-allowed"
          ? "Microphone permission was denied."
          : "Voice input stopped.";
        toast({ title });
      };

      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        inputRef.current?.focus();
      };

      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      toast({ title: VOICE_UNSUPPORTED });
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.75rem)] min-h-[420px] max-w-3xl min-w-0 flex-col overflow-hidden px-3 py-3 sm:h-[calc(100dvh-8rem)] sm:px-4 sm:py-6">
      <header className="mb-3 shrink-0 space-y-2">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />
              <h1 className="min-w-0 text-xl font-semibold leading-tight">Ask My Data</h1>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <FlaskConical className="h-3 w-3" /> OpenAI Beta
              </span>
            </div>
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              Chat with your earnings. Beta — answers are based only on your Streex data.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-2 text-xs"
            onClick={copyConversation}
            disabled={messages.length === 0}
            title={messages.length === 0 ? "Nothing to copy yet" : "Copy conversation"}
          >
            <Clipboard className="h-3.5 w-3.5" />
            <span className="hidden min-[420px]:inline">Copy</span>
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card/40 p-3 sm:space-y-4 sm:p-4"
      >
        {messages.length === 0 && (
          <div className="space-y-3 pb-2">
            <p className="text-sm text-muted-foreground">Try a starter:</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`min-w-0 max-w-[88%] break-words rounded-2xl px-3 py-2.5 text-sm sm:max-w-[85%] sm:px-4 ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="shrink-0 pt-3"
      >
        <div className="flex min-w-0 items-end gap-2 rounded-xl border border-border bg-background p-2 shadow-sm">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything about your earnings…"
            rows={1}
            className="max-h-24 min-h-10 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-base leading-5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
            disabled={loading}
          />
          <Button
            type="button"
            variant={listening ? "secondary" : "ghost"}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-lg"
            onClick={toggleVoiceInput}
            disabled={loading}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            title={listening ? "Stop voice input" : "Start voice input"}
          >
            {listening ? <MicOff className="h-4 w-4 text-primary" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button type="submit" className="h-10 w-10 shrink-0 rounded-lg p-0" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>

      <p className="mt-2 shrink-0 pb-[max(env(safe-area-inset-bottom),0.25rem)] text-center text-[10px] text-muted-foreground/70">
        Beta · responses may be imperfect · AI questions and summarized data may be sent to OpenAI
      </p>
    </div>
  );
}
