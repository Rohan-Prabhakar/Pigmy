"use client";

import { useEffect, useState } from "react";
import type { SettingsState } from "@/lib/product/types";

export function SettingsConsole() {
  const [settings, setSettings] = useState<SettingsState | null>(null);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    const response = await fetch("/api/settings");
    const data = (await response.json()) as { settings: SettingsState };
    setSettings(data.settings);
  }

  async function saveSettings() {
    if (!settings) return;
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    await loadSettings();
  }

  if (!settings) {
    return (
      <div className="rounded-[24px] border border-[rgba(93,105,160,0.16)] bg-white/78 p-6 text-sm text-[#66708f] backdrop-blur-xl">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[24px] border border-[rgba(93,105,160,0.16)] bg-white/78 p-4 backdrop-blur-xl">
        <p className="text-sm font-semibold text-[#151828]">Model routing</p>
        <div className="mt-4 space-y-3">
          {[
            ["Fast model", "fastModel"],
            ["Deep model", "deepModel"],
            ["Red herring model", "redHerringModel"],
          ].map(([label, key]) => (
            <label key={key} className="block">
              <span className="text-xs tracking-[0.12em] text-[#66708f]">{label}</span>
              <input
                className="mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm outline-none"
                value={settings.modelRouting[key as keyof typeof settings.modelRouting]}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          modelRouting: {
                            ...current.modelRouting,
                            [key]: event.target.value,
                          },
                        }
                      : current
                  )
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-[24px] border border-[rgba(93,105,160,0.16)] bg-white/78 p-4 backdrop-blur-xl">
        <p className="text-sm font-semibold text-[#151828]">Retrieval</p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-[#66708f]">
            <input
              type="checkbox"
              checked={settings.retrieval.enabled}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? {
                        ...current,
                        retrieval: {
                          ...current.retrieval,
                          enabled: event.target.checked,
                        },
                      }
                    : current
                )
              }
            />
            Enable hybrid retrieval
          </label>
          <label className="block">
            <span className="text-xs tracking-[0.12em] text-[#66708f]">Top K</span>
            <input
              className="mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm outline-none"
              value={settings.retrieval.topK}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? {
                        ...current,
                        retrieval: {
                          ...current.retrieval,
                          topK: Number(event.target.value),
                        },
                      }
                    : current
                )
              }
            />
          </label>
          <label className="block">
            <span className="text-xs tracking-[0.12em] text-[#66708f]">Audit retention days</span>
            <input
              className="mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm outline-none"
              value={settings.auditRetentionDays}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, auditRetentionDays: Number(event.target.value) }
                    : current
                )
              }
            />
          </label>
        </div>
      </div>

      <div className="rounded-[24px] border border-[rgba(93,105,160,0.16)] bg-white/78 p-4 backdrop-blur-xl lg:col-span-2">
        <button
          type="button"
          onClick={() => void saveSettings()}
          className="rounded-full border border-[rgba(108,114,255,0.28)] bg-[linear-gradient(180deg,#7d83ff,#6c72ff)] px-4 py-2 text-sm font-medium text-white"
        >
          Save settings
        </button>
      </div>
    </div>
  );
}
