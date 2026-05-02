import { useMemo } from "react";

export interface MentionItem {
  id: string;
  name: string;
  type: "agent" | "member";
}

export interface MentionDropdownProps {
  items: MentionItem[];
  query: string;
  activeIndex: number;
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
}

export default function MentionDropdown({
  items,
  query,
  activeIndex,
  onSelect,
  onClose,
}: MentionDropdownProps) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, query]);

  if (filtered.length === 0) return null;

  return (
    <div className="mention-dropdown" role="listbox">
      {filtered.map((item, index) => (
        <div
          key={item.id}
          className={`mention-dropdown__item${index === activeIndex ? " is-active" : ""}`}
          role="option"
          aria-selected={index === activeIndex}
          onClick={() => onSelect(item.id, item.name)}
        >
          <span className="mention-dropdown__icon">
            {item.type === "agent" ? "⚡" : "👤"}
          </span>
          <span>{item.name}</span>
        </div>
      ))}
    </div>
  );
}
