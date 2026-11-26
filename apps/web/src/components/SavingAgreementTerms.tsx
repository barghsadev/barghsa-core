export function SavingAgreementTerms({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2 text-sm">
      {title && (
        <p dir="auto" className="font-medium wrap-anywhere">
          {title}
        </p>
      )}
      {body && (
        <p
          dir="auto"
          className="max-h-80 overflow-y-auto whitespace-break-spaces wrap-anywhere rounded-md bg-muted/30 p-4"
        >
          {body}
        </p>
      )}
    </div>
  );
}
