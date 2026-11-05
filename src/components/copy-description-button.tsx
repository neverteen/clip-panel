"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

type Labels = { copy: string; copied: string; error: string };

export function CopyDescriptionButton({ text, labels }: { text: string; labels: Labels }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copyText() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      setStatus("copied");
    } catch {
      try {
        fallbackCopy(text);
        setStatus("copied");
      } catch {
        setStatus("error");
      }
    }
  }

  return <Button onClick={copyText} size="sm" type="button" variant="secondary">
    {status === "copied" ? labels.copied : status === "error" ? labels.error : labels.copy}
  </Button>;
}

function fallbackCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}
