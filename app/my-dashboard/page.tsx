import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardHeaderActions } from '@/components/layout/DashboardHeaderActions';
import { fetchDashboard, fetchCorpDashboard, fetchChainEntries, fetchCoIrRows, fetchCoRows } from '@/lib/dashboard-fetch';
import type { DashboardJson, ChainEntry } from '@/types/dashboard';
import type { CoIrRow, CoRow } from '@/types/csv';
import { MyDashboardClient, type MyDashModuleData } from './MyDashboardClient';

export const dynamic = 'force-dynamic';
export const generateStaticParams = async () => [];

const MODULES = ['jo', 'mo', 'co', 'co-ir', 'im'] as const;

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
        const coIrRows: CoIrRow[] = mod === 'co-ir' ? await fetchCoIrRows('CORP', chain) : [];
        modules[mod] = { data, chainEntries, coRows, coIrRows };
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
        // If the selected hotel has no data for this module, fall back to any hotel
        // in chainEntries that does — so My Hotel shows MO/IM/JO even when the
        // alphabetically-first hotel hasn't uploaded that module yet.
        if (!data && mod !== 'co') {
          const altHotel = entriesByModule[mod]?.find(
            (e) => e.hotel_code && e.hotel_code.toUpperCase() !== hotel.toUpperCase(),
          )?.hotel_code;
          if (altHotel) {
            const altData = await fetchDashboard(altHotel, mod);
            if (altData && (altData.meta.chain_code ?? '').toUpperCase() === chain) data = altData;
          }
        }
        // CO is not hotel-scoped on My Hotel — CO uploads use their own
        // sub-property codes (e.g. WMET/WMWT), so always use the chain's rows.
        const coRows: CoRow[] = mod === 'co' ? await fetchCoRows('CORP', chain) : [];
        const coIrRows: CoIrRow[] = mod === 'co-ir' && hotel ? await fetchCoIrRows(hotel, chain) : [];
        modules[mod] = { data, chainEntries: entriesByModule[mod] ?? [], coRows, coIrRows };
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
