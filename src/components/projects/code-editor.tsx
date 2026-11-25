// The CodeMirror editor of the Compose file tab. It is loaded with React.lazy (see project-compose-file.tsx),
// so the CodeMirror packages stay out of the main bundle until a Compose file is open.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { yaml } from '@codemirror/lang-yaml'
import { Annotation, Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

export interface CodeEditorProps {
  /** the text the editor shows; the editor reports every change through onChange */
  value: string
  onChange: (text: string) => void
  /** Ctrl/Cmd+S */
  onSave: () => void
  readOnly: boolean
  /** a Compose file is YAML; any other file is plain text */
  language: 'yaml' | 'plain'
  /** moves the cursor to a line and marks it (a failed check). Pass a new object to mark the same line again. */
  jump: { line: number } | null
  label: string
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '12px',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '18px' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent) !important' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '32px', paddingRight: '8px' },
  '.cm-activeLine': { backgroundColor: 'var(--accent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '.cm-error-line': { backgroundColor: 'color-mix(in srgb, var(--destructive) 14%, transparent)' },
})

const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--info)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--success)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--warning)' },
  { tag: [t.comment, t.lineComment], color: 'var(--muted-foreground)', fontStyle: 'italic' },
])

// --- the line a failed check points at --------------------------------------

const setErrorLine = StateEffect.define<number | null>()

function errorLineMark(state: EditorState, line: number | null): DecorationSet {
  if (line === null || line < 1 || line > state.doc.lines) return Decoration.none
  return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(state.doc.line(line).from)])
}

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) return errorLineMark(tr.state, effect.value)
    }
    // an edit clears the mark: the line may no longer be the one the check meant
    return tr.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Marks the transactions that set the text from the value prop, so they are not reported as edits. */
const External = Annotation.define<boolean>()

function editableExtensions(readOnly: boolean): Extension[] {
  return [EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]
}

export function CodeEditor({ value, onChange, onSave, readOnly, language, jump, label }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [editable] = useState(() => new Compartment())
  // Effect events: the listeners are made once with the view, but always reach the latest props.
  const notifyChange = useEffectEvent((text: string) => onChange(text))
  const saveNow = useEffectEvent(() => onSave())

  const createView = useEffectEvent(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            if (update.transactions.some((tr) => tr.annotation(External))) return
            notifyChange(update.state.doc.toString())
          }),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-s',
                run: () => {
                  saveNow()
                  return true
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          history(),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          theme,
          syntaxHighlighting(highlight),
          language === 'yaml' ? yaml() : [],
          errorLineField,
          editable.of(editableExtensions(readOnly)),
        ],
      }),
    })
    viewRef.current = view
  })

  useEffect(() => {
    createView()
    const view = viewRef.current
    return () => {
      view?.destroy()
      viewRef.current = null
    }
  }, [])

  // The text follows the value prop: a discard, a reload or a save can change it from outside.
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: External.of(true),
    })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.reconfigure(editableExtensions(readOnly)) })
  }, [readOnly, editable])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (jump === null) {
      view.dispatch({ effects: setErrorLine.of(null) })
      return
    }
    const line = Math.min(Math.max(jump.line, 1), view.state.doc.lines)
    const pos = view.state.doc.line(line).from
    view.dispatch({
      selection: { anchor: pos },
      effects: [setErrorLine.of(line), EditorView.scrollIntoView(pos, { y: 'center' })],
    })
    view.focus()
  }, [jump])

  return <div className="h-full min-h-0 w-full" ref={hostRef} />
}
