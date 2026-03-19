import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Ctx } from "@milkdown/ctx";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
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
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
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
import { ySyncPlugin, yUndoPlugin, yCursorPlugin } from "y-prosemirror";
import type { XmlFragment as YXmlFragment } from "yjs";

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
  placeholder?: string;
  onChange: (value: string) => void;
  onUploadFile?: (file: File) => Promise<UploadFileResult>;
  onRejectFile?: (file: File) => void;
  resolveImageUrl?: (src: string) => Promise<string>;
  onTableContextMenu?: () => Promise<TableAction | null>;
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
        checkbox.addEventListener("change", () => {
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (pos == null) return;
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: checkbox.checked,
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
  placeholder = "Start writing in Markdown...",
  onChange,
  onUploadFile,
  onRejectFile,
  resolveImageUrl,
  onTableContextMenu,
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

  onChangeRef.current = onChange;
  onUploadFileRef.current = onUploadFile;
  onRejectFileRef.current = onRejectFile;
  resolveImageUrlRef.current = resolveImageUrl;
  onTableContextMenuRef.current = onTableContextMenu;
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
              view.dispatch(state.tr.replaceSelectionWith(list));
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

    // Placeholder tracking: map from placeholder ID to the position of the inserted node
    const placeholderAttr = "data-upload-id";

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

    // y-prosemirror plugins (CRDT mode only)
    const ySyncPmPlugin = yFragment ? $prose(() => ySyncPlugin(yFragment)) : null;
    const yUndoPmPlugin = yFragment ? $prose(() => yUndoPlugin()) : null;

    // Separate view update plugin for slash menu sync in CRDT mode
    // (needed because dispatchTransaction is not overridden in CRDT mode)
    const viewUpdatePlugin = $prose(() => new Plugin({
      view() {
        return {
          update(view: EditorView, prevState: any) {
            slashProvider.update(view, prevState);
            updateMenu(getSlashQuery(view));
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
      .use(codeBlockCopyPlugin);

    // Conditional plugins: CRDT mode uses y-prosemirror, legacy mode uses history
    if (yFragment) {
      if (ySyncPmPlugin) editor.use(ySyncPmPlugin);
      if (yUndoPmPlugin) editor.use(yUndoPmPlugin);
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
      {!value.trim() && <div className="milkdown-placeholder">{placeholder}</div>}
      <div className="milkdown-root" ref={rootRef} />
    </div>
  );
});
