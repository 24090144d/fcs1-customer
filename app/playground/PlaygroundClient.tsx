'use client';

import { useEffect, useMemo, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

type Generated = {
  organization_id: string;
  module_code: 'im' | 'jo';
  title: string;
  chart_type: string;
  query_spec_json: Record<string, unknown>;
  chart_config_json: Highcharts.Options;
  assistant_text: string;
};

type SavedChart = {
  id: string;
  title: string;
  chart_type: string;
  module_code: string;
  chart_config_json: Highcharts.Options;
  is_hidden: boolean;
};

function getUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  const k = 'fcs1_user_id';
  let v = localStorage.getItem(k);
  if (!v) {
    v = `user_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(k, v);
  }
  return v;
}

export default function PlaygroundClient() {
  const [prompt, setPrompt] = useState('Show monthly incidents by severity');
  const [moduleCode, setModuleCode] = useState<'im' | 'jo'>('im');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [saved, setSaved] = useState<SavedChart[]>([]);
  const userId = useMemo(() => getUserId(), []);

  async function loadSaved() {
    const res = await fetch(`/api/ai/charts/list?user_id=${encodeURIComponent(userId)}`);
    const body = await res.json();
    setSaved(body.charts ?? []);
  }

  useEffect(() => {
    void loadSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateChart() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/charts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, module_code: moduleCode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Generation failed');
      setGenerated(body);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  async function saveChart() {
    if (!generated) return;
    const res = await fetch('/api/ai/charts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...generated,
        prompt,
        created_by: userId,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      alert(body.error ?? 'Save failed');
      return;
    }
    await loadSaved();
    alert('Chart saved.');
  }

  async function toggleHidden(chart: SavedChart) {
    const res = await fetch('/api/ai/charts/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, chart_id: chart.id, is_hidden: !chart.is_hidden }),
    });
    if (!res.ok) {
      alert('Failed to update visibility');
      return;
    }
    await loadSaved();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="p-4 border rounded-lg bg-white/70">
        <h1 className="text-xl font-semibold">AI Chart Playground</h1>
        <p className="text-sm text-slate-600 mt-1">Generate tenant-scoped chart previews from your DB, then save and hide/unhide per user.</p>
      </div>

      <div className="p-4 border rounded-lg bg-white/70 space-y-3">
        <div className="flex gap-2 items-center">
          <select
            className="border px-2 py-1 rounded"
            value={moduleCode}
            onChange={(e) => setModuleCode(e.target.value as 'im' | 'jo')}
          >
            <option value="im">IM</option>
            <option value="jo">JO</option>
          </select>
          <input
            className="border px-3 py-2 rounded flex-1"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask for a chart..."
          />
          <button onClick={() => void generateChart()} className="px-4 py-2 bg-slate-900 text-white rounded" disabled={loading}>
            {loading ? 'Generating...' : 'Generate'}
          </button>
          <button onClick={() => void saveChart()} className="px-4 py-2 bg-teal-700 text-white rounded" disabled={!generated}>
            Save
          </button>
        </div>
        {generated && <p className="text-sm text-slate-700">{generated.assistant_text}</p>}
      </div>

      {generated && (
        <div className="p-4 border rounded-lg bg-white/70">
          <h2 className="font-semibold mb-3">Preview: {generated.title}</h2>
          <HighchartsReact highcharts={Highcharts} options={generated.chart_config_json} />
        </div>
      )}

      <div className="p-4 border rounded-lg bg-white/70">
        <h2 className="font-semibold mb-3">Saved Charts</h2>
        <div className="space-y-2">
          {saved.map((c) => (
            <div key={c.id} className="flex items-center justify-between border rounded px-3 py-2">
              <div>
                <p className="font-medium">{c.title}</p>
                <p className="text-xs text-slate-500">{c.module_code.toUpperCase()} · {c.chart_type}</p>
              </div>
              <button className="text-xs px-3 py-1 border rounded" onClick={() => void toggleHidden(c)}>
                {c.is_hidden ? 'Unhide in sidebar' : 'Hide from sidebar'}
              </button>
            </div>
          ))}
          {saved.length === 0 && <p className="text-sm text-slate-500">No saved charts yet.</p>}
        </div>
      </div>
    </div>
  );
}
