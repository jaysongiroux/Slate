import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LocalNoteSummary } from "@slate/shared/index";
import { Ctx } from "@milkdown/ctx";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx
} from "@milkdown/core";
import { clipboard } from "@milkdown/plugin-clipboard";
import { history } from "@milkdown/plugin-history";
import { prism, prismConfig } from "@milkdown/plugin-prism";
import { SlashProvider, slashFactory } from "@milkdown/plugin-slash";
import {
  commonmark,
  createCodeBlockCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand
} from "@milkdown/preset-commonmark";
import {
  gfm,
  insertTableCommand,
  addColBeforeCommand,
  addColAfterCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  deleteSelectedCellsCommand,
  selectRowCommand,
  selectColCommand,
} from "@milkdown/preset-gfm";
import type { EditorView } from "@milkdown/prose/view";
import { $prose, callCommand, replaceAll } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection, AllSelection, EditorState } from "@milkdown/prose/state";
import { InputRule, inputRules } from "@milkdown/prose/inputrules";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import bash from "refractor/bash";
import css from "refractor/css";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markdown from "refractor/markdown";
import markup from "refractor/markup";
import python from "refractor/python";
import sql from "refractor/sql";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";
import { refractor } from "refractor";
import { ySyncPlugin, yUndoPlugin, yCursorPlugin, undoCommand, redoCommand } from "y-prosemirror";
import { keymap } from "@milkdown/prose/keymap";
import type { XmlFragment as YXmlFragment } from "yjs";
import { openExternal } from "../lib/api";
import { toast } from "sonner";

// Register mermaid syntax highlighting grammar with Prism/refractor
if (!refractor.registered("mermaid")) {
  const mermaidGrammar = (Prism: any) => {
    Prism.languages.mermaid = {
      comment: /%%.*$/m,
      string: {
        pattern: /"[^"]*"|'[^']*'/,
        greedy: true,
      },
      "diagram-type": {
        pattern: /\b(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|gitgraph|journey|mindmap|timeline|sankey-beta|xychart-beta|block-beta|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/,
        alias: "keyword",
      },
      keyword: /\b(?:subgraph|end|participant|actor|activate|deactivate|loop|alt|else|opt|par|and|critical|break|rect|note\s+(?:right\s+of|left\s+of|over)|Note\s+(?:right\s+of|left\s+of|over)|title|section|dateFormat|axisFormat|todayMarker|excludes|inclusiveEndDates|class|namespace|direction|state|fork|join|choice|LR|RL|TB|TD|BT)\b/,
      arrow: {
        pattern: /<?(?:--+>|==+>|~~+>|-\.-+>|--+[x)o]|==+[x)o]|~~+[x)o])|--+|==+|-\.-+|~~+|-->|==>|-\.->|~~~|---|===|\|>|<\||\*--|--\*|o--|--o/,
        alias: "important",
      },
      "class-label": {
        pattern: /:::/,
        alias: "punctuation",
      },
      "node-id": {
        pattern: /\b[a-zA-Z_]\w*(?=[\s]*[\[({>])/,
        alias: "function",
      },
      "pipe-text": {
        pattern: /\|[^|]*\|/,
        alias: "string",
      },
      number: /\b\d+(?:\.\d+)?\b/,
      punctuation: /[[\](){};<>]/,
    };
  };
  mermaidGrammar.displayName = "mermaid";
  mermaidGrammar.aliases = [] as string[];
  refractor.register(mermaidGrammar as any);
}

type MermaidAPI = Awaited<typeof import("mermaid")>["default"];
let mermaidApi: MermaidAPI | null = null;
let mermaidLoading: Promise<MermaidAPI> | null = null;
let mermaidIdCounter = 0;
const mermaidSvgCache = new Map<string, string>();

function loadMermaid() {
  if (mermaidApi) return Promise.resolve(mermaidApi);
  if (!mermaidLoading) {
    mermaidLoading = import("mermaid").then((mod) => {
      mermaidApi = mod.default;
      mermaidApi.initialize({ startOnLoad: false, theme: "dark" });
      return mermaidApi;
    });
  }
  return mermaidLoading;
}

type SlashItem = {
  id: string;
  label: string;
  search: string[];
  run: (ctx: Ctx) => void;
};

type UploadFileResult = { id: string; contentUrl: string };

type TableAction = "add-row-before" | "add-row-after" | "add-col-before" | "add-col-after" | "delete-row" | "delete-col";

type MilkdownEditorProps = {
  value: string;
  yFragment?: YXmlFragment | null;
  onChange: (value: string) => void;
  onUploadFile?: (file: File) => Promise<UploadFileResult>;
  onRejectFile?: (file: File) => void;
  resolveImageUrl?: (src: string) => Promise<string>;
  onTableContextMenu?: () => Promise<TableAction | null>;
  notes?: LocalNoteSummary[];
  currentNoteId?: string;
  onNavigateNote?: (noteId: string) => void;
};

export type MilkdownEditorHandle = {
  search: (query: string, index: number) => { count: number; index: number };
  getSearchState: () => { query: string; index: number };
};

const searchPluginKey = new PluginKey("search-highlight");

const slashPlugin = slashFactory("note-editor");

const taskListPlugin = $prose(() => new Plugin({
  props: {
    nodeViews: {
      list_item: (node, view, getPos) => {
        const li = document.createElement("li");

        if (node.attrs.checked == null) {
          li.dataset.listType = node.attrs.listType;
          const contentWrapper = document.createElement("div");
          li.appendChild(contentWrapper);
          return { dom: li, contentDOM: contentWrapper };
        }

        li.dataset.itemType = "task";
        li.dataset.listType = node.attrs.listType;
        li.dataset.checked = String(node.attrs.checked);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(node.attrs.checked);
        checkbox.contentEditable = "false";
        // Prevent checkbox from stealing focus from the editor
        checkbox.addEventListener("mousedown", (e) => {
          e.preventDefault();
        });
        checkbox.addEventListener("click", (e) => {
          e.preventDefault();
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (pos == null) return;
          const newChecked = !node.attrs.checked;
          checkbox.checked = newChecked;
          li.dataset.checked = String(newChecked);
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: newChecked,
          }));
        });

        const contentWrapper = document.createElement("div");
        contentWrapper.className = "task-content";

        li.appendChild(checkbox);
        li.appendChild(contentWrapper);

        return { dom: li, contentDOM: contentWrapper };
      },
    },
  },
}));

// Paste handler that converts markdown task list syntax into proper task list nodes
const taskListPastePlugin = $prose(() => new Plugin({
  props: {
    handlePaste(view, event) {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return false;

      // Match lines like "- [ ] task" or "- [x] task" (with optional leading whitespace)
      const taskLineRe = /^\s*-\s+\[([ xX])\]\s+(.*)/;
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) return false;

      // Only handle paste if every non-empty line is a task list item
      if (!lines.every((line) => taskLineRe.test(line))) return false;

      const { schema } = view.state;
      const listItemType = schema.nodes.list_item;
      const bulletListType = schema.nodes.bullet_list;
      const paragraphType = schema.nodes.paragraph;
      if (!listItemType || !bulletListType || !paragraphType) return false;

      const items = lines.map((line) => {
        const match = line.match(taskLineRe)!;
        const checked = match[1] !== " ";
        const content = match[2];
        const para = paragraphType.create(
          null,
          content ? schema.text(content) : undefined,
        );
        return listItemType.create({ checked }, para);
      });

      const list = bulletListType.create(null, items);
      view.dispatch(view.state.tr.replaceSelectionWith(list).scrollIntoView());
      return true;
    },
  },
}));

// Select-all that skips the first heading (the note title)
const selectAllSkipTitlePlugin = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      const isMod = navigator.platform.toUpperCase().includes("MAC")
        ? event.metaKey
        : event.ctrlKey;
      if (!isMod || event.key.toLowerCase() !== "a") return false;

      const { doc, tr } = view.state;
      const firstChild = doc.firstChild;
      if (firstChild && firstChild.type.name === "heading" && firstChild.attrs.level === 1) {
        const from = firstChild.nodeSize;
        const to = doc.content.size;
        if (from < to) {
          event.preventDefault();
          view.dispatch(tr.setSelection(TextSelection.create(doc, from, to)));
          return true;
        }
      }
      return false;
    },
  },
}));

function findMatches(doc: import("@milkdown/prose/model").Node, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const results: { from: number; to: number }[] = [];
  const lower = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const text = node.text.toLowerCase();
      let index = 0;
      while ((index = text.indexOf(lower, index)) !== -1) {
        results.push({ from: pos + index, to: pos + index + query.length });
        index += 1;
      }
    }
  });
  return results;
}

export const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(function MilkdownEditor({
  value,
  yFragment,
  onChange,
  onUploadFile,
  onRejectFile,
  resolveImageUrl,
  onTableContextMenu,
  notes,
  currentNoteId,
  onNavigateNote,
}, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const markdownRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const searchStateRef = useRef({ query: "", index: 0 });

  const onUploadFileRef = useRef(onUploadFile);
  const onRejectFileRef = useRef(onRejectFile);
  const resolveImageUrlRef = useRef(resolveImageUrl);
  const onTableContextMenuRef = useRef(onTableContextMenu);
  const notesRef = useRef(notes);
  const currentNoteIdRef = useRef(currentNoteId);
  const onNavigateNoteRef = useRef(onNavigateNote);

  onChangeRef.current = onChange;
  onUploadFileRef.current = onUploadFile;
  onRejectFileRef.current = onRejectFile;
  resolveImageUrlRef.current = resolveImageUrl;
  onTableContextMenuRef.current = onTableContextMenu;
  notesRef.current = notes;
  currentNoteIdRef.current = currentNoteId;
  onNavigateNoteRef.current = onNavigateNote;
  markdownRef.current = value;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let destroyed = false;
    root.replaceChildren();
    const menuElement = document.createElement("div");
    menuElement.className = "milkdown-slash-menu";
    menuElement.dataset.show = "false";

    const state = {
      visible: false,
      query: "",
      index: 0,
      items: [] as SlashItem[]
    };

    const slashItems: SlashItem[] = [
      {
        id: "h1",
        label: "Heading 1",
        search: ["title", "heading", "h1"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInHeadingCommand.key, 1)(ctx);
        }
      },
      {
        id: "h2",
        label: "Heading 2",
        search: ["subtitle", "heading", "h2"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInHeadingCommand.key, 2)(ctx);
        }
      },
      {
        id: "bullet",
        label: "Bullet list",
        search: ["list", "bullet", "unordered"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInBulletListCommand.key)(ctx);
        }
      },
      {
        id: "quote",
        label: "Quote",
        search: ["quote", "blockquote", "callout"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInBlockquoteCommand.key)(ctx);
        }
      },
      {
        id: "task",
        label: "Task list",
        search: ["task", "todo", "checkbox", "check"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { $from } = state.selection;
          const listItemType = state.schema.nodes.list_item;
          const bulletListType = state.schema.nodes.bullet_list;
          if (listItemType && bulletListType) {
            const item = listItemType.createAndFill({ checked: false }, state.schema.nodes.paragraph.create());
            if (item) {
              const list = bulletListType.create(null, item);
              const { from } = state.selection;
              const tr = state.tr.replaceSelectionWith(list);
              // Place cursor inside the paragraph of the new task item
              const pos = tr.mapping.map(from);
              const $pos = tr.doc.resolve(pos);
              tr.setSelection(TextSelection.near($pos));
              view.dispatch(tr.scrollIntoView());
            }
          }
        }
      },
      {
        id: "code",
        label: "Code block",
        search: ["code", "snippet", "pre"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(createCodeBlockCommand.key)(ctx);
        }
      },
      {
        id: "mermaid",
        label: "Mermaid diagram",
        search: ["mermaid", "diagram", "chart", "flowchart", "sequence", "graph"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(createCodeBlockCommand.key, "mermaid")(ctx);
        }
      },
      {
        id: "table",
        label: "Table",
        search: ["table", "grid", "spreadsheet"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(insertTableCommand.key, { row: 3, col: 3 })(ctx);
        }
      },
      {
        id: "image",
        label: "Image",
        search: ["image", "picture", "photo", "upload"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) return;
            const upload = onUploadFileRef.current;
            if (!upload) return;

            const view = ctx.get(editorViewCtx);
            void handleImageFiles(view, [file]);
          });
          input.click();
        }
      }
    ];

    function clearSlashTrigger(ctx: Ctx) {
      const view = ctx.get(editorViewCtx);
      const { $from } = view.state.selection;
      const from = $from.start();
      const to = $from.pos;
      view.dispatch(view.state.tr.delete(from, to));
    }

    function getSlashText(view: EditorView) {
      const { selection } = view.state;
      const { empty, $from } = selection;

      if (!empty) {
        return "";
      }

      return $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC").trim();
    }

    function getSlashQuery(view: EditorView) {
      const content = getSlashText(view);
      if (!/^\/[^\s]*$/.test(content)) {
        return null;
      }

      return content.slice(1).toLowerCase();
    }

    function updateMenu(query: string | null) {
      if (query === null) {
        state.visible = false;
        state.query = "";
        state.index = 0;
        state.items = [];
        menuElement.dataset.show = "false";
        menuElement.innerHTML = "";
        return;
      }

      const items = slashItems.filter((item) => {
        if (!query) {
          return true;
        }

        const haystack = [item.label, ...item.search].join(" ").toLowerCase();
        return haystack.includes(query);
      });

      state.visible = items.length > 0;
      state.query = query;
      state.items = items;
      state.index = Math.min(state.index, Math.max(items.length - 1, 0));
      menuElement.dataset.show = state.visible ? "true" : "false";

      if (!state.visible) {
        menuElement.innerHTML = "";
        return;
      }

      menuElement.innerHTML = "";
      items.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `milkdown-slash-item ${index === state.index ? "active" : ""}`;
        button.innerHTML = `
          <span class="milkdown-slash-copy">
            ${item.label}
          </span>
        `;
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          if (!editorRef.current) {
            return;
          }

          editorRef.current.action((ctx) => {
            item.run(ctx);
          });
          updateMenu(null);
        });
        menuElement.appendChild(button);
      });
    }

    const slashProvider = new SlashProvider({
      content: menuElement,
      debounce: 0,
      root,
      shouldShow: (view) => getSlashQuery(view) !== null
    });

    const searchPlugin = $prose(() => new Plugin({
      key: searchPluginKey,
      state: {
        init() {
          return DecorationSet.empty;
        },
        apply(tr, old, _oldState, newState) {
          const meta = tr.getMeta(searchPluginKey);
          if (meta !== undefined) {
            const { query, index } = meta as { query: string; index: number };
            if (!query) return DecorationSet.empty;
            const matches = findMatches(newState.doc, query);
            const decorations = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === index ? "search-match active" : "search-match",
              })
            );
            return DecorationSet.create(newState.doc, decorations);
          }
          if (tr.docChanged && old !== DecorationSet.empty) {
            return old.map(tr.mapping, tr.doc);
          }
          return old;
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    }));

    function insertImageNode(view: EditorView, src: string, alt: string) {
      const imageType = view.state.schema.nodes.image;
      if (!imageType) return;
      const node = imageType.create({ src, alt });
      const { from } = view.state.selection;
      view.dispatch(view.state.tr.insert(from, node));
    }

    function findPlaceholderPos(view: EditorView, uploadId: string): number | null {
      let found: number | null = null;
      view.state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.type.name === "image" && node.attrs.alt === uploadId) {
          found = pos;
          return false;
        }
      });
      return found;
    }

    async function handleImageFiles(view: EditorView, files: File[]) {
      const upload = onUploadFileRef.current;
      if (!upload) return false;

      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return false;

      for (const file of imageFiles) {
        const uploadId = `uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const imageType = view.state.schema.nodes.image;
        if (!imageType) continue;

        // Insert a placeholder image node
        const placeholder = imageType.create({ src: "", alt: uploadId, title: `Uploading ${file.name}...` });
        const { from } = view.state.selection;
        view.dispatch(view.state.tr.insert(from, placeholder));

        try {
          const result = await upload(file);
          const pos = findPlaceholderPos(view, uploadId);
          if (pos !== null) {
            const realImage = imageType.create({ src: result.contentUrl, alt: file.name });
            view.dispatch(view.state.tr.replaceWith(pos, pos + 1, realImage));
          } else {
            insertImageNode(view, result.contentUrl, file.name);
          }
        } catch {
          // Remove placeholder on error
          const pos = findPlaceholderPos(view, uploadId);
          if (pos !== null) {
            view.dispatch(view.state.tr.delete(pos, pos + 1));
          }
        }
      }

      return true;
    }

    async function handleDroppedFiles(view: EditorView, files: File[]) {
      const upload = onUploadFileRef.current;
      if (!upload) return false;
      if (files.length === 0) return false;

      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      const rejectedFiles = files.filter((f) => !f.type.startsWith("image/"));

      for (const file of rejectedFiles) {
        onRejectFileRef.current?.(file);
      }

      if (imageFiles.length > 0) {
        await handleImageFiles(view, imageFiles);
      }

      return true;
    }

    const imageUploadPlugin = $prose(() => new Plugin({
      props: {
        handlePaste(view, event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length > 0) {
            event.preventDefault();
            void handleDroppedFiles(view, files);
            return true;
          }
          return false;
        },
        handleDrop(view, event) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length > 0) {
            event.preventDefault();
            void handleDroppedFiles(view, files);
            return true;
          }
          return false;
        },
      },
    }));

    const imageResolverPlugin = $prose(() => new Plugin({
      props: {
        nodeViews: {
          image: (node) => {
            const img = document.createElement("img");
            img.alt = node.attrs.alt ?? "";
            img.title = node.attrs.title ?? "";

            const src = node.attrs.src ?? "";
            if (src.startsWith("/api/attachments/") && resolveImageUrlRef.current) {
              img.src = "";
              void resolveImageUrlRef.current(src).then((resolved) => {
                img.src = resolved;
              });
            } else {
              img.src = src;
            }

            return { dom: img };
          },
        },
      },
    }));

    function getTableCellInfo(view: EditorView): { inTable: boolean; row: number; col: number } {
      const { $from } = view.state.selection;
      let inTable = false;
      let row = 0;
      let col = 0;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "table_cell" || node.type.name === "table_header") {
          col = $from.index(d - 1);
        }
        if (node.type.name === "table_row") {
          row = $from.index(d - 1);
        }
        if (node.type.name === "table") {
          inTable = true;
          break;
        }
      }
      return { inTable, row, col };
    }

    const tableContextMenuPlugin = $prose(() => new Plugin({
      props: {
        handleDOMEvents: {
          contextmenu(view, event) {
            const info = getTableCellInfo(view);
            if (!info.inTable || !onTableContextMenuRef.current) return false;
            event.preventDefault();
            const { row, col } = info;
            void onTableContextMenuRef.current().then((action) => {
              if (!action || !editorRef.current) return;
              editorRef.current.action((ctx) => {
                const commands: Record<TableAction, () => void> = {
                  "add-row-before": () => callCommand(addRowBeforeCommand.key)(ctx),
                  "add-row-after": () => callCommand(addRowAfterCommand.key)(ctx),
                  "add-col-before": () => callCommand(addColBeforeCommand.key)(ctx),
                  "add-col-after": () => callCommand(addColAfterCommand.key)(ctx),
                  "delete-row": () => {
                    callCommand(selectRowCommand.key, { index: row })(ctx);
                    callCommand(deleteSelectedCellsCommand.key)(ctx);
                  },
                  "delete-col": () => {
                    callCommand(selectColCommand.key, { index: col })(ctx);
                    callCommand(deleteSelectedCellsCommand.key)(ctx);
                  },
                };
                commands[action]?.();
              });
            });
            return true;
          },
        },
      },
    }));

    const tableAddButtonsPlugin = $prose(() => new Plugin({
      view(editorView) {
        if (!root) return { update() { }, destroy() { } };
        const tableRoot = root;

        const addRowBtn = document.createElement("button");
        addRowBtn.className = "table-add-btn table-add-row-btn";
        addRowBtn.textContent = "+";
        addRowBtn.type = "button";
        addRowBtn.title = "Add row";

        const addColBtn = document.createElement("button");
        addColBtn.className = "table-add-btn table-add-col-btn";
        addColBtn.textContent = "+";
        addColBtn.type = "button";
        addColBtn.title = "Add column";

        tableRoot.appendChild(addRowBtn);
        tableRoot.appendChild(addColBtn);

        let currentTable: HTMLTableElement | null = null;
        let overButton = false;
        let hideTimer: ReturnType<typeof setTimeout> | null = null;

        function reposition(table: HTMLTableElement) {
          const tableRect = table.getBoundingClientRect();
          const rootRect = tableRoot.getBoundingClientRect();

          addRowBtn.style.left = `${tableRect.left - rootRect.left + tableRect.width / 2}px`;
          addRowBtn.style.top = `${tableRect.bottom - rootRect.top + 4}px`;

          addColBtn.style.left = `${tableRect.right - rootRect.left + 4}px`;
          addColBtn.style.top = `${tableRect.top - rootRect.top + tableRect.height / 2}px`;
        }

        function show(table: HTMLTableElement) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          currentTable = table;
          reposition(table);
          addRowBtn.classList.add("visible");
          addColBtn.classList.add("visible");
        }

        function hideNow() {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          currentTable = null;
          addRowBtn.classList.remove("visible");
          addColBtn.classList.remove("visible");
        }

        function hideDelayed() {
          if (overButton) return;
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            hideTimer = null;
            if (!overButton) hideNow();
          }, 100);
        }

        function onMouseMove(e: MouseEvent) {
          const target = e.target as HTMLElement;
          if (addRowBtn.contains(target) || addColBtn.contains(target)) return;
          const table = target.closest("table") as HTMLTableElement | null;
          if (table && tableRoot.contains(table)) {
            show(table);
          } else {
            hideDelayed();
          }
        }

        function onMouseLeave() {
          if (!overButton) hideDelayed();
        }

        addRowBtn.addEventListener("mouseenter", () => {
          overButton = true;
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        });
        addRowBtn.addEventListener("mouseleave", () => { overButton = false; hideDelayed(); });
        addColBtn.addEventListener("mouseenter", () => {
          overButton = true;
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        });
        addColBtn.addEventListener("mouseleave", () => { overButton = false; hideDelayed(); });

        addRowBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          if (!currentTable || !editorRef.current) return;
          const rows = currentTable.querySelectorAll("tr");
          const lastRow = rows[rows.length - 1];
          const cell = lastRow?.querySelector("td, th");
          if (!cell) return;

          const pos = editorView.posAtDOM(cell, 0);
          editorView.dispatch(
            editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, pos))
          );
          editorRef.current.action((ctx) => {
            callCommand(addRowAfterCommand.key)(ctx);
          });
        });

        addColBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          if (!currentTable || !editorRef.current) return;
          const firstRow = currentTable.querySelector("tr");
          const cells = firstRow?.querySelectorAll("td, th");
          const lastCell = cells?.[cells.length - 1];
          if (!lastCell) return;

          const pos = editorView.posAtDOM(lastCell, 0);
          editorView.dispatch(
            editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, pos))
          );
          editorRef.current.action((ctx) => {
            callCommand(addColAfterCommand.key)(ctx);
          });
        });

        tableRoot.addEventListener("mousemove", onMouseMove);
        tableRoot.addEventListener("mouseleave", onMouseLeave);

        return {
          update() {
            if (currentTable) {
              if (currentTable.isConnected) {
                reposition(currentTable);
              } else {
                currentTable = null;
                addRowBtn.classList.remove("visible");
                addColBtn.classList.remove("visible");
              }
            }
          },
          destroy() {
            if (hideTimer) clearTimeout(hideTimer);
            tableRoot.removeEventListener("mousemove", onMouseMove);
            tableRoot.removeEventListener("mouseleave", onMouseLeave);
            addRowBtn.remove();
            addColBtn.remove();
          }
        };
      }
    }));

    const codeBlockCopyPlugin = $prose(() => new Plugin({
      view(editorView) {
        if (!root) return { update() { }, destroy() { } };
        const codeRoot = root;

        const copyBtn = document.createElement("button");
        copyBtn.className = "code-copy-btn";
        copyBtn.textContent = "Copy";
        copyBtn.type = "button";
        codeRoot.appendChild(copyBtn);

        let currentPre: HTMLPreElement | null = null;
        let hideTimer: ReturnType<typeof setTimeout> | null = null;
        let overButton = false;

        function reposition(pre: HTMLPreElement) {
          const preRect = pre.getBoundingClientRect();
          const rootRect = codeRoot.getBoundingClientRect();
          copyBtn.style.top = `${preRect.top - rootRect.top + 8}px`;
          copyBtn.style.right = `${rootRect.right - preRect.right + 8}px`;
        }

        function show(pre: HTMLPreElement) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          currentPre = pre;
          reposition(pre);
          copyBtn.classList.add("visible");
          copyBtn.textContent = "Copy";
        }

        function hideNow() {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          currentPre = null;
          copyBtn.classList.remove("visible");
        }

        function hideDelayed() {
          if (overButton) return;
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            hideTimer = null;
            if (!overButton) hideNow();
          }, 100);
        }

        function onMouseMove(e: MouseEvent) {
          const target = e.target as HTMLElement;
          if (copyBtn.contains(target)) return;
          const pre = target.closest("pre") as HTMLPreElement | null;
          if (pre && codeRoot.contains(pre)) {
            show(pre);
          } else {
            hideDelayed();
          }
        }

        function onMouseLeave() {
          if (!overButton) hideDelayed();
        }

        copyBtn.addEventListener("mouseenter", () => {
          overButton = true;
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        });
        copyBtn.addEventListener("mouseleave", () => { overButton = false; hideDelayed(); });

        copyBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          if (!currentPre) return;
          const code = currentPre.querySelector("code");
          const text = (code || currentPre).textContent || "";
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              if (copyBtn.textContent === "Copied!") copyBtn.textContent = "Copy";
            }, 1500);
          });
        });

        codeRoot.addEventListener("mousemove", onMouseMove);
        codeRoot.addEventListener("mouseleave", onMouseLeave);

        return {
          update() {
            if (currentPre) {
              if (currentPre.isConnected) {
                reposition(currentPre);
              } else {
                hideNow();
              }
            }
          },
          destroy() {
            if (hideTimer) clearTimeout(hideTimer);
            codeRoot.removeEventListener("mousemove", onMouseMove);
            codeRoot.removeEventListener("mouseleave", onMouseLeave);
            copyBtn.remove();
          }
        };
      }
    }));

    const mermaidPluginKey = new PluginKey("mermaid-preview");
    const mermaidPlugin = $prose(() => {
      function buildDecorations(doc: import("@milkdown/prose/model").Node) {
        const decorations: (Decoration | any)[] = [];
        doc.descendants((node, pos) => {
          if (node.type.name !== "code_block" || node.attrs.language !== "mermaid") return;
          const content = node.textContent;
          const end = pos + node.nodeSize;
          const hasSvg = mermaidSvgCache.has(content);

          // Remove bottom rounding on the code block so it connects with the preview
          decorations.push(
            Decoration.node(pos, end, { class: "mermaid-code-block" }),
          );

          decorations.push(
            Decoration.widget(end, () => {
              const preview = document.createElement("div");
              preview.className = "mermaid-preview";
              preview.contentEditable = "false";
              const cached = mermaidSvgCache.get(content);
              if (cached) {
                preview.innerHTML = cached;
              } else if (content.trim()) {
                preview.textContent = "Rendering diagram\u2026";
              }
              return preview;
            }, { side: 1, key: `mermaid-${pos}-${hasSvg ? "r" : "p"}` }),
          );
        });
        return DecorationSet.create(doc, decorations);
      }

      return new Plugin({
        key: mermaidPluginKey,
        state: {
          init(_, { doc }) { return buildDecorations(doc); },
          apply(tr, old) {
            if (tr.docChanged || tr.getMeta(mermaidPluginKey)) {
              return buildDecorations(tr.doc);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) { return mermaidPluginKey.getState(state); },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let alive = true;

          function schedule() {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (alive) void renderPending();
            }, 600);
          }

          async function renderPending() {
            const { doc } = editorView.state;
            const pending: string[] = [];
            doc.descendants((node) => {
              if (node.type.name === "code_block" && node.attrs.language === "mermaid") {
                const text = node.textContent;
                if (text.trim() && !mermaidSvgCache.has(text)) pending.push(text);
              }
            });
            if (pending.length === 0) return;

            const m = await loadMermaid();
            if (!m || !alive) return;
            let updated = false;
            for (const text of pending) {
              if (mermaidSvgCache.has(text)) continue;
              try {
                const { svg } = await m.render(`mermaid-${++mermaidIdCounter}`, text);
                mermaidSvgCache.set(text, svg);
                updated = true;
              } catch {
                mermaidSvgCache.set(text, '<span class="mermaid-error">Invalid diagram syntax</span>');
                updated = true;
              }
            }
            if (updated && alive) {
              const viewport = editorView.dom.closest(".ui-scroll-area__viewport");
              const scrollTop = viewport?.scrollTop ?? 0;
              editorView.dispatch(editorView.state.tr.setMeta(mermaidPluginKey, true));
              if (viewport) viewport.scrollTop = scrollTop;
            }
          }

          schedule();
          return {
            update() { schedule(); },
            destroy() { alive = false; if (timer) clearTimeout(timer); },
          };
        },
      });
    });

    // --- Link Input Rule Plugin ---
    // Converts typed [text](url) into a proper link mark when ) is typed
    const linkInputRule = new InputRule(
      /\[([^\]]+)\]\(([^)]+)\)$/,
      (state, match, start, end) => {
        const [, text, href] = match;
        const linkMark = state.schema.marks.link.create({ href });
        const linkNode = state.schema.text(text, [linkMark]);
        return state.tr.replaceWith(start, end, linkNode);
      }
    );

    const linkInputRulePlugin = $prose(() => {
      return inputRules({ rules: [linkInputRule] });
    });

    // --- Link Decoration Plugin ---
    const linkDecorationPluginKey = new PluginKey("linkDecoration");

    const linkDecorationPlugin = $prose(() => {
      return new Plugin({
        key: linkDecorationPluginKey,
        state: {
          init(_, state) {
            return buildLinkDecorations(state);
          },
          apply(tr, oldDecorations, _oldState, newState) {
            if (tr.docChanged) {
              return buildLinkDecorations(newState);
            }
            return oldDecorations;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      });
    });

    function buildLinkDecorations(state: EditorState): DecorationSet {
      const decorations: Decoration[] = [];
      const notes = notesRef.current ?? [];
      const notePaths = new Set(notes.map((n) => n.path));

      state.doc.descendants((node, pos) => {
        if (!node.isInline) return;
        const linkMark = node.marks.find((m) => m.type.name === "link");
        if (!linkMark) return;

        const href = linkMark.attrs.href as string;
        let className = "";

        if (/^https?:\/\//.test(href) || href.startsWith("mailto:")) {
          className = "link-external";
        } else if (href.endsWith(".md") && !notePaths.has(href)) {
          className = "link-broken";
        }

        if (className) {
          decorations.push(
            Decoration.inline(pos, pos + node.nodeSize, {
              class: className,
            })
          );
        }
      });

      return DecorationSet.create(state.doc, decorations);
    }

    // --- Link Click Plugin ---
    const linkClickPlugin = $prose(() => {
      return new Plugin({
        props: {
          handleClick(view, pos, event) {
            if (!(event.metaKey || event.ctrlKey)) return false;

            const { state } = view;
            const $pos = state.doc.resolve(pos);
            const linkMark = $pos.marks().find((m) => m.type.name === "link");
            if (!linkMark) return false;

            const href = linkMark.attrs.href as string;

            if (/^https?:\/\//.test(href) || href.startsWith("mailto:")) {
              void openExternal(href);
            } else {
              const notes = notesRef.current ?? [];
              const target = notes.find((n) => n.path === href);
              if (target) {
                onNavigateNoteRef.current?.(target.id);
              } else {
                toast.error("Note not found");
              }
            }

            return true;
          },
          handleDOMEvents: {
            mouseover(view, event) {
              const target = event.target as HTMLElement;
              const anchor = target.closest("a");
              if (anchor && (event.metaKey || event.ctrlKey)) {
                anchor.style.cursor = "pointer";
              }
              return false;
            },
            mouseout(_view, event) {
              const target = event.target as HTMLElement;
              const anchor = target.closest("a");
              if (anchor) {
                anchor.style.cursor = "";
              }
              return false;
            },
            keydown(view, event) {
              if (event.key === "Meta" || event.key === "Control") {
                view.dom.classList.add("link-clickable");
              }
              return false;
            },
            keyup(view, event) {
              if (event.key === "Meta" || event.key === "Control") {
                view.dom.classList.remove("link-clickable");
              }
              return false;
            },
          },
        },
      });
    });

    // --- Link Autocomplete Plugin ---
    const linkMenuElement = document.createElement("div");
    linkMenuElement.className = "link-autocomplete";

    const linkMenuState = {
      open: false,
      query: "",
      index: 0,
      triggerPos: -1,
      items: [] as LocalNoteSummary[],
    };

    function updateLinkMenu(open: boolean, query = "", triggerPos = -1) {
      const notes = notesRef.current ?? [];
      const currentId = currentNoteIdRef.current;

      let filtered = notes.filter((n) => n.id !== currentId);
      if (query) {
        const q = query.toLowerCase();
        filtered = filtered.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.path.toLowerCase().includes(q)
        );
      }
      filtered = filtered.slice(0, 20);

      linkMenuState.open = open;
      linkMenuState.query = query;
      linkMenuState.triggerPos = triggerPos;
      linkMenuState.items = filtered;
      // +1 for the "Link to URL..." option at the bottom
      const totalCount = filtered.length + 1;
      if (!open) linkMenuState.index = 0;
      if (linkMenuState.index >= totalCount) {
        linkMenuState.index = Math.max(0, totalCount - 1);
      }

      renderLinkMenu();
    }

    function renderLinkMenu() {
      linkMenuElement.innerHTML = "";
      linkMenuElement.setAttribute("data-show", String(linkMenuState.open));

      if (!linkMenuState.open) return;

      const { items, index } = linkMenuState;

      if (items.length === 0 && !linkMenuState.query) {
        const empty = document.createElement("div");
        empty.className = "link-autocomplete__empty";
        empty.textContent = "Type to search notes or insert a URL";
        linkMenuElement.appendChild(empty);
        return;
      }

      items.forEach((note, i) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `link-autocomplete__item${i === index ? " active" : ""}`;

        const title = document.createElement("span");
        title.className = "link-autocomplete__item-title";
        title.textContent = note.title;

        const folder = note.path.includes("/")
          ? note.path.slice(0, note.path.lastIndexOf("/"))
          : "";
        if (folder) {
          const pathEl = document.createElement("span");
          pathEl.className = "link-autocomplete__item-path";
          pathEl.textContent = folder;
          button.appendChild(title);
          button.appendChild(pathEl);
        } else {
          button.appendChild(title);
        }

        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          selectLinkItem(note);
        });

        linkMenuElement.appendChild(button);
      });

      // "Link to URL..." option at the bottom
      const externalOption = document.createElement("button");
      externalOption.type = "button";
      const isExternalSelected = index === items.length;
      externalOption.className = `link-autocomplete__item link-autocomplete__item--external${isExternalSelected ? " active" : ""}`;
      const externalLabel = document.createElement("span");
      externalLabel.className = "link-autocomplete__item-title";
      externalLabel.textContent = linkMenuState.query
        ? `Link "${linkMenuState.query}" to URL...`
        : "Link to URL...";
      const externalHint = document.createElement("span");
      externalHint.className = "link-autocomplete__item-path";
      externalHint.textContent = "Insert an external link";
      externalOption.appendChild(externalLabel);
      externalOption.appendChild(externalHint);
      externalOption.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectExternalLink();
      });
      linkMenuElement.appendChild(externalOption);

      const hint = document.createElement("div");
      hint.className = "link-autocomplete__hint";
      hint.innerHTML = "<span>↑↓ navigate</span><span>↵ select · esc dismiss</span>";
      linkMenuElement.appendChild(hint);

      const activeEl = linkMenuElement.querySelector(".active");
      activeEl?.scrollIntoView({ block: "nearest" });
    }

    function selectExternalLink() {
      if (!editorRef.current) return;

      editorRef.current.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { triggerPos, query } = linkMenuState;
        const cursorPos = state.selection.from;

        // Insert [query text]( and place cursor between parens for URL entry
        // The link input rule will convert it to a link mark when ) is typed
        const linkText = query || "link";
        const insertText = `[${linkText}](`;
        const tr = state.tr.replaceWith(
          triggerPos,
          cursorPos,
          state.schema.text(insertText)
        );
        view.dispatch(tr);
      });

      updateLinkMenu(false);
    }

    function selectLinkItem(note: LocalNoteSummary) {
      if (!editorRef.current) return;

      editorRef.current.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { triggerPos } = linkMenuState;
        const cursorPos = state.selection.from;

        // Replace the `[query` text with a proper link mark node
        const linkMark = state.schema.marks.link.create({ href: note.path });
        const linkNode = state.schema.text(note.title, [linkMark]);
        const tr = state.tr.replaceWith(triggerPos, cursorPos, linkNode);
        view.dispatch(tr);
      });

      updateLinkMenu(false);
    }

    const linkAutocompletePluginKey = new PluginKey("linkAutocomplete");

    const linkAutocompletePlugin = $prose(() => {
      return new Plugin({
        key: linkAutocompletePluginKey,
        view(editorView) {
          editorView.dom.parentElement?.appendChild(linkMenuElement);
          return {
            update(view) {
              if (!linkMenuState.open) return;

              const { state } = view;
              const cursorPos = state.selection.from;

              if (cursorPos <= linkMenuState.triggerPos) {
                updateLinkMenu(false);
                return;
              }

              if (!state.selection.empty) {
                updateLinkMenu(false);
                return;
              }

              // Re-derive query from document state (handles Backspace, deletion, etc.)
              const query = state.doc.textBetween(
                linkMenuState.triggerPos + 1,
                cursorPos,
                ""
              );
              if (query !== linkMenuState.query) {
                updateLinkMenu(true, query, linkMenuState.triggerPos);
                positionLinkMenu(view);
              }
            },
            destroy() {
              linkMenuElement.remove();
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (linkMenuState.open) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const totalCount = linkMenuState.items.length + 1;
                linkMenuState.index = (linkMenuState.index + 1) % totalCount;
                renderLinkMenu();
                return true;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                const totalCount = linkMenuState.items.length + 1;
                linkMenuState.index =
                  linkMenuState.index > 0
                    ? linkMenuState.index - 1
                    : totalCount - 1;
                renderLinkMenu();
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const item = linkMenuState.items[linkMenuState.index];
                if (item) {
                  selectLinkItem(item);
                } else if (linkMenuState.index === linkMenuState.items.length) {
                  // "Link to URL..." option
                  selectExternalLink();
                } else {
                  updateLinkMenu(false);
                }
                return true;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                updateLinkMenu(false);
                return true;
              }
            }
            return false;
          },
          handleDOMEvents: {
            blur() {
              if (linkMenuState.open) updateLinkMenu(false);
              return false;
            },
          },
          handleTextInput(view, from, _to, text) {
            if (text === "[") {
              const { state } = view;
              const $pos = state.doc.resolve(from);

              // Suppress in code blocks
              if ($pos.parent.type.name === "code_block") return false;

              // Suppress in inline code
              if ($pos.marks().some((m) => m.type.name === "inlineCode")) return false;

              // Suppress inside existing link
              if ($pos.marks().some((m) => m.type.name === "link")) return false;

              // Suppress if preceded by ! (image) or [ (double bracket)
              const before = $pos.parent.textBetween(
                Math.max(0, $pos.parentOffset - 1),
                $pos.parentOffset,
                ""
              );
              if (before === "!" || before === "[") return false;

              // Open autocomplete on next tick (after the [ is inserted)
              setTimeout(() => {
                const newState = view.state;
                const triggerPos = newState.selection.from - 1;
                updateLinkMenu(true, "", triggerPos);
                positionLinkMenu(view);
              }, 0);
            } else if (linkMenuState.open) {
              if (text === "]") {
                updateLinkMenu(false);
                return false;
              }
              setTimeout(() => {
                const newState = view.state;
                const query = newState.doc.textBetween(
                  linkMenuState.triggerPos + 1,
                  newState.selection.from,
                  ""
                );
                updateLinkMenu(true, query, linkMenuState.triggerPos);
                positionLinkMenu(view);
              }, 0);
            }
            return false;
          },
        },
      });
    });

    function positionLinkMenu(view: EditorView) {
      if (!linkMenuState.open) return;

      const coords = view.coordsAtPos(linkMenuState.triggerPos);
      const editorRect = view.dom.parentElement!.getBoundingClientRect();

      linkMenuElement.style.left = `${coords.left - editorRect.left}px`;
      linkMenuElement.style.top = `${coords.bottom - editorRect.top + 4}px`;
    }

    // y-prosemirror plugins (CRDT mode only)
    const ySyncPmPlugin = yFragment ? $prose(() => ySyncPlugin(yFragment)) : null;
    const yUndoPmPlugin = yFragment ? $prose(() => yUndoPlugin()) : null;
    const yUndoKeymapPlugin = yFragment
      ? $prose(() => keymap({
        "Mod-z": undoCommand,
        "Mod-y": redoCommand,
        "Mod-Shift-z": redoCommand,
      }))
      : null;

    // Separate view update plugin for CRDT mode:
    // - syncs slash menu (since dispatchTransaction is not overridden)
    // - serializes markdown and calls onChange so the save/rename pipeline runs
    const viewUpdatePlugin = $prose((ctx) => new Plugin({
      view() {
        return {
          update(view: EditorView, prevState: any) {
            slashProvider.update(view, prevState);
            updateMenu(getSlashQuery(view));

            if (view.state.doc.eq(prevState.doc)) return;
            const markdown = ctx.get(serializerCtx)(view.state.doc);
            if (markdown !== markdownRef.current) {
              markdownRef.current = markdown;
              onChangeRef.current(markdown);
            }
          },
        };
      },
    }));

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);

        if (!yFragment) {
          ctx.set(defaultValueCtx, value);
        }

        ctx.set(prismConfig.key, {
          configureRefractor: (refractor) => {
            refractor.register(markup);
            refractor.register(css);
            refractor.register(javascript);
            refractor.register(typescript);
            refractor.register(json);
            refractor.register(bash);
            refractor.register(markdown);
            refractor.register(python);
            refractor.register(sql);
            refractor.register(yaml);
            refractor.register(jsx);
            refractor.register(tsx);
          }
        });

        // Use "-" for bullet lists instead of remark-stringify's default "*"
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          bullet: "-" as const,
        }));

        if (yFragment) {
          // CRDT mode: y-prosemirror manages content and transactions
          ctx.set(editorViewOptionsCtx, {
            attributes: {
              class: "slate-milkdown-editor"
            },
          });
        } else {
          // Legacy mode: keep existing dispatchTransaction
          ctx.set(editorViewOptionsCtx, {
            attributes: {
              class: "slate-milkdown-editor"
            },
            dispatchTransaction: (transaction) => {
              const view = ctx.get(editorViewCtx) as Partial<EditorView> | undefined;
              if (!view || !view.state || !view.updateState) {
                return;
              }
              const previous = view.state;
              const next = previous.apply(transaction);
              view.updateState(next);
              slashProvider.update(view as EditorView, previous);

              const markdown = ctx.get(serializerCtx)(next.doc);
              if (markdown !== markdownRef.current) {
                markdownRef.current = markdown;
                onChangeRef.current(markdown);
              }
            }
          });
        }

        ctx.set(slashPlugin.key, {
          view: (view) => {
            const sync = (current: EditorView, previous?: typeof current.state) => {
              slashProvider.update(current, previous);
              updateMenu(getSlashQuery(current));
            };

            sync(view);

            return {
              update: sync,
              destroy: () => {
                slashProvider.destroy();
                menuElement.remove();
              }
            };
          },
          props: {
            handleKeyDown: (_view, event) => {
              if (!state.visible || state.items.length === 0) {
                return false;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                state.index = (state.index + 1) % state.items.length;
                updateMenu(state.query);
                return true;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                state.index = (state.index - 1 + state.items.length) % state.items.length;
                updateMenu(state.query);
                return true;
              }

              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const item = state.items[state.index];
                if (!item) {
                  return true;
                }

                editor.action((actionCtx) => {
                  item.run(actionCtx);
                });
                updateMenu(null);
                return true;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                updateMenu(null);
                return true;
              }

              return false;
            }
          }
        });
      })
      .use(taskListPastePlugin)
      .use(clipboard)
      .use(commonmark)
      .use(gfm)
      .use(prism)
      .use(slashPlugin)
      .use(taskListPlugin)
      .use(searchPlugin)
      .use(imageUploadPlugin)
      .use(imageResolverPlugin)
      .use(tableContextMenuPlugin)
      .use(tableAddButtonsPlugin)
      .use(codeBlockCopyPlugin)
      .use(mermaidPlugin)
      .use(selectAllSkipTitlePlugin)
      .use(linkInputRulePlugin)
      .use(linkDecorationPlugin)
      .use(linkClickPlugin)
      .use(linkAutocompletePlugin);

    // Conditional plugins: CRDT mode uses y-prosemirror, legacy mode uses history
    if (yFragment) {
      if (ySyncPmPlugin) editor.use(ySyncPmPlugin);
      if (yUndoPmPlugin) editor.use(yUndoPmPlugin);
      if (yUndoKeymapPlugin) editor.use(yUndoKeymapPlugin);
      editor.use(viewUpdatePlugin);
    } else {
      editor.use(history);
    }

    void editor.create().then((instance) => {
      if (destroyed) {
        void instance.destroy().finally(() => {
          root.replaceChildren();
        });
        return;
      }

      editorRef.current = instance;
    });

    return () => {
      destroyed = true;
      updateMenu(null);
      updateLinkMenu(false);
      const currentEditor = editorRef.current;
      editorRef.current = null;
      if (currentEditor) {
        void currentEditor.destroy().finally(() => {
          root.replaceChildren();
        });
      } else {
        root.replaceChildren();
      }
      if (document.activeElement instanceof HTMLElement && menuElement.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (menuElement.isConnected) {
        menuElement.remove();
      }
      if (linkMenuElement.isConnected) {
        linkMenuElement.remove();
      }
    };
  }, [yFragment]);

  const dispatchSearch = useCallback((query: string, index: number): { count: number; index: number } => {
    const editor = editorRef.current;
    if (!editor) return { count: 0, index: 0 };
    let result = { count: 0, index: 0 };
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const matches = findMatches(view.state.doc, query);
      const safeIndex = matches.length > 0 ? ((index % matches.length) + matches.length) % matches.length : 0;

      searchStateRef.current = { query, index: safeIndex };
      result = { count: matches.length, index: safeIndex };

      const tr = view.state.tr.setMeta(searchPluginKey, { query, index: safeIndex });
      view.dispatch(tr);

      // scroll active match into view
      if (matches.length > 0 && matches[safeIndex]) {
        const match = matches[safeIndex];
        const dom = view.domAtPos(match.from);
        const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    return result;
  }, []);

  useImperativeHandle(ref, () => ({
    search: dispatchSearch,
    getSearchState: () => searchStateRef.current,
  }), [dispatchSearch]);

  useEffect(() => {
    if (yFragment) return; // CRDT mode: y-prosemirror manages content
    const editor = editorRef.current;
    if (!editor || value === markdownRef.current) {
      return;
    }

    markdownRef.current = value;
    editor.action(replaceAll(value));
  }, [value, yFragment]);

  return (
    <div className="milkdown-shell">
      <div className="milkdown-root" ref={rootRef} />
    </div>
  );
});
