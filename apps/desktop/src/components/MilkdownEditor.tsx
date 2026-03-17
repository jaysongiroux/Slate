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
import { gfm } from "@milkdown/preset-gfm";
import type { EditorView } from "@milkdown/prose/view";
import { $prose, callCommand, replaceAll } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
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

type SlashItem = {
  id: string;
  label: string;
  hint: string;
  search: string[];
  run: (ctx: Ctx) => void;
};

type UploadFileResult = { id: string; contentUrl: string };

type MilkdownEditorProps = {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onUploadFile?: (file: File) => Promise<UploadFileResult>;
  resolveImageUrl?: (src: string) => Promise<string>;
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
  placeholder = "Start writing in Markdown...",
  onChange,
  onUploadFile,
  resolveImageUrl,
}, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const markdownRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const searchStateRef = useRef({ query: "", index: 0 });

  const onUploadFileRef = useRef(onUploadFile);
  const resolveImageUrlRef = useRef(resolveImageUrl);

  onChangeRef.current = onChange;
  onUploadFileRef.current = onUploadFile;
  resolveImageUrlRef.current = resolveImageUrl;
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
        hint: "Large section heading",
        search: ["title", "heading", "h1"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInHeadingCommand.key, 1)(ctx);
        }
      },
      {
        id: "h2",
        label: "Heading 2",
        hint: "Medium section heading",
        search: ["subtitle", "heading", "h2"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInHeadingCommand.key, 2)(ctx);
        }
      },
      {
        id: "bullet",
        label: "Bullet list",
        hint: "Turn this line into a list",
        search: ["list", "bullet", "unordered"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInBulletListCommand.key)(ctx);
        }
      },
      {
        id: "quote",
        label: "Quote",
        hint: "Indented quote block",
        search: ["quote", "blockquote", "callout"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(wrapInBlockquoteCommand.key)(ctx);
        }
      },
      {
        id: "task",
        label: "Task list",
        hint: "Checklist with checkboxes",
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
        hint: "Insert a fenced code block",
        search: ["code", "snippet", "pre"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(createCodeBlockCommand.key)(ctx);
        }
      },
      {
        id: "image",
        label: "Image",
        hint: "Upload an image file",
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

        const haystack = [item.label, item.hint, ...item.search].join(" ").toLowerCase();
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
            <strong>${item.label}</strong>
            <span>${item.hint}</span>
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

    const imageUploadPlugin = $prose(() => new Plugin({
      props: {
        handlePaste(view, event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.some((f) => f.type.startsWith("image/"))) {
            event.preventDefault();
            void handleImageFiles(view, files);
            return true;
          }
          return false;
        },
        handleDrop(view, event) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.some((f) => f.type.startsWith("image/"))) {
            event.preventDefault();
            void handleImageFiles(view, files);
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

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, value);
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
      .use(history)
      .use(prism)
      .use(slashPlugin)
      .use(taskListPlugin)
      .use(searchPlugin)
      .use(imageUploadPlugin)
      .use(imageResolverPlugin);

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
  }, []);

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
    const editor = editorRef.current;
    if (!editor || value === markdownRef.current) {
      return;
    }

    markdownRef.current = value;
    editor.action(replaceAll(value));
  }, [value]);

  return (
    <div className="milkdown-shell">
      {!value.trim() && <div className="milkdown-placeholder">{placeholder}</div>}
      <div className="milkdown-root" ref={rootRef} />
    </div>
  );
});
