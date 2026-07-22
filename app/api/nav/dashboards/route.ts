import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';


type SbR<T> = { data: T | null; error: unknown };
type DashRow = {
  generated_json: {
    meta?: {
      chain_code?: string;
      hotel_code?: string;
      hotel_name?: string;
      country_code?: string;
      generated_at?: string;
      schema?: string;
    };
  };
  generated_at?: string;
};

export interface NavDashItem {
  module:       'im' | 'jo' | 'mo' | 'co' | 'co-ir';
  hotel_code:   string;
  hotel_name:   string;
  country_code: string;
  label:        string;
  href:         string;
  scope?:       'hotel' | 'corp';
}

export interface NavChain {
  chain: string;
  items: NavDashItem[];
}

export async function GET() {
  noStore();
  try {
    const sb = createAdminClient();
    const [{ data: imRows }, { data: joRows }, { data: moRows }, { data: coRows }] = await Promise.all([
      sb.from('im_dashboard_json').select('generated_json, generated_at').order('generated_at', { ascending: false }) as unknown as Promise<SbR<DashRow[]>>,
      sb.from('jo_dashboard_json').select('generated_json, generated_at').order('generated_at', { ascending: false }) as unknown as Promise<SbR<DashRow[]>>,
      sb.from('mo_dashboard_json').select('generated_json, generated_at').order('generated_at', { ascending: false }) as unknown as Promise<SbR<DashRow[]>>,
      sb.from('co_dashboard_json').select('generated_json, generated_at').order('generated_at', { ascending: false }) as unknown as Promise<SbR<DashRow[]>>,
    ]);

    type NavModule = NavDashItem['module'];
    const chainMap = new Map<string, Map<string, { hotel_name: string; country_code: string; mods: Set<NavModule> }>>();
    const seen = new Set<string>(); // module|chain|hotel

    const addRow = (module: NavModule, row: DashRow) => {
      const m = row.generated_json?.meta;
      if (!m) return;
      const chain = (m.chain_code ?? '').trim().toUpperCase();
      const hotel = (m.hotel_code ?? '').trim().toUpperCase();
      if (!chain || !hotel) return;
      const key = `${module}|${chain}|${hotel}`;
      if (seen.has(key)) return; // keep latest only due to desc order
      seen.add(key);
      if (!chainMap.has(chain)) chainMap.set(chain, new Map());
      const hotelMap = chainMap.get(chain)!;
      if (!hotelMap.has(hotel)) {
        hotelMap.set(hotel, {
          hotel_name: (m.hotel_name ?? '').trim(),
          country_code: (m.country_code ?? '').trim().toUpperCase(),
          mods: new Set(),
        });
      }
      hotelMap.get(hotel)!.mods.add(module);
    };

    for (const r of (imRows ?? [])) addRow('im', r);
    for (const r of (joRows ?? [])) addRow('jo', r);
    for (const r of (moRows ?? [])) addRow('mo', r);
    for (const r of (coRows ?? [])) addRow(r.generated_json?.meta?.schema === 'co-ir-v1' ? 'co-ir' : 'co', r);

    if (chainMap.size === 0) return NextResponse.json({ chains: [] });

    const chains: NavChain[] = Array.from(chainMap.entries()).map(([chain, hotelMap]) => {
      const items: NavDashItem[] = [];

      for (const moduleCode of ['im', 'jo', 'mo', 'co', 'co-ir'] as const) {
        const hotelsForModule = Array.from(hotelMap.entries())
          .filter(([, { mods }]) => mods.has(moduleCode))
          .sort(([a], [b]) => a.localeCompare(b));

        if (hotelsForModule.length >= 2) {
          items.push({
            module: moduleCode,
            hotel_code: 'CORP',
            hotel_name: 'Corp',
            country_code: '',
            label: moduleCode === 'im' ? 'Corp · IM' : moduleCode === 'jo' ? 'Corp · JO' : moduleCode === 'mo' ? 'Corp · MO' : moduleCode === 'co-ir' ? 'Corp · CO IR' : 'Corp · CO ACSR',
            href: `/dashboard?hotel=corp&chain=${encodeURIComponent(chain)}&module=${moduleCode}`,
            scope: 'corp',
          });
        }

        for (const [hotel_code, { hotel_name, country_code }] of hotelsForModule) {
          items.push({
            module: moduleCode,
            hotel_code,
            hotel_name,
            country_code,
            label: `${hotel_code} · ${moduleCode === 'co' ? 'CO ACSR' : moduleCode === 'co-ir' ? 'CO IR' : moduleCode.toUpperCase()}`,
            href: moduleCode === 'im'
              ? `/dashboard?hotel=${hotel_code}&chain=${encodeURIComponent(chain)}`
              : `/dashboard?module=${moduleCode}&hotel=${hotel_code}&chain=${encodeURIComponent(chain)}`,
            scope: 'hotel',
          });
        }
      }

      return { chain, items };
    });

    return NextResponse.json({ chains });
  } catch (e) {
    console.error('[nav/dashboards]', e);
    return NextResponse.json({ chains: [] });
  }
}
