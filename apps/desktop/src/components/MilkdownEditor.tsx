import { useEffect, useRef } from "react";
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
import type { EditorView } from "@milkdown/prose/view";
import { callCommand, replaceAll } from "@milkdown/utils";
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

type MilkdownEditorProps = {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

const slashPlugin = slashFactory("note-editor");

export function MilkdownEditor({
  value,
  placeholder = "Start writing in Markdown...",
  onChange
}: MilkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const markdownRef = useRef(value);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;
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
        id: "code",
        label: "Code block",
        hint: "Insert a fenced code block",
        search: ["code", "snippet", "pre"],
        run: (ctx) => {
          clearSlashTrigger(ctx);
          callCommand(createCodeBlockCommand.key)(ctx);
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
      .use(history)
      .use(prism)
      .use(slashPlugin);

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
}
