import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type ChatMarkdownProps = {
  text: string
  color: string
  linkColor?: string
  dividerColor?: string
}

export function ChatMarkdown({
  text,
  color,
  linkColor = "#4D8062",
  dividerColor = "rgba(61, 56, 48, 0.15)",
}: ChatMarkdownProps) {
  const components: Components = {
    p: ({ children }) => (
      <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
    ),
    strong: ({ children }) => <strong className="font-800">{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    ul: ({ children }) => (
      <ul className="list-disc pl-5 mb-3 space-y-1.5 last:mb-0">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal pl-5 mb-3 space-y-1.5 last:mb-0">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    h1: ({ children }) => (
      <p className="font-800 text-base mb-2 leading-snug">{children}</p>
    ),
    h2: ({ children }) => (
      <p className="font-800 text-sm mb-2 leading-snug">{children}</p>
    ),
    h3: ({ children }) => (
      <p className="font-700 mb-2 leading-snug">{children}</p>
    ),
    hr: () => (
      <hr
        style={{ border: "none", borderTop: `1px solid ${dividerColor}` }}
        className="my-3"
      />
    ),
    blockquote: ({ children }) => (
      <blockquote
        style={{ borderLeft: `3px solid ${dividerColor}` }}
        className="pl-3 my-3 italic opacity-90"
      >
        {children}
      </blockquote>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: linkColor, textDecoration: "underline", fontWeight: 600 }}
      >
        {children}
      </a>
    ),
    code: ({ className, children }) => {
      const inline = !className
      if (inline) {
        return (
          <code
            style={{ backgroundColor: dividerColor }}
            className="px-1 py-0.5 rounded text-[0.85em] font-600"
          >
            {children}
          </code>
        )
      }
      return (
        <pre
          style={{ backgroundColor: dividerColor }}
          className="p-3 rounded-lg mb-3 overflow-x-auto text-xs leading-relaxed"
        >
          <code>{children}</code>
        </pre>
      )
    },
  }

  return (
    <div className="text-sm font-500" style={{ color }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
