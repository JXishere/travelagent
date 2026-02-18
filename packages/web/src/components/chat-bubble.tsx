"use client";

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
