import React from "react";

export interface MentionRange {
  start: number;
  end: number;
  type: "agent" | "user";
}

export interface MentionOverlayProps {
  text: string;
  mentions?: MentionRange[];
}

export default function MentionOverlay({ text, mentions = [] }: MentionOverlayProps) {
  if (mentions.length === 0) {
    return <div className="mention-overlay">{text}</div>;
  }

  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const mention of sorted) {
    if (mention.start > lastIndex) {
      parts.push(text.slice(lastIndex, mention.start));
    }
    const mentionText = text.slice(mention.start, mention.end);
    parts.push(
      <span
        key={`${mention.start}-${mention.end}`}
        className={mention.type === "agent" ? "mention-overlay__agent" : "mention-overlay__user"}
      >
        {mentionText}
      </span>
    );
    lastIndex = mention.end;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <div className="mention-overlay">{parts}</div>;
}
