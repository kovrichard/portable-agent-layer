interface TemplateBlockProps {
  label?: string;
  children: React.ReactNode;
}

export function TemplateBlock({
  label = "Copy this template for each opportunity",
  children,
}: TemplateBlockProps) {
  return (
    <div className="template-block">
      <div className="template-block-label">{label}</div>
      <pre className="template-block-content">
        <code>{children}</code>
      </pre>
    </div>
  );
}
