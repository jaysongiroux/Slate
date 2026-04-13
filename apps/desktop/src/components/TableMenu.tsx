import { BubbleMenu, type Editor } from "@tiptap/react";
import { Plus, Trash2, Columns3, Rows3 } from "lucide-react";

interface TableMenuProps {
  editor: Editor;
}

function Btn({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[0.75rem] font-medium whitespace-nowrap transition-colors ${
        danger
          ? "text-[var(--danger)] hover:bg-[rgba(255,150,140,0.1)]"
          : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--accent)]"
      }`}
    >
      {children}
    </button>
  );
}

export function TableMenu({ editor }: TableMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ placement: "top", maxWidth: "none" }}
      shouldShow={({ editor }) => editor.isActive("table")}
    >
      <div className="glass-popover flex items-center gap-0.5 !rounded-[10px] !p-1">
        <Btn onClick={() => (editor.chain().focus() as any).addColumnAfter().run()}>
          <Columns3 className="w-3.5 h-3.5" /> Add column
        </Btn>
        <Btn onClick={() => (editor.chain().focus() as any).addRowAfter().run()}>
          <Rows3 className="w-3.5 h-3.5" /> Add row
        </Btn>
        <div className="w-px h-4 bg-[var(--line)]" />
        <Btn danger onClick={() => (editor.chain().focus() as any).deleteColumn().run()}>
          <Trash2 className="w-3 h-3" /> Column
        </Btn>
        <Btn danger onClick={() => (editor.chain().focus() as any).deleteRow().run()}>
          <Trash2 className="w-3 h-3" /> Row
        </Btn>
        <Btn danger onClick={() => (editor.chain().focus() as any).deleteTable().run()}>
          <Trash2 className="w-3 h-3" /> Table
        </Btn>
      </div>
    </BubbleMenu>
  );
}
