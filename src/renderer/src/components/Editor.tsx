import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

export function NoteEditor({
  noteId,
  contentJson,
  onChange
}: {
  noteId: string
  contentJson: string
  onChange: (json: string, plain: string) => void
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: 'Escribe… Usa # para títulos, - para listas, [] para tareas.' })
      ],
      content: parse(contentJson),
      onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' }))
    },
    [noteId]
  )

  useEffect(() => () => editor?.destroy(), [editor])
  return <EditorContent editor={editor} />
}

function parse(json: string): object | string {
  if (!json) return ''
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}
