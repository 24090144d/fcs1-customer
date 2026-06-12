import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardHeaderActions } from '@/components/layout/DashboardHeaderActions';
import { fetchDashboard, fetchCorpDashboard, fetchChainEntries, fetchCoRows } from '@/lib/dashboard-fetch';
import type { DashboardJson, ChainEntry } from '@/types/dashboard';
import type { CoRow } from '@/types/csv';
import { MyDashboardClient, type MyDashModuleData } from './MyDashboardClient';

export const dynamic = 'force-dynamic';
export const generateStaticParams = async () => [];

const MODULES = ['jo', 'mo', 'co', 'im'] as const;

export default async function MyDashboardPage({
  searchParams,
}: {
  searchParams: { scope?: string; chain?: string; hotel?: string };
}) {
  const scope = searchParams.scope === 'corp' ? 'corp' : 'hotel';
  const chain = String(searchParams.chain ?? '').trim().toUpperCase();
  const title = `${scope === 'hotel' ? 'My Hotel' : 'My Corp'}${chain ? ` - ${chain}` : ''}`;

  const modules: Record<string, MyDashModuleData> = {};
  let hotels: string[] = [];
  let hotel = String(searchParams.hotel ?? '').trim().toUpperCase();

  if (chain) {
    if (scope === 'corp') {
      for (const mod of MODULES) {
        const { data, chainEntries } = await fetchCorpDashboard(chain, mod);
        const coRows: CoRow[] = mod === 'co' && data ? await fetchCoRows('CORP', chain) : [];
        modules[mod] = { data, chainEntries, coRows };
      }
    } else {
      // Hotel scope — derive the chain's hotel list, then fetch each module
      // for the selected hotel.
      const entriesByModule: Record<string, ChainEntry[]> = {};
      const hotelSet = new Set<string>();
      for (const mod of MODULES) {
        const entries = await fetchChainEntries(chain, '', mod);
        entriesByModule[mod] = entries;
        for (const e of entries) {
          const code = (e.hotel_code ?? '').toUpperCase();
          if (code && code !== 'CORP') hotelSet.add(code);
        }
      }
      hotels = Array.from(hotelSet).sort();
      if (!hotel || !hotels.includes(hotel)) hotel = hotels[0] ?? '';

      for (const mod of MODULES) {
        let data: DashboardJson | null = null;
        if (hotel) {
          data = await fetchDashboard(hotel, mod);
          // Guard against the JO latest-row fallback returning another chain's data.
          if (data && (data.meta.chain_code ?? '').toUpperCase() !== chain) data = null;
          if (data && (data.meta.hotel_code ?? '').toUpperCase() !== hotel) data = null;
        }
        // CO is not hotel-scoped on My Hotel — CO uploads use their own
        // sub-property codes (e.g. WMET/WMWT), so always use the chain's rows.
        const coRows: CoRow[] = mod === 'co' ? await fetchCoRows('CORP', chain) : [];
        modules[mod] = { data, chainEntries: entriesByModule[mod] ?? [], coRows };
      }
    }
  }

  return (
    <AppLayout breadcrumbs={[{ label: 'My Dashboard' }, { label: title }]} headerRight={<DashboardHeaderActions />}>
      <MyDashboardClient
        scope={scope}
        chain={chain}
        hotel={hotel}
        hotels={hotels}
        modules={modules}
      />
    </AppLayout>
  );
}
