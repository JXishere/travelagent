"use client";

import { useEffect, useState } from "react";

/** Format a timestamp as relative time */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Render inline formatting: **bold**, *italic* */
function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-b-${match.index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={`${keyPrefix}-i-${match.index}`}>{match[3]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes;
}

/** Render light markdown: **bold**, *italic*, bullet lists, and line breaks */
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const paragraphs = text.split(/\n\n+/);

  paragraphs.forEach((para, pi) => {
    if (pi > 0) nodes.push(<br key={`br-${pi}`} />);

    const lines = para.split("\n");

    // Check if this paragraph is a bullet list
    const bulletLines = lines.filter((l) => /^\s*[-•]\s/.test(l));
    const isBulletList = bulletLines.length > 0 && bulletLines.length >= lines.length * 0.5;

    if (isBulletList) {
      const listItems: React.ReactNode[] = [];
      lines.forEach((line, li) => {
        const bulletMatch = line.match(/^\s*[-•]\s+(.*)/);
        if (bulletMatch) {
          listItems.push(
            <li key={`li-${pi}-${li}`}>
              {renderInline(bulletMatch[1], `${pi}-${li}`)}
            </li>
          );
        } else if (line.trim()) {
          // Non-bullet line in a mostly-bullet paragraph — render as text before list
          nodes.push(...renderInline(line, `${pi}-${li}`));
          nodes.push(<br key={`ln-${pi}-${li}`} />);
        }
      });
      if (listItems.length > 0) {
        nodes.push(
          <ul key={`ul-${pi}`} className="my-1 ml-4 list-disc space-y-0.5">
            {listItems}
          </ul>
        );
      }
    } else {
      lines.forEach((line, li) => {
        if (li > 0) nodes.push(<br key={`ln-${pi}-${li}`} />);
        nodes.push(...renderInline(line, `${pi}-${li}`));
      });
    }
  });

  return nodes;
}

export function ChatBubble({
  role,
  content,
  timestamp,
}: {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}) {
  const isUser = role === "user";
  const [timeStr, setTimeStr] = useState(() => timestamp ? relativeTime(timestamp) : "");
  const [copied, setCopied] = useState(false);

  // Update relative time every 30s
  useEffect(() => {
    if (!timestamp) return;
    const interval = setInterval(() => {
      setTimeStr(relativeTime(timestamp));
    }, 30000);
    return () => clearInterval(interval);
  }, [timestamp]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div className="flex flex-col" style={{ maxWidth: "80%" }}>
        <div
          className={`group relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isUser
              ? "rounded-br-sm"
              : "rounded-bl-sm"
          }`}
          style={{
            backgroundColor: isUser ? "var(--green)" : "var(--bar-bg)",
            color: isUser ? "var(--bg)" : "var(--fg)",
          }}
        >
          {isUser ? content : renderMarkdown(content)}
          {!isUser && (
            <button
              onClick={handleCopy}
              className="absolute top-1.5 right-1.5 rounded p-1.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-70 sm:hover:!opacity-100 max-sm:opacity-50"
              style={{ color: "var(--muted)" }}
              aria-label="Copy message"
            >
              {copied ? (
                <span className="text-[11px]">Copied!</span>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
        {timeStr && (
          <span
            className={`mt-1 text-[11px] ${isUser ? "text-right" : "text-left"}`}
            style={{ color: "var(--muted)", opacity: 0.6 }}
          >
            {timeStr}
          </span>
        )}
      </div>
    </div>
  );
}
