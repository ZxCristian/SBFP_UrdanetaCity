/**
 * A warning shown before something is destroyed.
 *
 * The district console and the teacher website share it so "delete" never
 * happens on a single click in one place and behind a browser `confirm()` in
 * another: both spell out *what* is about to go, in the app's own styling,
 * with the safe choice focused and the destructive one a deliberate second
 * click.
 *
 * Keyboard: Escape cancels, Tab stays inside the dialog, focus starts on the
 * safe button and returns to whatever opened it. Clicking the dimmed backdrop
 * cancels too — it never confirms.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface ConfirmPalette {
  surface: string;
  /** Secondary surface — the warning block behind the consequences text. */
  surface2: string;
  border: string;
  text: string;
  sub: string;
  /** The destructive button and the warning glyph. */
  danger: string;
  /** A wash of `danger`, safe to put text on. */
  dangerSoft: string;
  /** Text on the solid `danger` button — dark ink on a neon red, white on a deep red. */
  dangerText?: string;
  font: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  /** Names the thing being destroyed, e.g. "Delete Juan Dela Cruz's record?" */
  title: string;
  /** The consequences. Say what is lost and that it cannot be undone. */
  children: ReactNode;
  /** Defaults to "Delete". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  palette: ConfirmPalette;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  palette: p,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Open: remember what had focus, move focus to the safe button, pin the page
  // behind the dialog. Close: undo all three.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep Tab inside the dialog: two buttons, so the cycle is trivial — but
    // don't let focus walk into the records table behind it.
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(6, 8, 10, 0.55)",
        backdropFilter: "blur(2px)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          maxWidth: 452,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: p.surface,
          border: `1px solid ${p.border}`,
          borderRadius: 14,
          padding: "22px 22px 18px",
          boxShadow: "0 24px 60px rgba(8, 12, 18, 0.32)",
          fontFamily: p.font,
          color: p.text,
        }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            style={{
              flex: "none",
              width: 34,
              height: 34,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              background: p.dangerSoft,
              color: p.danger,
              fontSize: 17,
              fontWeight: 700,
            }}
          >
            !
          </span>
          <h2
            id={titleId}
            style={{
              fontSize: 16.5,
              fontWeight: 600,
              lineHeight: 1.35,
              color: p.text,
              marginTop: 4,
            }}
          >
            {title}
          </h2>
        </div>

        <div
          id={bodyId}
          style={{
            marginTop: 14,
            marginLeft: 46,
            padding: "11px 13px",
            background: p.surface2,
            border: `1px solid ${p.border}`,
            borderLeft: `3px solid ${p.danger}`,
            borderRadius: 9,
            fontSize: 13,
            lineHeight: 1.6,
            color: p.sub,
          }}
        >
          {children}
        </div>

        <div className="flex items-center justify-end gap-2 flex-wrap" style={{ marginTop: 20 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 13,
              fontWeight: 500,
              padding: "9px 16px",
              borderRadius: 8,
              border: `1px solid ${p.border}`,
              background: p.surface,
              color: p.text,
              cursor: "pointer",
              fontFamily: p.font,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: 8,
              border: `1px solid ${p.danger}`,
              background: p.danger,
              color: p.dangerText ?? "#fff",
              cursor: "pointer",
              fontFamily: p.font,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
