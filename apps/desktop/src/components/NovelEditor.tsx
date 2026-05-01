import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandList,
  EditorCommandItem,
  EditorCommandEmpty,
  StarterKit,
  Placeholder,
  TiptapLink,
  TiptapImage,
  TaskList,
  TaskItem,
  HorizontalRule,
  TiptapUnderline,
  type SuggestionItem,
  Command,
  renderItems,
} from "novel";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  noteContentToMarkdown,
  parseMarkdownForTiptapPaste,
  type LocalNoteSummary,
} from "@slate/shared";
import { TableMenu } from "./TableMenu";
import { TemplateInsertPicker } from "./TemplateInsertPicker";
import { useDatabase } from "../db/DatabaseProvider";
import { documentTitleFromMarkdown } from "../lib/document-title-from-markdown";
import { useSyncStore } from "../stores/sync-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useAppStore } from "../stores/app-store";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { common, createLowlight } from "lowlight";
import { MermaidCodeBlock } from "../lib/mermaid-extension";
import { TableOfContentsExtension } from "../lib/toc-extension";
import { listTemplates } from "../lib/api";
import { loadTemplateTiptapContent } from "../lib/template-content";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  GitBranch,
  Quote,
  Minus,
  Image,
  Table2,
  FileStack,
  TableOfContents,
} from "lucide-react";
const lowlight = createLowlight(common);
const AI_NOTE_STREAM_EVENT = "slate-ai-note-stream";
const SLASH_COMMAND_NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "Enter"]);

type AiNoteStreamDetail = {
  documentId?: string;
  kind?: "create" | "edit";
  phase?: "start" | "delta" | "done";
  content?: string;
};

type SearchRange = {
  from: number;
  to: number;
};

type SearchState = {
  query: string;
  index: number;
  ranges: SearchRange[];
  decorations: DecorationSet;
};

const searchPluginKey = new PluginKey<SearchState>("slate-note-search");
const SEARCH_MATCH_HIGHLIGHT = "slate-search-match";
const SEARCH_ACTIVE_HIGHLIGHT = "slate-search-active";

function emptySearchState(doc: any): SearchState {
  return {
    query: "",
    index: 0,
    ranges: [],
    decorations: DecorationSet.empty,
  };
}

function normalizeSearchIndex(index: number, count: number) {
  if (count === 0) return 0;
  return ((index % count) + count) % count;
}

function buildSearchState(doc: any, query: string, requestedIndex: number): SearchState {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return emptySearchState(doc);

  const ranges: SearchRange[] = [];
  const needle = normalizedQuery.toLowerCase();

  doc.descendants((node: any, pos: number) => {
    if (!node.isText || typeof node.text !== "string") return;

    const haystack = node.text.toLowerCase();
    let offset = 0;
    while (offset < haystack.length) {
      const match = haystack.indexOf(needle, offset);
      if (match === -1) break;
      ranges.push({ from: pos + match, to: pos + match + needle.length });
      offset = match + Math.max(needle.length, 1);
    }
  });

  const index = normalizeSearchIndex(requestedIndex, ranges.length);
  const decorations = ranges.map((range, rangeIndex) =>
    Decoration.inline(range.from, range.to, {
      class: rangeIndex === index ? "search-match active" : "search-match",
      style:
        rangeIndex === index
          ? "background-color: rgba(255, 214, 102, 0.72); color: #1f1800; border-radius: 3px; box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.65);"
          : "background-color: rgba(255, 214, 102, 0.36); color: inherit; border-radius: 3px;",
    }),
  );

  return {
    query: normalizedQuery,
    index,
    ranges,
    decorations: DecorationSet.create(doc, decorations),
  };
}

function getCssSearchHighlights() {
  return typeof CSS === "undefined" ? null : (CSS as any).highlights;
}

function clearDomSearchHighlights() {
  const highlights = getCssSearchHighlights();
  highlights?.delete(SEARCH_MATCH_HIGHLIGHT);
  highlights?.delete(SEARCH_ACTIVE_HIGHLIGHT);
}

function applyDomSearchHighlights(editor: any, query: string, activeIndex: number) {
  const highlights = getCssSearchHighlights();
  const Highlight = typeof window === "undefined" ? null : (window as any).Highlight;
  const normalizedQuery = query.trim().toLowerCase();

  if (!highlights || !Highlight || !normalizedQuery) {
    clearDomSearchHighlights();
    return;
  }

  try {
    const matchRanges: Range[] = [];
    const activeRanges: Range[] = [];
    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    let rangeIndex = 0;
    let textNode = walker.nextNode() as Text | null;

    while (textNode) {
      const haystack = textNode.data.toLowerCase();
      let offset = 0;

      while (offset < haystack.length) {
        const match = haystack.indexOf(normalizedQuery, offset);
        if (match === -1) break;

        const range = document.createRange();
        range.setStart(textNode, match);
        range.setEnd(textNode, match + normalizedQuery.length);

        if (rangeIndex === activeIndex) {
          activeRanges.push(range);
        } else {
          matchRanges.push(range);
        }

        rangeIndex += 1;
        offset = match + Math.max(normalizedQuery.length, 1);
      }

      textNode = walker.nextNode() as Text | null;
    }

    highlights.set(SEARCH_MATCH_HIGHLIGHT, new Highlight(...matchRanges));
    highlights.set(SEARCH_ACTIVE_HIGHLIGHT, new Highlight(...activeRanges));
  } catch {
    clearDomSearchHighlights();
  }
}

function scheduleDomSearchHighlights(editor: any, query: string, activeIndex: number) {
  const apply = () => applyDomSearchHighlights(editor, query, activeIndex);
  if (typeof window === "undefined") {
    apply();
    return;
  }
  window.requestAnimationFrame(apply);
}

function scheduleScrollSearchRangeIntoView(editor: any, range: SearchRange) {
  if (typeof window === "undefined") return;

  window.requestAnimationFrame(() => {
    const { node } = editor.view.domAtPos(range.from);
    const element =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    element?.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

const SearchHighlightExtension = Command.extend({
  name: "slateSearchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: (_config, state) => emptySearchState(state.doc),
          apply: (tr, previous) => {
            const meta = tr.getMeta(searchPluginKey) as
              | { query: string; index: number }
              | undefined;
            if (meta) {
              return buildSearchState(tr.doc, meta.query, meta.index);
            }
            if (tr.docChanged && previous.query) {
              return buildSearchState(tr.doc, previous.query, previous.index);
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

function getEditorSearchState(editor: any): SearchState {
  return searchPluginKey.getState(editor.state) ?? emptySearchState(editor.state.doc);
}

function runEditorSearch(editor: any, query: string, requestedIndex: number) {
  const nextState = buildSearchState(editor.state.doc, query, requestedIndex);
  let tr = editor.state.tr.setMeta(searchPluginKey, {
    query: nextState.query,
    index: nextState.index,
  });

  const activeRange = nextState.ranges[nextState.index];
  if (activeRange) {
    scheduleScrollSearchRangeIntoView(editor, activeRange);
  } else if (!nextState.query && !editor.state.selection.empty) {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(editor.state.selection.to)));
  }

  editor.view.dispatch(tr);
  scheduleDomSearchHighlights(editor, nextState.query, nextState.index);
  return { index: nextState.index, count: nextState.ranges.length };
}

export interface NovelEditorHandle {
  search: (query: string, index: number) => { index: number; count: number };
  getSearchState: () => { query: string; index: number; count: number };
  replace: (replacement: string) => { index: number; count: number };
  replaceAll: (replacement: string) => { index: number; count: number };
}

let IMAGE_UPLOAD_HANDLER: ((file: File) => Promise<{ id: string; contentUrl: string }>) | null =
  null;

let pendingImageInsert: { editor: any } | null = null;

function handleSlashCommandNavigation(event: KeyboardEvent) {
  const commandMenu = document.querySelector("#slash-command");
  if (!commandMenu || !SLASH_COMMAND_NAVIGATION_KEYS.has(event.key)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  commandMenu.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: event.key,
      cancelable: true,
      bubbles: true,
    }),
  );
  return true;
}

const baseSlashCommandItems: SuggestionItem[] = [
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1 className="w-4 h-4" />,
    searchTerms: ["h1", "title", "heading"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2 className="w-4 h-4" />,
    searchTerms: ["h2", "subtitle"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: <Heading3 className="w-4 h-4" />,
    searchTerms: ["h3"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: <List className="w-4 h-4" />,
    searchTerms: ["bullet", "unordered", "ul"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: <ListOrdered className="w-4 h-4" />,
    searchTerms: ["ordered", "ol", "number"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Task List",
    description: "Checklist with checkboxes",
    icon: <CheckSquare className="w-4 h-4" />,
    searchTerms: ["todo", "checkbox", "task"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Code Block",
    description: "Syntax-highlighted code",
    icon: <Code className="w-4 h-4" />,
    searchTerms: ["code", "codeblock", "fence"],
    command: ({ editor, range }) => {
      (
        editor.chain().focus().deleteRange(range) as unknown as {
          toggleCodeBlock: () => { run: () => boolean };
        }
      )
        .toggleCodeBlock()
        .run();
    },
  },
  {
    title: "Mermaid Diagram",
    description: "Flowchart, sequence, etc.",
    icon: <GitBranch className="w-4 h-4" />,
    searchTerms: ["mermaid", "diagram", "flowchart", "sequence", "graph"],
    command: ({ editor, range }) => {
      (
        editor.chain().focus().deleteRange(range) as unknown as {
          setCodeBlock: (attrs: { language: string }) => { run: () => boolean };
        }
      )
        .setCodeBlock({ language: "mermaid" })
        .run();
    },
  },
  {
    title: "Blockquote",
    description: "Indented quote",
    icon: <Quote className="w-4 h-4" />,
    searchTerms: ["quote", "blockquote"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Table",
    description: "Insert a table",
    icon: <Table2 className="w-4 h-4" />,
    searchTerms: ["table", "grid", "spreadsheet"],
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    title: "Horizontal Rule",
    description: "Visual divider",
    icon: <Minus className="w-4 h-4" />,
    searchTerms: ["hr", "divider", "separator"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: "Table of Contents",
    description: "Dynamic outline of headings",
    icon: <TableOfContents className="w-4 h-4" />,
    searchTerms: ["toc", "outline", "contents", "navigation"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: "tableOfContents" }).run();
    },
  },
  {
    title: "Image",
    description: "Upload an image",
    icon: <Image className="w-4 h-4" />,
    searchTerms: ["image", "picture", "photo", "upload"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      pendingImageInsert = { editor };
      // Trigger the hidden file input
      document.getElementById("novel-image-upload")?.click();
    },
  },
];

const defaultExtensions = [
  StarterKit.configure({
    codeBlock: false,
    horizontalRule: false,
  }),
  Placeholder.configure({
    placeholder: "Press '/' for commands...",
  }),
  TiptapLink.configure({
    HTMLAttributes: { class: "text-foreground underline", target: "_blank" },
  }),
  TiptapImage,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  HorizontalRule,
  MermaidCodeBlock.configure({ lowlight }),
  TiptapUnderline,
  TableOfContentsExtension,
  SearchHighlightExtension,
];

interface NovelEditorProps {
  noteId?: string;
  onContentChange?: (markdown: string) => void;
  onUploadImage?: (file: File) => Promise<{ id: string; contentUrl: string }>;
}

type PendingEditorSave = {
  noteId: string;
  path: string;
  title: string;
  content: any;
  markdown: string;
};

function editorContentFromNoteDoc(doc: any) {
  if (
    doc &&
    doc.content &&
    typeof doc.content === "object" &&
    Object.keys(doc.content).length > 0
  ) {
    return doc.content;
  }

  if (doc?.markdown) {
    const blocks = parseMarkdownForTiptapPaste(doc.markdown);
    return {
      type: "doc",
      content: blocks.length > 0 ? blocks : [{ type: "paragraph" }],
    };
  }

  return { type: "doc", content: [{ type: "paragraph" }] };
}

export const NovelEditor = forwardRef<NovelEditorHandle, NovelEditorProps>(function NovelEditor(
  { noteId, onContentChange, onUploadImage },
  ref,
) {
  const db = useDatabase();
  const [mounted, setMounted] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  const dbRef = useRef(db);
  dbRef.current = db;
  const contentLoadedRef = useRef(contentLoaded);
  contentLoadedRef.current = contentLoaded;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const notePathRef = useRef<string>("");
  const noteTitleRef = useRef<string>("");
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const [templates, setTemplates] = useState<LocalNoteSummary[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatePickerError, setTemplatePickerError] = useState("");
  const [insertingTemplateId, setInsertingTemplateId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<any>(null);
  const activeStreamRef = useRef<{ kind: "create" | "edit" } | null>(null);
  const pendingEditorSaveRef = useRef<PendingEditorSave | null>(null);
  const lastAppliedUpdatedAtRef = useRef<string | null>(null);

  const flushPendingEditorSave = useCallback(
    async (saveTargetId = noteIdRef.current, options: { requireCurrentNote?: boolean } = {}) => {
      const database = dbRef.current;
      const snapshot = pendingEditorSaveRef.current;
      if (
        !database ||
        !saveTargetId ||
        !snapshot ||
        snapshot.noteId !== saveTargetId ||
        !contentLoadedRef.current
      ) {
        return;
      }

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      try {
        if (options.requireCurrentNote && noteIdRef.current !== saveTargetId) return;

        const existing = await database.notes.findOne({ selector: { id: saveTargetId } }).exec();
        if (!existing || existing.isDeleted) return;

        const nextUpdatedAt = new Date().toISOString();
        lastAppliedUpdatedAtRef.current = nextUpdatedAt;
        await existing.patch({
          title: snapshot.title,
          content: snapshot.content,
          markdown: snapshot.markdown,
          updatedAt: nextUpdatedAt,
        });
        if (pendingEditorSaveRef.current === snapshot) {
          pendingEditorSaveRef.current = null;
        }
        if (noteIdRef.current === saveTargetId) {
          noteTitleRef.current = snapshot.title;
        }
        useSyncStore.getState().setSaveState("saved");
      } catch (err) {
        console.error("Failed to save note to RxDB:", err);
        useSyncStore.getState().setSaveState("error");
      }
    },
    [],
  );

  useEffect(() => {
    setMounted(true);
    return () => clearDomSearchHighlights();
  }, []);

  useEffect(() => {
    IMAGE_UPLOAD_HANDLER = onUploadImage ?? null;
  }, [onUploadImage]);

  useEffect(() => {
    if (!templatePickerOpen) return;

    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatePickerError("");

    void listTemplates()
      .then((nextTemplates) => {
        if (cancelled) return;
        setTemplates(nextTemplates);
      })
      .catch((error) => {
        if (cancelled) return;
        setTemplatePickerError(error instanceof Error ? error.message : "Failed to load templates");
      })
      .finally(() => {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [templatePickerOpen]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !IMAGE_UPLOAD_HANDLER || !pendingImageInsert) return;

    const { editor } = pendingImageInsert;
    pendingImageInsert = null;

    try {
      const result = await IMAGE_UPLOAD_HANDLER(file);
      (editor.chain().focus() as any).setImage({ src: result.contentUrl }).run();
    } catch {
      // upload failed — silently ignore, editor stays focused
    }

    // Reset so the same file can be picked again
    e.target.value = "";
  }, []);

  const handleTemplateSelect = useCallback(async (template: LocalNoteSummary) => {
    const editor = editorRef.current;
    if (!editor) return;

    setInsertingTemplateId(template.id);
    setTemplatePickerError("");

    try {
      const content = await loadTemplateTiptapContent(template.id);
      if (content.length > 0) {
        editor.chain().focus().insertContentAt(editor.state.doc.content.size, content).run();
      }
      setTemplatePickerOpen(false);
    } catch (error) {
      setTemplatePickerError(error instanceof Error ? error.message : "Failed to insert template");
    } finally {
      setInsertingTemplateId(null);
    }
  }, []);

  const slashCommandItems = useMemo<SuggestionItem[]>(
    () => [
      ...baseSlashCommandItems,
      {
        title: "Insert from template",
        description: "Append content from a template",
        icon: <FileStack className="w-4 h-4" />,
        searchTerms: ["template", "insert", "append", "snippet"],
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).run();
          setTemplatePickerError("");
          setTemplatePickerOpen(true);
        },
      },
    ],
    [],
  );

  const editorExtensions = useMemo(
    () =>
      [
        ...defaultExtensions,
        Command.configure({
          suggestion: {
            startOfLine: true,
            items: () => slashCommandItems,
            render: renderItems,
          },
        }),
      ] as any,
    [slashCommandItems],
  );

  const applyMarkdownToEditor = useCallback((markdown: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const nextContent = parseMarkdownForTiptapPaste(markdown);
    editor.commands.setContent(
      {
        type: "doc",
        content: nextContent.length > 0 ? nextContent : [{ type: "paragraph" }],
      },
      false,
    );
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      search(query: string, index: number) {
        const editor = editorRef.current;
        if (!editor) return { index: 0, count: 0 };
        return runEditorSearch(editor, query, index);
      },
      getSearchState() {
        const editor = editorRef.current;
        if (!editor) return { query: "", index: 0, count: 0 };
        const state = getEditorSearchState(editor);
        return { query: state.query, index: state.index, count: state.ranges.length };
      },
      replace(replacement: string) {
        const editor = editorRef.current;
        if (!editor) return { index: 0, count: 0 };

        const state = getEditorSearchState(editor);
        const activeRange = state.ranges[state.index];
        if (!state.query || !activeRange) return { index: state.index, count: state.ranges.length };

        editor.view.dispatch(
          editor.state.tr.insertText(replacement, activeRange.from, activeRange.to),
        );
        return runEditorSearch(editor, state.query, state.index);
      },
      replaceAll(replacement: string) {
        const editor = editorRef.current;
        if (!editor) return { index: 0, count: 0 };

        const state = getEditorSearchState(editor);
        if (!state.query || state.ranges.length === 0) {
          return { index: state.index, count: state.ranges.length };
        }

        let tr = editor.state.tr;
        for (const range of [...state.ranges].reverse()) {
          tr = tr.insertText(replacement, range.from, range.to);
        }
        editor.view.dispatch(tr);
        return runEditorSearch(editor, state.query, 0);
      },
    }),
    [],
  );

  useEffect(() => {
    const api = (window as any).slateDesktop;
    if (!api?.onPasteMarkdown) return;

    const handlePasteMarkdown = (_event: unknown, payload?: { text?: string }) => {
      const text = payload?.text?.trim();
      const editor = editorRef.current;
      if (!text || !editor) return;

      const content = parseMarkdownForTiptapPaste(text);
      if (!content || !Array.isArray(content) || content.length === 0) return;

      editor.chain().focus().insertContent(content).run();
    };

    api.onPasteMarkdown(handlePasteMarkdown);
    return () => {
      api.offPasteMarkdown?.();
    };
  }, []);

  useEffect(() => {
    const api = (window as any).slateDesktop;
    if (!api?.onCopySelectionAsMarkdown) return;

    const handleCopySelectionAsMarkdown = () => {
      const editor = editorRef.current;
      if (!editor) return;

      const selection = editor.state.selection;
      if (selection.empty) return;

      const selectionContent = selection.content().content;
      const fallbackText = selectionContent.textBetween(0, selectionContent.size, "\n\n");
      let markdown = fallbackText;
      const selectionJson = selectionContent.toJSON?.();
      if (Array.isArray(selectionJson)) {
        try {
          markdown =
            noteContentToMarkdown({ type: "doc", content: selectionJson }, { tightLists: true }) ||
            fallbackText;
        } catch {
          markdown = fallbackText;
        }
      }
      if (markdown) {
        void navigator.clipboard.writeText(markdown);
      }
    };

    api.onCopySelectionAsMarkdown(handleCopySelectionAsMarkdown);
    return () => {
      api.offCopySelectionAsMarkdown?.();
    };
  }, []);

  useEffect(() => {
    if (!noteId) return;

    const handleAiNoteStream = (event: Event) => {
      const detail = (event as CustomEvent<AiNoteStreamDetail>).detail;
      if (detail?.documentId !== noteId) return;

      if (detail.phase === "start") {
        activeStreamRef.current = {
          kind: detail.kind === "edit" ? "edit" : "create",
        };
        return;
      }

      if (typeof detail.content !== "string") return;

      const stream =
        activeStreamRef.current ??
        (() => {
          const next = {
            kind: detail.kind === "edit" ? "edit" : "create",
          } as const;
          activeStreamRef.current = next;
          return next;
        })();

      if (stream.kind === "edit" && detail.phase !== "done") {
        return;
      }

      if (detail.phase === "done") {
        applyMarkdownToEditor(detail.content);
        activeStreamRef.current = null;
        return;
      }

      applyMarkdownToEditor(detail.content);
    };

    window.addEventListener(AI_NOTE_STREAM_EVENT, handleAiNoteStream as EventListener);
    return () => {
      activeStreamRef.current = null;
      window.removeEventListener(AI_NOTE_STREAM_EVENT, handleAiNoteStream as EventListener);
    };
  }, [applyMarkdownToEditor, noteId]);

  // Load content from RxDB when noteId or editor instance changes
  useEffect(() => {
    const loadingForNoteId = noteId;
    if (!db || !loadingForNoteId || !editorInstance) {
      if (!loadingForNoteId || !editorInstance) {
        contentLoadedRef.current = false;
        setContentLoaded(false);
      }
      return;
    }

    const editor = editorInstance;
    let cancelled = false;
    contentLoadedRef.current = false;
    setContentLoaded(false);
    (async () => {
      const doc = await db.notes.findOne({ selector: { id: loadingForNoteId } }).exec();
      if (cancelled || noteIdRef.current !== loadingForNoteId) return;

      if (doc) {
        editor.commands.setContent(editorContentFromNoteDoc(doc), false);
        notePathRef.current = doc.path;
        noteTitleRef.current = doc.title ?? "";
        lastAppliedUpdatedAtRef.current = doc.updatedAt ?? null;
      } else {
        editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }, false);
        notePathRef.current = "";
        noteTitleRef.current = "";
        lastAppliedUpdatedAtRef.current = null;
      }
      if (noteIdRef.current === loadingForNoteId) {
        contentLoadedRef.current = true;
        setContentLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, noteId, editorInstance]);

  useEffect(
    function remoteNoteSubscription() {
      const liveNoteId = noteId;
      const editor = editorInstance;
      if (!db || !liveNoteId || !editor) return;

      const sub = db.notes.findOne({ selector: { id: liveNoteId } }).$.subscribe((doc) => {
        if (!doc || noteIdRef.current !== liveNoteId || !contentLoadedRef.current) {
          return;
        }

        const updatedAt = doc.updatedAt ?? null;
        if (updatedAt && updatedAt === lastAppliedUpdatedAtRef.current) {
          return;
        }

        if (doc.isDeleted) {
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          pendingEditorSaveRef.current = null;
          notePathRef.current = "";
          noteTitleRef.current = "";
          lastAppliedUpdatedAtRef.current = updatedAt;
          useWorkspaceStore.getState().setSelectedNote(null);
          useAppStore.getState().setSelectedNoteId("");
          editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }, false);
          useSyncStore.getState().setSaveState("saved");
          return;
        }

        if (pendingEditorSaveRef.current) {
          return;
        }

        const nextContent = editorContentFromNoteDoc(doc);
        const currentContent = editor.getJSON?.();
        notePathRef.current = doc.path;
        noteTitleRef.current = doc.title ?? "";
        lastAppliedUpdatedAtRef.current = updatedAt;
        useWorkspaceStore.getState().setSelectedNote(doc.toJSON() as any);

        if (JSON.stringify(currentContent) === JSON.stringify(nextContent)) {
          return;
        }

        const { from, to } = editor.state.selection;
        editor.commands.setContent(nextContent, false);
        const docSize = editor.state.doc.content.size;
        const restoredFrom = Math.min(from, docSize);
        const restoredTo = Math.min(to, docSize);
        try {
          editor.commands.setTextSelection({ from: restoredFrom, to: restoredTo });
        } catch {}
        useSyncStore.getState().setSaveState("saved");
      });

      return () => sub.unsubscribe();
    },
    [db, noteId, editorInstance],
  );

  // Flush pending debounced saves when switching notes or unmounting.
  useEffect(() => {
    const saveTargetId = noteId;
    return () => {
      void flushPendingEditorSave(saveTargetId);
    };
  }, [flushPendingEditorSave, noteId]);

  if (!mounted || !db) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  return (
    <EditorRoot>
      <input
        id="novel-image-upload"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <EditorContent
        key={noteId}
        extensions={editorExtensions}
        className="slate-editor"
        editorProps={{
          attributes: {
            class: "prose prose-invert max-w-none focus:outline-none",
          },
          handleKeyDown: (_view, event) => handleSlashCommandNavigation(event),
          handlePaste: (_view, event) => {
            const items = Array.from(event.clipboardData?.items ?? []);
            const imageItem = items.find((item) => item.type.startsWith("image/"));
            if (!imageItem || !IMAGE_UPLOAD_HANDLER) return false;
            const file = imageItem.getAsFile();
            if (!file) return false;
            event.preventDefault();
            IMAGE_UPLOAD_HANDLER(file)
              .then((result) => {
                editorRef.current?.chain().focus().setImage({ src: result.contentUrl }).run();
              })
              .catch(() => {});
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
            const imageFile = files.find((f) => f.type.startsWith("image/"));
            if (!imageFile || !IMAGE_UPLOAD_HANDLER) return false;
            event.preventDefault();
            const coords = {
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            };
            const pos = view.posAtCoords(coords);
            IMAGE_UPLOAD_HANDLER(imageFile)
              .then((result) => {
                const editor = editorRef.current;
                if (!editor) return;
                const insertChain = editor.chain().focus();
                if (pos) insertChain.setTextSelection(pos.pos);
                insertChain.setImage({ src: result.contentUrl }).run();
              })
              .catch(() => {});
            return true;
          },
        }}
        onCreate={({ editor }) => {
          editorRef.current = editor;
          setEditorInstance(editor);
          // Hide broken images gracefully
          editor.view.dom.addEventListener(
            "error",
            (e) => {
              const target = e.target as HTMLElement;
              if (target.tagName === "IMG") {
                (target as HTMLImageElement).style.display = "none";
              }
            },
            true,
          );
        }}
        onUpdate={({ editor }) => {
          editorRef.current = editor;
          const md = editor.storage.markdown?.getMarkdown?.() ?? editor.getText();
          if (onContentChange && editor) {
            onContentChange(md);
          }

          // Debounced save to RxDB
          if (db && noteId && contentLoadedRef.current) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            const saveTargetId = noteId;
            const title = documentTitleFromMarkdown(md, {
              existingTitle: noteTitleRef.current,
            });
            pendingEditorSaveRef.current = {
              noteId: saveTargetId,
              path: notePathRef.current || saveTargetId,
              title,
              content: editor.getJSON(),
              markdown: md,
            };
            saveTimerRef.current = setTimeout(() => {
              void flushPendingEditorSave(saveTargetId, { requireCurrentNote: true });
            }, 500);
          }
        }}
      >
        {editorInstance && <TableMenu editor={editorInstance} />}
        <TemplateInsertPicker
          open={templatePickerOpen}
          templates={templates}
          loading={templatesLoading}
          errorMessage={templatePickerError}
          insertingTemplateId={insertingTemplateId}
          onSelect={handleTemplateSelect}
          onClose={() => {
            if (!insertingTemplateId) {
              setTemplatePickerOpen(false);
              setTemplatePickerError("");
            }
          }}
        />
        <EditorCommand className="glass-popover z-50 h-auto max-h-[330px] w-[260px] overflow-y-auto p-1.5 scrollbar-none">
          <EditorCommandEmpty className="px-3 py-2 text-sm text-[rgba(255,255,255,0.4)]">
            No results
          </EditorCommandEmpty>
          <EditorCommandList>
            {slashCommandItems.map((item) => (
              <EditorCommandItem
                value={item.title}
                onCommand={(val) => item.command?.(val)}
                key={item.title}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-sm text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.08)] aria-selected:bg-[rgba(255,255,255,0.08)]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.06)]">
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-[0.82rem] font-medium leading-tight">{item.title}</p>
                  <p className="text-[0.7rem] text-[rgba(255,255,255,0.35)] leading-tight">
                    {item.description}
                  </p>
                </div>
              </EditorCommandItem>
            ))}
          </EditorCommandList>
        </EditorCommand>
      </EditorContent>
    </EditorRoot>
  );
});
