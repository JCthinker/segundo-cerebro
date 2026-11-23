import { useEffect, useMemo, useRef, useState } from "react";
import type { AiStatus, Area, Item, Note } from "@shared/types";
import { KIND_LABEL } from "@shared/types";
import { deleteNoteQuestion } from "@shared/notes";
import { call, useAction, useData } from "../api";
import { NoteEditor } from "../components/Editor";
import { DismissButton } from "../components/Dismiss";
import { DuePill } from "../components/ItemRow";
import {
  Button,
  Empty,
  ErrorNote,
  Icon,
  inputCls,
  Pill,
  Spinner,
} from "../components/ui";
import { useNav } from "../nav";
import { Workflow, WORKFLOW_NOTE_ID } from "./Workflow";

const EXTRACT_AFTER_MS = 4000;

/** Agrupa las notas por la nota en la que están metidas. Las de primer nivel van con la clave ''. */
function childrenMap(notes: Note[]): Map<string, Note[]> {
  const ids = new Set(notes.map((n) => n.id));
  const map = new Map<string, Note[]>();
  for (const n of notes) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  // Dentro de una nota, las subnotas van en el orden en que se crearon (como en Notion).
  for (const [k, list] of map)
    if (k) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return map;
}

/** Cadena de notas desde la principal hasta esta (incluida). */
function ancestry(notes: Note[], id: string): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: Note[] = [];
  let cur = byId.get(id);
  while (cur && out.length < 50) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

const OPEN_KEY = "notes.open";
function loadOpen(): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

export function Notes({ ai }: { ai: AiStatus | null }) {
  const { param, go } = useNav();
  const { data: notes = [] } = useData<Note[]>("notes.list", [], ["notes"]);
  const [q, setQ] = useState("");
  const { data: hits } = useData<
    { id: string; title: string; snippet: string }[]
  >("notes.search", [q], []);
  const selected =
    param ?? notes.find((n) => !n.parentId)?.id ?? notes[0]?.id ?? null;
  const kids = useMemo(() => childrenMap(notes), [notes]);

  const [open, setOpen] = useState<Set<string>>(loadOpen);
  const setOpenSaved = (next: Set<string>) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      /* sin almacenamiento: solo se pierde qué carpetas estaban abiertas */
    }
  };
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenSaved(next);
  };
  const expand = (ids: string[]) => {
    if (ids.every((i) => open.has(i))) return;
    setOpenSaved(new Set([...open, ...ids]));
  };

  // Al abrir una subnota, despliega las notas que la contienen para que se vea en la lista.
  useEffect(() => {
    if (!selected) return;
    const chain = ancestry(notes, selected)
      .slice(0, -1)
      .map((n) => n.id);
    if (chain.length) expand(chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, notes]);

  const create = async (parentId: string | null = null) => {
    const n = await call<Note>("notes.create", parentId);
    if (parentId) expand([parentId]);
    go("notes", n.id);
  };

  // Arrastrar una nota encima de otra la mete dentro.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const drop = async (target: string | null) => {
    const id = dragId;
    setDragId(null);
    setDropOn(null);
    if (!id || id === target) return;
    await call("notes.move", id, target);
    if (target) expand([target]);
  };

  const row = (n: Note, depth: number): React.ReactNode => {
    const children = kids.get(n.id) ?? [];
    const isOpen = open.has(n.id);
    return (
      <div key={n.id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDragId(n.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropOn(null);
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === n.id) return;
            e.preventDefault();
            setDropOn(n.id);
          }}
          onDragLeave={() => setDropOn((d) => (d === n.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            void drop(n.id);
          }}
          style={{ paddingLeft: 4 + depth * 14 }}
          className={`group mb-0.5 flex items-center gap-0.5 rounded-lg pr-1 ${
            dropOn === n.id
              ? "bg-selected ring-1 ring-clay"
              : n.id === selected
                ? "bg-selected"
                : "hover:bg-hover"
          } ${dragId === n.id ? "opacity-50" : ""}`}
        >
          <button
            onClick={() => toggle(n.id)}
            className={`grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-hover hover:text-ink ${children.length ? "" : "invisible"}`}
            aria-label={isOpen ? "Plegar" : "Desplegar"}
          >
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          </button>
          <button
            onClick={() => go("notes", n.id)}
            className="min-w-0 flex-1 py-1.5 text-left"
          >
            <div className="truncate text-[13px] font-medium">
              {n.title || "Sin título"}
            </div>
          </button>
          <button
            onClick={() => void create(n.id)}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
            title="Nueva nota dentro de esta"
            aria-label="Nueva nota dentro de esta"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
        </div>
        {isOpen ? children.map((c) => row(c, depth + 1)) : null}
      </div>
    );
  };

  const roots = kids.get("") ?? [];
  const draggingNested =
    !!dragId && !!notes.find((n) => n.id === dragId)?.parentId;

  return (
    <div className="-mx-8 -my-6 flex h-[calc(100vh)] min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center gap-2 p-3 pt-6">
          <input
            className={inputCls}
            placeholder="Buscar en notas"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void create()}
            title="Nueva nota"
            aria-label="Nueva nota"
          >
            <Icon name="plus" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {q.trim() ? (
            <>
              {(hits ?? []).map((h) => (
                <button
                  key={h.id}
                  onClick={() => go("notes", h.id)}
                  className={`mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left ${h.id === selected ? "bg-selected" : "hover:bg-hover"}`}
                >
                  <div className="truncate text-[13px] font-medium">
                    {h.title || "Sin título"}
                  </div>
                  <div className="truncate text-[12px] text-faint">
                    {h.snippet || " "}
                  </div>
                </button>
              ))}
              {!(hits ?? []).length ? (
                <p className="px-2 py-4 text-[12.5px] text-faint">
                  Sin resultados
                </p>
              ) : null}
            </>
          ) : (
            <>
              {draggingNested ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropOn("");
                  }}
                  onDragLeave={() => setDropOn((d) => (d === "" ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void drop(null);
                  }}
                  className={`mb-1 rounded-lg border border-dashed px-2.5 py-2 text-center text-[12px] ${
                    dropOn === ""
                      ? "border-clay bg-selected text-ink"
                      : "border-line-strong text-faint"
                  }`}
                >
                  Suelta aquí para sacarla fuera
                </div>
              ) : null}
              <button
                onClick={() => go("notes", WORKFLOW_NOTE_ID)}
                className={`mb-0.5 flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-1 pl-1.5 text-left ${
                  selected === WORKFLOW_NOTE_ID ? "bg-selected" : "hover:bg-hover"
                }`}
                title="Cómo trabajas: Claude lo lee siempre. Se puede editar, no borrar."
              >
                <Icon name="route" className="h-3.5 w-3.5 text-clay" />
                <span className="truncate text-[13px] font-medium">Mi flujo</span>
              </button>
              {roots.map((n) => row(n, 0))}
              {!roots.length ? (
                <p className="px-2 py-4 text-[12.5px] text-faint">
                  Aún no hay notas
                </p>
              ) : null}
              {roots.length ? (
                <p className="px-2 pt-3 text-[11.5px] leading-snug text-faint">
                  Arrastra una nota encima de otra para meterla dentro.
                </p>
              ) : null}
            </>
          )}
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected === WORKFLOW_NOTE_ID ? (
          <Workflow ai={ai} />
        ) : selected ? (
          <NoteView
            key={selected}
            id={selected}
            ai={ai}
            notes={notes}
            onCreateChild={() => void create(selected)}
          />
        ) : (
          <div className="p-10">
            <Empty
              title="Escribe tu primera nota"
              action={
                <Button variant="primary" onClick={() => void create()}>
                  Nueva nota
                </Button>
              }
            >
              Mientras escribes, Claude detecta lo que tienes que hacer y te lo
              propone en el dashboard.
            </Empty>
          </div>
        )}
      </section>
    </div>
  );
}

function NoteView({
  id,
  ai,
  notes,
  onCreateChild,
}: {
  id: string;
  ai: AiStatus | null;
  notes: Note[];
  onCreateChild: () => void;
}) {
  const { go, editItem } = useNav();
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [saved, setSaved] = useState(true);
  const draft = useRef<{ json: string; plain: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const extractTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { data: allItems = [] } = useData<Item[]>(
    "items.list",
    [{}],
    ["items"],
  );
  const { data: areas = [] } = useData<Area[]>("areas.list", [], ["areas"]);
  const detected = allItems.filter(
    (i) => i.sourceRef === id && i.status !== "dismissed",
  );

  const extract = useAction((force: boolean) =>
    call<number>("notes.extract", id, force),
  );

  useEffect(() => {
    void call<Note>("notes.get", id).then((n) => {
      setNote(n);
      setTitle(n?.title ?? "");
    });
    return () => {
      clearTimeout(saveTimer.current);
      clearTimeout(extractTimer.current);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Refs para que el guardado al salir de la nota vea siempre lo último escrito.
  const titleRef = useRef(title);
  titleRef.current = title;
  const noteRef = useRef(note);
  noteRef.current = note;
  const dirty = useRef(false);

  const flush = async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const d = draft.current ?? {
      json: noteRef.current?.contentJson ?? "",
      plain: noteRef.current?.plain ?? "",
    };
    await call("notes.save", id, titleRef.current, d.json, d.plain);
    setSaved(true);
  };

  const schedule = () => {
    dirty.current = true;
    setSaved(false);
    clearTimeout(saveTimer.current);
    clearTimeout(extractTimer.current);
    saveTimer.current = setTimeout(() => {
      void flush().then(() => {
        if (ai?.ok)
          extractTimer.current = setTimeout(
            () => void extract.run(false),
            EXTRACT_AFTER_MS,
          );
      });
    }, 700);
  };

  if (!note) return null;

  return (
    <div className="mx-auto max-w-3xl px-10 pt-10 pb-24">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-faint">
        <span>{saved ? "Guardado" : "Guardando…"}</span>
        {extract.busy ? (
          <span className="flex items-center gap-1.5">
            · <Spinner className="h-3 w-3" /> Claude está leyendo la nota
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <MoveTo notes={notes} id={id} />
          <Button
            size="sm"
            variant="ghost"
            busy={extract.busy}
            onClick={() => flush().then(() => extract.run(true))}
          >
            <Icon name="sparkles" className="text-clay" /> Analizar ahora
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const inside = descendants(notes, id).length;
              if (!window.confirm(deleteNoteQuestion(title, inside))) return;
              await call("notes.delete", id);
              go("notes", note.parentId ?? undefined);
            }}
            aria-label="Eliminar nota"
          >
            <Icon name="trash" />
          </Button>
        </div>
      </div>
      <Breadcrumbs notes={notes} id={id} title={title} />
      <input
        className="mb-4 w-full bg-transparent text-[28px] font-semibold tracking-tight outline-none placeholder:text-faint"
        placeholder="Sin título"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          schedule();
        }}
      />
      <NoteEditor
        noteId={id}
        contentJson={note.contentJson}
        onChange={(json, plain) => {
          draft.current = { json, plain };
          schedule();
        }}
      />
      <ErrorNote>{extract.error}</ErrorNote>

      <SubNotes notes={notes} id={id} onCreate={onCreateChild} />

      <div className="mt-10 border-t border-line pt-4">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-muted">
          <Icon name="sparkles" className="text-clay" /> Detectado en esta nota
          {!ai?.ok ? (
            <span className="font-normal text-faint">
              · conecta Claude en Ajustes para que se detecte solo
            </span>
          ) : null}
        </div>
        {detected.length ? (
          detected.map((i) => (
            <div
              key={i.id}
              className="flex items-center gap-2 border-b border-line py-2 last:border-0"
            >
              <button
                className={`flex-1 text-left text-[13px] hover:underline ${i.status === "done" ? "text-faint line-through" : ""}`}
                onClick={() => editItem(i)}
              >
                {i.title}
              </button>
              <Pill>
                {KIND_LABEL[i.kind]}
                {i.person ? ` · ${i.person}` : ""}
              </Pill>
              {i.areaId ? (
                <Pill>{areas.find((a) => a.id === i.areaId)?.name}</Pill>
              ) : null}
              <DuePill item={i} />
              {i.status === "proposed" ? (
                <>
                  <DismissButton item={i} label="Descartar" />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      call("items.update", i.id, { status: "active" })
                    }
                  >
                    Confirmar
                  </Button>
                </>
              ) : (
                <Pill tone={i.status === "done" ? "success" : "info"}>
                  {i.status === "done" ? "Hecho" : "Activo"}
                </Pill>
              )}
            </div>
          ))
        ) : (
          <p className="text-[12.5px] text-faint">Nada todavía.</p>
        )}
      </div>
    </div>
  );
}

function descendants(notes: Note[], id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const n of notes)
      if (n.parentId === p && !out.includes(n.id)) {
        out.push(n.id);
        walk(n.id);
      }
  };
  walk(id);
  return out;
}

/** «Nota principal / Subnota / …» encima del título, para saber dónde estás. */
function Breadcrumbs({
  notes,
  id,
  title,
}: {
  notes: Note[];
  id: string;
  title: string;
}) {
  const { go } = useNav();
  const chain = ancestry(notes, id).slice(0, -1);
  if (!chain.length) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 text-[12.5px] text-faint">
      {chain.map((n) => (
        <span key={n.id} className="flex items-center gap-1">
          <button
            className="max-w-[16rem] truncate hover:text-ink hover:underline"
            onClick={() => go("notes", n.id)}
          >
            {n.title || "Sin título"}
          </button>
          <Icon name="chevron" className="h-3 w-3" />
        </span>
      ))}
      <span className="max-w-[16rem] truncate text-muted">
        {title || "Sin título"}
      </span>
    </div>
  );
}

/** Desplegable para meter esta nota dentro de otra (o sacarla). */
function MoveTo({ notes, id }: { notes: Note[]; id: string }) {
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  const blocked = new Set([id, ...descendants(notes, id)]);
  const kids = childrenMap(notes);
  const options: { id: string; label: string }[] = [];
  const walk = (key: string, depth: number) => {
    for (const n of kids.get(key) ?? []) {
      if (blocked.has(n.id)) continue;
      options.push({
        id: n.id,
        label: `${"\u00a0\u00a0".repeat(depth)}${n.title || "Sin título"}`,
      });
      walk(n.id, depth + 1);
    }
  };
  walk("", 0);
  return (
    <label className="flex items-center gap-1 text-[12px] text-faint">
      Dentro de
      <select
        className="max-w-[11rem] rounded-md bg-transparent px-1.5 py-1 text-[12px] text-muted outline-none hover:bg-hover"
        value={note.parentId ?? ""}
        title="Meter esta nota dentro de otra"
        aria-label="Meter esta nota dentro de otra"
        onChange={(e) => void call("notes.move", id, e.target.value || null)}
      >
        <option value="">ninguna</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Lista de las notas que hay dentro de esta, como las subpáginas de Notion. */
function SubNotes({
  notes,
  id,
  onCreate,
}: {
  notes: Note[];
  id: string;
  onCreate: () => void;
}) {
  const { go } = useNav();
  const children = childrenMap(notes).get(id) ?? [];
  return (
    <div className="mt-8">
      {children.length ? (
        <div className="mb-1 text-[12.5px] font-medium text-muted">
          Notas dentro de esta
        </div>
      ) : null}
      {children.map((c) => (
        <button
          key={c.id}
          onClick={() => go("notes", c.id)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-hover"
        >
          <Icon name="notes" className="text-faint" />
          <span className="truncate underline decoration-line-strong underline-offset-4">
            {c.title || "Sin título"}
          </span>
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={onCreate}>
        <Icon name="plus" /> Nota dentro de esta
      </Button>
    </div>
  );
}
