import { highlightYaml, type YamlKind } from '@/lib/yaml-highlight'
import { cn } from '@/lib/utils'

const KIND_CLASS: Record<YamlKind, string | undefined> = {
  plain: undefined,
  key: 'text-info',
  string: 'text-success',
  number: 'text-warning',
  bool: 'text-warning',
  comment: 'italic text-muted-foreground',
}

/** YAML text, read only and highlighted, for a short preview (not the editor). */
export function YamlText({ text, label }: { text: string; label: string }) {
  return (
    <pre
      aria-label={label}
      className="max-h-64 min-w-0 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-[18px]"
    >
      <code>
        {highlightYaml(text).map((tokens, lineIndex) => (
          // the lines of a preview never reorder, so the line number is a stable key
          <div className="min-h-[18px] whitespace-pre" key={lineIndex}>
            {tokens.map((token, tokenIndex) => (
              <span className={cn(KIND_CLASS[token.kind])} key={tokenIndex}>
                {token.text}
              </span>
            ))}
          </div>
        ))}
      </code>
    </pre>
  )
}
