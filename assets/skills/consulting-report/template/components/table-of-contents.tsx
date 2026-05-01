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
    <nav className="toc">
      <h2>{title}</h2>
      <ol>
        {items.map((item, i) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>
              <span className="toc-number">{(i + 1).toString().padStart(2, "0")}</span>
              <span className="toc-title">{item.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
