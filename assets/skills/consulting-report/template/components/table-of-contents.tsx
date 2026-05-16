interface TocItem {
  id: string;
  title: string;
}

interface TableOfContentsProps {
  items: TocItem[];
  title?: string;
}

export function TableOfContents({ items, title = "Contents" }: TableOfContentsProps) {
  return (
    <nav className="break-after-page mb-12">
      <h2 className="font-heading text-3xl font-semibold text-foreground mb-6 pb-2 border-b-2 border-primary">
        {title}
      </h2>
      <ol className="list-none p-0 m-0">
        {items.map((item, i) => (
          <li
            key={item.id}
            className="my-3 border-b border-dotted border-border-emphasis pb-2"
          >
            <a
              href={`#${item.id}`}
              className="flex gap-4 items-baseline text-foreground no-underline"
            >
              <span className="font-sans font-semibold text-sm text-primary w-8 shrink-0">
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span className="font-heading font-medium text-base">{item.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
