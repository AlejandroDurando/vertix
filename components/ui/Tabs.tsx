"use client";

type Tab<T extends string> = {
  value: T;
  label: string;
};

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<T>[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-lg bg-vertix/5 p-1">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
              isActive
                ? "bg-white text-vertix shadow-sm"
                : "text-vertix/60 hover:text-vertix"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
