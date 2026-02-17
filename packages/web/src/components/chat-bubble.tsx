"use client";

/** Render light markdown: **bold**, *italic*, and \n line breaks */
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split into paragraphs on double newlines
  const paragraphs = text.split(/\n\n+/);

  paragraphs.forEach((para, pi) => {
    if (pi > 0) nodes.push(<br key={`br-${pi}`} />);

    // Process inline formatting within each paragraph
    const lines = para.split("\n");
    lines.forEach((line, li) => {
      if (li > 0) nodes.push(<br key={`ln-${pi}-${li}`} />);

      // Match **bold**, *italic*, and plain text segments
      const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(line)) !== null) {
        // Plain text before this match
        if (match.index > lastIndex) {
          nodes.push(line.slice(lastIndex, match.index));
        }

        if (match[2]) {
          // **bold**
          nodes.push(<strong key={`b-${pi}-${li}-${match.index}`}>{match[2]}</strong>);
        } else if (match[3]) {
          // *italic*
          nodes.push(<em key={`i-${pi}-${li}-${match.index}`}>{match[3]}</em>);
        }

        lastIndex = match.index + match[0].length;
      }

      // Remaining plain text
      if (lastIndex < line.length) {
        nodes.push(line.slice(lastIndex));
      }
    });
  });

  return nodes;
}

export function ChatBubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-sm"
            : "rounded-bl-sm"
        }`}
        style={{
          backgroundColor: isUser ? "var(--green)" : "var(--bar-bg)",
          color: isUser ? "#0a0a0a" : "var(--fg)",
        }}
      >
        {isUser ? content : renderMarkdown(content)}
      </div>
    </div>
  );
}
