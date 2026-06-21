"use client";

type Tone = "success" | "error" | "info" | "warning";

const tones: Record<Tone, { wrap: string; title: string }> = {
  success: {
    wrap: "border-green-200 bg-green-50 text-green-800",
    title: "text-green-900",
  },
  error: {
    wrap: "border-red-200 bg-red-50 text-red-800",
    title: "text-red-900",
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 text-amber-800",
    title: "text-amber-900",
  },
  info: {
    wrap: "border-vertix/15 bg-vertix/5 text-vertix",
    title: "text-vertix",
  },
};

export function Alert({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  const t = tones[tone];
  return (
    <div className={`rounded-lg border p-4 text-sm ${t.wrap}`} role={tone === "error" ? "alert" : "status"}>
      {title && <p className={`mb-1 font-semibold ${t.title}`}>{title}</p>}
      <div>{children}</div>
    </div>
  );
}
